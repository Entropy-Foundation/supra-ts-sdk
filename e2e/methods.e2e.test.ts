import { TypeTagParser } from "../src/index";
import { createFundedAccount } from "./helpers/accounts";
import { describeE2E } from "./helpers/describe";
import { getE2EContext, type E2EContext } from "./helpers/env";
import { SUPRA_COIN_TYPE, rawSupraBalance } from "./helpers/raw";

describeE2E("view functions", () => {
    let ctx: E2EContext;
    let address: string;

    beforeAll(async () => {
        ctx = await getE2EContext();
        address = (await createFundedAccount(ctx)).address().toString();
    });

    test("view returns typed values: a u64 result is a bigint", async () => {
        const [balance] = await ctx.supra.methods.view<[bigint]>({
            function: "0x1::coin::balance",
            functionArguments: [address],
            typeArguments: [SUPRA_COIN_TYPE],
        });
        expect(typeof balance).toBe("bigint");
        expect(balance).toBe(await rawSupraBalance(ctx, address));
    });

    test("view accepts a parsed TypeTag as a type argument", async () => {
        const [balance] = await ctx.supra.methods.view<[bigint]>({
            function: "0x1::coin::balance",
            functionArguments: [address],
            typeArguments: [new TypeTagParser(SUPRA_COIN_TYPE).parseTypeTag()],
        });
        expect(balance).toBe(await rawSupraBalance(ctx, address));
    });

    test("view of a function without arguments returns the chain's time", async () => {
        const [now] = await ctx.supra.methods.view<[bigint]>({ function: "0x1::timestamp::now_microseconds" });
        const nowMs = Number(now / 1000n);
        expect(Math.abs(nowMs - Date.now())).toBeLessThan(10 * 60 * 1000);
    });

    test("viewRaw returns the node's JSON values: a u64 result is a decimal string", async () => {
        const [balance] = await ctx.supra.methods.viewRaw<[string]>({
            function: "0x1::coin::balance",
            functionArguments: [address],
            typeArguments: [SUPRA_COIN_TYPE],
        });
        expect(balance).toBe((await rawSupraBalance(ctx, address)).toString());
    });

    test("view of a function that aborts rejects", async () => {
        await expect(
            ctx.supra.methods.view({
                function: "0x1::coin::balance",
                functionArguments: [address],
                typeArguments: ["0x1::supra_coin::NoSuchCoin"],
            }),
        ).rejects.toThrow();
    });
});
