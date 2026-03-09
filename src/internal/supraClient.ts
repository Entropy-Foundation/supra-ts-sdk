import { get } from "../client/get";
import { post } from "../client/post";
import type { GasPrice } from "../types/supraClient";
import type { NetworkConfig } from "../utils/apiEndpoints";

export async function getGasPriceInternal(config: NetworkConfig): Promise<bigint> {

    return BigInt(await get<GasPrice>({
        path: `/rpc/v3/transactions/estimate_gas_price`,
    }, config).then(res => res.data.median_gas_price))
}


export async function getMinGasUnitPriceInternal(config: NetworkConfig): Promise<bigint> {
    return BigInt(await get<GasPrice>({
        path: `/rpc/v3/transactions/estimate_gas_price`,
    }, config).then(res => res.data.min_configured_gas_price))
}