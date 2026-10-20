/**
 * Validates the `rpcUrl` of a client configuration.
 * @throws {TypeError} If the value is not an absolute `http:` or `https:` URL.
 */
export function validateRpcUrl(rpcUrl: string): string {
    let parsed: URL;
    try {
        parsed = new URL(rpcUrl);
    } catch {
        throw new TypeError(`rpcUrl must be an absolute http: or https: URL, got ${JSON.stringify(rpcUrl)}`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new TypeError(`rpcUrl must be an absolute http: or https: URL, got ${JSON.stringify(rpcUrl)}`);
    }
    return rpcUrl;
}

/**
 * Builds the URL of an RPC request: the node's base URL (with or without trailing slashes, with or without a path
 * prefix), `/rpc/<rpcVersion>` and the request path. Used by GET and POST requests.
 */
export function buildRpcUrl(rpcUrl: string, rpcVersion: string, path: string): URL {
    const base = new URL(rpcUrl);
    const prefix = base.pathname.replace(/\/+$/, "");
    return new URL(`${base.origin}${prefix}/rpc/${rpcVersion}${path}`);
}
