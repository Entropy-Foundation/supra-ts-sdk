import type { Network } from "../utils/apiEndpoints";

/**
 * Retry policy of idempotent GET requests.
 * A request is retried when the node answers 429 or 503 or the connection fails. A 429 is retried after the wait the
 * node asks for (`retry_after_seconds` of the body, else the `Retry-After` header); the other cases wait for a delay
 * that starts at 250 ms and doubles on every retry. No wait exceeds `maxDelayMs`: a 429 that asks for a longer wait is
 * thrown at once. A timeout is not retried. POST requests (submit, simulate, view) are never retried.
 */
export interface RetryConfig {
    /** Requests to send in total, the first included. Default 3. */
    attempts?: number;
    /** Longest wait before a retry, in milliseconds, from 0 to 2147483647. Default 10000. */
    maxDelayMs?: number;
}

/**
 * The SupraConfig interface is used to configure the SupraClient class.
 * `maxGas` sets the max gas of every transaction that sets none; without it the max gas is estimated (see
 * `OptionalTransactionPayloadArgs`). `minGasUnitPrice` sets the gas unit price of every transaction that sets none
 * (default `DEFAULT_GAS_PRICE`). `estimateMaxGas: false` turns the estimate off: a transaction without `maxGas` then has
 * `DEFAULT_MAX_GAS_UNITS`. A simulation whose status is not `Success` throws `SupraSimulationFailedError` and nothing is
 * submitted; the simulation runs against committed state, so a transaction that depends on an earlier one that has not
 * committed fails its estimate, and needs `maxGas`. `maxGasEstimateMultiplier` replaces
 * `DEFAULT_MAX_GAS_ESTIMATE_MULTIPLIER`, the factor applied to the simulated gas used; it must be a finite number of
 * at least 1.
 * `timeoutMs` sets the timeout of each request (default 30000 ms; an integer up to 2147483647); a request that exceeds it throws
 * `SupraTimeoutError`. `retry` turns on retries of GET requests; it is off by default.
 * `waitTimeoutMs` sets how long a wait for a transaction's final status lasts (`waitForTransaction` and submissions
 * with `enableWaitForTransaction`) when the call sets no timeout (default 60000 ms); a wait that exceeds it throws
 * `SupraTransactionTimeoutError`.
 *
 * Every setting belongs to the client it is passed to: `network`, `rpcUrl`, `chainId`, `maxGas`,
 * `minGasUnitPrice`, `estimateMaxGas`, `maxGasEstimateMultiplier`, `timeoutMs`, `retry`, `waitTimeoutMs` and
 * `verifyChainId`. The client copies the configuration, so later changes
 * to the object passed in do not reach it, and two clients never share settings, including two clients of the same
 * predefined network. `rpcUrl` must be an absolute `http:` or `https:` URL, with or without trailing slashes and with
 * or without a path prefix; the constructor throws a `TypeError` otherwise. `chainId` must be an integer from 0 to
 * 255; the constructor throws a `RangeError` otherwise.
 *
 * Chain ID check: before its first signature the client reads the node's chain ID, from the `x-supra-chain-id` header
 * of an earlier response or with `GET /rpc/v3/transactions/chain_id`, and keeps it for the client's lifetime.
 * Every signature (`signTransaction`, the `signedTransaction`, `sendTxnPayload`, `signTransaction`, `simulate` and
 * `submitTransaction` methods of a built transaction, the submit helpers that take a `senderAccount`, the coin and
 * fungible asset transfers, `publishPackage` and the entry functions of `Contract.fromABI`) throws
 * `SupraChainIdMismatchError` before signing when the configured chain ID or the chain ID of the transaction differs
 * from the node's. `verifyChainId: false` turns the check off: the configured chain ID is used and signing sends no
 * request, which allows signing offline.
 */
export type SupraConfig =
    {
        network: Network.MAINNET | Network.TESTNET | Network.DEVNET;
        maxGas?: bigint;
        minGasUnitPrice?: bigint;
        estimateMaxGas?: boolean;
        maxGasEstimateMultiplier?: number;
        timeoutMs?: number;
        retry?: RetryConfig;
        waitTimeoutMs?: number;
        /** `false` signs with the network's chain ID without reading the node's. Default `true`. */
        verifyChainId?: boolean;
    }
    | {
        network?: Network.CUSTOM;
        rpcUrl: string;
        chainId: number;
        maxGas?: bigint;
        minGasUnitPrice?: bigint;
        estimateMaxGas?: boolean;
        maxGasEstimateMultiplier?: number;
        timeoutMs?: number;
        retry?: RetryConfig;
        waitTimeoutMs?: number;
        /** `false` signs with `chainId` without reading the node's chain ID. Default `true`. */
        verifyChainId?: boolean;
    };


export interface GasPrice {
    mean_gas_price: number,
    max_gas_price: number,
    median_gas_price: number,
    min_configured_gas_price: number
}
