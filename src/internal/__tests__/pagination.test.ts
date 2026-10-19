import {
    getAccountAutoTransactionsInternal,
    getAccountCoinsCountInternal,
    getAccountCoinTransactionsInternal,
    getAccountModulesInternal,
    getAccountResourcesInternal,
    getAccountTransactionsInternal,
    nextSequenceNumberCursor,
} from "../account";
import { TransactionStatus, TransactionType, type UserTransactionResponse } from "../../types/transaction";
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

function sentQuery(call: number): Record<string, unknown> | undefined {
    return mockGet.mock.calls[call]?.[0].query;
}

function userTxn(sequenceNumber: number): UserTransactionResponse {
    return {
        txn_type: TransactionType.User,
        hash: `0x${sequenceNumber.toString(16).padStart(64, "0")}`,
        authenticator: { Move: { Ed25519: { public_key: "0x", signature: "0x" } } },
        block_header: null,
        header: {
            chain_id: 6,
            expiration_timestamp: { microseconds_since_unix_epoch: 0, utc_date_time: "" },
            sender: { Move: "0x1" },
            sequence_number: sequenceNumber,
            gas_unit_price: 100,
            max_gas_amount: 10,
        },
        payload: { Move: { type: "entry_function_payload", function: "0x1::m::f", type_arguments: [], arguments: [] } },
        output: { Move: { gas_used: 1, events: [], vm_status: "Executed successfully" } },
        status: TransactionStatus.Success,
    };
}

