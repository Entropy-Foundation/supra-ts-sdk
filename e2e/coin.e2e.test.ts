import type { SupraAccount, TransactionResponse } from "../src/index";
import { TransactionStatus } from "../src/index";
import { createFundedAccount, createUnfundedAccount } from "./helpers/accounts";
import { describeE2E } from "./helpers/describe";
import { getE2EContext, type E2EContext } from "./helpers/env";
import { SUPRA_COIN_TYPE, rawSupraBalance } from "./helpers/raw";
import { explicitGas } from "./helpers/transfers";

const AMOUNT = 12_345n;

/** The Quants the transaction cost its sender, from the node's report of it. */
function feeOf(txn: TransactionResponse): bigint {
    const output = txn.output;
    if (output === null || !("Move" in output)) {
        throw new Error("The transaction has no Move output");
    }
    if (!("header" in txn)) {
        throw new Error("The transaction has no header");
    }
    return BigInt(output.Move.gas_used) * BigInt(txn.header.gas_unit_price);
}

describeE2E("coin", () => {
    let ctx: E2EContext;
    let sender: SupraAccount;

    beforeAll(async () => {
        ctx = await getE2EContext();
        sender = await createFundedAccount(ctx);
    });

    test("getCoinInfo describes the SUPRA coin", async () => {
        const info = await ctx.supra.coin.getCoinInfo({ coinType: SUPRA_COIN_TYPE });
        expect(info.symbol).toBe("SUPRA");
        expect(info.decimals).toBe(8);
        expect(info.name.length).toBeGreaterThan(0);
    });

    test("transferSupraCoin delivers the amount to a new account and charges the sender amount plus gas", async () => {
        const receiver = createUnfundedAccount().address().toString();
        const before = await rawSupraBalance(ctx, sender.address().toString());

        const txn = await ctx.supra.coin.transferSupraCoin({
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
        expect(await rawSupraBalance(ctx, sender.address().toString())).toBe(before - AMOUNT - feeOf(txn));
    });

    test("transferCoin delivers the amount of a coin type to an existing account", async () => {
        const receiverAccount = await createFundedAccount(ctx);
        const receiver = receiverAccount.address().toString();
        const receiverBefore = await rawSupraBalance(ctx, receiver);
        const senderBefore = await rawSupraBalance(ctx, sender.address().toString());

        const txn = await ctx.supra.coin.transferCoin({
            senderAccount: sender,
            receiverAccountAddress: receiver,
            amount: AMOUNT,
            coinType: SUPRA_COIN_TYPE,
            optionalTransactionArgs: {
                optionalTransactionPayloadArgs: await explicitGas(ctx),
                enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true },
            },
        });

        expect(txn.status).toBe(TransactionStatus.Success);
        expect(await rawSupraBalance(ctx, receiver)).toBe(receiverBefore + AMOUNT);
        expect(await rawSupraBalance(ctx, sender.address().toString())).toBe(senderBefore - AMOUNT - feeOf(txn));
    });

    test("transferSupraCoin with the default gas settings delivers the amount to a new account", async () => {
        const receiver = createUnfundedAccount().address().toString();

        const txn = await ctx.supra.coin.transferSupraCoin({
            senderAccount: sender,
            receiverAccountAddress: receiver,
            amount: AMOUNT,
            optionalTransactionArgs: {
                enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true },
            },
        });

        expect(txn.status).toBe(TransactionStatus.Success);
        expect(await rawSupraBalance(ctx, receiver)).toBe(AMOUNT);
    });
});
