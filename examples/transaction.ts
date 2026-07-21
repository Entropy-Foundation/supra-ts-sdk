import { SupraClient, Network } from "supra-ts-sdk";

(async () => {
    const supra = new SupraClient({ network: Network.TESTNET });


    // ---------------------------------------------------------------------------
    // Check transaction status
    // ---------------------------------------------------------------------------

    let isPendingTransaction = await supra.transaction.isPendingTransaction({
        transactionHash: "0x83ef4c457912d24b0a81eed9f2c40a648f19b2235745d80b25a68e2d62750519"
    });

    console.log("Transaction status:", isPendingTransaction);


    // ---------------------------------------------------------------------------
    // Get transaction by hash
    // ---------------------------------------------------------------------------

    let transaction = await supra.transaction.waitForTransaction({
        transactionHash: "0x83ef4c457912d24b0a81eed9f2c40a648f19b2235745d80b25a68e2d62750519"
    });

    console.log("Transaction:", transaction);


    // ---------------------------------------------------------------------------
    // Get transaction by hash
    // ---------------------------------------------------------------------------

    let transactionResponse = await supra.transaction.getTransactionByHash({
        transactionHash: "0x3c77491f046d618b629b5cf9b600549b745134f7a0f64cd2a355fd44a9d0df4c"
    });

    console.log("Transaction:", transactionResponse);


})();