import { SupraAccount } from "../src/index";
import { describeE2E } from "./helpers/describe";
import { getE2EContext, type E2EContext } from "./helpers/env";
import { rawWaitForCommit } from "./helpers/raw";
import { waitForBalance } from "./helpers/accounts";

describeE2E("faucet", () => {
    let ctx: E2EContext;

    beforeAll(async () => {
        ctx = await getE2EContext();
    });

    test("fundAccountWithFaucet funds an account and returns the hash of the funding transaction", async () => {
        const address = new SupraAccount().address().toString();

        const { hash } = await ctx.supra.faucet.fundAccountWithFaucet({ accountAddress: address });

        expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
        await rawWaitForCommit(ctx, hash);
        expect(await waitForBalance(ctx, address, (balance) => balance > 0n)).toBeGreaterThan(0n);
    });

    test("getFaucetTransaction returns the funding transaction", async () => {
        const address = new SupraAccount().address().toString();
        const { hash } = await ctx.supra.faucet.fundAccountWithFaucet({ accountAddress: address });
        await rawWaitForCommit(ctx, hash);

        const transaction = await ctx.supra.faucet.getFaucetTransaction({ transactionHash: hash });

        expect(transaction.hash).toBe(hash);
        expect(transaction.status).toBe("Success");
    });
});
