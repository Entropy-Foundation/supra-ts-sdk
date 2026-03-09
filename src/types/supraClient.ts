import type { Network } from "../utils/apiEndpoints";

/**
 * The SupraConfig interface is used to configure the SupraClient class.
 * You can set maxGas and minGasUnitPrice if you want to override global default values 
 */
export interface SupraConfig {
    network: Network,
    maxGas?: bigint,
    minGasUnitPrice?: bigint
}


export interface GasPrice {
    mean_gas_price: number,
    max_gas_price: number,
    median_gas_price: number,
    min_configured_gas_price: number
}