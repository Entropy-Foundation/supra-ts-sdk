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

    // Expected: the faucet method works against any node that serves a faucet, not only on Testnet.
    test.failing("fundAccountWithFaucet funds an account and returns the hash of the funding transaction", async () => {
        const address = new SupraAccount().address().toString();

        const { hash } = await ctx.supra.faucet.fundAccountWithFaucet({ accountAddress: address });

        expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
        await rawWaitForCommit(ctx, hash);
        expect(await waitForBalance(ctx, address, (balance) => balance > 0n)).toBeGreaterThan(0n);
    });
});
