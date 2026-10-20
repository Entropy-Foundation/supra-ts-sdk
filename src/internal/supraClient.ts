import { get } from "../client/get";
import { parseChainId } from "../client/chainIdCache";
import { SupraError } from "../errors/supraError";
import type { GasPrice } from "../types/supraClient";
import type { NetworkConfig } from "../utils/apiEndpoints";

export async function getGasPriceInternal(config: NetworkConfig): Promise<bigint> {
    return BigInt(
        await get<GasPrice>(
            {
                path: `/transactions/estimate_gas_price`,
            },
            config,
        ).then((res) => res.data.median_gas_price),
    );
}

export async function getMinGasUnitPriceInternal(config: NetworkConfig): Promise<bigint> {
    return BigInt(
        await get<GasPrice>(
            {
                path: `/transactions/estimate_gas_price`,
            },
            config,
        ).then((res) => res.data.min_configured_gas_price),
    );
}

/**
 * Reads the gas unit price that a transaction without a price of the call or the client carries:
 * `max(median_gas_price, min_configured_gas_price)` of `GET /rpc/v3/transactions/estimate_gas_price`. The median is
 * taken over recent transactions and can be below the node's current minimum.
 */
export async function getEstimatedGasUnitPriceInternal(config: NetworkConfig): Promise<bigint> {
    const { data } = await get<GasPrice>({ path: `/transactions/estimate_gas_price` }, config);
    const median = BigInt(data.median_gas_price);
    const minimum = BigInt(data.min_configured_gas_price);
    return median > minimum ? median : minimum;
}

/**
 * Reads the node's chain ID with `GET /rpc/v3/transactions/chain_id`.
 * @throws {SupraError} If the body is not an integer from 0 to 255.
 */
export async function getChainIdInternal(config: NetworkConfig): Promise<number> {
    const { data } = await get<unknown>(
        {
            path: `/transactions/chain_id`,
        },
        config,
    );
    const chainId = parseChainId(data);
    if (chainId === undefined) {
        throw new SupraError(
            `The node answered GET /transactions/chain_id with ${JSON.stringify(data)}, which is not a chain ID`,
        );
    }
    return chainId;
}
