import { SupraClient, TransactionStatus } from "../src/index";
import { createFundedAccount, createUnfundedAccount } from "./helpers/accounts";
import { describeE2E } from "./helpers/describe";
import { getE2EContext, type E2EContext } from "./helpers/env";
import { rawGet, rawSupraBalance } from "./helpers/raw";
import { explicitGas } from "./helpers/transfers";

describeE2E("client", () => {
    let ctx: E2EContext;

    beforeAll(async () => {
        ctx = await getE2EContext();
    });

    test("getChainId returns the node's chain ID", async () => {
        expect((await ctx.supra.getChainId()).value).toBe(ctx.chainId);
    });

    test("validateChainId resolves when the configured chain ID is the node's", async () => {
        await expect(ctx.supra.validateChainId()).resolves.toBeUndefined();
    });

    test("validateChainId rejects when the configured chain ID differs from the node's", async () => {
        const wrong = new SupraClient({ rpcUrl: ctx.rpcUrl, chainId: ctx.chainId === 1 ? 2 : 1 });
        await expect(wrong.validateChainId()).rejects.toThrow(/does not match/);
    });

    test("getGasPrice and getMinGasUnitPrice return positive amounts with min <= median", async () => {
        const median = await ctx.supra.getGasPrice();
        const min = await ctx.supra.getMinGasUnitPrice();
        expect(typeof median).toBe("bigint");
        expect(typeof min).toBe("bigint");
        expect(min).toBeGreaterThan(0n);
        expect(median).toBeGreaterThanOrEqual(min);
    });

    test("the node serves its version", async () => {
        const response = await rawGet<unknown>(ctx, "/rpc/v3/version");
        expect(response.status).toBe(200);
        expect(JSON.stringify(response.body)).toMatch(/\d+\.\d+/);
    });

    test.each(["/", "//"])("a client whose rpcUrl ends in %j reads the chain and sends a transfer", async (suffix) => {
        const supra = new SupraClient({ rpcUrl: `${ctx.rpcUrl}${suffix}`, chainId: ctx.chainId });
        await expect(supra.validateChainId()).resolves.toBeUndefined();

        const sender = await createFundedAccount(ctx);
        const receiver = createUnfundedAccount().address().toString();
        const txn = await supra.coin.transferSupraCoin({
            senderAccount: sender,
            receiverAccountAddress: receiver,
            amount: 1_000n,
            optionalTransactionArgs: {
                optionalTransactionPayloadArgs: await explicitGas(ctx),
                enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true },
            },
        });

        expect(txn.status).toBe(TransactionStatus.Success);
        expect(await rawSupraBalance(ctx, receiver)).toBe(1_000n);
    });
});
