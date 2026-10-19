import { getAccountLegacyCoins, getAccountInfoInternal, getAccountModulesInternal, getAccountModuleInternal, getAccountResourcesInternal, getAccountResourceInternal, getAccountTransactionsInternal, isAccountExistsInternal } from "../account";
import { SupraAPIError } from "../../errors/apiError";
import type { MoveResource } from "../../types/move";
import type { NetworkConfig } from "../../utils/apiEndpoints";

// Mock the get client
jest.mock("../../client/get", () => ({
    get: jest.fn(),
}));

import { get } from "../../client/get";
const mockGet = get as jest.MockedFunction<typeof get>;

const testConfig: NetworkConfig = {
    name: "testnet",
    chainId: 6,
    rpcUrl: "https://rpc-testnet.supra.com",
};

const fullAddress = "0x0000000000000000000000000000000000000000000000000000000000000001";

describe("internal/account", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe("getAccountLegacyCoins", () => {
        it("should filter CoinStore resources and extract values", () => {
            const resources: MoveResource[] = [
                {
                    type: "0x1::coin::CoinStore<0x1::supra_coin::SupraCoin>" as `${string}::${string}::${string}`,
                    data: { coin: { value: "1000" } },
                },
                {
                    type: "0x1::account::Account" as `${string}::${string}::${string}`,
                    data: { sequence_number: "5" },
                },
                {
                    type: "0x1::coin::CoinStore<0x2::custom::Token>" as `${string}::${string}::${string}`,
                    data: { coin: { value: "500" } },
                },
            ];

            const result = getAccountLegacyCoins(resources);
            expect(Object.keys(result)).toHaveLength(2);
            expect(result["0x1::coin::CoinStore<0x1::supra_coin::SupraCoin>"]).toBe("1000");
            expect(result["0x1::coin::CoinStore<0x2::custom::Token>"]).toBe("500");
        });

        it("should return empty object when no CoinStore resources", () => {
            const resources: MoveResource[] = [
                {
                    type: "0x1::account::Account" as `${string}::${string}::${string}`,
                    data: {},
                },
            ];
            expect(getAccountLegacyCoins(resources)).toEqual({});
        });

        it("should return empty object for empty resources", () => {
            expect(getAccountLegacyCoins([])).toEqual({});
        });
    });

    describe("getAccountInfoInternal", () => {
        it("should call get with correct path", async () => {
            mockGet.mockResolvedValue({ data: { sequence_number: 5, authentication_key: "0xabc" } });

            const result = await getAccountInfoInternal(
                { accountAddress: "0x1" },
                testConfig,
            );

            expect(mockGet).toHaveBeenCalledWith(
                { path: `/accounts/${fullAddress}` },
                testConfig,
            );
            expect(result).toEqual({ sequence_number: 5n, authentication_key: "0xabc" });
        });

        it("should return the sequence number as a bigint", async () => {
            mockGet.mockResolvedValue({ data: { sequence_number: 7, authentication_key: "0xabc" } });

            const result = await getAccountInfoInternal({ accountAddress: "0x1" }, testConfig);

            expect(typeof result.sequence_number).toBe("bigint");
            expect(result.sequence_number + 1n).toBe(8n);
        });

        it("should accept a sequence number sent as a decimal string", async () => {
            mockGet.mockResolvedValue({ data: { sequence_number: "18446744073709551615", authentication_key: "0xabc" } });

            const result = await getAccountInfoInternal({ accountAddress: "0x1" }, testConfig);

            expect(result.sequence_number).toBe(18446744073709551615n);
        });
    });

    describe("getAccountModulesInternal", () => {
        it("should call get with correct path and pagination params", async () => {
            const mockModules = [{ bytecode: "0x...", abi: undefined }];
            mockGet.mockResolvedValue({ data: mockModules, cursor: "next" });

            const result = await getAccountModulesInternal(
                { accountAddress: "0x1", options: { count: 10, start: "abc" } },
                testConfig,
            );

            expect(mockGet).toHaveBeenCalledWith(
                {
                    path: `/accounts/${fullAddress}/modules`,
                    query: { count: 10, start: "abc" },
                },
                testConfig,
            );
            expect(result).toEqual({ response: mockModules, cursor: "next" });
        });
    });

    describe("getAccountModuleInternal", () => {
        it("should call get with correct path including module name", async () => {
            const mockModule = { bytecode: "0x...", abi: undefined };
            mockGet.mockResolvedValue({ data: mockModule });

            await getAccountModuleInternal(
                { accountAddress: "0x1", moduleName: "coin" },
                testConfig,
            );

            expect(mockGet).toHaveBeenCalledWith(
                { path: `/accounts/${fullAddress}/modules/coin` },
                testConfig,
            );
        });
    });

    describe("getAccountResourcesInternal", () => {
        it("should call get with correct path and pagination", async () => {
            mockGet.mockResolvedValue({ data: [], cursor: undefined });

            const result = await getAccountResourcesInternal(
                { accountAddress: "0x1", options: { count: 5 } },
                testConfig,
            );

            expect(mockGet).toHaveBeenCalledWith(
                {
                    path: `/accounts/${fullAddress}/resources`,
                    query: { count: 5, start: undefined },
                },
                testConfig,
            );
            expect(result).toEqual({ response: [], cursor: undefined });
        });
    });

    describe("getAccountResourceInternal", () => {
        it("should call get with correct path including resource type", async () => {
            const resourceType = "0x1::coin::CoinStore<0x1::supra_coin::SupraCoin>" as `${string}::${string}::${string}`;
            mockGet.mockResolvedValue({ data: { type: resourceType, data: {} } });

            await getAccountResourceInternal(
                { accountAddress: "0x1", resourceType },
                testConfig,
            );

            expect(mockGet).toHaveBeenCalledWith(
                { path: `/accounts/${fullAddress}/resources/${encodeURIComponent(resourceType)}` },
                testConfig,
            );
            expect(encodeURIComponent(resourceType)).toBe("0x1%3A%3Acoin%3A%3ACoinStore%3C0x1%3A%3Asupra_coin%3A%3ASupraCoin%3E");
        });

        it("should encode a resource type so that it stays one path segment", async () => {
            mockGet.mockResolvedValue({ data: { type: "t", data: {} } });

            await getAccountResourceInternal(
                { accountAddress: "0x1", resourceType: "0x1::a::B/../c" as `${string}::${string}::${string}` },
                testConfig,
            );

            expect(mockGet).toHaveBeenCalledWith({ path: `/accounts/${fullAddress}/resources/0x1%3A%3Aa%3A%3AB%2F..%2Fc` }, testConfig);
        });
    });

    describe("getAccountTransactionsInternal", () => {
        it("should pass all query options", async () => {
            mockGet.mockResolvedValue({ data: [], cursor: "cursor1" });

            await getAccountTransactionsInternal(
                {
                    accountAddress: "0x1",
                    options: { count: 20, start: "s", ascending: true },
                },
                testConfig,
            );

            expect(mockGet).toHaveBeenCalledWith(
                {
                    path: `/accounts/${fullAddress}/transactions`,
                    query: { count: 20, start: "s", ascending: true },
                },
                testConfig,
            );
        });
    });

    describe("isAccountExistsInternal", () => {
        it("should return true when account exists", async () => {
            mockGet.mockResolvedValue({ data: { sequence_number: 0n, authentication_key: "0x" } });
            const result = await isAccountExistsInternal({ accountAddress: "0x1" }, testConfig);
            expect(result).toBe(true);
        });

        const apiError = (status: number, message?: string) =>
            new SupraAPIError({
                status,
                statusText: `status ${status}`,
                url: "http://node/rpc/v3/accounts/0x1",
                data: message === undefined ? undefined : { message },
            });

        it("should return false when a v12 node answers HTTP 404", async () => {
            mockGet.mockRejectedValue(apiError(404, "Not Found: Resource not found: 0x1::account::Account"));
            const result = await isAccountExistsInternal({ accountAddress: "0x999" }, testConfig);
            expect(result).toBe(false);
        });

        it("should return false when a v11 node answers HTTP 400 with Resource not found", async () => {
            mockGet.mockRejectedValue(apiError(400, "Bad Request: Resource not found: 0x1::account::Account"));
            const result = await isAccountExistsInternal({ accountAddress: "0x999" }, testConfig);
            expect(result).toBe(false);
        });

        it("should rethrow HTTP 400 without a Resource not found message", async () => {
            const error = apiError(400, "Bad Request: storage error");
            mockGet.mockRejectedValue(error);
            await expect(isAccountExistsInternal({ accountAddress: "0x999" }, testConfig)).rejects.toBe(error);
        });

        it.each([429, 500, 503])("should rethrow HTTP %i", async (status) => {
            const error = apiError(status);
            mockGet.mockRejectedValue(error);
            await expect(isAccountExistsInternal({ accountAddress: "0x999" }, testConfig)).rejects.toBe(error);
        });

        it("should rethrow a network failure", async () => {
            const error = new TypeError("fetch failed");
            mockGet.mockRejectedValue(error);
            await expect(isAccountExistsInternal({ accountAddress: "0x999" }, testConfig)).rejects.toBe(error);
        });

        it("should rethrow a timeout", async () => {
            const error = new DOMException("The operation was aborted due to timeout", "TimeoutError");
            mockGet.mockRejectedValue(error);
            await expect(isAccountExistsInternal({ accountAddress: "0x999" }, testConfig)).rejects.toBe(error);
        });
    });
});
