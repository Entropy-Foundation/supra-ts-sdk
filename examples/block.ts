import { createClient, runExample } from "./setup";

runExample(async () => {
    const supra = createClient();

    // ---------------------------------------------------------------------------
    // Get the latest block
    // ---------------------------------------------------------------------------
    const latestBlock = await supra.block.getLatestBlock();
    console.log("Latest block:", latestBlock.header);

    // ---------------------------------------------------------------------------
    // Get a block by height
    // ---------------------------------------------------------------------------
    const block = await supra.block.getBlockByHeight({
        height: latestBlock.header.height,
        options: { withFinalizedTransactions: true },
    });
    console.log("Block by height:", block.header, `${block.transactions?.length ?? 0} transactions`);

    // ---------------------------------------------------------------------------
    // Get a block by hash
    // ---------------------------------------------------------------------------
    const blockByHash = await supra.block.getBlockByHash({ blockHash: latestBlock.header.hash });
    console.log("Block by hash:", blockByHash.header);

    // ---------------------------------------------------------------------------
    // Get the transaction hashes of a block
    // ---------------------------------------------------------------------------
    const transactions = await supra.block.getTransactionsByBlockHash({ blockHash: latestBlock.header.hash });
    console.log("Transactions by block hash:", transactions);
});
