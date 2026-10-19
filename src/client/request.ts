import { retryAfterSecondsOf } from "../errors/apiError";
import { SupraNetworkError, SupraTimeoutError } from "../errors/supraError";
import type { NetworkConfig } from "../utils/apiEndpoints";
import { DEFAULT_REQUEST_TIMEOUT_MS, DEFAULT_RETRY_ATTEMPTS, DEFAULT_RETRY_MAX_DELAY_MS } from "../utils/constants";

/** Delay before the first retry of a request that failed without a `Retry-After`; it doubles on every retry. */
const RETRY_BASE_DELAY_MS = 250;

/**
 * Sends a request with the timeout of `config`.
 *
 * A request that exceeds the timeout rejects with {@link SupraTimeoutError} and one that fails before the node
 * answers rejects with {@link SupraNetworkError}; the original error is the `cause` of both.
 *
 * When `retryable` is true and `config.retry` is set, a response with status 429 or 503 and a failed connection are
 * retried, up to `retry.attempts` requests in total. Before a retry the function waits for the `retry_after_seconds`
 * of a 429 response (body, then `Retry-After` header) or else for an exponentially growing delay, never longer than
 * `retry.maxDelayMs`. A 429 that asks for a longer wait is returned without a retry, as is a timeout.
 * The response of the last attempt is returned whatever its status.
 */
export async function sendRequest(
    url: string,
    init: Omit<RequestInit, "signal">,
    config: NetworkConfig,
    retryable: boolean,
): Promise<Response> {
    const timeoutMs = config.timeout ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const attempts = retryable ? (config.retry?.attempts ?? 1) : 1;
    const maxDelayMs = config.retry?.maxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS;

    for (let attempt = 1; ; attempt++) {
        const last = attempt >= attempts;
        const backoffMs = Math.min(maxDelayMs, RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));

        let response: Response;
        try {
            response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
        } catch (error) {
            if (isTimeout(error)) {
                throw new SupraTimeoutError({ url, timeoutMs, cause: error });
            }
            if (last) {
                throw new SupraNetworkError({ url, cause: error });
            }
            await sleep(backoffMs);
            continue;
        }

        if (last || (response.status !== 429 && response.status !== 503)) {
            return response;
        }

        let delayMs = backoffMs;
        if (response.status === 429) {
            const retryAfterSeconds = await retryAfterSecondsOfResponse(response);
            if (retryAfterSeconds !== undefined) {
                delayMs = retryAfterSeconds * 1000;
                if (delayMs > maxDelayMs) {
                    return response;
                }
            }
        }
        await sleep(delayMs);
    }
}

/** The wait a 429 response asks for, read from a clone so that the caller can still read the body. */
async function retryAfterSecondsOfResponse(response: Response): Promise<number | undefined> {
    let data: unknown;
    try {
        data = JSON.parse(await response.clone().text()) as unknown;
    } catch {
        data = undefined;
    }
    return retryAfterSecondsOf(data, response.headers.get("retry-after"));
}

/** The only signal of a request is the timeout, whose abort reason is a `TimeoutError` (`AbortError` in older runtimes). */
export function isTimeout(error: unknown): boolean {
    const name = (error as { name?: unknown } | null | undefined)?.name;
    return name === "TimeoutError" || name === "AbortError";
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Validates the request timeout of a client configuration. */
export function validateTimeoutMs(timeoutMs: number): number {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
        throw new RangeError(`timeoutMs must be a positive integer number of milliseconds, got ${timeoutMs}`);
    }
    return timeoutMs;
}

/** Applies the defaults to the retry options of a client configuration and validates them. */
export function resolveRetry(retry: { attempts?: number; maxDelayMs?: number }): {
    attempts: number;
    maxDelayMs: number;
} {
    const attempts = retry.attempts ?? DEFAULT_RETRY_ATTEMPTS;
    const maxDelayMs = retry.maxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS;
    if (!Number.isInteger(attempts) || attempts < 1) {
        throw new RangeError(`retry.attempts must be an integer of at least 1, got ${attempts}`);
    }
    if (!Number.isFinite(maxDelayMs) || maxDelayMs < 0) {
        throw new RangeError(`retry.maxDelayMs must be a non-negative number, got ${maxDelayMs}`);
    }
    return { attempts, maxDelayMs };
}
