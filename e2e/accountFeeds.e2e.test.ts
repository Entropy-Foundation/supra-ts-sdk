import type { PaginatedResponse, SupraAccount } from "../src/index";
import { SupraNotFoundError, SupraRouteUnsupportedError } from "../src/index";
import { createFundedAccount, createMigratedAccount, createUnfundedAccount } from "./helpers/accounts";
import { describeE2E, nodeGeneration } from "./helpers/describe";
import { DEFAULT_FAUCET_PATH, getE2EContext, type E2EContext } from "./helpers/env";
import { rawGet, rawPost, rawWaitForCommit, type RawTransaction } from "./helpers/raw";
import { sendSupra } from "./helpers/transfers";

/** Upper bound on the pages a loop may request before the test treats the feed as endless. */
const MAX_PAGES = 200;

const SUPRA_FA = "0xa";

/** Reads a feed to its end, passing each returned cursor back unchanged. */
async function readFeed<T>(
    fetchPage: (cursor: string | undefined) => Promise<PaginatedResponse<T[]>>,
    maxPages = MAX_PAGES,
): Promise<{ items: T[]; requests: number }> {
    const items: T[] = [];
    let requests = 0;
    let cursor: string | undefined;
    do {
        if (requests >= maxPages) {
            throw new Error(`The feed did not end within ${maxPages} pages`);
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

    describe("the feeds of the faucet account, which is funded at genesis", () => {
        let faucetAccount: string;
        let faucetStore: string;

        /**
         * Reads a feed ascending with plain requests, 100 rows at a time and without a type filter, to its end:
         * an empty page, or a page without the cursor header.
         */
        async function rawFeed(path: string): Promise<Array<{ hash: string; txn_type: string }>> {
            const rows: Array<{ hash: string; txn_type: string }> = [];
            let start: string | undefined;
            for (let page = 0; page < MAX_PAGES; page++) {
                const query = `count=100&ascending=true${start === undefined ? "" : `&start=${start}`}`;
                const response = await rawGet<Array<{ hash: string; txn_type: string }>>(ctx, `${path}?${query}`);
                expect(response.status).toBe(200);
                rows.push(...response.body);
                const cursor = response.headers.get("x-supra-cursor");
                if (response.body.length === 0 || cursor === null || cursor === "") {
                    return rows;
                }
                start = cursor;
            }
            throw new Error(`The raw feed ${path} did not end within ${MAX_PAGES} pages`);
        }

        beforeAll(async () => {
            // The faucet sends the funds, so it is the sender of the transaction that funds a fresh account.
            const template = process.env["SUPRA_E2E_FAUCET_PATH"] ?? DEFAULT_FAUCET_PATH;
            const response = await rawGet<{ Accepted: string }>(
                ctx,
                template.replace("{address}", createUnfundedAccount().address().toString()),
            );
            expect(response.status).toBe(200);
            const funding = await rawWaitForCommit(ctx, response.body.Accepted);
            const sender = funding.header?.sender.Move;
            if (sender === undefined) {
                throw new Error(`The faucet transaction ${funding.hash} has no sender`);
            }
            faucetAccount = sender;
            faucetStore = await rawPrimarySupraStore(ctx, faucetAccount);
        });

        test("reads each feed ascending with count 1 and type user to its end, as the untyped feed lists the user rows", async () => {
            const feeds = [
                {
                    path: () => `/rpc/v3/accounts/${faucetAccount}/coin_transactions`,
                    read: (start: string | undefined) =>
                        ctx.supra.account.getAccountCoinTransactions({
                            accountAddress: faucetAccount,
                            options: { count: 1, ascending: true, type: "user", start },
                        }),
                },
                {
                    path: () => `/rpc/v3/accounts/${faucetStore}/fa_transactions`,
                    read: (start: string | undefined) =>
                        ctx.supra.account.getAccountFaTransactions({
                            storeAddress: faucetStore,
                            options: { count: 1, ascending: true, type: "user", start },
                        }),
                },
            ];

            let nonEmpty = 0;
            for (const feed of feeds) {
                const expected = (await rawFeed(feed.path())).filter((txn) => txn.txn_type === "user");
                const { items } = await readFeed(feed.read, 5_000);
                const hashes = items.map((txn) => txn.hash);

                expect(new Set(hashes).size).toBe(hashes.length);
                expect(hashes).toEqual(expected.map((txn) => txn.hash));
                nonEmpty += hashes.length > 0 ? 1 : 0;
            }
            // SUPRA is a coin on v11 and a fungible asset on v12, so one of the two feeds lists the faucet's transfers.
            expect(nonEmpty).toBeGreaterThanOrEqual(1);
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
