export enum Network {
    MAINNET = "mainnet",
    TESTNET = "testnet",
    DEVNET = "devnet",
    CUSTOM = "custom"
}


export interface NetworkConfig {
    name: string;
    chainId: number;
    rpcUrl: string;
    maxGas?: bigint,
    minGasUnitPrice?: bigint,
    /** Request timeout in milliseconds. */
    timeout?: number,
    /** Retry policy of idempotent GET requests; no retry when absent. */
    retry?: { attempts: number, maxDelayMs: number },
    /** Longest wait for a transaction's final status, in milliseconds, when the call sets none. */
    waitTimeoutMs?: number,
    /**
     * `false` signs with `chainId` without reading the node's chain ID. Absent or `true`: the node's chain ID is read
     * before the first signature and every signature checks `chainId` and the transaction's chain ID against it.
     */
    verifyChainId?: boolean
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
    },
    [Network.DEVNET]: {
        name: "devnet",
        chainId: 50,
        rpcUrl: "https://rpc-devnet.supra.com"
    },
    [Network.CUSTOM]: {
        name: "custom",
        chainId: 0,
        rpcUrl: ""
    }
}
