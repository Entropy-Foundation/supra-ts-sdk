import {
    createSupraAPIError,
    retryAfterSecondsOf,
    SupraAPIError,
    SupraGoneError,
    SupraNotFoundError,
    SupraRateLimitError,
    SupraServiceUnavailableError,
} from "../apiError";
import { SupraFaucetResponseError, SupraFaucetUnavailableError } from "../faucetError";
import { SupraError, SupraNetworkError, SupraTimeoutError } from "../supraError";

describe("SupraAPIError", () => {
    it("should set name to SupraAPIError", () => {
        const error = new SupraAPIError({
            status: 400,
            statusText: "Bad Request",
            url: "https://example.com/api",
        });
        expect(error.name).toBe("SupraAPIError");
    });

    it("should set status, statusText, url correctly", () => {
        const error = new SupraAPIError({
            status: 404,
            statusText: "Not Found",
            url: "https://example.com/api/accounts/0x1",
        });
        expect(error.status).toBe(404);
        expect(error.statusText).toBe("Not Found");
        expect(error.url).toBe("https://example.com/api/accounts/0x1");
    });

    it("should set data when provided", () => {
        const data = { error: "some detail" };
        const error = new SupraAPIError({
            status: 500,
            statusText: "Internal Server Error",
            url: "https://example.com",
            data,
        });
        expect(error.data).toBe(data);
    });

    it("should extend Error and SupraError", () => {
        const error = new SupraAPIError({
            status: 400,
            statusText: "Bad Request",
            url: "https://example.com",
        });
        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(SupraError);
    });

    describe("message", () => {
        it("is the node's message when the body has one", () => {
            const error = new SupraAPIError({
                status: 400,
                statusText: "Bad Request",
                url: "https://example.com",
                data: { message: "Bad Transaction: something specific" },
            });
            expect(error.message).toBe("Bad Transaction: something specific");
            expect(error.statusText).toBe("Bad Request");
        });

        it("is the status text when the body has no message", () => {
            for (const data of [undefined, {}, { message: "" }, { message: 5 }, "plain text", null]) {
                const error = new SupraAPIError({
                    status: 400,
                    statusText: "Bad Request",
                    url: "https://example.com",
                    data,
                });
                expect(error.message).toBe("Bad Request");
            }
        });

        it("names the status when the status text is empty", () => {
            const error = new SupraAPIError({ status: 502, statusText: "", url: "https://example.com" });
            expect(error.message).toBe("HTTP 502");
        });
    });

    describe("major_status and sub_status", () => {
        it("are parsed from the node's message", () => {
            const error = new SupraAPIError({
                status: 400,
                statusText: "Bad Request",
                url: "https://example.com",
                data: {
                    message: "General err: MoveTransactionValidationFailed(0x1, 0, SEQUENCE_NUMBER_TOO_OLD)",
                },
            });
            expect(error.major_status).toBe("SEQUENCE_NUMBER_TOO_OLD");
            expect(error.sub_status).toBeUndefined();
        });

        it("are parsed from the status text when the body has no message", () => {
            const error = new SupraAPIError({
                status: 400,
                statusText: "Move abort in 0x1::coin: EINSUFFICIENT_BALANCE(0x10006): Not enough coins",
                url: "https://example.com",
                data: { hash: "0x1" },
            });
            expect(error.major_status).toBe("ABORTED");
            expect(error.sub_status).toBe(0x10006);
        });

        it("are undefined when the message carries no status", () => {
            const error = new SupraAPIError({
                status: 400,
                statusText: "Bad Request",
                url: "https://example.com",
                data: { message: "Some other error message" },
            });
            expect(error.major_status).toBeUndefined();
            expect(error.sub_status).toBeUndefined();
        });
    });

    it("should serialize to JSON correctly", () => {
        const error = new SupraAPIError({
            status: 400,
            statusText: "Bad Request",
            url: "https://example.com",
            data: { message: "Failed to execute view function: LINKER_ERROR at location UNDEFINED" },
        });
        expect(error.toJSON()).toEqual({
            name: "SupraAPIError",
            message: "Failed to execute view function: LINKER_ERROR at location UNDEFINED",
            status: 400,
            statusText: "Bad Request",
            url: "https://example.com",
            data: { message: "Failed to execute view function: LINKER_ERROR at location UNDEFINED" },
            major_status: "LINKER_ERROR",
            sub_status: undefined,
        });
    });
});

