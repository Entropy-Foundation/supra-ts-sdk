import { getTransactionByHashInternal, isPendingTransactionInternal, waitForTransactionInternal } from "../transaction";
import { TransactionStatus } from "../../types/transaction";
import type { NetworkConfig } from "../../utils/apiEndpoints";
import { SupraAPIError } from "../../errors/apiError";

jest.mock("../../client/get", () => ({
    get: jest.fn(),
}));

jest.mock("../../utils/functions", () => ({
    sleep: jest.fn().mockResolvedValue(null),
}));

import { get } from "../../client/get";
const mockGet = get as jest.MockedFunction<typeof get>;

const testConfig: NetworkConfig = {
    name: "testnet",
    chainId: 6,
    rpcUrl: "https://rpc-testnet.supra.com",
};

const fullHash = "0x0000000000000000000000000000000000000000000000000000000000000abc";

describe("internal/transaction", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe("getTransactionByHashInternal", () => {
        it("should call get with correct path", async () => {
            const mockTxn = { status: TransactionStatus.Success, hash: "0xabc" };
            mockGet.mockResolvedValue({ data: mockTxn });

            const result = await getTransactionByHashInternal(
                { transactionHash: "0xabc" },
                testConfig,
            );

            expect(mockGet).toHaveBeenCalledWith(
                expect.objectContaining({
                    path: expect.stringContaining("/transactions/"),
                }),
                testConfig,
            );
            expect(result).toEqual(mockTxn);
        });

        it("should pass query params for type and exclude_uncommitted", async () => {
            mockGet.mockResolvedValue({ data: {} });

            await getTransactionByHashInternal(
                { transactionHash: "0xabc", type: "user" as any, exclude_uncommitted: true },
                testConfig,
            );

            expect(mockGet).toHaveBeenCalledWith(
                expect.objectContaining({
                    query: { type: "user", exclude_uncommitted: true },
                }),
                testConfig,
            );
        });
    });

    describe("isPendingTransactionInternal", () => {
        it("should return true for pending transaction", async () => {
            mockGet.mockResolvedValue({ data: { status: TransactionStatus.Pending } });
            const result = await isPendingTransactionInternal(
                { transactionHash: "0xabc" },
                testConfig,
            );
            expect(result).toBe(true);
        });

        it("should return false for committed transaction", async () => {
            mockGet.mockResolvedValue({ data: { status: TransactionStatus.Success } });
            const result = await isPendingTransactionInternal(
                { transactionHash: "0xabc" },
                testConfig,
            );
            expect(result).toBe(false);
        });
    });

    describe("waitForTransactionInternal", () => {
        it("should return immediately when transaction is already committed", async () => {
            const committedTxn = { status: TransactionStatus.Success, hash: "0xabc" };
            mockGet.mockResolvedValue({ data: committedTxn });

            const result = await waitForTransactionInternal(
                { transactionHash: "0xabc" },
                testConfig,
            );

            expect(result).toEqual(committedTxn);
            expect(mockGet).toHaveBeenCalledTimes(1);
        });

        it("should poll until transaction is committed", async () => {
            mockGet
                .mockResolvedValueOnce({ data: { status: TransactionStatus.Pending } })
                .mockResolvedValueOnce({ data: { status: TransactionStatus.Pending } })
                .mockResolvedValueOnce({ data: { status: TransactionStatus.Success, hash: "0xabc" } });

            const result = await waitForTransactionInternal(
                { transactionHash: "0xabc" },
                testConfig,
            );

            expect(result.status).toBe(TransactionStatus.Success);
            expect(mockGet).toHaveBeenCalledTimes(3);
        });

        it("should throw on timeout", async () => {
            mockGet.mockResolvedValue({ data: { status: TransactionStatus.Pending } });

            await expect(
                waitForTransactionInternal(
                    {
                        transactionHash: "0xabc",
                        options: { timeoutSecs: 0.001 },
                    },
                    testConfig,
                ),
            ).rejects.toThrow(SupraAPIError);
        });

        it("should throw on failed transaction when checkSuccess is true", async () => {
            mockGet.mockResolvedValue({ data: { status: TransactionStatus.Fail } });

            await expect(
                waitForTransactionInternal(
                    {
                        transactionHash: "0xabc",
                        options: { checkSuccess: true },
                    },
                    testConfig,
                ),
            ).rejects.toThrow(SupraAPIError);
        });

        it("should return failed transaction when checkSuccess is false", async () => {
            const failedTxn = { status: TransactionStatus.Fail, hash: "0xabc" };
            mockGet.mockResolvedValue({ data: failedTxn });

            const result = await waitForTransactionInternal(
                {
                    transactionHash: "0xabc",
                    options: { checkSuccess: false },
                },
                testConfig,
            );

            expect(result).toEqual(failedTxn);
        });
    });
});
