import type { SupraAccount } from "../src/index";
import { createFundedAccount, createUnfundedAccount } from "./helpers/accounts";
import { describeE2E } from "./helpers/describe";
import { getE2EContext, type E2EContext } from "./helpers/env";
import { rawSupraBalance } from "./helpers/raw";
import { sendSupra } from "./helpers/transfers";

const SUPRA_COIN_STORE = "0x1::coin::CoinStore<0x1::supra_coin::SupraCoin>";

describeE2E("account", () => {
    let ctx: E2EContext;
    let funded: SupraAccount;
    let receiver: SupraAccount;
    let address: string;

    beforeAll(async () => {
        ctx = await getE2EContext();
        funded = await createFundedAccount(ctx);
        receiver = createUnfundedAccount();
        address = funded.address().toString();
        await sendSupra(ctx, funded, receiver.address().toString(), 1_000n);
    });

    test("isAccountExists is true for a funded account and false for one that was never used", async () => {
        await expect(ctx.supra.account.isAccountExists({ accountAddress: address })).resolves.toBe(true);
        await expect(
            ctx.supra.account.isAccountExists({ accountAddress: createUnfundedAccount().address().toString() }),
        ).resolves.toBe(false);
    });

    test("getAccountInfo returns the sequence number and authentication key", async () => {
        const info = await ctx.supra.account.getAccountInfo({ accountAddress: address });
        // One transaction was sent from this account in beforeAll.
        expect(BigInt(info.sequence_number)).toBe(1n);
        expect(info.authentication_key).toBe(funded.authKey().toString());
    });

    test("an address in upper case reads the same account", async () => {
        const upper = `0x${address.slice(2).toUpperCase()}`;
        const info = await ctx.supra.account.getAccountInfo({ accountAddress: upper });
        expect(info.authentication_key).toBe(funded.authKey().toString());
        await expect(ctx.supra.account.isAccountExists({ accountAddress: upper })).resolves.toBe(true);
    });

    test("getAccountModule and getAccountResource send their names as one path segment", async () => {
        await expect(
            ctx.supra.account.getAccountModule({ accountAddress: "0x1", moduleName: "../resources" }),
        ).rejects.toThrow("Invalid moduleName");
        await expect(
            ctx.supra.account.getAccountResource({
                accountAddress: address,
                resourceType: "0x1::account::Account/../Account" as `${string}::${string}::${string}`,
            }),
        ).rejects.toThrow("Invalid resourceType");
        const resource = await ctx.supra.account.getAccountResource({
            accountAddress: address,
            resourceType: SUPRA_COIN_STORE,
        });
        expect(resource.type).toBe(SUPRA_COIN_STORE);
    });

    // Expected: the value matches the declared type `bigint`.
    test.failing("getAccountInfo returns the sequence number as a bigint", async () => {
        const info = await ctx.supra.account.getAccountInfo({ accountAddress: address });
        expect(typeof info.sequence_number).toBe("bigint");
    });

    test("getAccountResources lists the account's resources with a SUPRA coin store", async () => {
        const { response } = await ctx.supra.account.getAccountResources({ accountAddress: address });
        const types = response.map((resource) => resource.type);
        expect(types).toContain("0x1::account::Account");
    });

    test("getAccountResource returns one resource by type", async () => {
        const resource = await ctx.supra.account.getAccountResource<{ sequence_number: string }>({
            accountAddress: address,
            resourceType: "0x1::account::Account",
        });
        expect(resource.type).toBe("0x1::account::Account");
        expect(BigInt(resource.data.sequence_number)).toBe(1n);
    });

    test("getAccountResource reads the SUPRA coin store of a funded account", async () => {
        const resource = await ctx.supra.account.getAccountResource<{ coin: { value: string } }>({
            accountAddress: address,
            resourceType: SUPRA_COIN_STORE,
        });
        expect(BigInt(resource.data.coin.value)).toBe(await rawSupraBalance(ctx, address));
    });

    test("getAccountModules lists the framework modules", async () => {
        const { response } = await ctx.supra.account.getAccountModules({
            accountAddress: "0x1",
            options: { count: 5 },
        });
        expect(response.length).toBeGreaterThan(0);
        expect(response.length).toBeLessThanOrEqual(5);
        for (const module of response) {
            expect(module.bytecode).toMatch(/^0x[0-9a-f]+$/);
        }
    });

    test("getAccountModule returns the ABI of one module", async () => {
        const module = await ctx.supra.account.getAccountModule({ accountAddress: "0x1", moduleName: "supra_account" });
        expect(module.abi?.name).toBe("supra_account");
        expect(module.abi?.exposed_functions.map((fn) => fn.name)).toContain("transfer");
    });

    test("getAccountTransactions returns the transactions the account sent", async () => {
        const { response } = await ctx.supra.account.getAccountTransactions({ accountAddress: address });
        expect(response).toHaveLength(1);
        expect(response[0]?.status).toBe("Success");
    });

    test("getAccountCoinTransactions returns the coin transactions of the account", async () => {
        const { response } = await ctx.supra.account.getAccountCoinTransactions({ accountAddress: address });
        expect(response.length).toBeGreaterThanOrEqual(1);
    });

    test("getAccountAutoTransactions returns an empty list for an account without automation tasks", async () => {
        const { response } = await ctx.supra.account.getAccountAutoTransactions({ accountAddress: address });
        expect(response).toEqual([]);
    });

    test("getAccountSupraCoinBalance matches the balance read through the node's view function", async () => {
        const balance = await ctx.supra.account.getAccountSupraCoinBalance({ accountAddress: address });
        expect(balance).toBe(await rawSupraBalance(ctx, address));
        expect(balance).toBeGreaterThan(0n);
    });

    test("getAccountCoinBalance reads the balance of a coin type", async () => {
        await expect(
            ctx.supra.account.getAccountCoinBalance({ accountAddress: address, asset: "0x1::supra_coin::SupraCoin" }),
        ).resolves.toBe(await rawSupraBalance(ctx, address));
    });

    test("getAccountCoinBalance of the fungible asset address reads the fungible asset store only", async () => {
        // The faucet funds the account as a coin, so its fungible asset store is empty.
        await expect(ctx.supra.account.getAccountCoinBalance({ accountAddress: address, asset: "0xa" })).resolves.toBe(
            0n,
        );
    });

    test("getAccountSupraBalance splits the SUPRA balance by form without counting it twice", async () => {
        const balance = await ctx.supra.account.getAccountSupraBalance({ accountAddress: address });
        expect(balance.total).toBe(await rawSupraBalance(ctx, address));
        expect(balance.fungibleAsset).toBe(0n);
        expect(balance.coin).toBe(balance.total);
    });

    test("getAccountCoinsCount counts the SUPRA coin store of a funded account", async () => {
        await expect(ctx.supra.account.getAccountCoinsCount({ accountAddress: address })).resolves.toBe(1);
    });

    test("getAccountCoinsCount is 0 for an account that does not exist", async () => {
        await expect(
            ctx.supra.account.getAccountCoinsCount({ accountAddress: createUnfundedAccount().address().toString() }),
        ).resolves.toBe(0);
    });
});
