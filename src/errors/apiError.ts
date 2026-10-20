import { SupraError } from "./supraError";
import { parseVmStatus } from "./vmStatus";

/**
 * SupraAPIErrorOptions is an interface that defines the properties of the SupraAPIError class.
 */
export interface SupraAPIErrorOptions {
    status: number;
    statusText: string;
    url: string;
    data?: unknown;
}

/**
 * SupraAPIError is thrown when the node answers a request with an error status. It is the base class of the
 * errors listed below, so `instanceof SupraAPIError` matches every error the node answered.
 *
 * | Class | When |
 * |---|---|
 * | {@link SupraNotFoundError} | HTTP 404 |
 * | {@link SupraGoneError} | HTTP 410 (the requested data has been pruned) |
 * | {@link SupraRateLimitError} | HTTP 429, with `retryAfterSeconds` |
 * | {@link SupraServiceUnavailableError} | HTTP 503 |
 *
 * Errors that are not answers of the node derive from {@link SupraError}: {@link SupraTimeoutError} and
 * {@link SupraNetworkError} (a request that timed out or never reached the node) and the faucet errors.
 *
 * `message` is the node's `message` when the error body has one, otherwise the HTTP status text.
 * `major_status` and `sub_status` hold the Move VM status that the message reports, when it reports one.
 * @group SupraAPIError
 */
export class SupraAPIError extends SupraError {
    readonly status: number;
    readonly statusText: string;

    readonly url: string;
    /** The parsed response body: the node's error body, the transaction of a failed simulation, or the raw text. */
    readonly data?: unknown;

    /**
     * The name of the Move VM status code that the error reports (for example `SEQUENCE_NUMBER_TOO_OLD`,
     * `LINKER_ERROR` or `ABORTED`; see {@link MoveVmError}), or `undefined` when the error carries none.
     * Any status name the node emits is passed through, including names {@link MoveVmError} does not list.
     */
    readonly major_status: string | undefined;

    /**
     * The sub status of the Move VM status: the abort code of an `ABORTED` status. `undefined` when the error
     * carries none.
     */
    readonly sub_status: number | undefined;

    constructor(args: SupraAPIErrorOptions) {
        super(messageOf(args));
        this.name = "SupraAPIError";
        this.status = args.status;
        this.statusText = args.statusText;
        this.url = args.url;
        this.data = args.data;

        const vmStatus = parseVmStatus(this.message);
        this.major_status = vmStatus.majorStatus;
        this.sub_status = vmStatus.subStatus;
    }

    toJSON() {
        return {
            name: this.name,
            message: this.message,
            status: this.status,
            statusText: this.statusText,
            url: this.url,
            data: this.data,
            major_status: this.major_status,
            sub_status: this.sub_status,
        };
    }
}

/**
 * SupraNotFoundError is thrown when the node answers HTTP 404: the requested resource, module, account or
 * transaction is not available on the node.
 * @group SupraAPIError
 */
export class SupraNotFoundError extends SupraAPIError {
    constructor(args: SupraAPIErrorOptions) {
        super(args);
        this.name = "SupraNotFoundError";
    }
}

/**
 * SupraGoneError is thrown when the node answers HTTP 410: the requested data existed but the node has pruned it.
 * @group SupraAPIError
 */
export class SupraGoneError extends SupraAPIError {
    constructor(args: SupraAPIErrorOptions) {
        super(args);
        this.name = "SupraGoneError";
    }
}

/**
 * SupraRateLimitError is thrown when the node answers HTTP 429.
 * `retryAfterSeconds` is the number of seconds the node asks the caller to wait: the `retry_after_seconds` field of
 * the error body, or the `Retry-After` header when the body has none. It is `undefined` when the node gives neither.
 * @group SupraAPIError
 */
export class SupraRateLimitError extends SupraAPIError {
    readonly retryAfterSeconds: number | undefined;

    constructor(args: SupraAPIErrorOptions & { retryAfterSeconds?: number | undefined }) {
        super(args);
        this.name = "SupraRateLimitError";
        this.retryAfterSeconds = args.retryAfterSeconds;
    }

    override toJSON() {
        return { ...super.toJSON(), retryAfterSeconds: this.retryAfterSeconds };
    }
}

/**
 * SupraServiceUnavailableError is thrown when the node answers HTTP 503: the node cannot serve the request at the
 * moment. The request can be repeated later.
 * @group SupraAPIError
 */
export class SupraServiceUnavailableError extends SupraAPIError {
    constructor(args: SupraAPIErrorOptions) {
        super(args);
        this.name = "SupraServiceUnavailableError";
    }
}

/**
 * Builds the error for an error response: the subclass of {@link SupraAPIError} for the status, with
 * `retryAfterSeconds` filled in for HTTP 429.
 * @param args - The status, status text, URL and parsed body of the response.
 * @param retryAfterHeader - The value of the response's `Retry-After` header, if any.
 */
export function createSupraAPIError(args: SupraAPIErrorOptions, retryAfterHeader?: string | null): SupraAPIError {
    switch (args.status) {
        case 404:
            return new SupraNotFoundError(args);
        case 410:
            return new SupraGoneError(args);
        case 429:
            return new SupraRateLimitError({
                ...args,
                retryAfterSeconds: retryAfterSecondsOf(args.data, retryAfterHeader),
            });
        case 503:
            return new SupraServiceUnavailableError(args);
        default:
            return new SupraAPIError(args);
    }
}

/**
 * The seconds to wait that an error response asks for: the `retry_after_seconds` field of the body, otherwise the
 * `Retry-After` header (delta-seconds or an HTTP date).
 */
export function retryAfterSecondsOf(
    data: unknown,
    retryAfterHeader?: string | null,
    now = Date.now(),
): number | undefined {
    const field = (data as { retry_after_seconds?: unknown } | null | undefined)?.retry_after_seconds;
    const fromBody = typeof field === "string" && field.trim() !== "" ? Number(field) : field;
    if (typeof fromBody === "number" && Number.isFinite(fromBody) && fromBody >= 0) {
        return fromBody;
    }

    const header = retryAfterHeader?.trim();
    if (!header) {
        return undefined;
    }
    if (/^\d+$/.test(header)) {
        return Number(header);
    }
    const date = Date.parse(header);
    return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - now) / 1000));
}

function messageOf(args: SupraAPIErrorOptions): string {
    const nodeMessage = (args.data as { message?: unknown } | null | undefined)?.message;
    if (typeof nodeMessage === "string" && nodeMessage !== "") {
        return nodeMessage;
    }
    return args.statusText !== "" ? args.statusText : `HTTP ${args.status}`;
}
