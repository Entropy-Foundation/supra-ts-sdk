import { SupraAPIError } from "../errors/apiError";

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
 */
export async function parseJsonResponse(response: Response, url: string): Promise<unknown> {
    const text = await response.text();
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
