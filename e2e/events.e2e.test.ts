import { createFundedAccount, createUnfundedAccount } from "./helpers/accounts";
import { describeE2E } from "./helpers/describe";
import { getE2EContext, type E2EContext } from "./helpers/env";
import type { RawTransaction } from "./helpers/raw";
import { sendSupra } from "./helpers/transfers";

describeE2E("events", () => {
    let ctx: E2EContext;
    let transfer: RawTransaction;
    let receiver: string;

    beforeAll(async () => {
        ctx = await getE2EContext();
        const sender = await createFundedAccount(ctx);
        receiver = createUnfundedAccount().address().toString();
        transfer = await sendSupra(ctx, sender, receiver, 2_000n);
    });

    test("getEventsByType returns the deposit event of a committed transfer", async () => {
        const height = transfer.block_header?.height;
        expect(height).toBeDefined();

        const { response } = await ctx.supra.events.getEventsByType({
            eventType: "0x1::coin::CoinDeposit",
            options: { startHeight: height as number, endHeight: (height as number) + 1, limit: 100 },
        });

        const events = response.filter((event) => event.transaction_hash === transfer.hash);
        expect(events.length).toBeGreaterThan(0);
        expect(events.every((event) => event.event.type === "0x1::coin::CoinDeposit")).toBe(true);
        expect(events.every((event) => event.block_height === height)).toBe(true);
    });

    test("getEventsByType limits the number of events returned", async () => {
        const { response } = await ctx.supra.events.getEventsByType({
            eventType: "0x1::coin::CoinDeposit",
            options: { limit: 1 },
        });
        expect(response.length).toBeLessThanOrEqual(1);
    });
});
