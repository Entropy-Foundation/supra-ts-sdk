import { createFundedAccount, createUnfundedAccount } from "./helpers/accounts";
import { describeE2E } from "./helpers/describe";
import { getE2EContext, type E2EContext } from "./helpers/env";
import { depositEventType, supraLayoutOf } from "./helpers/layout";
import type { RawTransaction } from "./helpers/raw";
import { sendSupra } from "./helpers/transfers";

describeE2E("events", () => {
    let ctx: E2EContext;
    let transfer: RawTransaction;
    let receiver: string;
    let depositType: ReturnType<typeof depositEventType>;

    beforeAll(async () => {
        ctx = await getE2EContext();
        const sender = await createFundedAccount(ctx);
        receiver = createUnfundedAccount().address().toString();
        transfer = await sendSupra(ctx, sender, receiver, 2_000n);
        // The deposit lands in the receiver's store, which the transfer created.
        depositType = depositEventType(await supraLayoutOf(ctx, receiver));
    });

    test("getEventsByType returns the deposit event of a committed transfer", async () => {
        const height = transfer.block_header?.height;
        expect(height).toBeDefined();

        const { response } = await ctx.supra.events.getEventsByType({
            eventType: depositType,
            options: { startHeight: height as number, endHeight: (height as number) + 1, limit: 100 },
        });

        const events = response.filter((event) => event.transaction_hash === transfer.hash);
        expect(events.length).toBeGreaterThan(0);
        expect(events.every((event) => event.event.type === depositType)).toBe(true);
        expect(events.every((event) => event.block_height === height)).toBe(true);
    });

    test("getEventsByType limits the number of events returned", async () => {
        const { response } = await ctx.supra.events.getEventsByType({
            eventType: depositType,
            options: { limit: 1 },
        });
        expect(response.length).toBeLessThanOrEqual(1);
    });
});
