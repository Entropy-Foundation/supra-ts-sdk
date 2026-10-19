import type { SupraAccount, TxnBuilderTypes } from "supra-l1-sdk-core";
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
 * A simulation that runs out of gas throws its `SupraSimulationFailedError`: the transaction cannot complete with the
 * sender's balance. When there is no `senderAccount`, or the balance read or the simulation fails for another reason,
 * the max gas is `DEFAULT_MAX_GAS_UNITS`, at most `affordable` when that is known and not zero.
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
    // With no balance the node rejects the transaction whatever its max gas; the default lets it say why.
    if (affordable === 0n) {
        return DEFAULT_MAX_GAS_UNITS;
    }
    const fallback = minBigInt(DEFAULT_MAX_GAS_UNITS, affordable);
    if (args.senderAccount === undefined) {
        return fallback;
    }

    let simulated: TransactionResponse;
    try {
        simulated = await simulateTxnInternal(
            {
                sendTxPayload: sendTxnPayloadInternal({
                    senderAccount: args.senderAccount,
                    rawTxn: args.buildRawTxn(affordable),
                }),
            },
            config,
        );
    } catch (error) {
        if (error instanceof SupraSimulationFailedError && error.major_status === "OUT_OF_GAS") {
            throw error;
        }
        return fallback;
    }

    const gasUsed = gasUsedOf(simulated);
    if (gasUsed === undefined) {
        return fallback;
    }
    const multiplier = config.maxGasEstimateMultiplier ?? DEFAULT_MAX_GAS_ESTIMATE_MULTIPLIER;
    const estimate = BigInt(Math.ceil(gasUsed * multiplier));
    return minBigInt(estimate > MIN_ESTIMATED_MAX_GAS_UNITS ? estimate : MIN_ESTIMATED_MAX_GAS_UNITS, affordable);
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
