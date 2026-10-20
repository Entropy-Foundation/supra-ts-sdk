import { TxnBuilderTypes, type SupraAccount } from "supra-l1-sdk-core";
import type { AccountAddressInput } from "../../types/account";
import type { TransactionResponse } from "../../types/transaction";
import type { OptionalTransactionPayloadArgs } from "../../types/transactionManager/transactionBuild";
import type { NetworkConfig } from "../../utils/apiEndpoints";
import {
    DEFAULT_MAX_GAS_ESTIMATE_MULTIPLIER,
    DEFAULT_MAX_GAS_UNITS,
    MAX_GAS_UNITS_PER_TRANSACTION,
    MIN_ESTIMATED_MAX_GAS_UNITS,
    SUPRA_COIN_TYPE,
} from "../../utils/constants";
import { standardizeAddress } from "../../helper/account";
import { SupraSimulationFailedError } from "../../errors/transactionError";
import { viewRawInternal } from "../methods";
import { sequenceNumberTrackerOf, type SequenceNumberReservation } from "../sequenceNumber";
import { isSequenceNumberTooNew, MAX_TOO_NEW_CHECKS, resolveSequenceNumberTooNewInternal } from "./behindPending";
import { SupraGasUnitPriceBelowMinimumError } from "../../errors/apiError";
import { resolveGasUnitPriceInternal } from "./gasPrice";
import { simulateTxnInternal } from "./txnSimulate";
import { sendTxnPayloadInternal, withSequenceNumber } from "./txnBuild";

/** Returns `value` when it is a finite number of at least 1, and throws otherwise. */
export function validateMaxGasEstimateMultiplier(value: number): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
        throw new Error(`maxGasEstimateMultiplier must be a finite number of at least 1, got ${String(value)}`);
    }
    return value;
}

/**
 * The max gas that the call or the client sets, or `undefined` when neither sets one. The builders that make no
 * request use `DEFAULT_MAX_GAS_UNITS` in that case.
 */
export function explicitMaxGasOf(
    optionalTransactionPayloadArgs: OptionalTransactionPayloadArgs | undefined,
    config: NetworkConfig,
): bigint | undefined {
    return optionalTransactionPayloadArgs?.maxGas ?? config.maxGas;
}

/**
 * The largest number of gas units that the sender's SUPRA balance pays for at `gasUnitPrice`, at most
 * `MAX_GAS_UNITS_PER_TRANSACTION`. The node accepts a transaction only when the sender's balance pays for
 * `max gas × gas unit price`.
 */
export async function affordableGasUnitsInternal(
    args: { senderAddress: AccountAddressInput; gasUnitPrice: bigint },
    config: NetworkConfig,
): Promise<bigint> {
    const [balance] = await viewRawInternal<[string | number]>(
        {
            function: "0x1::coin::balance",
            typeArguments: [SUPRA_COIN_TYPE],
            functionArguments: [standardizeAddress(args.senderAddress)],
        },
        config,
    );
    if (args.gasUnitPrice <= 0n) {
        return MAX_GAS_UNITS_PER_TRANSACTION;
    }
    const units = BigInt(balance) / args.gasUnitPrice;
    return units < MAX_GAS_UNITS_PER_TRANSACTION ? units : MAX_GAS_UNITS_PER_TRANSACTION;
}

/**
 * The max gas of a transaction, and the sequence number to build it with when the estimate gave its reservation
 * another number (`undefined` otherwise).
 */
export interface ResolvedMaxGas {
    maxGas: bigint;
    sequenceNumber: bigint | undefined;
}

