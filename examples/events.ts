import { createClient, runExample } from "./setup";

runExample(async () => {
    const supra = createClient();

    // ---------------------------------------------------------------------------
    // Get deposit events
    //
    // SUPRA held in a `CoinStore` (Mainnet and Testnet nodes at v11.7.x): a deposit emits `0x1::coin::CoinDeposit`,
    // whose `account` field names the account.
    //
    // SUPRA held in a primary fungible store (a chain created from the `supra_node_v12.0.0` genesis, such as Devnet):
    // a deposit emits `0x1::fungible_asset::Deposit`, whose `store` field names the fungible store, not the account.
    // `getPrimaryStoreAddress` derives the store of an account. A network that holds SUPRA in both forms emits both.
    // ---------------------------------------------------------------------------
    for (const eventType of ["0x1::coin::CoinDeposit", "0x1::fungible_asset::Deposit"] as const) {
        const { response: depositEvents } = await supra.events.getEventsByType({
            eventType,
            options: { limit: 100 },
        });
        console.log(`${eventType}: ${depositEvents.length} events; the first:`, depositEvents[0]);
    }
});