describe("feed pagination", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe("getAccountCoinTransactionsInternal", () => {
        it('ends the feed on the "0" cursor of an empty v11 page', async () => {
            mockGet.mockResolvedValue({ data: [], cursor: "0" });

            const page = await getAccountCoinTransactionsInternal(
                { accountAddress: "0x1", options: { start: "1792406658389084" } },
                testConfig,
            );

            expect(page).toEqual({ response: [], cursor: undefined });
        });

        it("continues from a cursor on an empty page filtered by type", async () => {
            mockGet.mockResolvedValue({ data: [], cursor: "1792406658389090" });

            const page = await getAccountCoinTransactionsInternal(
                { accountAddress: "0x1", options: { start: "1792406658389084", type: "settlement" } },
                testConfig,
            );

            expect(page.cursor).toBe("1792406658389090");
            expect(sentQuery(0)?.["type"]).toBe("settlement");
        });

        it("does not send an empty start", async () => {
            mockGet.mockResolvedValue({ data: [], cursor: undefined });

            await getAccountCoinTransactionsInternal({ accountAddress: "0x1", options: { start: "" } }, testConfig);

            expect(sentQuery(0)?.["start"]).toBeUndefined();
        });
    });

    describe("getAccountResourcesInternal and getAccountModulesInternal", () => {
        it("end the feed when an empty v11 page echoes the start", async () => {
            mockGet.mockResolvedValue({ data: [], cursor: "0a0b" });

            await expect(
                getAccountResourcesInternal({ accountAddress: "0x1", options: { start: "0a0b" } }, testConfig),
            ).resolves.toEqual({ response: [], cursor: undefined });
            await expect(
                getAccountModulesInternal({ accountAddress: "0x1", options: { start: "0a0b" } }, testConfig),
            ).resolves.toEqual({ response: [], cursor: undefined });
        });

        it("end the feed on the empty cursor v11 sends for an account without entries", async () => {
            mockGet.mockResolvedValue({ data: [], cursor: "" });

            await expect(getAccountResourcesInternal({ accountAddress: "0x1" }, testConfig)).resolves.toEqual({
                response: [],
                cursor: undefined,
            });
        });
    });

    describe("getAccountAutoTransactionsInternal", () => {
        it("sends the cursor as `cursor` and ends the feed on an empty v11 cursor", async () => {
            mockGet.mockResolvedValue({ data: [], cursor: "" });

            const page = await getAccountAutoTransactionsInternal(
                { accountAddress: "0x1", options: { cursor: "c1" } },
                testConfig,
            );

            expect(sentQuery(0)?.["cursor"]).toBe("c1");
            expect(page.cursor).toBeUndefined();
        });
    });

    describe("getAccountCoinsCountInternal", () => {
        it("stops when a v11 node echoes the start on the last page", async () => {
            const coinStore = {
                type: "0x1::coin::CoinStore<0x1::supra_coin::SupraCoin>",
                data: { coin: { value: "1" } },
            };
            mockGet
                .mockResolvedValueOnce({ data: [coinStore], cursor: "c1" })
                .mockResolvedValueOnce({ data: [], cursor: "c1" });

            await expect(getAccountCoinsCountInternal({ accountAddress: "0x1" }, testConfig)).resolves.toBe(1);
            expect(mockGet).toHaveBeenCalledTimes(2);
            expect(sentQuery(0)?.["start"]).toBeUndefined();
            expect(sentQuery(1)?.["start"]).toBe("c1");
        });

        it("stops when a v12 node omits the cursor", async () => {
            mockGet.mockResolvedValueOnce({ data: [], cursor: undefined });

            await expect(getAccountCoinsCountInternal({ accountAddress: "0x1" }, testConfig)).resolves.toBe(0);
            expect(mockGet).toHaveBeenCalledTimes(1);
        });
    });

    describe("getAccountTransactionsInternal", () => {
        it("returns the next sequence number as the cursor in ascending order", async () => {
            mockGet.mockResolvedValue({ data: [userTxn(4), userTxn(5)], cursor: undefined });

            const page = await getAccountTransactionsInternal(
                { accountAddress: "0x1", options: { start: 4, count: 2, ascending: true } },
                testConfig,
            );

            expect(page.cursor).toBe("6");
            expect(sentQuery(0)?.["start"]).toBe("4");
        });

        it("returns the previous sequence number as the cursor in descending order", async () => {
            mockGet.mockResolvedValue({ data: [userTxn(5), userTxn(4)], cursor: undefined });

            const page = await getAccountTransactionsInternal(
                { accountAddress: "0x1", options: { count: 2 } },
                testConfig,
            );

            expect(page.cursor).toBe("3");
        });

        it("ends the feed on an empty page and at sequence number 0 in descending order", async () => {
            mockGet.mockResolvedValueOnce({ data: [], cursor: undefined });
            await expect(
                getAccountTransactionsInternal(
                    { accountAddress: "0x1", options: { start: "7", ascending: true } },
                    testConfig,
                ),
            ).resolves.toEqual({ response: [], cursor: undefined });

            mockGet.mockResolvedValueOnce({ data: [userTxn(1), userTxn(0)], cursor: undefined });
            const last = await getAccountTransactionsInternal({ accountAddress: "0x1" }, testConfig);
            expect(last.cursor).toBeUndefined();
        });

        it("accepts its own cursor, a number and a bigint as start", async () => {
            mockGet.mockResolvedValue({ data: [], cursor: undefined });

            await getAccountTransactionsInternal({ accountAddress: "0x1", options: { start: "6" } }, testConfig);
            await getAccountTransactionsInternal({ accountAddress: "0x1", options: { start: 6 } }, testConfig);
            await getAccountTransactionsInternal({ accountAddress: "0x1", options: { start: 6n } }, testConfig);
            await getAccountTransactionsInternal({ accountAddress: "0x1", options: { start: "" } }, testConfig);

            expect([0, 1, 2, 3].map((call) => sentQuery(call)?.["start"])).toEqual(["6", "6", "6", undefined]);
        });
    });

    describe("nextSequenceNumberCursor", () => {
        it("is undefined for a page without a transaction that has a header", () => {
            expect(nextSequenceNumberCursor([], true)).toBeUndefined();
        });
    });
});