/**
 * Resolves the max gas of a transaction:
 *
 * 1. The call's `maxGas`, else the client's `maxGas`.
 * 2. With estimation turned off (`estimateMaxGas: false` on the call, else on the client): `DEFAULT_MAX_GAS_UNITS`.
 * 3. Otherwise the transaction built by `buildRawTxn` with the largest number of gas units that the sender's balance
 *    pays for (`affordable`) is simulated with `senderAccount`, and the max gas is
 *    `ceil(gas used × multiplier)`, at least `MIN_ESTIMATED_MAX_GAS_UNITS`, at most `affordable`. The multiplier is the
 *    client's `maxGasEstimateMultiplier`, else `DEFAULT_MAX_GAS_ESTIMATE_MULTIPLIER`.
 *
 * The balance limit uses the transaction's gas unit price: the call's, else the client's, else the node's estimate
 * (`resolveGasUnitPriceInternal`). The builders pass the price resolved for the transaction, so the estimate is read
 * once. A failed read of the estimate is thrown.
 *
 * A simulation whose status is not `Success` (a `Fail` with an abort, `OUT_OF_GAS`, `PendingAfterExecution`,
 * `Invalid`) throws its `SupraSimulationFailedError`, except one refused for a gas unit price below the node's minimum,
 * which throws `SupraGasUnitPriceBelowMinimumError`. Nothing is submitted. When the transaction's sequence number
 * is ahead of the account's number on the chain, the simulation reports `SEQUENCE_NUMBER_TOO_NEW`, and
 * `resolveSequenceNumberTooNewInternal` reads the account and the latest block:
 *
 * - When every number from the chain's up to the transaction's has a record of a submission of this client, the same
 *   transaction is simulated with the chain's number and that result is used. If that simulation reports a stale
 *   sequence number, the chain is read and the simulation made once more; a second stale result is thrown.
 * - Otherwise, with `reservation` (a number from the client's counter), the reservation is given the lowest number
 *   without a record, the transaction is built with it, and the estimate continues with it (`sequenceNumber` of the
 *   result), at most twice; without `reservation` the `SEQUENCE_NUMBER_TOO_NEW` failure is thrown.
 * - A failed read of the account is thrown, and nothing is submitted.
 *
 * When any simulation of the estimate reports `INSUFFICIENT_BALANCE_FOR_TRANSACTION_FEE` because an earlier
 * transaction committed after the balance was read, the balance is read again (at most twice in one estimate) and the
 * simulation is made with what the new balance pays for; when the new balance still pays for the simulated max gas,
 * the failure is thrown. A transaction that depends on the state of an earlier one that has not committed fails the
 * simulation at the chain's number and throws. Signing a simulated transaction throws what signing throws, for example
 * `SupraChainIdMismatchError` or the error of a failed read of the chain ID, before the simulation is requested. When
 * there is no `senderAccount`, or the balance read fails, or the simulation fails for a reason that is not a
 * simulation result (a request error, a response without `gas_used`), the max gas is `DEFAULT_MAX_GAS_UNITS`, at most
 * `affordable` when that is known and not zero. After a balance read made again during the estimate, `affordable` is
 * the lowest number of units a read paid for.
 */
export async function resolveMaxGasInternal(
    args: {
        senderAddress: AccountAddressInput;
        senderAccount?: SupraAccount | undefined;
        optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs | undefined;
        buildRawTxn: (maxGas: bigint) => TxnBuilderTypes.RawTransaction;
        /** The reservation of the transaction's sequence number, when the number came from the client's counter. */
        reservation?: SequenceNumberReservation | undefined;
    },
    config: NetworkConfig,
): Promise<ResolvedMaxGas> {
    const options = args.optionalTransactionPayloadArgs;
    const explicit = explicitMaxGasOf(options, config);
    if (explicit !== undefined) {
        return { maxGas: explicit, sequenceNumber: undefined };
    }
    if ((options?.estimateMaxGas ?? config.estimateMaxGas ?? true) === false) {
        return { maxGas: DEFAULT_MAX_GAS_UNITS, sequenceNumber: undefined };
    }

    // The builders pass a price already resolved; a failed read of the node's estimate is thrown, not a fallback case.
    const gasUnitPrice = await resolveGasUnitPriceInternal(options, config);
    let affordable: bigint;
    try {
        affordable = await affordableGasUnitsInternal({ senderAddress: args.senderAddress, gasUnitPrice }, config);
    } catch {
        return { maxGas: DEFAULT_MAX_GAS_UNITS, sequenceNumber: undefined };
    }
    if (affordable === 0n || args.senderAccount === undefined) {
        return { maxGas: fallbackMaxGas(affordable), sequenceNumber: undefined };
    }

    const simulations = new EstimateSimulations(
        { senderAccount: args.senderAccount, senderAddress: args.senderAddress, buildRawTxn: args.buildRawTxn },
        affordable,
        config,
    );
    const sender = standardizeAddress(simulations.rawTxn.sender.toHexString().toString());
    let moved: bigint | undefined;
    let simulated: TransactionResponse | undefined;
    for (let checks = 0; ; checks += 1) {
        const sequenceNumber = BigInt(simulations.rawTxn.sequence_number);
        try {
            simulated = await simulations.simulate();
            if (simulated !== undefined) {
                // The simulation at the transaction's own number ran, so that number is the account's number on the
                // chain.
                sequenceNumberTrackerOf(config).observeChainSequenceNumber(sender, sequenceNumber);
            }
            break;
        } catch (error) {
            if (!isSequenceNumberTooNew(error) || checks >= MAX_TOO_NEW_CHECKS) {
                throw error;
            }
            const outcome = await resolveSequenceNumberTooNewInternal(
                {
                    address: sender,
                    sequenceNumber,
                    reservation: args.reservation,
                    tooNew: error,
                    simulateAt: (chainNumber) => simulations.simulate(chainNumber),
                },
                config,
            );
            if (outcome.kind === "simulated") {
                simulated = outcome.result;
                break;
            }
            moved = outcome.sequenceNumber;
            simulations.useSequenceNumber(moved);
        }
    }
    // A simulation may have lowered `affordable` after a new balance read; the fallback uses the lowest value.
    const gasUsed = simulated === undefined ? undefined : gasUsedOf(simulated);
    if (gasUsed === undefined) {
        return { maxGas: fallbackMaxGas(simulations.affordable), sequenceNumber: moved };
    }
    const multiplier = config.maxGasEstimateMultiplier ?? DEFAULT_MAX_GAS_ESTIMATE_MULTIPLIER;
    const estimate = BigInt(Math.ceil(gasUsed * multiplier));
    return {
        maxGas: minBigInt(
            estimate > MIN_ESTIMATED_MAX_GAS_UNITS ? estimate : MIN_ESTIMATED_MAX_GAS_UNITS,
            simulations.affordable,
        ),
        sequenceNumber: moved,
    };
}

