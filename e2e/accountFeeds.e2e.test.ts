import type { PaginatedResponse, SupraAccount } from "../src/index";
import { SupraNotFoundError, SupraRouteUnsupportedError } from "../src/index";
import { createFundedAccount, createUnfundedAccount } from "./helpers/accounts";
import { describeE2E, nodeGeneration } from "./helpers/describe";
import { getE2EContext, type E2EContext } from "./helpers/env";
import { rawPost, type RawTransaction } from "./helpers/raw";
import { sendSupra } from "./helpers/transfers";

/** Upper bound on the pages a loop may request before the test treats the feed as endless. */
const MAX_PAGES = 200;

const SUPRA_FA = "0xa";

/** Reads a feed to its end, passing each returned cursor back unchanged. */
async function readFeed<T>(
    fetchPage: (cursor: string | undefined) => Promise<PaginatedResponse<T[]>>,
): Promise<{ items: T[]; requests: number }> {
    const items: T[] = [];
    let requests = 0;
    let cursor: string | undefined;
    do {
        if (requests >= MAX_PAGES) {
            throw new Error(`The feed did not end within ${MAX_PAGES} pages`);
        }
        const page = await fetchPage(cursor);
        requests++;
        items.push(...page.response);
        cursor = page.cursor;
    } while (cursor !== undefined);
    return { items, requests };
}

/** The address of the primary SUPRA fungible store of `owner`, read with the node's view function. */
async function primarySupraStore(ctx: E2EContext, owner: string): Promise<string> {
    const response = await rawPost<{ result: string[] }>(ctx, "/rpc/v3/view", {
        function: "0x1::primary_fungible_store::primary_store_address",
        type_arguments: ["0x1::object::ObjectCore"],
        arguments: [owner, SUPRA_FA],
    });
    const store = response.body.result?.[0];
    if (response.status !== 200 || store === undefined) {
        throw new Error(`primary_store_address returned HTTP ${response.status}: ${JSON.stringify(response.body)}`);
    }
    return store;
}

describeE2E("account fa_transactions and history feeds", () => {
    let ctx: E2EContext;
    let sender: SupraAccount;
    let address: string;
    const sent: RawTransaction[] = [];

    beforeAll(async () => {
        ctx = await getE2EContext();
        sender = await createFundedAccount(ctx);
        address = sender.address().toString();
        for (let i = 0; i < 3; i++) {
            sent.push(await sendSupra(ctx, sender, createUnfundedAccount().address().toString(), 1_000n + BigInt(i)));
        }
    });

    describe("getAccountFaTransactions", () => {
        test.each([true, false])(
            "reads the feed of the primary store to its end once, in both page sizes (ascending: %s)",
            async (ascending) => {
                const store = await primarySupraStore(ctx, address);
                const all = await ctx.supra.account.getAccountFaTransactions({
                    accountAddress: store,
                    options: { count: 100, ascending },
                });
                const { items, requests } = await readFeed((start) =>
                    ctx.supra.account.getAccountFaTransactions({
                        accountAddress: store,
                        options: { count: 1, ascending, start },
                    }),
                );

                const hashes = items.map((txn) => txn.hash);
                expect(new Set(hashes).size).toBe(hashes.length);
                expect(hashes).toEqual(all.response.map((txn) => txn.hash));
                expect(requests).toBeGreaterThanOrEqual(1);
                if (nodeGeneration() === "v12") {
                    // SUPRA moves between primary stores on a chain created from the v12 genesis.
                    expect(hashes).toEqual(expect.arrayContaining(sent.map((txn) => txn.hash)));
                }
            },
        );

        test("a store without transactions ends the feed", async () => {
            const store = await primarySupraStore(ctx, createUnfundedAccount().address().toString());
            const { items } = await readFeed((start) =>
                ctx.supra.account.getAccountFaTransactions({ accountAddress: store, options: { start } }),
            );
            expect(items).toEqual([]);
        });
    });

    describe("getAccountHistory", () => {
        /** Runs `body` unless the node is older than v12 and answers 404 for the route. */
        async function onNodeWithHistory(body: () => Promise<void>): Promise<void> {
            try {
                await ctx.supra.account.getAccountHistory({ accountAddress: address, options: { count: 1 } });
            } catch (error) {
                if (error instanceof SupraRouteUnsupportedError) {
                    expect(error).toBeInstanceOf(SupraNotFoundError);
                    expect(error.status).toBe(404);
                    expect(nodeGeneration()).not.toBe("v12");
                    return;
                }
                throw error;
            }
            await body();
        }

        test("a node before v12 answers with SupraRouteUnsupportedError, and v12 serves the route", async () => {
            const outcome = await ctx.supra.account
                .getAccountHistory({ accountAddress: address })
                .then(() => "served")
                .catch((error: unknown) => (error instanceof SupraRouteUnsupportedError ? "unsupported" : error));
            expect(outcome).toBe(nodeGeneration() === "v11" ? "unsupported" : "served");
        });

        test("lists the transactions the account sent with the sent category", () =>
            onNodeWithHistory(async () => {
                const page = await ctx.supra.account.getAccountHistory({
                    accountAddress: address,
                    options: { categories: ["sent"], count: 100 },
                });
                const hashes = page.response.map((entry) => entry.transaction.hash);
                expect(hashes).toEqual(expect.arrayContaining(sent.map((txn) => txn.hash)));
                for (const entry of page.response) {
                    expect(entry.categories).toContain("sent");
                }
            }));

        test.each([true, false])("reads the feed to its end once (ascending: %s)", (ascending) =>
            onNodeWithHistory(async () => {
                const all = await ctx.supra.account.getAccountHistory({
                    accountAddress: address,
                    options: { count: 100, ascending },
                });
                const { items, requests } = await readFeed((start) =>
                    ctx.supra.account.getAccountHistory({
                        accountAddress: address,
                        options: { count: 1, ascending, start },
                    }),
                );

                const hashes = items.map((entry) => entry.transaction.hash);
                expect(new Set(hashes).size).toBe(hashes.length);
                expect(hashes).toEqual(all.response.map((entry) => entry.transaction.hash));
                expect(requests).toBeGreaterThanOrEqual(sent.length);
            }),
        );

        test("an account without transactions has an empty history that ends", () =>
            onNodeWithHistory(async () => {
                const { items } = await readFeed((start) =>
                    ctx.supra.account.getAccountHistory({
                        accountAddress: createUnfundedAccount().address().toString(),
                        options: { start },
                    }),
                );
                expect(items).toEqual([]);
            }));

        test("rejects an unknown category before any request", async () => {
            await expect(
                ctx.supra.account.getAccountHistory({
                    accountAddress: address,
                    // @ts-expect-error "sell" is not a category
                    options: { categories: ["sell"] },
                }),
            ).rejects.toThrow("Invalid categories");
        });
    });
});
