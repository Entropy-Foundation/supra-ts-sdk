import {
    getChainIdInternal,
    getEstimatedGasUnitPriceInternal,
    getGasPriceInternal,
    getMinGasUnitPriceInternal,
} from "../supraClient";
import type { NetworkConfig } from "../../utils/apiEndpoints";

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

describe("internal/supraClient", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe("getChainIdInternal", () => {
        it("should return the chain_id from the RPC response", async () => {
            mockGet.mockResolvedValueOnce({ data: 6 });

            const chainId = await getChainIdInternal(testConfig);

            expect(chainId).toBe(6);
            expect(mockGet).toHaveBeenCalledWith({ path: "/transactions/chain_id" }, testConfig);
        });
    });

    describe("getGasPriceInternal", () => {
        it("should return median_gas_price hitting the correct path", async () => {
            mockGet.mockResolvedValueOnce({
                data: { mean_gas_price: 1, max_gas_price: 2, median_gas_price: 100, min_configured_gas_price: 1 },
            });

            const price = await getGasPriceInternal(testConfig);

            expect(price).toBe(100n);
            expect(mockGet).toHaveBeenCalledWith({ path: "/transactions/estimate_gas_price" }, testConfig);
        });
    });

    describe("getEstimatedGasUnitPriceInternal", () => {
        it.each([
            [100, 50, 100n],
            [30, 50, 50n],
            [50, 50, 50n],
        ])("returns max(median %p, minimum %p) = %p from one request", async (median, min, expected) => {
            mockGet.mockResolvedValueOnce({
                data: {
                    mean_gas_price: 1,
                    max_gas_price: 2,
                    median_gas_price: median,
                    min_configured_gas_price: min,
                },
            });

            const price = await getEstimatedGasUnitPriceInternal(testConfig);

            expect(price).toBe(expected);
            expect(mockGet).toHaveBeenCalledTimes(1);
            expect(mockGet).toHaveBeenCalledWith({ path: "/transactions/estimate_gas_price" }, testConfig);
        });
    });

    describe("getMinGasUnitPriceInternal", () => {
        it("should return min_configured_gas_price hitting the correct path", async () => {
            mockGet.mockResolvedValueOnce({
                data: { mean_gas_price: 1, max_gas_price: 2, median_gas_price: 100, min_configured_gas_price: 50 },
            });

            const price = await getMinGasUnitPriceInternal(testConfig);

            expect(price).toBe(50n);
            expect(mockGet).toHaveBeenCalledWith({ path: "/transactions/estimate_gas_price" }, testConfig);
        });
    });
});