/**
 * The max gas of an estimate that has no simulation result: `DEFAULT_MAX_GAS_UNITS`, at most `affordable`. With no
 * balance the node rejects the transaction whatever its max gas, so a zero `affordable` gives `DEFAULT_MAX_GAS_UNITS`
 * and the node reports the reason.
 */
function fallbackMaxGas(affordable: bigint): bigint {
    return affordable === 0n ? DEFAULT_MAX_GAS_UNITS : minBigInt(DEFAULT_MAX_GAS_UNITS, affordable);
}

/** The number of times one estimate reads the balance again after a simulation reports it short. */
const MAX_BALANCE_REREADS = 2;

/**
 * The simulations of one max gas estimate. `rawTxn` is the transaction built with `affordable`, the lowest number of
 * gas units that a read of the sender's balance paid for.
 */
class EstimateSimulations {
    affordable: bigint;
    rawTxn: TxnBuilderTypes.RawTransaction;
    private balanceReads = 0;
    /** The number the transaction is built with instead of the one `buildRawTxn` gives it. */
    private sequenceNumber: bigint | undefined;

    constructor(
        private readonly args: {
            senderAccount: SupraAccount;
            senderAddress: AccountAddressInput;
            buildRawTxn: (maxGas: bigint) => TxnBuilderTypes.RawTransaction;
        },
        affordable: bigint,
        private readonly config: NetworkConfig,
    ) {
        this.affordable = affordable;
        this.rawTxn = args.buildRawTxn(affordable);
    }

    /** Builds `rawTxn`, and the transactions built later, with `sequenceNumber`. */
    useSequenceNumber(sequenceNumber: bigint): void {
        this.sequenceNumber = sequenceNumber;
        this.rawTxn = withSequenceNumber(this.rawTxn, sequenceNumber);
    }

    private build(maxGas: bigint): TxnBuilderTypes.RawTransaction {
        const rawTxn = this.args.buildRawTxn(maxGas);
        return this.sequenceNumber === undefined ? rawTxn : withSequenceNumber(rawTxn, this.sequenceNumber);
    }

    /**
     * Simulates `rawTxn` with `sequenceNumber`, or with its own number when that is omitted, and returns the simulated
     * transaction.
     *
     * Signing checks the chain ID; its errors are thrown, as the signature of the submitted transaction would throw
     * them. A simulation that reports `INSUFFICIENT_BALANCE_FOR_TRANSACTION_FEE` means that an earlier transaction
     * committed after the balance was read: the balance is read again (at most `MAX_BALANCE_REREADS` times in one
     * estimate), and when it pays for fewer units than the simulated max gas, the transaction is rebuilt with that
     * number and simulated again. When the new balance still pays for the simulated max gas, the failure is thrown.
     * Any other failed simulation throws its `SupraSimulationFailedError`. Returns `undefined` when a request fails or
     * the new balance is zero.
     */
    async simulate(sequenceNumber?: bigint): Promise<TransactionResponse | undefined> {
        for (;;) {
            const rawTxn = sequenceNumber === undefined ? this.rawTxn : withSequenceNumber(this.rawTxn, sequenceNumber);
            const sendTxPayload = await sendTxnPayloadInternal(
                { senderAccount: this.args.senderAccount, rawTxn },
                this.config,
            );
            try {
                return await simulateTxnInternal({ sendTxPayload }, this.config);
            } catch (error) {
                if (error instanceof SupraGasUnitPriceBelowMinimumError) {
                    throw error;
                }
                if (!(error instanceof SupraSimulationFailedError)) {
                    return undefined;
                }
                if (
                    error.major_status !== "INSUFFICIENT_BALANCE_FOR_TRANSACTION_FEE" ||
                    this.balanceReads >= MAX_BALANCE_REREADS
                ) {
                    throw error;
                }
                this.balanceReads += 1;
                let affordable: bigint;
                try {
                    affordable = await affordableGasUnitsInternal(
                        { senderAddress: this.args.senderAddress, gasUnitPrice: BigInt(rawTxn.gas_unit_price) },
                        this.config,
                    );
                } catch {
                    return undefined;
                }
                if (affordable >= BigInt(rawTxn.max_gas_amount)) {
                    throw error;
                }
                this.affordable = affordable;
                if (affordable === 0n) {
                    return undefined;
                }
                this.rawTxn = this.build(affordable);
            }
        }
    }
}

function gasUsedOf(transaction: TransactionResponse): number | undefined {
    const output = (transaction as { output?: unknown }).output;
    if (output === null || typeof output !== "object" || !("Move" in output)) {
        return undefined;
    }
    const gasUsed = Number((output as { Move?: { gas_used?: unknown } }).Move?.gas_used);
    return Number.isSafeInteger(gasUsed) && gasUsed >= 0 ? gasUsed : undefined;
}

function minBigInt(a: bigint, b: bigint): bigint {
    return a < b ? a : b;
}
