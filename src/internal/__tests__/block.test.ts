import {
    getLatestBlockInternal,
    getBlockByHeightInternal,
    getBlockByHashInternal,
    getTransactionsByBlockHashInternal,
} from "../block";
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

/** The exactly read fields of a block's `execution_statistics`. */
const EXACT_STATISTICS = [
    "execution_statistics.evm_base_fee_per_gas",
    "execution_statistics.evm_automated_txn_gas_unit_price",
] as const;

const mockBlockHeader = {
    hash: "0xabc",
    height: 100,
    timestamp: "1234567890",
};

describe("internal/block", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe("getLatestBlockInternal", () => {
        it("should call get with /block path", async () => {
            mockGet.mockResolvedValue({ data: mockBlockHeader });
            const result = await getLatestBlockInternal(testConfig);
            expect(mockGet).toHaveBeenCalledWith({ path: "/block", u64Fields: [...EXACT_STATISTICS] }, testConfig);
            expect(result).toEqual(mockBlockHeader);
        });
    });

    describe("getBlockByHeightInternal", () => {
        it("should call get with correct path and options", async () => {
            mockGet.mockResolvedValue({ data: mockBlockHeader });
            await getBlockByHeightInternal(
                { height: 100, options: { withFinalizedTransactions: true, type: "user" } },
                testConfig,
            );
            expect(mockGet).toHaveBeenCalledWith(
                {
                    path: "/block/height/100",
                    query: { with_finalized_transactions: true, type: "user" },
                    u64Fields: [...EXACT_STATISTICS, "transactions[*].data.burn_amount"],
                },
                testConfig,
            );
        });

        it("should work without options", async () => {
            mockGet.mockResolvedValue({ data: mockBlockHeader });
            await getBlockByHeightInternal({ height: 50 }, testConfig);
            expect(mockGet).toHaveBeenCalledWith(
                {
                    path: "/block/height/50",
                    query: { with_finalized_transactions: undefined, type: undefined },
                    u64Fields: [...EXACT_STATISTICS, "transactions[*].data.burn_amount"],
                },
                testConfig,
            );
        });
    });

    describe("getBlockByHashInternal", () => {
        it("should call get with correct path", async () => {
            mockGet.mockResolvedValue({ data: mockBlockHeader });
            await getBlockByHashInternal({ blockHash: "0xabc" }, testConfig);
            expect(mockGet).toHaveBeenCalledWith(
                { path: "/block/0xabc", u64Fields: [...EXACT_STATISTICS] },
                testConfig,
            );
        });
    });

    describe("getTransactionsByBlockHashInternal", () => {
        it("should call get with correct path and type option", async () => {
            mockGet.mockResolvedValue({ data: ["0xhash1", "0xhash2"] });
            const result = await getTransactionsByBlockHashInternal(
                { blockHash: "0xabc", options: { type: "user" } },
                testConfig,
            );
            expect(mockGet).toHaveBeenCalledWith(
                {
                    path: "/block/0xabc/transactions",
                    query: { type: "user" },
                },
                testConfig,
            );
            expect(result).toEqual(["0xhash1", "0xhash2"]);
        });
    });
});
