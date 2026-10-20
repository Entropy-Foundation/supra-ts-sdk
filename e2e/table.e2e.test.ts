import { describeE2E } from "./helpers/describe";
import { getE2EContext, type E2EContext } from "./helpers/env";

/** The `TypeInfo` of `0x1::supra_coin::SupraCoin`, with its module and struct names as hex-encoded bytes. */
const SUPRA_COIN_TYPE_INFO = {
    account_address: "0x1",
    module_name: "0x73757072615f636f696e",
    struct_name: "0x5375707261436f696e",
};

describeE2E("tables", () => {
    let ctx: E2EContext;
    let handle: string;

    beforeAll(async () => {
        ctx = await getE2EContext();
        // The coin to fungible asset map of the framework is a table keyed by coin type.
        const resource = await ctx.supra.account.getAccountResource<{ coin_to_fungible_asset_map: { handle: string } }>(
            {
                accountAddress: "0x1",
                resourceType: "0x1::coin::CoinConversionMap",
            },
        );
        handle = resource.data.coin_to_fungible_asset_map.handle;
    });

    test("getTableItem reads the fungible asset paired with the SUPRA coin", async () => {
        const item = await ctx.supra.table.getTableItem<{ inner: string }>({
            handle,
            data: {
                key_type: "0x1::type_info::TypeInfo",
                value_type: "0x1::object::Object<0x1::fungible_asset::Metadata>",
                key: SUPRA_COIN_TYPE_INFO,
            },
        });
        expect(item).toEqual({ inner: "0xa" });
    });

    test("getTableItem rejects for a key that is not in the table", async () => {
        await expect(
            ctx.supra.table.getTableItem({
                handle,
                data: {
                    key_type: "0x1::type_info::TypeInfo",
                    value_type: "0x1::object::Object<0x1::fungible_asset::Metadata>",
                    key: { account_address: "0x1", module_name: "0x00", struct_name: "0x00" },
                },
            }),
        ).rejects.toThrow();
    });
});
