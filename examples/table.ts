import { SupraClient, Network } from "supra-ts-sdk";

(async () => {
    const supra = new SupraClient({ network: Network.TESTNET });


    // ---------------------------------------------------------------------------
    // Fund an account with the faucet
    // ---------------------------------------------------------------------------

    let tableItem = await supra.table.getTableItem({
        handle: "0xe048de29cf41dbb209a155e228b6e9a2ec8d2afaf2a8321e2ee28298c9a6a8a0",
        data: {
            key_type: "u64",
            value_type: "0x48516d04d942d36299e6fb018865f0ac4b1ca37e2a1518ca367c7960c4b30985::pool::Position",
            key: "1"
        }
    });

    console.log("Table item:", tableItem);




})();