import { createFundedAccount, createUnfundedAccount } from "./helpers/accounts";
import { describeE2E, nodeGeneration } from "./helpers/describe";
import { getE2EContext, type E2EContext } from "./helpers/env";
import type { RawTransaction } from "./helpers/raw";
import { sendSupra } from "./helpers/transfers";

describeE2E("blocks", () => {
    let ctx: E2EContext;
    let transfer: RawTransaction;

    beforeAll(async () => {
        ctx = await getE2EContext();
        const sender = await createFundedAccount(ctx);
        transfer = await sendSupra(ctx, sender, createUnfundedAccount().address().toString(), 1_500n);
    });

    test("getLatestBlock returns a block whose height is at least that of a committed transfer", async () => {
        const latest = await ctx.supra.block.getLatestBlock();
        expect(latest.header.height).toBeGreaterThanOrEqual(transfer.block_header?.height ?? Number.MAX_SAFE_INTEGER);
        expect(latest.header.hash).toMatch(/^0x[0-9a-f]{64}$/);
    });

    test("getBlockByHeight returns the block that committed a transfer", async () => {
        const height = transfer.block_header?.height as number;
        const block = await ctx.supra.block.getBlockByHeight({ height });
        expect(block.header.height).toBe(height);
        expect(block.header.hash).toBe(transfer.block_header?.hash);
    });

    test("getBlockByHeight with finalized transactions lists the transfer", async () => {
        const height = transfer.block_header?.height as number;
        const block = await ctx.supra.block.getBlockByHeight({ height, options: { withFinalizedTransactions: true } });
        expect(block.transactions?.map((txn) => txn.hash)).toContain(transfer.hash);
    });

    test("getBlockByHash returns the same block as getBlockByHeight", async () => {
        const height = transfer.block_header?.height as number;
        const byHeight = await ctx.supra.block.getBlockByHeight({ height });
        const byHash = await ctx.supra.block.getBlockByHash({ blockHash: byHeight.header.hash });
        expect(byHash.header).toEqual(byHeight.header);
    });

    test("the settlement type filter is accepted from v12 and refused with HTTP 400 before it", async () => {
        const hash = transfer.block_header?.hash as string;
        const request = ctx.supra.block.getTransactionsByBlockHash({
            blockHash: hash,
            options: { type: "settlement" },
        });
        if (nodeGeneration() === "v11") {
            await expect(request).rejects.toMatchObject({ status: 400 });
        } else {
            await expect(request).resolves.not.toContain(transfer.hash);
        }
    });

    test("getTransactionsByBlockHash lists the hash of the transfer", async () => {
        const hash = transfer.block_header?.hash as string;
        await expect(ctx.supra.block.getTransactionsByBlockHash({ blockHash: hash })).resolves.toContain(transfer.hash);
    });
});
