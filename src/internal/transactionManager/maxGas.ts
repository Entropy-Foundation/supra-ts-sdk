import { TxnBuilderTypes, type SupraAccount } from "supra-l1-sdk-core";
import type { AccountAddressInput } from "../../types/account";
import type { TransactionResponse } from "../../types/transaction";
import type { OptionalTransactionPayloadArgs } from "../../types/transactionManager/transactionBuild";
import type { NetworkConfig } from "../../utils/apiEndpoints";
import {
    DEFAULT_GAS_PRICE,
    DEFAULT_MAX_GAS_ESTIMATE_MULTIPLIER,
    DEFAULT_MAX_GAS_UNITS,
    MAX_GAS_UNITS_PER_TRANSACTION,
    MIN_ESTIMATED_MAX_GAS_UNITS,
    SUPRA_COIN_TYPE,
} from "../../utils/constants";
import { standardizeAddress } from "../../helper/account";
import { SupraSimulationFailedError } from "../../errors/transactionError";
import { getAccountInfoInternal } from "../account";
import { viewRawInternal } from "../methods";
import { simulateTxnInternal } from "./txnSimulate";
import { sendTxnPayloadInternal } from "./txnBuild";

/** Returns `value` when it is a finite number of at least 1, and throws otherwise. */
export function validateMaxGasEstimateMultiplier(value: number): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
        throw new Error(`maxGasEstimateMultiplier must be a finite number of at least 1, got ${String(value)}`);
    }
    return value;
}

/** The gas unit price of a transaction: the call's, else the client's, else `DEFAULT_GAS_PRICE`. */
export function gasUnitPriceOf(
    optionalTransactionPayloadArgs: OptionalTransactionPayloadArgs | undefined,
    config: NetworkConfig,
): bigint {
    return optionalTransactionPayloadArgs?.gasUnitPrice ?? config.minGasUnitPrice ?? DEFAULT_GAS_PRICE;
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
 * Resolves the max gas of a transaction:
 *
 * 1. The call's `maxGas`, else the client's `maxGas`.
 * 2. With estimation turned off (`estimateMaxGas: false` on the call, else on the client): `DEFAULT_MAX_GAS_UNITS`.
 * 3. Otherwise the transaction built by `buildRawTxn` with the largest number of gas units that the sender's balance
 *    pays for (`affordable`) is simulated with `senderAccount`, and the max gas is
 *    `ceil(gas used × multiplier)`, at least `MIN_ESTIMATED_MAX_GAS_UNITS`, at most `affordable`. The multiplier is the
 *    client's `maxGasEstimateMultiplier`, else `DEFAULT_MAX_GAS_ESTIMATE_MULTIPLIER`.
 *
 * A simulation whose status is not `Success` (a `Fail` with an abort, `OUT_OF_GAS`, `PendingAfterExecution`,
 * `Invalid`) throws its `SupraSimulationFailedError`, and nothing is submitted. When the transaction's sequence number
 * is ahead of the account's number on the chain, because an earlier transaction of the account has not committed, the
 * simulation reports `SEQUENCE_NUMBER_TOO_NEW`: the same transaction is then simulated with the chain's number, and
 * that result is used. If that simulation reports a stale sequence number again, the number is read and the
 * simulation made once more; if it is stale a second time, or the account cannot be read, the max gas is
 * `DEFAULT_MAX_GAS_UNITS`, at most `affordable`. When any simulation of the estimate reports
 * `INSUFFICIENT_BALANCE_FOR_TRANSACTION_FEE` because an earlier transaction committed after the balance was read, the
 * balance is read again (at most twice in one estimate) and the simulation is made with what the new balance pays
 * for; when the new balance still pays for the simulated max gas, the failure is thrown.
 * A transaction that depends on the state of an earlier one that has not
 * committed fails the simulation at the chain's number and throws. Signing a simulated transaction throws what signing
 * throws, for example `SupraChainIdMismatchError` or the error of a failed read of the chain ID, before the simulation
 * is requested. When there
 * is no `senderAccount`, or the balance read fails, or the simulation fails for a reason that is not a simulation
 * result (a request error, a response without `gas_used`), the max gas is `DEFAULT_MAX_GAS_UNITS`, at most
 * `affordable` when that is known and not zero. After a balance read made again during the estimate, `affordable` is
 * the lowest number of units a read paid for.
 */
export async function resolveMaxGasInternal(
    args: {
        senderAddress: AccountAddressInput;
        senderAccount?: SupraAccount | undefined;
        optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs | undefined;
        buildRawTxn: (maxGas: bigint) => TxnBuilderTypes.RawTransaction;
    },
    config: NetworkConfig,
): Promise<bigint> {
    const options = args.optionalTransactionPayloadArgs;
    const explicit = explicitMaxGasOf(options, config);
    if (explicit !== undefined) {
        return explicit;
    }
    if ((options?.estimateMaxGas ?? config.estimateMaxGas ?? true) === false) {
        return DEFAULT_MAX_GAS_UNITS;
    }

    let affordable: bigint;
    try {
        affordable = await affordableGasUnitsInternal(
            { senderAddress: args.senderAddress, gasUnitPrice: gasUnitPriceOf(options, config) },
            config,
        );
    } catch {
        return DEFAULT_MAX_GAS_UNITS;
    }
    if (affordable === 0n || args.senderAccount === undefined) {
        return fallbackMaxGas(affordable);
    }

    const simulations = new EstimateSimulations(
        { senderAccount: args.senderAccount, senderAddress: args.senderAddress, buildRawTxn: args.buildRawTxn },
        affordable,
        config,
    );
    let simulated: TransactionResponse | undefined;
    try {
        simulated = await simulations.simulate();
    } catch (error) {
        if (!(error instanceof SupraSimulationFailedError) || !isSequenceNumberTooNew(error)) {
            throw error;
        }
        simulated = await simulateAtChainSequenceNumber(simulations, config);
    }
    // A simulation may have lowered `affordable` after a new balance read; the fallback uses the lowest value.
    const gasUsed = simulated === undefined ? undefined : gasUsedOf(simulated);
    if (gasUsed === undefined) {
        return fallbackMaxGas(simulations.affordable);
    }
    const multiplier = config.maxGasEstimateMultiplier ?? DEFAULT_MAX_GAS_ESTIMATE_MULTIPLIER;
    const estimate = BigInt(Math.ceil(gasUsed * multiplier));
    return minBigInt(
        estimate > MIN_ESTIMATED_MAX_GAS_UNITS ? estimate : MIN_ESTIMATED_MAX_GAS_UNITS,
        simulations.affordable,
    );
}

/**
 * The max gas of an estimate that has no simulation result: `DEFAULT_MAX_GAS_UNITS`, at most `affordable`. With no
 * balance the node rejects the transaction whatever its max gas, so a zero `affordable` gives `DEFAULT_MAX_GAS_UNITS`
 * and the node reports the reason.
 */
function fallbackMaxGas(affordable: bigint): bigint {
    return affordable === 0n ? DEFAULT_MAX_GAS_UNITS : minBigInt(DEFAULT_MAX_GAS_UNITS, affordable);
}

function isSequenceNumberTooNew(error: SupraSimulationFailedError): boolean {
    return error.major_status === "SEQUENCE_NUMBER_TOO_NEW";
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
                this.rawTxn = this.args.buildRawTxn(affordable);
            }
        }
    }
}

