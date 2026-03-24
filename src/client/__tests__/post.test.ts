import { post } from "../post";
import { SupraAPIError } from "../../errors/apiError";
import type { NetworkConfig } from "../../utils/apiEndpoints";

const testConfig: NetworkConfig = {
    name: "testnet",
    chainId: 6,
    rpcUrl: "https://rpc-testnet.supra.com",
};

function mockFetchResponse(status: number, data: unknown) {
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? "OK" : "Error",
        json: jest.fn().mockResolvedValue(data),
    } as unknown as Response;
}

describe("client/post", () => {
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

        const result = await post({ path: "/view", data: { function: "0x1::coin::balance" } }, testConfig);
        expect(result).toEqual(mockData);
    });

    it("should construct URL correctly", async () => {
        (global.fetch as jest.Mock).mockResolvedValue(mockFetchResponse(200, {}));

        await post({ path: "/transactions/simulate" }, testConfig);

        const calledUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
        expect(calledUrl).toBe("https://rpc-testnet.supra.com/rpc/v3/transactions/simulate");
    });

    it("should pass body as JSON.stringify", async () => {
        (global.fetch as jest.Mock).mockResolvedValue(mockFetchResponse(200, {}));
        const data = { function: "0x1::coin::balance", args: ["0x1"] };

        await post({ path: "/view", data }, testConfig);

        const calledOptions = (global.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
        expect(calledOptions.body).toBe(JSON.stringify(data));
    });

    it("should not set body when data is undefined", async () => {
        (global.fetch as jest.Mock).mockResolvedValue(mockFetchResponse(200, {}));

        await post({ path: "/test" }, testConfig);

        const calledOptions = (global.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
        expect(calledOptions.body).toBeNull();
    });

    it("should set method to POST", async () => {
        (global.fetch as jest.Mock).mockResolvedValue(mockFetchResponse(200, {}));

        await post({ path: "/test" }, testConfig);

        const calledOptions = (global.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
        expect(calledOptions.method).toBe("POST");
    });

    it("should throw SupraAPIError on 400 response", async () => {
        (global.fetch as jest.Mock).mockResolvedValue(
            mockFetchResponse(400, { message: "Bad request" }),
        );

        await expect(post({ path: "/test" }, testConfig)).rejects.toThrow(SupraAPIError);
    });

    it("should throw SupraAPIError on 500 response", async () => {
        (global.fetch as jest.Mock).mockResolvedValue(
            mockFetchResponse(500, { message: "Server error" }),
        );

        await expect(post({ path: "/test" }, testConfig)).rejects.toThrow(SupraAPIError);
    });

    it("should include error details in SupraAPIError", async () => {
        const errorData = { message: "major_status: ABORTED" };
        (global.fetch as jest.Mock).mockResolvedValue(mockFetchResponse(400, errorData));

        try {
            await post({ path: "/view" }, testConfig);
        } catch (error) {
            const apiError = error as SupraAPIError;
            expect(apiError.status).toBe(400);
            expect(apiError.data).toEqual(errorData);
            expect(apiError.major_status).toBe("ABORTED");
        }
    });
});
