import { TxnBuilderTypes, type AnyRawTransaction } from "supra-l1-sdk-core";
import { get } from "../client/get";
import { SupraError } from "../errors/supraError";
import { chainClockOf } from "./chainTime";
import type { TransactionParameters } from "../types/supraClient";
import type { NetworkConfig } from "../utils/apiEndpoints";
import {
    ASSUMED_MAX_TX_EXPIRATION_DURATION,
    DEFAULT_TX_EXPIRATION_DURATION,
    MILLISECONDS_PER_SECOND,
    TX_EXPIRATION_MARGIN_SECS,
} from "../utils/constants";

/**
 * The node's maximum time to live per client, keyed by the client's network configuration (each client has its own).
 * The entry is the value once it is known, or the pending request that reads it, so that concurrent readers share one
 * request.
 */
const maxTimesToLive = new WeakMap<NetworkConfig, number | Promise<number>>();

/** The client's clock in whole seconds, the unit of a transaction's expiration time. */
function nowSeconds(): number {
    return Math.floor(Date.now() / MILLISECONDS_PER_SECOND);
}

/**
 * Reads `GET /rpc/v3/transactions/parameters` and keeps `max_transaction_time_to_live_seconds` for this client,
 * replacing an earlier value.
 * @throws {SupraError} If `max_transaction_time_to_live_seconds` is missing or is not a non-negative integer.
 */
export async function getTransactionParametersInternal(config: NetworkConfig): Promise<TransactionParameters> {
    const { data } = await get<unknown>({ path: `/transactions/parameters` }, config);
    const value = (data as Record<string, unknown> | null | undefined)?.["max_transaction_time_to_live_seconds"];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        throw new SupraError(
            `The node answered GET /transactions/parameters with ${JSON.stringify(data)}, ` +
                `in which max_transaction_time_to_live_seconds is not a non-negative integer`,
        );
    }
    maxTimesToLive.set(config, value);
    return { max_transaction_time_to_live_seconds: value };
}

/**
 * The most seconds after the node's clock that the node accepts as a transaction's expiration time. A value already
 * read for this client is returned without a request; otherwise it is read with
 * {@link getTransactionParametersInternal} and kept. Concurrent callers share one request. A failed request is not
 * kept and is thrown: the next call sends a new one.
 */
export function getMaxTxExpirySecsInternal(config: NetworkConfig): Promise<number> {
    const cached = maxTimesToLive.get(config);
    if (cached !== undefined) {
        return Promise.resolve(cached);
    }
    const request = getTransactionParametersInternal(config).then(
        (parameters) => parameters.max_transaction_time_to_live_seconds,
        (error: unknown) => {
            if (maxTimesToLive.get(config) === request) {
                maxTimesToLive.delete(config);
            }
            return Promise.reject(error instanceof Error ? error : new Error(String(error)));
        },
    );
    maxTimesToLive.set(config, request);
    return request;
}

/** The node's maximum time to live when this client has read it, else `undefined`; sends no request. */
export function knownMaxTxExpirySecs(config: NetworkConfig): number | undefined {
    const cached = maxTimesToLive.get(config);
    return typeof cached === "number" ? cached : undefined;
}

/**
 * Seconds from the client's clock to the default expiration time: `SupraConfig.txExpirySecs` (default
 * `DEFAULT_TX_EXPIRATION_DURATION`), at most `maxSecs - TX_EXPIRATION_MARGIN_SECS` and at least 1.
 */
function defaultExpirySecs(config: NetworkConfig, maxSecs: number): number {
    const requested = config.txExpirySecs ?? DEFAULT_TX_EXPIRATION_DURATION;
    return Math.max(1, Math.min(requested, maxSecs - TX_EXPIRATION_MARGIN_SECS));
}

/**
 * The expiration time of a transaction built without `txExpiryTime` by a builder that makes no request: the client's
 * clock in whole seconds plus {@link defaultExpirySecs}, with `maxSecs` the node's maximum when this client has read it
 * and `ASSUMED_MAX_TX_EXPIRATION_DURATION` otherwise.
 */
export function defaultTxExpiryTime(config: NetworkConfig): bigint {
    const maxSecs = knownMaxTxExpirySecs(config) ?? ASSUMED_MAX_TX_EXPIRATION_DURATION;
    return BigInt(nowSeconds() + defaultExpirySecs(config, maxSecs));
}

/**
 * The expiration time of a transaction built without `txExpiryTime`, using the node's maximum (read once per client).
 * @throws {RangeError} If `SupraConfig.txExpirySecs` is more than the node's maximum.
 * @throws The error of a failed read of the node's maximum; there is no fallback.
 */
export async function resolveDefaultTxExpiryTimeInternal(config: NetworkConfig): Promise<bigint> {
    const maxSecs = await getMaxTxExpirySecsInternal(config);
    if (config.txExpirySecs !== undefined && config.txExpirySecs > maxSecs) {
        throw new RangeError(
            `txExpirySecs is ${config.txExpirySecs}, more than the ${maxSecs} seconds that the node accepts ` +
                `(max_transaction_time_to_live_seconds)`,
        );
    }
    return BigInt(nowSeconds() + defaultExpirySecs(config, maxSecs));
}

/**
 * Throws when `expirationTime` (seconds since the Unix epoch) is more than `maxSecs` after the later of the client's
 * clock and the chain time the client estimates from its reads of the latest block (the node's clock is not read, and
 * the later of the two never refuses a time that a node with either clock accepts), in whole seconds.
 * @throws {RangeError} If the node would refuse the expiration time as too far in the future.
 */
export function assertTxExpiryWithinMax(expirationTime: bigint | number, maxSecs: number, config: NetworkConfig): void {
    const wall = BigInt(nowSeconds());
    const chain = chainClockOf(config).estimatedNowSeconds();
    const now = wall > chain ? wall : chain;
    const expiry = BigInt(expirationTime);
    if (expiry > now + BigInt(maxSecs)) {
        throw new RangeError(
            `The expiration time ${String(expiry)} is ${String(expiry - now)} seconds after the current time, ` +
                `more than the ${maxSecs} seconds that the node accepts (max_transaction_time_to_live_seconds)`,
        );
    }
}

/**
 * Checks, before a transaction is signed, that its expiration time is within the node's maximum. Does nothing with
 * `verifyChainId: false`, so that signing without it sends no request.
 * @throws {RangeError} If the expiration time is more than the node's maximum after the current time.
 */
export async function checkExpiryBeforeSigningInternal(
    rawTxn: AnyRawTransaction,
    config: NetworkConfig,
): Promise<void> {
    if (config.verifyChainId === false) {
        return;
    }
    const raw = rawTxn instanceof TxnBuilderTypes.RawTransaction ? rawTxn : rawTxn.raw_txn;
    assertTxExpiryWithinMax(raw.expiration_timestamp_secs, await getMaxTxExpirySecsInternal(config), config);
}
