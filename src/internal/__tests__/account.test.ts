import { getAccountLegacyCoins, getAccountInfoInternal, getAccountModulesInternal, getAccountModuleInternal, getAccountResourcesInternal, getAccountResourceInternal, getAccountTransactionsInternal, isAccountExistsInternal } from "../account";
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
            const mockData = { sequence_number: 5n, authentication_key: "0xabc" };
            mockGet.mockResolvedValue({ data: mockData });

            const result = await getAccountInfoInternal(
                { accountAddress: "0x1" },
                testConfig,
            );

            expect(mockGet).toHaveBeenCalledWith(
                { path: `/accounts/${fullAddress}` },
                testConfig,
            );
            expect(result).toEqual(mockData);
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
                { path: `/accounts/${fullAddress}/resources/${resourceType}` },
                testConfig,
            );
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

        it("should return false when account does not exist", async () => {
            mockGet.mockRejectedValue(new Error("Not found"));
            const result = await isAccountExistsInternal({ accountAddress: "0x999" }, testConfig);
            expect(result).toBe(false);
        });
    });
});
