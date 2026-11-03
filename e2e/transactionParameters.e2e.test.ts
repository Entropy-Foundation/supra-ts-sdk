import type { SupraAccount } from "../src/index";
import { SupraClient, TransactionStatus } from "../src/index";
import { createFundedAccount, createUnfundedAccount } from "./helpers/accounts";
import { describeE2E } from "./helpers/describe";
import { getE2EContext, type E2EContext } from "./helpers/env";
import { rawGet, rawSupraBalance } from "./helpers/raw";

/**
 * The node's maximum time to live (`GET /rpc/v3/transactions/parameters`) as the bound of a transaction's expiration
 * time: the client reads it, derives the default expiration time from it and refuses a larger one before signing.
 */

const WAIT = { enableWaitForTransaction: true } as const;

describeE2E("transaction parameters", () => {
    let ctx: E2EContext;
    let sender: SupraAccount;
    let maximum: number;

    beforeAll(async () => {
        ctx = await getE2EContext();
        sender = await createFundedAccount(ctx);
        const raw = await rawGet<{ max_transaction_time_to_live_seconds: number }>(
            ctx,
            "/rpc/v3/transactions/parameters",
        );
        expect(raw.status).toBe(200);
        maximum = raw.body.max_transaction_time_to_live_seconds;
    });

    function transfer(supra: SupraClient, receiver: string, optionalTransactionPayloadArgs = {}) {
        return supra.coin.transferSupraCoin({
            senderAccount: sender,
            receiverAccountAddress: receiver,
            amount: 1_000n,
            optionalTransactionArgs: {
                enableTransactionWaitAndSimulationArgs: WAIT,
                optionalTransactionPayloadArgs,
            },
        });
    }

    test("getTransactionParameters returns what the node serves", async () => {
        await expect(ctx.supra.getTransactionParameters()).resolves.toEqual({
            max_transaction_time_to_live_seconds: maximum,
        });
    });

    test("a transfer with the default expiration time commits", async () => {
        const receiver = createUnfundedAccount().address().toString();

        const txn = await transfer(ctx.supra, receiver);

        expect(txn.status).toBe(TransactionStatus.Success);
        expect(await rawSupraBalance(ctx, receiver)).toBe(1_000n);
    });

    test("a transfer whose txExpirySecs equals the node's maximum commits", async () => {
        const supra = new SupraClient({ rpcUrl: ctx.rpcUrl, chainId: ctx.chainId, txExpirySecs: maximum });
        const receiver = createUnfundedAccount().address().toString();

        const txn = await transfer(supra, receiver);

        expect(txn.status).toBe(TransactionStatus.Success);
    });

    test("a txExpirySecs above the node's maximum is refused before signing", async () => {
        const supra = new SupraClient({ rpcUrl: ctx.rpcUrl, chainId: ctx.chainId, txExpirySecs: maximum + 1 });
        const receiver = createUnfundedAccount().address().toString();

        await expect(transfer(supra, receiver)).rejects.toThrow(RangeError);
        expect(await rawSupraBalance(ctx, receiver)).toBe(0n);
    });

    test("a txExpiryTime above the node's maximum is refused before signing", async () => {
        const receiver = createUnfundedAccount().address().toString();
        const txExpiryTime = BigInt(Math.floor(Date.now() / 1_000) + maximum + 60);

        await expect(transfer(ctx.supra, receiver, { txExpiryTime })).rejects.toThrow(RangeError);
        expect(await rawSupraBalance(ctx, receiver)).toBe(0n);
    });
});
