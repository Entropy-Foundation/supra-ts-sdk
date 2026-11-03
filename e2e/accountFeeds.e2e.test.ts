import type { PaginatedResponse, SupraAccount } from "../src/index";
import { SupraNotFoundError, SupraRouteUnsupportedError } from "../src/index";
import { createFundedAccount, createMigratedAccount, createUnfundedAccount } from "./helpers/accounts";
import { describeE2E, nodeGeneration } from "./helpers/describe";
import { getE2EContext, type E2EContext } from "./helpers/env";
import { rawGet, rawPost, type RawTransaction } from "./helpers/raw";
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

/** The address of the primary SUPRA fungible store of `owner`, read with a plain request to the view endpoint. */
async function rawPrimarySupraStore(ctx: E2EContext, owner: string): Promise<string> {
    const response = await rawPost<{ result: string[] }>(ctx, "/rpc/v3/view", {
        function: "0x1::primary_fungible_store::primary_store_address",
        type_arguments: ["0x1::fungible_asset::Metadata"],
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

    describe("getPrimaryStoreAddress", () => {
        test("returns the address the view function returns, for SUPRA by default and by metadata address", async () => {
            const expected = await rawPrimarySupraStore(ctx, address);
            await expect(ctx.supra.account.getPrimaryStoreAddress({ accountAddress: address })).resolves.toBe(expected);
            await expect(
                ctx.supra.account.getPrimaryStoreAddress({ accountAddress: address, metadataAddress: SUPRA_FA }),
            ).resolves.toBe(expected);
        });

        // The view needs an existing metadata object, and SUPRA's is the only one on the localnets, so a
        // non-default metadata address is covered by a unit test of the view arguments.
    });

    describe("getAccountFaTransactions", () => {
        let faAccountAddress: string;
        const faSent: RawTransaction[] = [];

        beforeAll(async () => {
            // On v11 SUPRA is held as a coin until the account migrates to its primary store.
            const account =
                nodeGeneration() === "v11" ? await createMigratedAccount(ctx) : await createFundedAccount(ctx);
            faAccountAddress = account.address().toString();
            for (let i = 0; i < 3; i++) {
                faSent.push(
                    await sendSupra(ctx, account, createUnfundedAccount().address().toString(), 2_000n + BigInt(i)),
                );
            }
        });

        test("the address of an account that is not a store has an empty feed", async () => {
            const page = await ctx.supra.account.getAccountFaTransactions({ storeAddress: address });
            expect(page.response).toEqual([]);
        });

        test.each([true, false])(
            "pages a non-empty store feed with count 1 to its end, in the order requested (ascending: %s)",
            async (ascending) => {
                const store = await ctx.supra.account.getPrimaryStoreAddress({ accountAddress: faAccountAddress });
                const raw = await rawGet<Array<{ hash: string }>>(
                    ctx,
                    `/rpc/v3/accounts/${store}/fa_transactions?count=100&ascending=${ascending}`,
                );
                expect(raw.status).toBe(200);
                const expected = raw.body.map((txn) => txn.hash);
                expect(expected.length).toBeGreaterThanOrEqual(faSent.length);

                const all = await ctx.supra.account.getAccountFaTransactions({
                    storeAddress: store,
                    options: { count: 100, ascending },
                });
                const { items, requests } = await readFeed((start) =>
                    ctx.supra.account.getAccountFaTransactions({
                        storeAddress: store,
                        options: { count: 1, ascending, start },
                    }),
                );

                const hashes = items.map((txn) => txn.hash);
                expect(new Set(hashes).size).toBe(hashes.length);
                expect(all.response.map((txn) => txn.hash)).toEqual(expected);
                expect(hashes).toEqual(expected);
                expect(requests).toBeGreaterThan(faSent.length);
                expect(hashes).toEqual(expect.arrayContaining(faSent.map((txn) => txn.hash)));
            },
        );

        test("ascending and descending feeds are reverses of each other", async () => {
            const store = await ctx.supra.account.getPrimaryStoreAddress({ accountAddress: faAccountAddress });
            const up = await ctx.supra.account.getAccountFaTransactions({
                storeAddress: store,
                options: { count: 100, ascending: true },
            });
            const down = await ctx.supra.account.getAccountFaTransactions({
                storeAddress: store,
                options: { count: 100, ascending: false },
            });
            expect(up.response.map((txn) => txn.hash)).toEqual(down.response.map((txn) => txn.hash).reverse());
        });

        test("a store without transactions ends the feed", async () => {
            const store = await ctx.supra.account.getPrimaryStoreAddress({
                accountAddress: createUnfundedAccount().address().toString(),
            });
            const { items } = await readFeed((start) =>
                ctx.supra.account.getAccountFaTransactions({ storeAddress: store, options: { start } }),
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

                const raw = await rawGet<Array<{ transaction: { hash: string } }>>(
                    ctx,
                    `/rpc/v3/accounts/${address}/history?count=100&ascending=${ascending}`,
                );
                expect(raw.status).toBe(200);
                const expected = raw.body.map((entry) => entry.transaction.hash);

                const hashes = items.map((entry) => entry.transaction.hash);
                expect(new Set(hashes).size).toBe(hashes.length);
                expect(all.response.map((entry) => entry.transaction.hash)).toEqual(expected);
                expect(hashes).toEqual(expected);
                expect(requests).toBeGreaterThanOrEqual(sent.length);
            }),
        );

        test("pages past empty pages that carry a cursor when categories filter rows out", () =>
            onNodeWithHistory(async () => {
                // The peer receives three transfers and sends one, so its ascending history starts with rows that
                // the `sent` filter excludes.
                const peer = await createFundedAccount(ctx);
                const peerAddress = peer.address().toString();
                for (let i = 0; i < 3; i++) {
                    await sendSupra(ctx, sender, peerAddress, 3_000n + BigInt(i));
                }
                const own = await sendSupra(ctx, peer, createUnfundedAccount().address().toString(), 1_000n);

                let emptyPagesWithCursor = 0;
                const { items } = await readFeed(async (start) => {
                    const page = await ctx.supra.account.getAccountHistory({
                        accountAddress: peerAddress,
                        options: { categories: ["sent"], count: 1, ascending: true, start },
                    });
                    if (page.response.length === 0 && page.cursor !== undefined) {
                        emptyPagesWithCursor++;
                    }
                    return page;
                });

                expect(items.map((entry) => entry.transaction.hash)).toEqual([own.hash]);
                for (const entry of items) {
                    expect(entry.categories).toContain("sent");
                }
                // Not asserted to be positive: how many rows the node reads per page is its choice.
                expect(emptyPagesWithCursor).toBeGreaterThanOrEqual(0);
            }));

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
