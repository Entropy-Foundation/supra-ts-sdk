import type { SupraAccount } from "../src/index";
import { SupraInsufficientFungibleAssetBalanceError, TransactionStatus } from "../src/index";
import { createFundedAccount, createMigratedAccount, createUnfundedAccount } from "./helpers/accounts";
import { describeE2E } from "./helpers/describe";
import { getE2EContext, type E2EContext } from "./helpers/env";
import { rawSupraBalance } from "./helpers/raw";
import { explicitGas } from "./helpers/transfers";

const SUPRA_FA = "0x000000000000000000000000000000000000000000000000000000000000000a";
const AMOUNT = 4_321n;

describeE2E("fungible asset", () => {
    let ctx: E2EContext;

    beforeAll(async () => {
        ctx = await getE2EContext();
    });

    async function transferArgs(sender: SupraAccount, receiver: string) {
        return {
            senderAccount: sender,
            receiverAccountAddress: receiver,
            amount: AMOUNT,
            optionalTransactionArgs: {
                optionalTransactionPayloadArgs: await explicitGas(ctx),
                enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true },
            },
        };
    }

    test("getFungibleAssetMetadata describes the SUPRA fungible asset", async () => {
        const metadata = await ctx.supra.fungibleAsset.getFungibleAssetMetadata({ assetAddress: SUPRA_FA });
        expect(metadata.symbol).toBe("SUPRA");
        expect(metadata.decimals).toBe(8);
    });

    test("a faucet-funded account holds SUPRA as a coin and its fungible asset balance is 0", async () => {
        const sender = await createFundedAccount(ctx);
        const address = sender.address().toString();

        const balance = await ctx.supra.account.getAccountSupraBalance({ accountAddress: address });
        expect(balance.total).toBe(await rawSupraBalance(ctx, address));
        expect(balance.coin).toBe(balance.total);
        expect(balance.fungibleAsset).toBe(0n);
        await expect(ctx.supra.account.getAccountCoinBalance({ accountAddress: address, asset: SUPRA_FA })).resolves.toBe(
            0n,
        );
    });

    test("transferSupraFungibleAsset is refused before submission when the SUPRA is held as a coin", async () => {
        const sender = await createFundedAccount(ctx);
        const address = sender.address().toString();
        const receiver = createUnfundedAccount().address().toString();
        const total = await rawSupraBalance(ctx, address);
        const sequenceBefore = BigInt((await ctx.supra.account.getAccountInfo({ accountAddress: address })).sequence_number);

        const failure = await ctx.supra.fungibleAsset
            .transferSupraFungibleAsset(await transferArgs(sender, receiver))
            .catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(SupraInsufficientFungibleAssetBalanceError);
        const error = failure as SupraInsufficientFungibleAssetBalanceError;
        expect(error.fungibleAssetBalance).toBe(0n);
        expect(error.coinBalance).toBe(total);
        expect(error.amount).toBe(AMOUNT);
        expect(error.message).toContain("migrateCoinToFungibleStore");
        // Nothing was submitted: the sequence number is unchanged and the balance is not charged for gas.
        const info = await ctx.supra.account.getAccountInfo({ accountAddress: address });
        expect(BigInt(info.sequence_number)).toBe(sequenceBefore);
        expect(await rawSupraBalance(ctx, address)).toBe(total);
    });

    test("transferFungibleAsset of the SUPRA fungible asset is refused the same way", async () => {
        const sender = await createFundedAccount(ctx);
        const receiver = createUnfundedAccount().address().toString();

        await expect(
            ctx.supra.fungibleAsset.transferFungibleAsset({
                ...(await transferArgs(sender, receiver)),
                assetAddress: SUPRA_FA,
            }),
        ).rejects.toBeInstanceOf(SupraInsufficientFungibleAssetBalanceError);
    });

    test("migrateCoinToFungibleStore moves the coin balance to the fungible asset store", async () => {
        const sender = await createFundedAccount(ctx);
        const address = sender.address().toString();

        await ctx.supra.fungibleAsset.migrateCoinToFungibleStore({
            senderAccount: sender,
            optionalTransactionArgs: {
                optionalTransactionPayloadArgs: await explicitGas(ctx),
                enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true },
            },
        });

        const balance = await ctx.supra.account.getAccountSupraBalance({ accountAddress: address });
        expect(balance.coin).toBe(0n);
        expect(balance.fungibleAsset).toBeGreaterThan(0n);
        expect(balance.total).toBe(balance.fungibleAsset);
        expect(balance.total).toBe(await rawSupraBalance(ctx, address));
        // The fungible asset balance read through 0xa and the coin balance read through the type agree.
        await expect(ctx.supra.account.getAccountCoinBalance({ accountAddress: address, asset: SUPRA_FA })).resolves.toBe(
            balance.total,
        );
        await expect(ctx.supra.account.getAccountSupraCoinBalance({ accountAddress: address })).resolves.toBe(
            balance.total,
        );
    });

    test("getAccountCoinsCount counts the SUPRA of a migrated account", async () => {
        const sender = await createMigratedAccount(ctx);

        await expect(
            ctx.supra.account.getAccountCoinsCount({ accountAddress: sender.address().toString() }),
        ).resolves.toBe(1);
    });

    test("transferFungibleAsset moves the amount of the SUPRA fungible asset to an existing account", async () => {
        const sender = await createMigratedAccount(ctx);
        const receiver = (await createFundedAccount(ctx)).address().toString();
        const receiverBefore = await rawSupraBalance(ctx, receiver);

        const txn = await ctx.supra.fungibleAsset.transferFungibleAsset({
            ...(await transferArgs(sender, receiver)),
            assetAddress: SUPRA_FA,
        });

        expect(txn.status).toBe(TransactionStatus.Success);
        expect(await rawSupraBalance(ctx, receiver)).toBe(receiverBefore + AMOUNT);
    });

    test("transferSupraFungibleAsset moves SUPRA to a new account", async () => {
        const sender = await createMigratedAccount(ctx);
        const receiver = createUnfundedAccount().address().toString();

        const txn = await ctx.supra.fungibleAsset.transferSupraFungibleAsset(await transferArgs(sender, receiver));

        expect(txn.status).toBe(TransactionStatus.Success);
        expect(await rawSupraBalance(ctx, receiver)).toBe(AMOUNT);
    });

    test("transferSupraCoin moves SUPRA held as a fungible asset", async () => {
        const sender = await createMigratedAccount(ctx);
        const receiver = createUnfundedAccount().address().toString();

        const txn = await ctx.supra.coin.transferSupraCoin(await transferArgs(sender, receiver));

        expect(txn.status).toBe(TransactionStatus.Success);
        expect(await rawSupraBalance(ctx, receiver)).toBe(AMOUNT);
    });
});
