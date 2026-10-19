import { createClient, runExample } from "./setup";

runExample(async () => {
    const supra = createClient();

    // ---------------------------------------------------------------------------
    // Read an item of a table. The framework's coin to fungible asset map is a table keyed by the type of a coin;
    // the key is the `TypeInfo` of `0x1::supra_coin::SupraCoin`, whose module and struct names are hex-encoded bytes.
    // ---------------------------------------------------------------------------
    const conversionMap = await supra.account.getAccountResource<{ coin_to_fungible_asset_map: { handle: string } }>({
        accountAddress: "0x1",
        resourceType: "0x1::coin::CoinConversionMap",
    });

    const tableItem = await supra.table.getTableItem<{ inner: string }>({
        handle: conversionMap.data.coin_to_fungible_asset_map.handle,
        data: {
            key_type: "0x1::type_info::TypeInfo",
            value_type: "0x1::object::Object<0x1::fungible_asset::Metadata>",
            key: {
                account_address: "0x1",
                module_name: "0x73757072615f636f696e",
                struct_name: "0x5375707261436f696e",
            },
        },
    });
    console.log("Table item:", tableItem);
});
