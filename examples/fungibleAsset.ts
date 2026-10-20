import { SupraAccount } from "supra-ts-sdk";
import { assertSuccess, createClient, getFundedAccounts, runExample } from "./setup";

runExample(async () => {
    const supra = createClient();
    const [account] = await getFundedAccounts(supra, 1);
    if (account === undefined) {
        throw new Error("No account");
    }
    const receiver = new SupraAccount().address();
    const waitForCommit = {
        enableTransactionWaitAndSimulationArgs: { enableTransactionSimulation: true, enableWaitForTransaction: true },
    };

    // ---------------------------------------------------------------------------
    // Get fungible asset metadata: the SUPRA fungible asset is at 0xa
    // ---------------------------------------------------------------------------
    const fungibleAssetMetadata = await supra.fungibleAsset.getFungibleAssetMetadata({ assetAddress: "0xa" });
    console.log("Fungible asset metadata:", fungibleAssetMetadata);

    // ---------------------------------------------------------------------------
    // Migrate SUPRA from the coin store to the fungible asset store
    // ---------------------------------------------------------------------------

    // A fungible asset transfer moves only the balance of the fungible asset store. An account that received SUPRA
    // as a coin migrates it first; without the migration the transfer below throws
    // SupraInsufficientFungibleAssetBalanceError.
    const balances = await supra.account.getAccountSupraBalance({ accountAddress: account.address() });
    console.log("SUPRA balance:", balances);

    if (balances.coin > 0n) {
        const migration = await supra.fungibleAsset.migrateCoinToFungibleStore({
            senderAccount: account,
            optionalTransactionArgs: { enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true } },
        });
        assertSuccess("migrateCoinToFungibleStore", migration);
        console.log("Migration committed:", migration.hash);
    }

    // ---------------------------------------------------------------------------
    // Transfer SUPRA as a fungible asset
    // ---------------------------------------------------------------------------
    const txn = await supra.fungibleAsset.transferSupraFungibleAsset({
        senderAccount: account,
        receiverAccountAddress: receiver,
        amount: 10_000n,
        optionalTransactionArgs: waitForCommit,
    });
    assertSuccess("transferSupraFungibleAsset", txn);
    console.log("Transaction committed:", txn.hash);

    // ---------------------------------------------------------------------------
    // Transfer a fungible asset by address
    // ---------------------------------------------------------------------------
    const txn1 = await supra.fungibleAsset.transferFungibleAsset({
        senderAccount: account,
        receiverAccountAddress: receiver,
        amount: 10_000n,
        assetAddress: "0x000000000000000000000000000000000000000000000000000000000000000a",
        optionalTransactionArgs: waitForCommit,
    });
    assertSuccess("transferFungibleAsset", txn1);
    console.log("Transaction committed:", txn1.hash);
});