/** `rawTxn` with another sequence number and the same sender, payload, max gas, gas unit price, expiry and chain ID. */
function withSequenceNumber(
    rawTxn: TxnBuilderTypes.RawTransaction,
    sequenceNumber: bigint,
): TxnBuilderTypes.RawTransaction {
    return new TxnBuilderTypes.RawTransaction(
        rawTxn.sender,
        sequenceNumber,
        rawTxn.payload,
        rawTxn.max_gas_amount,
        rawTxn.gas_unit_price,
        rawTxn.expiration_timestamp_secs,
        rawTxn.chain_id,
    );
}

/**
 * Simulates the transaction again with the account's sequence number on the chain, for a transaction whose number is
 * ahead of the committed state because an earlier transaction of the account has not committed. The simulation runs
 * with the same payload, gas unit price, expiry and chain ID. When the chain moved between the read and the
 * simulation, the number is read again, once more. A shortfall of the balance is handled by
 * `EstimateSimulations.simulate`. Returns `undefined` when the result says nothing about the transaction (the chain's
 * number is above the transaction's, the sequence number is stale both times, the account or the balance cannot be
 * read, the request fails). A simulation that fails for another reason throws its `SupraSimulationFailedError`.
 */
async function simulateAtChainSequenceNumber(
    simulations: EstimateSimulations,
    config: NetworkConfig,
): Promise<TransactionResponse | undefined> {
    let staleSimulations = 0;
    while (staleSimulations < 2) {
        let chainSequenceNumber: bigint;
        try {
            const account = await getAccountInfoInternal(
                { accountAddress: simulations.rawTxn.sender.toHexString() },
                config,
            );
            chainSequenceNumber = BigInt(account.sequence_number);
        } catch {
            return undefined;
        }
        if (chainSequenceNumber > BigInt(simulations.rawTxn.sequence_number)) {
            // The chain has passed the transaction's number: a simulation says nothing about the transaction.
            return undefined;
        }
        // At an equal number the transaction is the account's next one, and the simulation runs with its own number.
        try {
            return await simulations.simulate(chainSequenceNumber);
        } catch (error) {
            if (
                error instanceof SupraSimulationFailedError &&
                (error.major_status === "SEQUENCE_NUMBER_TOO_NEW" || error.major_status === "SEQUENCE_NUMBER_TOO_OLD")
            ) {
                staleSimulations += 1;
            } else {
                throw error;
            }
        }
    }
    return undefined;
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
