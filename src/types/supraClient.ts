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
 *
 * Sequence numbers: the client keeps a sequence-number counter for each account its helpers send from (the coin and
 * fungible asset transfers, `migrateCoinToFungibleStore`, `publishPackage` and the entry functions of
 * `Contract.fromABI`), and submits the calls of one account one after another. A call holds the account from taking its
 * number until the node answers its submission (accepted, refused, or the request fails); the wait for the final
 * status comes after that. A call without `maxGas` (here or on the call) holds the account while its max gas is
 * estimated; a call with `maxGas` waits only until the calls ahead of it have been submitted or have failed. To submit
 * faster from one account, set `maxGas`; to submit in parallel, send from several accounts. A call with an explicit
 * `sequenceNumber` does not take part in this order.
 *
 * The counter records every transaction of the account that the client submitted (accepted, or whose submission
 * request failed without an answer, explicit `sequenceNumber`s included) with its expiration time, and hands out the
 * lowest number at or above the account's sequence number on the chain that has no record. A submission whose request
 * failed without an answer holds its number until the transaction's expiration time or `resetSequenceNumber`, including
 * when its expiration time was beyond what a node accepts. A record is dropped when the
 * chain's number passes it, when the timestamp of a latest block the client reads (`GET /rpc/v3/block`) has reached
 * its expiration time, or when a read of the transaction returns `Invalid`; an HTTP 404 does not drop it. The first use
 * of an account reads the account and the latest block; so does the next call after a refusal for a stale number or a
 * full queue (`SupraAccountQueueFullError`), and every call while the estimated chain time (the newest latest block's
 * timestamp read plus the time elapsed since that read on a monotonic clock, never decreasing) has passed the
 * expiration time of a record by two seconds and no latest block read has reached it.
 *
 * `txExpirySecs` sets the expiration time of every transaction built without `txExpiryTime`: that many seconds after
 * the client's clock in whole seconds, at most 595 (`MAX_TX_EXPIRATION_DURATION - TX_EXPIRATION_MARGIN_SECS`) so that
 * a node whose clock is up to 5 seconds behind the client's accepts it. An integer from 1 to
 * `MAX_TX_EXPIRATION_DURATION` (600); default `DEFAULT_TX_EXPIRATION_DURATION` (60). The constructor throws a
 * `RangeError` otherwise. The node refuses a transaction whose expiration time is not after its clock, or more than 600
 * seconds after it, so a client whose clock is far from the node's has its transactions refused.
 *
 * `timeoutMs` sets the timeout of each request (default 30000 ms; an integer up to 2147483647); a request that exceeds it throws
 * `SupraTimeoutError`. `retry` turns on retries of GET requests; it is off by default.
 * `waitTimeoutMs` sets how long a wait for a transaction's final status lasts (`waitForTransaction` and submissions
 * with `enableWaitForTransaction`) when the call sets no timeout (default 60000 ms); a wait that exceeds it throws
 * `SupraTransactionTimeoutError`.
 *
 * Every setting belongs to the client it is passed to: `network`, `rpcUrl`, `chainId`, `maxGas`,
 * `minGasUnitPrice`, `estimateMaxGas`, `maxGasEstimateMultiplier`, `timeoutMs`, `retry`, `waitTimeoutMs`,
 * `txExpirySecs` and `verifyChainId`. The client copies the configuration, so later changes
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
        txExpirySecs?: number;
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
        txExpirySecs?: number;
        /** `false` signs with `chainId` without reading the node's chain ID. Default `true`. */
        verifyChainId?: boolean;
    };


export interface GasPrice {
    mean_gas_price: number,
    max_gas_price: number,
    median_gas_price: number,
    min_configured_gas_price: number
}
