import { getTransactionByHashInternal, isPendingTransactionInternal, waitForTransactionInternal } from "../transaction";
import { TransactionStatus } from "../../types/transaction";
import type { NetworkConfig } from "../../utils/apiEndpoints";
import { SupraNotFoundError, SupraRateLimitError } from "../../errors/apiError";
import { SupraNetworkError } from "../../errors/supraError";
import { SupraTransactionFailedError, SupraTransactionTimeoutError } from "../../errors/transactionError";
import { DEFAULT_TXN_WAIT_TIMEOUT_MS } from "../../utils/constants";

jest.mock("../../client/get", () => ({
    get: jest.fn(),
}));

jest.mock("../../utils/functions", () => ({
    sleep: jest.fn(),
}));

import { get } from "../../client/get";
import { sleep } from "../../utils/functions";
const mockGet = get as jest.MockedFunction<typeof get>;
const mockSleep = sleep as jest.MockedFunction<typeof sleep>;

const testConfig: NetworkConfig = {
    name: "testnet",
    chainId: 6,
    rpcUrl: "https://rpc-testnet.supra.com",
};

const HASH = "0x" + "ab".repeat(32);

function txn(status: TransactionStatus, vmStatus?: string) {
    return {
        hash: HASH,
        status,
        output: vmStatus === undefined ? null : { Move: { gas_used: 7, events: [], vm_status: vmStatus } },
    };
}

function notFound() {
    return new SupraNotFoundError({ status: 404, statusText: "Not Found", url: `/transactions/${HASH}` });
}

/** A clock that only `sleep` and the reads advance, so that the tests measure wall-clock time exactly. */
let now = 0;

