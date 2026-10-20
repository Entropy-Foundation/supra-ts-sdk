import type { PaginatedResponse, SupraAccount } from "../src/index";
import { createFundedAccount, createUnfundedAccount } from "./helpers/accounts";
import { describeE2E } from "./helpers/describe";
import { getE2EContext, type E2EContext } from "./helpers/env";
import type { RawTransaction } from "./helpers/raw";
import { sendSupra } from "./helpers/transfers";

/** Upper bound on the pages a loop may request before the test treats the feed as endless. */
const MAX_PAGES = 200;

/**
 * Reads a feed to its end with `while (cursor !== undefined)`, passing each returned cursor back unchanged, and
 * returns every item with the number of requests made. `fetchPage` receives the cursor as `string | undefined`,
 * which each SDK method accepts without a cast.
 */
async function readFeed<T>(
    fetchPage: (cursor: string | undefined) => Promise<PaginatedResponse<T[]>>,
): Promise<{ items: T[]; requests: number }> {
    const items: T[] = [];
    let requests = 0;
    let res = await fetchPage(undefined);
    requests++;
    items.push(...res.response);
    while (res.cursor !== undefined) {
        if (requests >= MAX_PAGES) {
            throw new Error(`The feed did not end within ${MAX_PAGES} pages`);
        }
        res = await fetchPage(res.cursor);
        requests++;
        items.push(...res.response);
    }
    return { items, requests };
}

function sorted(values: string[]): string[] {
    return [...values].sort();
}

describeE2E("feeds read to their end", () => {
    let ctx: E2EContext;
    let sender: SupraAccount;
    let address: string;
    const sent: RawTransaction[] = [];

    beforeAll(async () => {
        ctx = await getE2EContext();
        sender = await createFundedAccount(ctx);
        address = sender.address().toString();
        for (let i = 0; i < 5; i++) {
            sent.push(await sendSupra(ctx, sender, createUnfundedAccount().address().toString(), 1_000n + BigInt(i)));
        }
    });

    test.each([true, false])(
        "getAccountCoinTransactions (ascending: %s) returns every transaction once",
        async (ascending) => {
            const all = await ctx.supra.account.getAccountCoinTransactions({
                accountAddress: address,
                options: { count: 100, ascending },
            });
            const { items, requests } = await readFeed((cursor) =>
                ctx.supra.account.getAccountCoinTransactions({
                    accountAddress: address,
                    options: { count: 2, ascending, start: cursor },
                }),
            );

            const hashes = items.map((txn) => txn.hash);
            expect(new Set(hashes).size).toBe(hashes.length);
            expect(hashes).toEqual(all.response.map((txn) => txn.hash));
            expect(hashes).toEqual(expect.arrayContaining(sent.map((txn) => txn.hash)));
            expect(requests).toBeGreaterThan(Math.ceil(sent.length / 2));
        },
    );

    test.each([true, false])(
        "getAccountTransactions (ascending: %s) returns every sent transaction once",
        async (ascending) => {
            const { items } = await readFeed((cursor) =>
                ctx.supra.account.getAccountTransactions({
                    accountAddress: address,
                    options: { count: 2, ascending, start: cursor },
                }),
            );

            const expected = sent.map((txn) => txn.hash);
            expect(items.map((txn) => txn.hash)).toEqual(ascending ? expected : [...expected].reverse());
        },
    );

    test("getAccountResources returns every resource once", async () => {
        const all = await ctx.supra.account.getAccountResources({ accountAddress: address, options: { count: 100 } });
        const { items, requests } = await readFeed((cursor) =>
            ctx.supra.account.getAccountResources({ accountAddress: address, options: { count: 1, start: cursor } }),
        );

        const types = items.map((resource) => resource.type);
        expect(new Set(types).size).toBe(types.length);
        expect(types).toEqual(all.response.map((resource) => resource.type));
        expect(requests).toBeGreaterThan(1);
    });

    test("getAccountResources of an account that does not exist ends after one page", async () => {
        const { items, requests } = await readFeed((cursor) =>
            ctx.supra.account.getAccountResources({
                accountAddress: createUnfundedAccount().address().toString(),
                options: { start: cursor },
            }),
        );
        expect(items).toEqual([]);
        expect(requests).toBe(1);
    });

    test("getAccountModules returns every framework module once", async () => {
        const { items, requests } = await readFeed((cursor) =>
            ctx.supra.account.getAccountModules({ accountAddress: "0x1", options: { count: 25, start: cursor } }),
        );

        const names = items.map((module) => module.abi?.name ?? module.bytecode);
        expect(new Set(names).size).toBe(names.length);
        expect(names).toEqual(expect.arrayContaining(["coin", "supra_account", "account"]));
        expect(requests).toBeGreaterThan(2);
    });

    test("getEventsByType returns every event of a block range once", async () => {
        const heights = sent.map((txn) => txn.block_header?.height as number);
        const startHeight = Math.min(...heights);
        const endHeight = Math.max(...heights) + 1;
        const eventType = "0x1::coin::CoinDeposit";

        const all = await ctx.supra.events.getEventsByType({
            eventType,
            options: { startHeight, endHeight, limit: 100 },
        });
        const { items, requests } = await readFeed((cursor) =>
            ctx.supra.events.getEventsByType({
                eventType,
                options: { startHeight, endHeight, limit: 2, start: cursor },
            }),
        );

        const keys = items.map((event) => JSON.stringify(event));
        if (all.response.length < 100) {
            // One page held the whole range, so the paged read must return the same events.
            expect(sorted(keys)).toEqual(sorted(all.response.map((event) => JSON.stringify(event))));
        } else {
            expect(new Set(keys).size).toBe(keys.length);
        }
        expect(items.map((event) => event.transaction_hash)).toEqual(expect.arrayContaining(sent.map((t) => t.hash)));
        expect(requests).toBeGreaterThan(1);
    });

    test("getAccountAutoTransactions of an account without automation tasks ends after one page", async () => {
        const { items, requests } = await readFeed((cursor) =>
            ctx.supra.account.getAccountAutoTransactions({ accountAddress: address, options: { count: 2, cursor } }),
        );
        expect(items).toEqual([]);
        expect(requests).toBe(1);
    });
});
