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
 * You can set maxGas and minGasUnitPrice if you want to override global default values.
 * `timeoutMs` sets the timeout of each request (default 30000 ms; an integer up to 2147483647); a request that exceeds it throws
 * `SupraTimeoutError`. `retry` turns on retries of GET requests; it is off by default.
 * `waitTimeoutMs` sets how long a wait for a transaction's final status lasts (`waitForTransaction` and submissions
 * with `enableWaitForTransaction`) when the call sets no timeout (default 60000 ms); a wait that exceeds it throws
 * `SupraTransactionTimeoutError`.
 *
 * Every setting belongs to the client it is passed to: `network`, `rpcUrl`, `chainId`, `maxGas`,
 * `minGasUnitPrice`, `timeoutMs`, `retry` and `waitTimeoutMs`. The client copies the configuration, so later changes
 * to the object passed in do not reach it, and two clients never share settings, including two clients of the same
 * predefined network. `rpcUrl` must be an absolute `http:` or `https:` URL, with or without trailing slashes and with
 * or without a path prefix; the constructor throws a `TypeError` otherwise.
 */
export type SupraConfig =
    {
        network: Network.MAINNET | Network.TESTNET | Network.DEVNET;
        maxGas?: bigint;
        minGasUnitPrice?: bigint;
        timeoutMs?: number;
        retry?: RetryConfig;
        waitTimeoutMs?: number;
    }
    | {
        network?: Network.CUSTOM;
        rpcUrl: string;
        chainId: number;
        maxGas?: bigint;
        minGasUnitPrice?: bigint;
        timeoutMs?: number;
        retry?: RetryConfig;
        waitTimeoutMs?: number;
    };


export interface GasPrice {
    mean_gas_price: number,
    max_gas_price: number,
    median_gas_price: number,
    min_configured_gas_price: number
}
