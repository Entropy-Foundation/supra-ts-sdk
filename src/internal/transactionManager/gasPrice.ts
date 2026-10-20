import { SupraAPIError } from "../../errors/apiError";
import { MoveVmError } from "../../errors/moveVmErrors";
import { SupraGasUnitPriceBelowMinimumError, SupraSimulationFailedError } from "../../errors/transactionError";
import type { OptionalTransactionPayloadArgs } from "../../types/transactionManager/transactionBuild";
import type { NetworkConfig } from "../../utils/apiEndpoints";
import { getEstimatedGasUnitPriceInternal, getMinGasUnitPriceInternal } from "../supraClient";

/** The gas unit price that the call or the client sets, or `undefined` when neither sets one. */
export function explicitGasUnitPriceOf(
    optionalTransactionPayloadArgs: OptionalTransactionPayloadArgs | undefined,
    config: NetworkConfig,
): bigint | undefined {
    return optionalTransactionPayloadArgs?.gasUnitPrice ?? config.gasUnitPrice;
}

/**
 * The gas unit price of a transaction built without a request: the call's, else the client's.
 * @throws {RangeError} When neither sets one: without a request the node's estimate cannot be read.
 */
export function requireGasUnitPrice(
    optionalTransactionPayloadArgs: OptionalTransactionPayloadArgs | undefined,
    config: NetworkConfig,
): bigint {
    const price = explicitGasUnitPriceOf(optionalTransactionPayloadArgs, config);
    if (price === undefined) {
        throw new RangeError(
            "This builder makes no request, so it cannot read the node's gas unit price estimate. " +
                "Set `gasUnitPrice` in `optionalTransactionPayloadArgs` or `gasUnitPrice` in `SupraConfig`; " +
                "`getEstimatedGasUnitPrice()` returns the node's estimate.",
        );
    }
    return price;
}

/**
 * The gas unit price of a transaction: the call's, else the client's, else the node's estimate
 * (`getEstimatedGasUnitPriceInternal`), which is read for this transaction and not kept. A failed read of the estimate
 * is thrown.
 */
export async function resolveGasUnitPriceInternal(
    optionalTransactionPayloadArgs: OptionalTransactionPayloadArgs | undefined,
    config: NetworkConfig,
): Promise<bigint> {
    return (
        explicitGasUnitPriceOf(optionalTransactionPayloadArgs, config) ??
        (await getEstimatedGasUnitPriceInternal(config))
    );
}

/**
 * A copy of the call's settings that carries the transaction's gas unit price (`resolveGasUnitPriceInternal`), so that
 * every later step uses the one value. The caller's object is not modified.
 */
export async function withResolvedGasUnitPriceInternal(
    optionalTransactionPayloadArgs: OptionalTransactionPayloadArgs | undefined,
    config: NetworkConfig,
): Promise<OptionalTransactionPayloadArgs> {
    return {
        ...optionalTransactionPayloadArgs,
        gasUnitPrice: await resolveGasUnitPriceInternal(optionalTransactionPayloadArgs, config),
    };
}

/**
 * Returns `error`, or the `SupraGasUnitPriceBelowMinimumError` that replaces it when it is the node's refusal of a
 * transaction whose gas unit price is below the node's minimum: an error of a submission with that status, or a failed
 * simulation with that status. The node's minimum is read for the error; a failed read leaves `minimumGasUnitPrice`
 * undefined and does not replace the refusal.
 */
export async function mapGasUnitPriceRefusalInternal(
    error: unknown,
    gasUnitPrice: bigint,
    config: NetworkConfig,
): Promise<unknown> {
    if (error instanceof SupraGasUnitPriceBelowMinimumError) {
        return error;
    }
    if (
        !(error instanceof SupraAPIError || error instanceof SupraSimulationFailedError) ||
        error.major_status !== MoveVmError.GAS_UNIT_PRICE_BELOW_MIN_BOUND
    ) {
        return error;
    }
    const minimumGasUnitPrice = await getMinGasUnitPriceInternal(config).catch(() => undefined);
    return new SupraGasUnitPriceBelowMinimumError({ cause: error, gasUnitPrice, minimumGasUnitPrice });
}