describe("createSupraAPIError", () => {
    const base = { statusText: "Error", url: "https://example.com/rpc/v3/x" };

    it.each([
        [404, SupraNotFoundError, "SupraNotFoundError"],
        [410, SupraGoneError, "SupraGoneError"],
        [429, SupraRateLimitError, "SupraRateLimitError"],
        [503, SupraServiceUnavailableError, "SupraServiceUnavailableError"],
    ])("returns the typed error for status %i", (status, errorClass, name) => {
        const error = createSupraAPIError({ ...base, status });
        expect(error).toBeInstanceOf(errorClass);
        expect(error).toBeInstanceOf(SupraAPIError);
        expect(error.name).toBe(name);
        expect(error.status).toBe(status);
    });

    it.each([400, 401, 500, 502, 504])("returns a plain SupraAPIError for status %i", (status) => {
        const error = createSupraAPIError({ ...base, status });
        expect(error.constructor).toBe(SupraAPIError);
    });

    it("takes retryAfterSeconds of a 429 from the body", () => {
        const error = createSupraAPIError(
            { ...base, status: 429, data: { message: "Too Many Requests", retry_after_seconds: 77011 } },
            "5",
        );
        expect(error).toBeInstanceOf(SupraRateLimitError);
        expect((error as SupraRateLimitError).retryAfterSeconds).toBe(77011);
        expect(error.message).toBe("Too Many Requests");
    });

    it("takes retryAfterSeconds of a 429 from the Retry-After header when the body has none", () => {
        const error = createSupraAPIError({ ...base, status: 429, data: { message: "slow down" } }, "12");
        expect((error as SupraRateLimitError).retryAfterSeconds).toBe(12);
    });

    it("leaves retryAfterSeconds undefined when the node gives neither", () => {
        const error = createSupraAPIError({ ...base, status: 429, data: "rate limited" });
        expect((error as SupraRateLimitError).retryAfterSeconds).toBeUndefined();
    });

    it("includes retryAfterSeconds in the JSON of a rate limit error", () => {
        const error = createSupraAPIError({ ...base, status: 429, data: { retry_after_seconds: 3 } });
        expect(error.toJSON()).toMatchObject({ retryAfterSeconds: 3, status: 429 });
    });
});

describe("retryAfterSecondsOf", () => {
    it("reads a numeric and a numeric-string body field", () => {
        expect(retryAfterSecondsOf({ retry_after_seconds: 7 })).toBe(7);
        expect(retryAfterSecondsOf({ retry_after_seconds: "8" })).toBe(8);
    });

    it("ignores a body field that is not a non-negative number", () => {
        expect(retryAfterSecondsOf({ retry_after_seconds: -1 })).toBeUndefined();
        expect(retryAfterSecondsOf({ retry_after_seconds: "soon" })).toBeUndefined();
        expect(retryAfterSecondsOf({ retry_after_seconds: "" })).toBeUndefined();
        expect(retryAfterSecondsOf(undefined)).toBeUndefined();
    });

    it("reads a Retry-After header in seconds and as an HTTP date", () => {
        const now = Date.parse("2026-10-19T10:00:00Z");
        expect(retryAfterSecondsOf(undefined, "30", now)).toBe(30);
        expect(retryAfterSecondsOf(undefined, "Mon, 19 Oct 2026 10:01:00 GMT", now)).toBe(60);
        expect(retryAfterSecondsOf(undefined, "Mon, 19 Oct 2026 09:00:00 GMT", now)).toBe(0);
        expect(retryAfterSecondsOf(undefined, "garbage", now)).toBeUndefined();
        expect(retryAfterSecondsOf(undefined, null, now)).toBeUndefined();
    });
});

describe("error hierarchy", () => {
    it("derives every SDK error from SupraError", () => {
        const cause = new Error("boom");
        const errors: SupraError[] = [
            new SupraAPIError({ status: 400, statusText: "Bad Request", url: "u" }),
            new SupraNotFoundError({ status: 404, statusText: "Not Found", url: "u" }),
            new SupraTimeoutError({ url: "u", timeoutMs: 5, cause }),
            new SupraNetworkError({ url: "u", cause }),
            new SupraFaucetUnavailableError(),
            new SupraFaucetResponseError({}),
        ];
        for (const error of errors) {
            expect(error).toBeInstanceOf(SupraError);
            expect(error).toBeInstanceOf(Error);
        }
    });

    it("keeps the faucet errors out of SupraAPIError and keeps their names", () => {
        expect(new SupraFaucetUnavailableError()).not.toBeInstanceOf(SupraAPIError);
        expect(new SupraFaucetUnavailableError().name).toBe("SupraFaucetUnavailableError");
        expect(new SupraFaucetResponseError("x").name).toBe("SupraFaucetResponseError");
        expect(new SupraFaucetResponseError("x").data).toBe("x");
    });

    it("carries the original error of a timeout and of a network failure as cause", () => {
        const cause = new TypeError("fetch failed");
        const timeout = new SupraTimeoutError({ url: "https://example.com", timeoutMs: 100, cause });
        const network = new SupraNetworkError({ url: "https://example.com", cause });
        expect(timeout.cause).toBe(cause);
        expect(timeout.timeoutMs).toBe(100);
        expect(timeout.message).toContain("100 ms");
        expect(network.cause).toBe(cause);
        expect(network.message).toContain("fetch failed");
        expect(network.url).toBe("https://example.com");
    });
});
