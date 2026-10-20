import { SupraAccount } from "supra-ts-sdk";
import { assertSuccess, createClient, getFundedAccounts, runExample } from "./setup";

runExample(async () => {
    const supra = createClient();
    const [account] = await getFundedAccounts(supra, 1);
    if (account === undefined) {
        throw new Error("No account");
    }

    // The transfer is submitted without waiting, so the transaction can be inspected before it commits.
    const submitted = await supra.coin.transferSupraCoin({
        senderAccount: account,
        receiverAccountAddress: new SupraAccount().address(),
        amount: 10_000n,
    });
    console.log("Transaction submitted:", submitted.hash);

    // ---------------------------------------------------------------------------
    // Check transaction status
    // ---------------------------------------------------------------------------
    const isPendingTransaction = await supra.transaction.isPendingTransaction({ transactionHash: submitted.hash });
    console.log("Transaction is pending:", isPendingTransaction);

    // ---------------------------------------------------------------------------
    // Wait for the transaction to commit
    // ---------------------------------------------------------------------------
    const transaction = await supra.transaction.waitForTransaction({ transactionHash: submitted.hash });
    assertSuccess("waitForTransaction", transaction);
    console.log("Transaction committed:", transaction.hash);

    // ---------------------------------------------------------------------------
    // Get a transaction by hash
    // ---------------------------------------------------------------------------
    const transactionResponse = await supra.transaction.getTransactionByHash({ transactionHash: submitted.hash });
    console.log("Transaction:", transactionResponse.hash, transactionResponse.status);
});
