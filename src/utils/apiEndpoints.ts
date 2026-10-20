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
    /** Max gas of every transaction that sets none; when absent, the max gas is estimated or defaulted. */
    maxGas?: bigint,
    minGasUnitPrice?: bigint,
    /** Estimate the max gas of a transaction that sets none; default true. */
    estimateMaxGas?: boolean,
    /** Factor applied to the simulated gas used; default `DEFAULT_MAX_GAS_ESTIMATE_MULTIPLIER`. */
    maxGasEstimateMultiplier?: number,
    /** Request timeout in milliseconds. */
    timeout?: number,
    /** Retry policy of idempotent GET requests; no retry when absent. */
    retry?: { attempts: number, maxDelayMs: number },
    /** Longest wait for a transaction's final status, in milliseconds, when the call sets none. */
    waitTimeoutMs?: number,
    /**
     * Seconds from the client's clock to the expiration time of a transaction built without `txExpiryTime`, at most
     * `MAX_TX_EXPIRATION_DURATION - TX_EXPIRATION_MARGIN_SECS`; default `DEFAULT_TX_EXPIRATION_DURATION`.
     */
    txExpirySecs?: number,
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
