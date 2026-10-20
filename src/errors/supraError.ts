/**
 * SupraError is the base class of every error the SDK raises on its own behalf: errors answered by the node
 * ({@link SupraAPIError} and its subclasses), request timeouts ({@link SupraTimeoutError}), failed connections
 * ({@link SupraNetworkError}) and faucet errors.
 * When the error wraps another error, the wrapped error is available as `cause`.
 * @group Errors
 */
export class SupraError extends Error {
    constructor(message: string, options?: { cause?: unknown }) {
        super(message, options);
        this.name = "SupraError";
    }
}

/**
 * SupraTimeoutError is thrown when a request does not complete within the configured timeout
 * (`timeoutMs` of `SupraConfig`, 30 seconds by default). The abort error of the request is available as `cause`.
 * @group Errors
 */
export class SupraTimeoutError extends SupraError {
    /** The URL of the request. */
    readonly url: string;
    /** The timeout that elapsed, in milliseconds. */
    readonly timeoutMs: number;

    constructor(args: { url: string; timeoutMs: number; cause?: unknown }) {
        super(`The request to ${args.url} timed out after ${args.timeoutMs} ms`, { cause: args.cause });
        this.name = "SupraTimeoutError";
        this.url = args.url;
        this.timeoutMs = args.timeoutMs;
    }
}

/**
 * SupraNetworkError is thrown when a request cannot be sent or the connection fails before the node answers
 * (DNS failure, refused or reset connection, offline). The error of the underlying `fetch` is available as `cause`.
 * @group Errors
 */
export class SupraNetworkError extends SupraError {
    /** The URL of the request. */
    readonly url: string;

    constructor(args: { url: string; cause?: unknown }) {
        const reason = args.cause instanceof Error ? `: ${args.cause.message}` : "";
        super(`The request to ${args.url} failed before the node answered${reason}`, { cause: args.cause });
        this.name = "SupraNetworkError";
        this.url = args.url;
    }
}
