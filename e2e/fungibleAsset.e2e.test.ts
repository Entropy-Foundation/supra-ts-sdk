import type { SupraAccount } from "../src/index";
import { TransactionStatus } from "../src/index";
import { createFundedAccount, createUnfundedAccount } from "./helpers/accounts";
import { describeE2E } from "./helpers/describe";
import { getE2EContext, type E2EContext } from "./helpers/env";
import { rawSupraBalance } from "./helpers/raw";
import { explicitGas } from "./helpers/transfers";

const SUPRA_FA = "0x000000000000000000000000000000000000000000000000000000000000000a";
const AMOUNT = 4_321n;

describeE2E("fungible asset", () => {
    let ctx: E2EContext;
    let sender: SupraAccount;

    beforeAll(async () => {
        ctx = await getE2EContext();
        sender = await createFundedAccount(ctx);
    });

    test("getFungibleAssetMetadata describes the SUPRA fungible asset", async () => {
        const metadata = await ctx.supra.fungibleAsset.getFungibleAssetMetadata({ assetAddress: SUPRA_FA });
        expect(metadata.symbol).toBe("SUPRA");
        expect(metadata.decimals).toBe(8);
    });

    // Expected: the SUPRA held by an account is reported by the fungible asset balance read.
    test.failing("the balance of the SUPRA fungible asset equals the balance read by the node", async () => {
        const balance = await ctx.supra.account.getAccountCoinBalance({
            accountAddress: sender.address().toString(),
            asset: SUPRA_FA,
        });
        expect(balance).toBe(await rawSupraBalance(ctx, sender.address().toString()));
    });

    // Expected: SUPRA held by the sender as a coin is transferred through the fungible asset interface.
    test.failing(
        "transferFungibleAsset moves the amount of the SUPRA fungible asset to an existing account",
        async () => {
            const receiver = (await createFundedAccount(ctx)).address().toString();
            const receiverBefore = await rawSupraBalance(ctx, receiver);

            const txn = await ctx.supra.fungibleAsset.transferFungibleAsset({
                senderAccount: sender,
                receiverAccountAddress: receiver,
                amount: AMOUNT,
                assetAddress: SUPRA_FA,
                optionalTransactionArgs: {
                    optionalTransactionPayloadArgs: await explicitGas(ctx),
                    enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true },
                },
            });

            expect(txn.status).toBe(TransactionStatus.Success);
            expect(await rawSupraBalance(ctx, receiver)).toBe(receiverBefore + AMOUNT);
        },
    );

    // Expected: SUPRA held by the sender as a coin is transferred through the fungible asset interface.
    test.failing("transferSupraFungibleAsset moves SUPRA to a new account", async () => {
        const receiver = createUnfundedAccount().address().toString();

        const txn = await ctx.supra.fungibleAsset.transferSupraFungibleAsset({
            senderAccount: sender,
            receiverAccountAddress: receiver,
            amount: AMOUNT,
            optionalTransactionArgs: {
                optionalTransactionPayloadArgs: await explicitGas(ctx),
                enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true },
            },
        });

        expect(txn.status).toBe(TransactionStatus.Success);
        expect(await rawSupraBalance(ctx, receiver)).toBe(AMOUNT);
    });
});
