import { SupraAccount } from "supra-ts-sdk";
import { assertSuccess, createClient, getFundedAccounts, runExample } from "./setup";

runExample(async () => {
    const supra = createClient();
    const [account] = await getFundedAccounts(supra, 1);
    if (account === undefined) {
        throw new Error("No account");
    }
    const receiver = new SupraAccount().address();

    // ---------------------------------------------------------------------------
    // Get coin info
    // ---------------------------------------------------------------------------
    const coinInfo = await supra.coin.getCoinInfo({ coinType: "0x1::supra_coin::SupraCoin" });
    console.log("Coin info:", coinInfo);

    // ---------------------------------------------------------------------------
    // Transfer SUPRA
    // ---------------------------------------------------------------------------
    const txn = await supra.coin.transferSupraCoin({
        senderAccount: account,
        receiverAccountAddress: receiver,
        amount: 10_000n,
        optionalTransactionArgs: {
            enableTransactionWaitAndSimulationArgs: {
                enableTransactionSimulation: true,
                enableWaitForTransaction: true,
            },
        },
    });
    assertSuccess("transferSupraCoin", txn);
    console.log("Transaction committed:", txn.hash);

    // ---------------------------------------------------------------------------
    // Transfer a coin by type
    // ---------------------------------------------------------------------------
    const txn1 = await supra.coin.transferCoin({
        senderAccount: account,
        receiverAccountAddress: receiver,
        amount: 10_000n,
        coinType: "0x1::supra_coin::SupraCoin",
        optionalTransactionArgs: {
            enableTransactionWaitAndSimulationArgs: {
                enableTransactionSimulation: true,
                enableWaitForTransaction: true,
            },
        },
    });
    assertSuccess("transferCoin", txn1);
    console.log("Transaction committed:", txn1.hash);
});
