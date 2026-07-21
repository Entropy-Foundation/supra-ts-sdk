import { SupraClient, Network } from "supra-ts-sdk";


(async () => {

    const supra = new SupraClient({ network: Network.TESTNET });

    // ---------------------------------------------------------------------------
    // Get deposit events
    // ---------------------------------------------------------------------------
    const { response: depositEvents, cursor } = await supra.events.getEventsByType({ eventType: "0x1::fungible_asset::Deposit", options: { limit: 100 } });

    console.log("Deposit events :", depositEvents);


})();