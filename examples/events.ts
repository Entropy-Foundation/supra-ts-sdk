import { createClient, runExample } from "./setup";

runExample(async () => {
    const supra = createClient();

    // ---------------------------------------------------------------------------
    // Get deposit events
    // ---------------------------------------------------------------------------
    const { response: depositEvents } = await supra.events.getEventsByType({
        eventType: "0x1::coin::CoinDeposit",
        options: { limit: 100 },
    });
    console.log(`${depositEvents.length} deposit events; the first:`, depositEvents[0]);
});
