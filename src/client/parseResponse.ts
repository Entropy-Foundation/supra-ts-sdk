import { SupraAPIError } from "../errors/apiError";
import { SupraNetworkError, SupraTimeoutError } from "../errors/supraError";
import { convertU64Fields, quoteU64Fields, U64FieldError } from "./exactU64";
import { isTimeout } from "./request";

/**
 * Safely reads and JSON-parses a fetch Response body.
 *
 * The native `response.json()` throws a raw `SyntaxError` when the body is empty
 * (e.g. HTTP 204) or non-JSON (e.g. a gateway HTML error page from a 502/504).
 * This helper normalizes that so callers always deal with a `SupraAPIError` or a
 * parsed value:
 *  - empty body -> `undefined`
 *  - valid JSON -> parsed value
 *  - non-JSON on a successful (2xx) response -> throws `SupraAPIError`
 *  - non-JSON on an error response -> returns the raw text so the caller can wrap
 *    it in a `SupraAPIError` alongside the status code
 *  - a body that cannot be read -> throws `SupraTimeoutError` when the request timeout elapsed and
 *    `SupraNetworkError` otherwise, with the original error as `cause`
 *
 * When `u64Fields` lists paths (see `U64_FIELDS`), the numbers at those paths of a successful response are read
 * exactly and returned as `bigint`, from the number form and the decimal string form alike; a value at such a path
 * that is neither throws `SupraAPIError` with the 2xx status.
 */
export async function parseJsonResponse(
    response: Response,
    url: string,
    timeoutMs: number,
    u64Fields?: readonly string[],
): Promise<unknown> {
    let text: string;
    try {
        text = await response.text();
    } catch (error) {
        // The request timeout also covers the body. A body that fails after the headers arrived is reported as the
        // request failure it is.
        if (isTimeout(error)) {
            throw new SupraTimeoutError({ url, timeoutMs, cause: error });
        }
        throw new SupraNetworkError({ url, cause: error });
    }
    if (text.length === 0) {
        return undefined;
    }
    const exact = response.ok && u64Fields !== undefined && u64Fields.length > 0 ? u64Fields : undefined;
    let parsed: unknown;
    try {
        parsed = JSON.parse(exact === undefined ? text : quoteU64Fields(text, exact)) as unknown;
    } catch {
        if (response.ok) {
            throw new SupraAPIError({
                status: response.status,
                statusText: "Expected a JSON response but received a non-JSON body",
                url,
                data: text,
            });
        }
        return text;
    }
    if (exact === undefined) {
        return parsed;
    }
    try {
        return convertU64Fields(parsed, exact);
    } catch (error) {
        if (error instanceof U64FieldError) {
            throw new SupraAPIError({ status: response.status, statusText: error.message, url, data: text });
        }
        throw error;
    }
}