describe("internal/transaction", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        now = 1_000_000;
        jest.spyOn(Date, "now").mockImplementation(() => now);
        mockSleep.mockImplementation(async (ms: number) => {
            now += ms;
            return null;
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe("getTransactionByHashInternal", () => {
        it("should call get with correct path", async () => {
            const mockTxn = { status: TransactionStatus.Success, hash: "0xabc" };
            mockGet.mockResolvedValue({ data: mockTxn });

            const result = await getTransactionByHashInternal({ transactionHash: "0xabc" }, testConfig);

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
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
            const result = await isPendingTransactionInternal({ transactionHash: "0xabc" }, testConfig);
            expect(result).toBe(true);
        });

        it("should return true for a transaction pending after execution", async () => {
            mockGet.mockResolvedValue({ data: { status: TransactionStatus.PendingAfterExecution } });
            await expect(isPendingTransactionInternal({ transactionHash: "0xabc" }, testConfig)).resolves.toBe(true);
        });

        it.each([TransactionStatus.Success, TransactionStatus.Fail, TransactionStatus.Invalid])(
            "should return false for a final status (%s)",
            async (status) => {
                mockGet.mockResolvedValue({ data: { status } });
                await expect(isPendingTransactionInternal({ transactionHash: "0xabc" }, testConfig)).resolves.toBe(
                    false,
                );
            },
        );
    });

    describe("waitForTransactionInternal", () => {
        it("should return immediately when transaction is already committed", async () => {
            const committedTxn = txn(TransactionStatus.Success, "Executed successfully");
            mockGet.mockResolvedValue({ data: committedTxn });

            const result = await waitForTransactionInternal({ transactionHash: HASH }, testConfig);

            expect(result).toEqual(committedTxn);
            expect(mockGet).toHaveBeenCalledTimes(1);
            expect(mockSleep).not.toHaveBeenCalled();
        });

        it("should poll until transaction is committed", async () => {
            mockGet
                .mockResolvedValueOnce({ data: txn(TransactionStatus.Pending) })
                .mockResolvedValueOnce({ data: txn(TransactionStatus.Pending) })
                .mockResolvedValueOnce({ data: txn(TransactionStatus.Success, "Executed successfully") });

            const result = await waitForTransactionInternal({ transactionHash: HASH }, testConfig);

            expect(result.status).toBe(TransactionStatus.Success);
            expect(mockGet).toHaveBeenCalledTimes(3);
        });

        it("should keep polling on PendingAfterExecution and resolve with Success", async () => {
            mockGet
                .mockResolvedValueOnce({ data: txn(TransactionStatus.PendingAfterExecution) })
                .mockResolvedValueOnce({ data: txn(TransactionStatus.PendingAfterExecution) })
                .mockResolvedValueOnce({ data: txn(TransactionStatus.Success, "Executed successfully") });

            const result = await waitForTransactionInternal({ transactionHash: HASH }, testConfig);

            expect(result.status).toBe(TransactionStatus.Success);
            expect(mockGet).toHaveBeenCalledTimes(3);
        });

        it("should treat 404 as not yet seen and resolve once the node returns the transaction", async () => {
            mockGet
                .mockRejectedValueOnce(notFound())
                .mockRejectedValueOnce(notFound())
                .mockResolvedValueOnce({ data: txn(TransactionStatus.Pending) })
                .mockResolvedValueOnce({ data: txn(TransactionStatus.Success, "Executed successfully") });

            const result = await waitForTransactionInternal({ transactionHash: HASH }, testConfig);

            expect(result.status).toBe(TransactionStatus.Success);
            expect(mockGet).toHaveBeenCalledTimes(4);
        });

        it("should keep polling after a rate limit or a connection failure", async () => {
            mockGet
                .mockRejectedValueOnce(
                    new SupraRateLimitError({ status: 429, statusText: "Too Many Requests", url: "/transactions" }),
                )
                .mockRejectedValueOnce(new SupraNetworkError({ url: "/transactions" }))
                .mockResolvedValueOnce({ data: txn(TransactionStatus.Success, "Executed successfully") });

            const result = await waitForTransactionInternal({ transactionHash: HASH }, testConfig);

            expect(result.status).toBe(TransactionStatus.Success);
        });

        it("should rethrow an error that is not a request error", async () => {
            const bug = new TypeError("not a request error");
            mockGet.mockRejectedValueOnce(bug);

            await expect(waitForTransactionInternal({ transactionHash: HASH }, testConfig)).rejects.toBe(bug);
            expect(mockGet).toHaveBeenCalledTimes(1);
        });

        it("should throw SupraTransactionTimeoutError with the hash and the last status on timeout", async () => {
            mockGet.mockResolvedValue({ data: txn(TransactionStatus.Pending) });

            const error = await waitForTransactionInternal(
                { transactionHash: HASH, options: { timeoutMs: 3_000 } },
                testConfig,
            ).catch((e: unknown) => e);

            expect(error).toBeInstanceOf(SupraTransactionTimeoutError);
            const timeout = error as SupraTransactionTimeoutError;
            expect(timeout.hash).toBe(HASH);
            expect(timeout.timeoutMs).toBe(3_000);
            expect(timeout.lastStatus).toBe(TransactionStatus.Pending);
            expect(timeout.transaction?.hash).toBe(HASH);
            expect(timeout.cause).toBeUndefined();
            expect(timeout.message).toContain(HASH);
            expect(timeout.message).toContain("Pending");
        });

        it("should report PendingAfterExecution as the last status of a timeout", async () => {
            mockGet.mockResolvedValue({ data: txn(TransactionStatus.PendingAfterExecution) });

            const error = (await waitForTransactionInternal(
                { transactionHash: HASH, options: { timeoutMs: 1_000 } },
                testConfig,
            ).catch((e: unknown) => e)) as SupraTransactionTimeoutError;

            expect(error).toBeInstanceOf(SupraTransactionTimeoutError);
            expect(error.lastStatus).toBe(TransactionStatus.PendingAfterExecution);
        });

        it("should report a transaction never returned by the node with the last read error as cause", async () => {
            const lastError = notFound();
            mockGet.mockRejectedValue(lastError);

            const error = (await waitForTransactionInternal(
                { transactionHash: HASH, options: { timeoutMs: 1_000 } },
                testConfig,
            ).catch((e: unknown) => e)) as SupraTransactionTimeoutError;

            expect(error).toBeInstanceOf(SupraTransactionTimeoutError);
            expect(error.hash).toBe(HASH);
            expect(error.lastStatus).toBeUndefined();
            expect(error.transaction).toBeUndefined();
            expect(error.cause).toBe(lastError);
        });

        it("should count the time the reads take, not only the sleeps", async () => {
            // Every read takes 2 s of wall-clock time.
            mockGet.mockImplementation(async () => {
                now += 2_000;
                return { data: txn(TransactionStatus.Pending) };
            });

            await expect(
                waitForTransactionInternal({ transactionHash: HASH, options: { timeoutMs: 5_000 } }, testConfig),
            ).rejects.toBeInstanceOf(SupraTransactionTimeoutError);

            // Reads at 0 s, 2.2 s and 4.5 s; the third ends after the deadline.
            expect(mockGet).toHaveBeenCalledTimes(3);
        });

        it("should not sleep past the deadline", async () => {
            mockGet.mockResolvedValue({ data: txn(TransactionStatus.Pending) });
            const start = now;

            await expect(
                waitForTransactionInternal({ transactionHash: HASH, options: { timeoutMs: 10_000 } }, testConfig),
            ).rejects.toBeInstanceOf(SupraTransactionTimeoutError);

            expect(now - start).toBe(10_000);
        });

        it("should use the timeout of the client configuration when the call sets none", async () => {
            mockGet.mockResolvedValue({ data: txn(TransactionStatus.Pending) });
            const start = now;

            const error = (await waitForTransactionInternal(
                { transactionHash: HASH },
                { ...testConfig, waitTimeoutMs: 7_000 },
            ).catch((e: unknown) => e)) as SupraTransactionTimeoutError;

            expect(error.timeoutMs).toBe(7_000);
            expect(now - start).toBe(7_000);
        });

        it("should use the default timeout when neither the call nor the client sets one", async () => {
            mockGet.mockResolvedValue({ data: txn(TransactionStatus.Pending) });

            const error = (await waitForTransactionInternal({ transactionHash: HASH }, testConfig).catch(
                (e: unknown) => e,
            )) as SupraTransactionTimeoutError;

            expect(error.timeoutMs).toBe(DEFAULT_TXN_WAIT_TIMEOUT_MS);
        });

        it("should accept the deprecated timeoutSecs, with timeoutMs taking precedence", async () => {
            mockGet.mockResolvedValue({ data: txn(TransactionStatus.Pending) });

            const fromSecs = (await waitForTransactionInternal(
                { transactionHash: HASH, options: { timeoutSecs: 2 } },
                testConfig,
            ).catch((e: unknown) => e)) as SupraTransactionTimeoutError;
            const fromMs = (await waitForTransactionInternal(
                { transactionHash: HASH, options: { timeoutSecs: 2, timeoutMs: 500 } },
                testConfig,
            ).catch((e: unknown) => e)) as SupraTransactionTimeoutError;

            expect(fromSecs.timeoutMs).toBe(2_000);
            expect(fromMs.timeoutMs).toBe(500);
        });

        it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])("should reject the timeout %p", async (timeoutMs) => {
            await expect(
                waitForTransactionInternal({ transactionHash: HASH, options: { timeoutMs } }, testConfig),
            ).rejects.toBeInstanceOf(RangeError);
            expect(mockGet).not.toHaveBeenCalled();
        });

        it("should throw SupraTransactionFailedError for Fail with the hash, status and VM status", async () => {
            const failed = txn(
                TransactionStatus.Fail,
                "Move abort in 0x1::coin: EINSUFFICIENT_BALANCE(0x10006): Not enough coins to complete transaction",
            );
            mockGet.mockResolvedValue({ data: failed });

            const error = (await waitForTransactionInternal({ transactionHash: HASH }, testConfig).catch(
                (e: unknown) => e,
            )) as SupraTransactionFailedError;

            expect(error).toBeInstanceOf(SupraTransactionFailedError);
            expect(error.hash).toBe(HASH);
            expect(error.status).toBe(TransactionStatus.Fail);
            expect(error.vm_status).toBe(failed.output?.Move.vm_status);
            expect(error.major_status).toBe("ABORTED");
            expect(error.sub_status).toBe(0x10006);
            expect(error.transaction).toEqual(failed);
            expect(error.message).toContain(HASH);
            expect(error.message).toContain("EINSUFFICIENT_BALANCE");
            expect(JSON.parse(JSON.stringify(error))).toMatchObject({
                hash: HASH,
                status: "Fail",
                major_status: "ABORTED",
            });
        });

        it("should throw SupraTransactionFailedError for Out of gas with OUT_OF_GAS", async () => {
            mockGet.mockResolvedValue({ data: txn(TransactionStatus.Fail, "Out of gas") });

            const error = (await waitForTransactionInternal({ transactionHash: HASH }, testConfig).catch(
                (e: unknown) => e,
            )) as SupraTransactionFailedError;

            expect(error.major_status).toBe("OUT_OF_GAS");
            expect(error.sub_status).toBeUndefined();
        });

        it("should throw SupraTransactionFailedError for Invalid", async () => {
            mockGet.mockResolvedValue({
                data: txn(TransactionStatus.Invalid, "Status Code: INVALID_SIGNATURE, Type Validation"),
            });

            const error = (await waitForTransactionInternal({ transactionHash: HASH }, testConfig).catch(
                (e: unknown) => e,
            )) as SupraTransactionFailedError;

            expect(error).toBeInstanceOf(SupraTransactionFailedError);
            expect(error.status).toBe(TransactionStatus.Invalid);
            expect(error.major_status).toBe("INVALID_SIGNATURE");
        });

        it("should return failed transaction when checkSuccess is false", async () => {
            const failedTxn = txn(TransactionStatus.Fail, "Out of gas");
            mockGet.mockResolvedValue({ data: failedTxn });

            const result = await waitForTransactionInternal(
                { transactionHash: HASH, options: { checkSuccess: false } },
                testConfig,
            );

            expect(result).toEqual(failedTxn);
        });
    });
});
