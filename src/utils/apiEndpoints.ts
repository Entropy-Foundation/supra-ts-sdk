export enum Network {
    MAINNET = "mainnet",
    TESTNET = "testnet",
}


export interface NetworkConfig {
    name: string;
    chainId: number;
    rpcUrl: string;
    maxGas?: bigint,
    minGasUnitPrice?: bigint
}


export const NetworkInfo: Record<Network, NetworkConfig> = {
    [Network.MAINNET]: {
        name: "mainnet",
        chainId: 8,
        rpcUrl: "https://rpc-mainnet.supra.com"
    },
    [Network.TESTNET]: {
        name: "testnet",
        chainId: 6,
        rpcUrl: "https://rpc-testnet.supra.com"
    }
}
