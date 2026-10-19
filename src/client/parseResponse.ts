import { SupraAPIError } from "../errors/apiError";
import { SupraNetworkError, SupraTimeoutError } from "../errors/supraError";
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
 */
export async function parseJsonResponse(response: Response, url: string, timeoutMs: number): Promise<unknown> {
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
    try {
        return JSON.parse(text) as unknown;
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
}
