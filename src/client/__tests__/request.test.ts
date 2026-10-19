import { get } from "../get";
import { post } from "../post";
import {
    SupraAPIError,
    SupraNetworkError,
    SupraRateLimitError,
    SupraServiceUnavailableError,
    SupraTimeoutError,
} from "../../index";
import type { NetworkConfig } from "../../utils/apiEndpoints";
import { DEFAULT_REQUEST_TIMEOUT_MS } from "../../utils/constants";

const baseConfig: NetworkConfig = {
    name: "devnet",
    chainId: 50,
    rpcUrl: "https://rpc.example.com",
};

function response(status: number, data: unknown, headers: Record<string, string> = {}): Response {
    return new Response(typeof data === "string" ? data : JSON.stringify(data), {
        status,
        statusText: status === 200 ? "OK" : "Error",
        headers,
    });
}

function timeoutError(): DOMException {
    return new DOMException("The operation was aborted due to timeout", "TimeoutError");
}

describe("client request handling", () => {
    const originalFetch = global.fetch;
    let fetchMock: jest.Mock;

    beforeEach(() => {
        fetchMock = jest.fn();
        global.fetch = fetchMock as unknown as typeof fetch;
    });

    afterEach(() => {
        global.fetch = originalFetch;
        jest.restoreAllMocks();
        jest.useRealTimers();
    });

    describe("typed errors", () => {
        it("throws SupraRateLimitError with retryAfterSeconds from the body of a 429", async () => {
            fetchMock.mockResolvedValue(
                response(429, { message: "Too Many Requests: faucet limit", retry_after_seconds: 77011 }),
            );

            const error = (await get({ path: "/wallet/faucet/0x1" }, baseConfig).catch(
                (e: unknown) => e,
            )) as SupraRateLimitError;

            expect(error).toBeInstanceOf(SupraRateLimitError);
            expect(error).toBeInstanceOf(SupraAPIError);
            expect(error.retryAfterSeconds).toBe(77011);
            expect(error.message).toBe("Too Many Requests: faucet limit");
            expect(error.status).toBe(429);
        });

        it("throws SupraRateLimitError with retryAfterSeconds from the Retry-After header of a 429", async () => {
            fetchMock.mockResolvedValue(response(429, "slow down", { "Retry-After": "42" }));

            const error = (await post({ path: "/view" }, baseConfig).catch((e: unknown) => e)) as SupraRateLimitError;

            expect(error).toBeInstanceOf(SupraRateLimitError);
            expect(error.retryAfterSeconds).toBe(42);
        });

        it("throws SupraServiceUnavailableError on a 503", async () => {
            fetchMock.mockImplementation(() => Promise.resolve(response(503, { message: "busy" })));
            await expect(get({ path: "/x" }, baseConfig)).rejects.toBeInstanceOf(SupraServiceUnavailableError);
        });
    });

    describe("timeout", () => {
        it("passes the default timeout to AbortSignal.timeout", async () => {
            const spy = jest.spyOn(AbortSignal, "timeout");
            fetchMock.mockResolvedValue(response(200, {}));

            await get({ path: "/x" }, baseConfig);

            expect(spy).toHaveBeenCalledWith(DEFAULT_REQUEST_TIMEOUT_MS);
        });

        it("passes the configured timeout to AbortSignal.timeout for GET and POST", async () => {
            const spy = jest.spyOn(AbortSignal, "timeout");
            fetchMock.mockImplementation(() => Promise.resolve(response(200, {})));
            const config = { ...baseConfig, timeout: 1234 };

            await get({ path: "/x" }, config);
            await post({ path: "/x" }, config);

            expect(spy).toHaveBeenNthCalledWith(1, 1234);
            expect(spy).toHaveBeenNthCalledWith(2, 1234);
        });

        it("throws SupraTimeoutError with the abort error as cause", async () => {
            const abort = timeoutError();
            fetchMock.mockRejectedValue(abort);

            const error = (await get({ path: "/x" }, { ...baseConfig, timeout: 50 }).catch(
                (e: unknown) => e,
            )) as SupraTimeoutError;

            expect(error).toBeInstanceOf(SupraTimeoutError);
            expect(error.cause).toBe(abort);
            expect(error.timeoutMs).toBe(50);
            expect(error.url).toBe("https://rpc.example.com/rpc/v3/x");
            expect(error).not.toBeInstanceOf(SupraAPIError);
        });

        it("also maps a POST timeout", async () => {
            fetchMock.mockRejectedValue(timeoutError());
            await expect(post({ path: "/x" }, baseConfig)).rejects.toBeInstanceOf(SupraTimeoutError);
        });

        it("times out a real request that the server does not answer", async () => {
            // A fetch that settles only when the request's signal aborts, as a stalled connection does.
            fetchMock.mockImplementation(
                (_url: string, init: RequestInit) =>
                    new Promise((_resolve, reject) => {
                        init.signal?.addEventListener("abort", () => reject(init.signal?.reason as unknown));
                    }),
            );

            await expect(get({ path: "/x" }, { ...baseConfig, timeout: 20 })).rejects.toBeInstanceOf(SupraTimeoutError);
        });
    });

    describe("network failure", () => {
        it("throws SupraNetworkError with the fetch error as cause", async () => {
            const failure = new TypeError("fetch failed");
            fetchMock.mockRejectedValue(failure);

            const error = (await get({ path: "/x" }, baseConfig).catch((e: unknown) => e)) as SupraNetworkError;

            expect(error).toBeInstanceOf(SupraNetworkError);
            expect(error.cause).toBe(failure);
            expect(error.url).toBe("https://rpc.example.com/rpc/v3/x");
        });

        it("also maps a POST network failure", async () => {
            fetchMock.mockRejectedValue(new TypeError("fetch failed"));
            await expect(post({ path: "/x" }, baseConfig)).rejects.toBeInstanceOf(SupraNetworkError);
        });
    });

    describe("retry", () => {
        const retrying: NetworkConfig = { ...baseConfig, retry: { attempts: 3, maxDelayMs: 10_000 } };

        /** Runs `request` to completion while the fake timers advance, returning its outcome. */
        async function settle<T>(request: Promise<T>): Promise<{ value?: T; error?: unknown }> {
            const outcome = request.then(
                (value) => ({ value }),
                (error: unknown) => ({ error }),
            );
            await jest.runAllTimersAsync();
            return outcome;
        }

        it("does not retry by default", async () => {
            fetchMock.mockImplementation(() => Promise.resolve(response(503, { message: "busy" })));

            await expect(get({ path: "/x" }, baseConfig)).rejects.toBeInstanceOf(SupraServiceUnavailableError);

            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it("does not retry a network failure by default", async () => {
            fetchMock.mockRejectedValue(new TypeError("fetch failed"));
            await expect(get({ path: "/x" }, baseConfig)).rejects.toBeInstanceOf(SupraNetworkError);
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it("retries a 503 with an exponentially growing delay until the request succeeds", async () => {
            jest.useFakeTimers();
            const setTimeoutSpy = jest.spyOn(global, "setTimeout");
            fetchMock
                .mockResolvedValueOnce(response(503, { message: "busy" }))
                .mockResolvedValueOnce(response(503, { message: "busy" }))
                .mockResolvedValueOnce(response(200, { ok: true }));

            const outcome = await settle(get({ path: "/x" }, retrying));

            expect(outcome.value).toEqual({ data: { ok: true }, cursor: undefined });
            expect(fetchMock).toHaveBeenCalledTimes(3);
            const delays = setTimeoutSpy.mock.calls.map((call) => call[1]);
            expect(delays).toEqual([250, 500]);
        });

        it("throws the last error when every attempt fails", async () => {
            jest.useFakeTimers();
            fetchMock.mockImplementation(() => Promise.resolve(response(503, { message: "busy" })));

            const outcome = await settle(get({ path: "/x" }, retrying));

            expect(outcome.error).toBeInstanceOf(SupraServiceUnavailableError);
            expect(fetchMock).toHaveBeenCalledTimes(3);
        });

        it("caps the delay at maxDelayMs", async () => {
            jest.useFakeTimers();
            const setTimeoutSpy = jest.spyOn(global, "setTimeout");
            fetchMock.mockImplementation(() => Promise.resolve(response(503, { message: "busy" })));

            await settle(get({ path: "/x" }, { ...baseConfig, retry: { attempts: 4, maxDelayMs: 300 } }));

            expect(setTimeoutSpy.mock.calls.map((call) => call[1])).toEqual([250, 300, 300]);
        });

        it("waits for the retry_after_seconds of a 429 body before retrying", async () => {
            jest.useFakeTimers();
            const setTimeoutSpy = jest.spyOn(global, "setTimeout");
            fetchMock
                .mockResolvedValueOnce(response(429, { message: "limit", retry_after_seconds: 2 }))
                .mockResolvedValueOnce(response(200, { ok: true }));

            const outcome = await settle(get({ path: "/x" }, retrying));

            expect(outcome.value).toEqual({ data: { ok: true }, cursor: undefined });
            expect(setTimeoutSpy.mock.calls.map((call) => call[1])).toEqual([2000]);
        });

        it("waits for the Retry-After header of a 429 before retrying", async () => {
            jest.useFakeTimers();
            const setTimeoutSpy = jest.spyOn(global, "setTimeout");
            fetchMock
                .mockResolvedValueOnce(response(429, "limit", { "Retry-After": "3" }))
                .mockResolvedValueOnce(response(200, {}));

            await settle(get({ path: "/x" }, retrying));

            expect(setTimeoutSpy.mock.calls.map((call) => call[1])).toEqual([3000]);
        });

        it("throws a 429 at once when it asks for a longer wait than maxDelayMs", async () => {
            jest.useFakeTimers();
            fetchMock.mockResolvedValue(response(429, { message: "limit", retry_after_seconds: 77011 }));

            const outcome = await settle(get({ path: "/x" }, retrying));

            expect(outcome.error).toBeInstanceOf(SupraRateLimitError);
            expect((outcome.error as SupraRateLimitError).retryAfterSeconds).toBe(77011);
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it("retries a network failure and returns the later success", async () => {
            jest.useFakeTimers();
            fetchMock
                .mockRejectedValueOnce(new TypeError("fetch failed"))
                .mockResolvedValueOnce(response(200, { ok: true }));

            const outcome = await settle(get({ path: "/x" }, retrying));

            expect(outcome.value).toEqual({ data: { ok: true }, cursor: undefined });
            expect(fetchMock).toHaveBeenCalledTimes(2);
        });

        it("throws SupraNetworkError when the connection keeps failing", async () => {
            jest.useFakeTimers();
            fetchMock.mockRejectedValue(new TypeError("fetch failed"));

            const outcome = await settle(get({ path: "/x" }, retrying));

            expect(outcome.error).toBeInstanceOf(SupraNetworkError);
            expect(fetchMock).toHaveBeenCalledTimes(3);
        });

        it("does not retry a timeout", async () => {
            fetchMock.mockRejectedValue(timeoutError());
            await expect(get({ path: "/x" }, retrying)).rejects.toBeInstanceOf(SupraTimeoutError);
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it("does not retry other error statuses", async () => {
            fetchMock.mockResolvedValue(response(400, { message: "bad" }));
            await expect(get({ path: "/x" }, retrying)).rejects.toBeInstanceOf(SupraAPIError);
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it("still reads the body of the final 429 after reading it for the wait", async () => {
            jest.useFakeTimers();
            fetchMock.mockImplementation(() =>
                Promise.resolve(response(429, { message: "limit", retry_after_seconds: 1 })),
            );

            const outcome = await settle(
                get({ path: "/x" }, { ...baseConfig, retry: { attempts: 2, maxDelayMs: 5000 } }),
            );

            expect((outcome.error as SupraRateLimitError).retryAfterSeconds).toBe(1);
            expect((outcome.error as SupraRateLimitError).message).toBe("limit");
        });
    });
});
