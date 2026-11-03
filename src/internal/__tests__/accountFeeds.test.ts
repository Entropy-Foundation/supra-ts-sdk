import { Account } from "../../api/account";
import { SupraNotFoundError, SupraRouteUnsupportedError } from "../../errors/apiError";
import type { AccountHistoryEntry, AccountHistoryPage, PaginatedResponse } from "../../types/account";
import { TransactionStatus, TransactionType, type UserTransactionResponse } from "../../types/transaction";
import type { NetworkConfig } from "../../utils/apiEndpoints";
import {
    getAccountCoinTransactionsInternal,
    getAccountFaTransactionsInternal,
    getAccountHistoryInternal,
    getPrimaryStoreAddressInternal,
} from "../account";

jest.mock("../../client/get", () => ({
    get: jest.fn(),
}));

jest.mock("../methods", () => ({
    viewInternal: jest.fn(),
}));

import { viewInternal } from "../methods";
const mockView = viewInternal as jest.MockedFunction<typeof viewInternal>;

import { get } from "../../client/get";
const mockGet = get as jest.MockedFunction<typeof get>;

const testConfig: NetworkConfig = {
    name: "devnet",
    chainId: 50,
    rpcUrl: "https://rpc-devnet.supra.com",
};

function sentQuery(call: number): Record<string, unknown> | undefined {
    return mockGet.mock.calls[call]?.[0].query;
}

function userTxn(n: number): UserTransactionResponse {
    return {
        txn_type: TransactionType.User,
        hash: `0x${n.toString(16).padStart(64, "0")}`,
        authenticator: { Move: { Ed25519: { public_key: "0x", signature: "0x" } } },
        block_header: null,
        header: {
            chain_id: 50,
            expiration_timestamp: { microseconds_since_unix_epoch: 0, utc_date_time: "" },
            sender: { Move: "0x1" },
            sequence_number: n,
            gas_unit_price: 100,
            max_gas_amount: 10,
        },
        payload: { Move: { type: "entry_function_payload", function: "0x1::m::f", type_arguments: [], arguments: [] } },
        output: { Move: { gas_used: 1, events: [], vm_status: "Executed successfully" } },
        status: TransactionStatus.Success,
    };
}

function entry(n: number): AccountHistoryEntry {
    return { categories: ["sent", "fa"], transaction: userTxn(n) };
}

/** Reads a feed with `while (cursor !== undefined)` and returns the items and the number of requests. */
async function readFeed<T>(
    fetchPage: (cursor: string | undefined) => Promise<PaginatedResponse<T[]>>,
): Promise<{ items: T[]; requests: number }> {
    const items: T[] = [];
    let requests = 0;
    let cursor: string | undefined;
    do {
        if (requests >= 20) {
            throw new Error("The feed did not end");
        }
        const page = await fetchPage(cursor);
        requests++;
        items.push(...page.response);
        cursor = page.cursor;
    } while (cursor !== undefined);
    return { items, requests };
}

