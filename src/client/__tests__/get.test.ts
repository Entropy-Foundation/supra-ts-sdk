import { get } from "../get";
import { SupraAPIError } from "../../errors/apiError";
import type { NetworkConfig } from "../../utils/apiEndpoints";

const testConfig: NetworkConfig = {
    name: "testnet",
    chainId: 6,
    rpcUrl: "https://rpc-testnet.supra.com",
};

function mockFetchResponse(status: number, data: unknown, headers: Record<string, string> = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? "OK" : status === 404 ? "Not Found" : "Error",
        json: jest.fn().mockResolvedValue(data),
        headers: {
            get: (name: string) => headers[name.toLowerCase()] ?? null,
        },
    } as unknown as Response;
}

describe("client/get", () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        global.fetch = jest.fn();
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it("should return data on 200 response", async () => {
        const mockData = { result: "success" };
        (global.fetch as jest.Mock).mockResolvedValue(mockFetchResponse(200, mockData));

        const result = await get({ path: "/accounts/0x1" }, testConfig);
        expect(result.data).toEqual(mockData);
    });

    it("should extract cursor from x-supra-cursor header", async () => {
        (global.fetch as jest.Mock).mockResolvedValue(
            mockFetchResponse(200, {}, { "x-supra-cursor": "cursor_value" }),
        );

        const result = await get({ path: "/accounts/0x1" }, testConfig);
        expect(result.cursor).toBe("cursor_value");
    });

    it("should return undefined cursor when header is absent", async () => {
        (global.fetch as jest.Mock).mockResolvedValue(mockFetchResponse(200, {}));

        const result = await get({ path: "/test" }, testConfig);
        expect(result.cursor).toBeUndefined();
    });

    it("should construct URL correctly with default rpc version", async () => {
        (global.fetch as jest.Mock).mockResolvedValue(mockFetchResponse(200, {}));

        await get({ path: "/accounts/0x1" }, testConfig);

        const calledUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
        expect(calledUrl).toContain("https://rpc-testnet.supra.com/rpc/v3/accounts/0x1");
    });

    it("should use custom rpc version when provided", async () => {
        (global.fetch as jest.Mock).mockResolvedValue(mockFetchResponse(200, {}));

        await get({ path: "/test" }, testConfig, "v2");

        const calledUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
        expect(calledUrl).toContain("/rpc/v2/test");
    });

    it("should append query params to URL", async () => {
        (global.fetch as jest.Mock).mockResolvedValue(mockFetchResponse(200, {}));

        await get({ path: "/test", query: { count: 10, start: "abc" } }, testConfig);

        const calledUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
        expect(calledUrl).toContain("count=10");
        expect(calledUrl).toContain("start=abc");
    });

    it("should filter out undefined query params", async () => {
        (global.fetch as jest.Mock).mockResolvedValue(mockFetchResponse(200, {}));

        await get({ path: "/test", query: { count: 10, start: undefined } }, testConfig);

        const calledUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
        expect(calledUrl).toContain("count=10");
        expect(calledUrl).not.toContain("start");
    });

    it("should throw SupraAPIError on 400 response", async () => {
        (global.fetch as jest.Mock).mockResolvedValue(
            mockFetchResponse(400, { message: "Bad request" }),
        );

        await expect(get({ path: "/test" }, testConfig)).rejects.toThrow(SupraAPIError);

        try {
            await get({ path: "/test" }, testConfig);
        } catch (error) {
            const apiError = error as SupraAPIError;
            expect(apiError.status).toBe(400);
        }
    });

    it("should throw SupraAPIError on 404 response", async () => {
        (global.fetch as jest.Mock).mockResolvedValue(
            mockFetchResponse(404, { message: "Not found" }),
        );

        await expect(get({ path: "/test" }, testConfig)).rejects.toThrow(SupraAPIError);
    });

    it("should throw SupraAPIError on 500 response", async () => {
        (global.fetch as jest.Mock).mockResolvedValue(
            mockFetchResponse(500, { message: "Internal error" }),
        );

        await expect(get({ path: "/test" }, testConfig)).rejects.toThrow(SupraAPIError);
    });

    it("should include url in error", async () => {
        (global.fetch as jest.Mock).mockResolvedValue(
            mockFetchResponse(400, {}),
        );

        try {
            await get({ path: "/accounts/0x1" }, testConfig);
        } catch (error) {
            const apiError = error as SupraAPIError;
            expect(apiError.url).toContain("/accounts/0x1");
        }
    });
});
