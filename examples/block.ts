import { SupraClient, Network } from "supra-ts-sdk";


(async () => {

    const supra = new SupraClient({ network: Network.TESTNET });

    // ---------------------------------------------------------------------------
    // Get Latest Block
    // ---------------------------------------------------------------------------
    const latestBlock = await supra.block.getLatestBlock();

    console.log("Latest block:", latestBlock);

    // ---------------------------------------------------------------------------
    // Get Block by Height
    // ---------------------------------------------------------------------------

    const height = 75240367;
    const block = await supra.block.getBlockByHeight({ height: height, options: { withFinalizedTransactions: true } });

    console.log("Block by Height:", block);


    // ---------------------------------------------------------------------------
    // Get Block by Hash
    // ---------------------------------------------------------------------------

    const blockHash = "0xd5ff53b7278c4957871c654de26e09194a154cf8c5287d81b693dc95fedd7972";

    const blockByHash = await supra.block.getBlockByHash({ blockHash: blockHash });

    console.log("Block by Hash:", blockByHash);


    // ---------------------------------------------------------------------------
    // Get Transactions by Block Hash
    // ---------------------------------------------------------------------------

    const transactions = await supra.block.getTransactionsByBlockHash({ blockHash: blockHash });

    console.log("Transactions by Block Hash:", transactions);

})();