describe("account feeds", () => {
    beforeEach(() => {
        jest.resetAllMocks();
    });

    describe("getPrimaryStoreAddressInternal", () => {
        const STORE = "0xc6d3d69a9810647845a5ca5ebe905256dc37327c1c39c1d673de00caaac0e3a8";

        it("views primary_store_address with the owner and the SUPRA metadata by default", async () => {
            mockView.mockResolvedValue([STORE]);

            await expect(getPrimaryStoreAddressInternal({ accountAddress: "0x1" }, testConfig)).resolves.toBe(STORE);

            expect(mockView).toHaveBeenCalledWith(
                {
                    function: "0x1::primary_fungible_store::primary_store_address",
                    functionArguments: [
                        "0x0000000000000000000000000000000000000000000000000000000000000001",
                        "0x000000000000000000000000000000000000000000000000000000000000000a",
                    ],
                    typeArguments: ["0x1::fungible_asset::Metadata"],
                },
                testConfig,
            );
        });

        it("uses the given metadata address", async () => {
            mockView.mockResolvedValue([STORE]);

            await getPrimaryStoreAddressInternal({ accountAddress: "0x1", metadataAddress: "0xb" }, testConfig);

            expect(mockView.mock.calls[0]?.[0].functionArguments).toEqual([
                "0x0000000000000000000000000000000000000000000000000000000000000001",
                "0x000000000000000000000000000000000000000000000000000000000000000b",
            ]);
        });
    });

    describe("getAccountFaTransactionsInternal", () => {
        it("requests fa_transactions with the options and the start as sent", async () => {
            mockGet.mockResolvedValue({ data: [userTxn(1)], cursor: "17" });

            const page = await getAccountFaTransactionsInternal(
                { storeAddress: "0xa", options: { count: 5, start: "9", ascending: true, type: "user" } },
                testConfig,
            );

            expect(mockGet.mock.calls[0]?.[0].path).toBe(
                "/accounts/0x000000000000000000000000000000000000000000000000000000000000000a/fa_transactions",
            );
            expect(sentQuery(0)).toEqual({ count: 5, start: "9", ascending: true, type: "user" });
            expect(page.cursor).toBe("17");
        });

        it("ends a v12 feed at the first response without a cursor", async () => {
            mockGet
                .mockResolvedValueOnce({ data: [userTxn(1), userTxn(2)], cursor: "20" })
                .mockResolvedValueOnce({ data: [userTxn(3)], cursor: undefined });

            const { items, requests } = await readFeed((start) =>
                getAccountFaTransactionsInternal({ storeAddress: "0xa", options: { start } }, testConfig),
            );

            expect(items).toHaveLength(3);
            expect(requests).toBe(2);
        });

        it.each([true, false])('ends a v11 feed on the empty page with "0" (ascending: %s)', async (ascending) => {
            mockGet
                .mockResolvedValueOnce({ data: [userTxn(1), userTxn(2)], cursor: "20" })
                .mockResolvedValueOnce({ data: [], cursor: "0" });

            const { items, requests } = await readFeed((start) =>
                getAccountFaTransactionsInternal({ storeAddress: "0xa", options: { start, ascending } }, testConfig),
            );

            expect(items).toHaveLength(2);
            expect(requests).toBe(2);
            expect([0, 1].map((call) => sentQuery(call)?.["start"])).toEqual([undefined, "20"]);
        });

        it('ends the feed of a store without transactions on the first page ("0")', async () => {
            mockGet.mockResolvedValue({ data: [], cursor: "0" });

            const { items, requests } = await readFeed((start) =>
                getAccountFaTransactionsInternal({ storeAddress: "0xa", options: { start } }, testConfig),
            );

            expect(items).toEqual([]);
            expect(requests).toBe(1);
        });

        it("continues past an empty page that carries a cursor other than 0 (a type-filtered page)", async () => {
            mockGet
                .mockResolvedValueOnce({ data: [], cursor: "30" })
                .mockResolvedValueOnce({ data: [userTxn(1)], cursor: "40" })
                .mockResolvedValueOnce({ data: [], cursor: undefined });

            const { items, requests } = await readFeed((start) =>
                getAccountFaTransactionsInternal(
                    { storeAddress: "0xa", options: { start, type: "user", ascending: true } },
                    testConfig,
                ),
            );

            expect(items).toHaveLength(1);
            expect(requests).toBe(3);
        });

        it("ends the feed on the empty cursor header", async () => {
            mockGet.mockResolvedValue({ data: [], cursor: "" });

            const page = await getAccountFaTransactionsInternal({ storeAddress: "0xa" }, testConfig);

            expect(page.cursor).toBeUndefined();
        });
    });

    describe.each([
        ["getAccountCoinTransactionsInternal", "coin_transactions"],
        ["getAccountFaTransactionsInternal", "fa_transactions"],
    ] as const)("%s, the cursor 0 of a genesis row", (name, route) => {
        const readTyped = (options: { start?: string; ascending?: boolean; type?: "user"; count?: number }) =>
            name === "getAccountCoinTransactionsInternal"
                ? getAccountCoinTransactionsInternal({ accountAddress: "0xa", options }, testConfig)
                : getAccountFaTransactionsInternal({ storeAddress: "0xa", options }, testConfig);

        const readFeedTyped = (ascending: boolean | undefined, type: "user" | undefined) =>
            readFeed((start) => readTyped({ start, ascending, type, count: 1 }));

        const sentStarts = () => mockGet.mock.calls.map((call) => call[0].query?.["start"]);

        it("requests the route", async () => {
            mockGet.mockResolvedValue({ data: [], cursor: undefined });
            await readTyped({});
            expect(mockGet.mock.calls[0]?.[0].path).toContain(`/${route}`);
        });

        it("v12: continues with start=0 after the empty first page of an ascending typed read (reproduction)", async () => {
            // Block 0 has timestamp 0: the page scanned only the genesis row, which the type filter excluded.
            mockGet
                .mockResolvedValueOnce({ data: [], cursor: "0" })
                .mockResolvedValueOnce({ data: [userTxn(1)], cursor: "1793692451844347" })
                .mockResolvedValueOnce({ data: [userTxn(2)], cursor: "1793692451844400" })
                .mockResolvedValueOnce({ data: [], cursor: undefined });

            const { items, requests } = await readFeedTyped(true, "user");

            expect(items.map((txn) => txn.hash)).toEqual([userTxn(1).hash, userTxn(2).hash]);
            expect(requests).toBe(4);
            expect(sentStarts()).toEqual([undefined, "0", "1793692451844347", "1793692451844400"]);
        });

        it("v12: a feed without rows ends on the first page without a cursor", async () => {
            mockGet.mockResolvedValue({ data: [], cursor: undefined });

            const { items, requests } = await readFeedTyped(true, "user");

            expect(items).toEqual([]);
            expect(requests).toBe(1);
        });

        it("v11: the request with start=0 ends the feed through the echo, after one extra request", async () => {
            mockGet.mockResolvedValue({ data: [], cursor: "0" });

            const { items, requests } = await readFeedTyped(true, "user");

            expect(items).toEqual([]);
            expect(requests).toBe(2);
            expect(sentStarts()).toEqual([undefined, "0"]);
        });

        it("v11: continues past the genesis row the typed read excluded, which the request with start=0 skips", async () => {
            mockGet
                .mockResolvedValueOnce({ data: [], cursor: "0" })
                .mockResolvedValueOnce({ data: [userTxn(1)], cursor: "1793683183245980" })
                .mockResolvedValueOnce({ data: [], cursor: "1793683183245980" });

            const { items, requests } = await readFeedTyped(true, "user");

            expect(items).toHaveLength(1);
            expect(requests).toBe(3);
        });

        it.each([
            ["descending with a type", false, "user"],
            ["ascending without a type", true, undefined],
            ["unordered with a type", undefined, "user"],
        ] as const)('ends the feed on the empty first page with "0" (%s)', async (_label, ascending, type) => {
            mockGet.mockResolvedValue({ data: [], cursor: "0" });

            const { requests } = await readFeedTyped(ascending, type);

            expect(requests).toBe(1);
        });

        it('ends the feed on an empty page with "0" for a request that has a start', async () => {
            mockGet
                .mockResolvedValueOnce({ data: [userTxn(1)], cursor: "17" })
                .mockResolvedValueOnce({ data: [], cursor: "0" });

            const { items, requests } = await readFeedTyped(true, "user");

            expect(items).toHaveLength(1);
            expect(requests).toBe(2);
        });
    });

    describe("getAccountHistoryInternal", () => {
        it("requests history with the categories joined by commas, and omits an empty start", async () => {
            mockGet.mockResolvedValue({ data: [], cursor: undefined });

            await getAccountHistoryInternal(
                {
                    accountAddress: "0xa",
                    options: { categories: ["sent", "fa"], count: 7, ascending: true, start: "" },
                },
                testConfig,
            );

            expect(mockGet.mock.calls[0]?.[0].path).toBe(
                "/accounts/0x000000000000000000000000000000000000000000000000000000000000000a/history",
            );
            expect(sentQuery(0)).toEqual({ categories: "sent,fa", count: 7, ascending: true, start: undefined });
        });

        it("sends no categories by default", async () => {
            mockGet.mockResolvedValue({ data: [], cursor: undefined });

            await getAccountHistoryInternal({ accountAddress: "0xa" }, testConfig);

            expect(sentQuery(0)?.["categories"]).toBeUndefined();
        });

        it("returns the entries with the cursor and the heights of the headers", async () => {
            mockGet.mockResolvedValue({
                data: [entry(1)],
                cursor: "123",
                headers: new Headers({ "x-supra-history-indexed-from": "42", "x-supra-oldest-block": "7" }),
            });

            const page: AccountHistoryPage = await getAccountHistoryInternal({ accountAddress: "0xa" }, testConfig);

            expect(page.response).toEqual([entry(1)]);
            expect(page.cursor).toBe("123");
            expect(page.indexedFrom).toBe(42);
            expect(page.oldestBlock).toBe(7);
        });

        it("leaves the heights undefined when the node sends no such header", async () => {
            mockGet.mockResolvedValue({ data: [], cursor: undefined, headers: new Headers() });

            const page = await getAccountHistoryInternal({ accountAddress: "0xa" }, testConfig);

            expect(page.indexedFrom).toBeUndefined();
            expect(page.oldestBlock).toBeUndefined();
        });

        it('reads to the end past an empty page with a cursor and the cursor "0"', async () => {
            mockGet
                .mockResolvedValueOnce({ data: [entry(1)], cursor: "100" })
                .mockResolvedValueOnce({ data: [], cursor: "90" })
                .mockResolvedValueOnce({ data: [], cursor: "0" })
                .mockResolvedValueOnce({ data: [entry(2)], cursor: "0" })
                .mockResolvedValueOnce({ data: [], cursor: undefined });

            const { items, requests } = await readFeed((start) =>
                getAccountHistoryInternal({ accountAddress: "0xa", options: { start } }, testConfig),
            );

            expect(items.map((item) => item.transaction.hash)).toEqual([userTxn(1).hash, userTxn(2).hash]);
            expect(requests).toBe(5);
            expect([0, 1, 2, 3, 4].map((call) => sentQuery(call)?.["start"])).toEqual([
                undefined,
                "100",
                "90",
                "0",
                "0",
            ]);
        });

        it("does not end the feed on an empty page that echoes the cursor it was sent", async () => {
            mockGet
                .mockResolvedValueOnce({ data: [], cursor: "5" })
                .mockResolvedValueOnce({ data: [], cursor: undefined });

            const first = await getAccountHistoryInternal(
                { accountAddress: "0xa", options: { start: "5" } },
                testConfig,
            );

            expect(first.cursor).toBe("5");
        });

        it("ends the feed on an empty cursor header", async () => {
            mockGet.mockResolvedValue({ data: [entry(1)], cursor: "" });

            const page = await getAccountHistoryInternal({ accountAddress: "0xa" }, testConfig);

            expect(page.cursor).toBeUndefined();
        });

        it("rethrows a 404 that carries a body unchanged (an error of the request, not a missing route)", async () => {
            const original = new SupraNotFoundError({
                status: 404,
                statusText: "Not Found",
                url: "https://rpc-devnet.supra.com/rpc/v3/accounts/0xa/history",
                data: { message: "Transaction not found" },
            });
            mockGet.mockRejectedValue(original);

            const error = await getAccountHistoryInternal({ accountAddress: "0xa" }, testConfig).catch(
                (e: unknown) => e,
            );

            expect(error).toBe(original);
            expect(error).not.toBeInstanceOf(SupraRouteUnsupportedError);
        });

        it("throws SupraRouteUnsupportedError, a SupraNotFoundError, when the node answers 404 with an empty body", async () => {
            const original = new SupraNotFoundError({
                status: 404,
                statusText: "Not Found",
                url: "https://rpc-mainnet.supra.com/rpc/v3/accounts/0xa/history",
            });
            mockGet.mockRejectedValue(original);

            const error = await getAccountHistoryInternal({ accountAddress: "0xa" }, testConfig).catch(
                (e: unknown) => e,
            );

            expect(error).toBeInstanceOf(SupraRouteUnsupportedError);
            expect(error).toBeInstanceOf(SupraNotFoundError);
            const unsupported = error as SupraRouteUnsupportedError;
            expect(unsupported.status).toBe(404);
            expect(unsupported.data).toBeUndefined();
            expect(unsupported.method).toBe("getAccountHistory");
            expect(unsupported.minimumNodeRelease).toBe("supra_node_v12.0.0");
            expect(unsupported.message).toContain("supra_node_v12.0.0");
            expect(unsupported.name).toBe("SupraRouteUnsupportedError");
        });

        it("rethrows other errors unchanged", async () => {
            const failure = new Error("boom");
            mockGet.mockRejectedValue(failure);

            await expect(getAccountHistoryInternal({ accountAddress: "0xa" }, testConfig)).rejects.toBe(failure);
        });
    });

    describe("Account", () => {
        const account = new Account(testConfig);

        it("getAccountHistory rejects an empty or unknown category before any request", async () => {
            await expect(
                account.getAccountHistory({ accountAddress: "0xa", options: { categories: [] } }),
            ).rejects.toThrow("Invalid categories");
            await expect(
                account.getAccountHistory({
                    accountAddress: "0xa",
                    // @ts-expect-error "sell" is not a category
                    options: { categories: ["sell"] },
                }),
            ).rejects.toThrow("Invalid categories");
            expect(mockGet).not.toHaveBeenCalled();
        });

        it("getAccountFaTransactions validates storeAddress, and getPrimaryStoreAddress its addresses", async () => {
            await expect(account.getAccountFaTransactions({ storeAddress: "not an address" })).rejects.toThrow(
                "storeAddress",
            );
            await expect(account.getPrimaryStoreAddress({ accountAddress: "zz" })).rejects.toThrow("accountAddress");
            await expect(
                account.getPrimaryStoreAddress({ accountAddress: "0x1", metadataAddress: "zz" }),
            ).rejects.toThrow("metadataAddress");
            expect(mockGet).not.toHaveBeenCalled();
            expect(mockView).not.toHaveBeenCalled();
        });

        it("getAccountHistory and getAccountFaTransactions reject a count outside 1 to 100", async () => {
            await expect(account.getAccountHistory({ accountAddress: "0xa", options: { count: 0 } })).rejects.toThrow(
                "Invalid count",
            );
            await expect(
                account.getAccountFaTransactions({ storeAddress: "0xa", options: { count: 101 } }),
            ).rejects.toThrow("Invalid count");
            expect(mockGet).not.toHaveBeenCalled();
        });
    });
});
