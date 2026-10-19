import { HexString, SupraAccount, TransactionType } from "supra-ts-sdk";
import { canSendTransactions, createClient, getFundedAccounts, runExample } from "./setup";

runExample(async () => {
    const supra = createClient();
    const frameworkAddress = "0x0000000000000000000000000000000000000000000000000000000000000001";

    // -------------------------------------------------------------------------
    // Check whether accounts exist
    // -------------------------------------------------------------------------
    console.log("0x1 exists:", await supra.account.isAccountExists({ accountAddress: frameworkAddress }));
    console.log(
        "A new account exists:",
        await supra.account.isAccountExists({ accountAddress: new SupraAccount().address() }),
    );

    // -------------------------------------------------------------------------
    // Query the current state of an account (the address as a string or a HexString)
    // -------------------------------------------------------------------------
    const accountData = await supra.account.getAccountInfo({ accountAddress: frameworkAddress });
    console.log("Account data:", accountData);

    const accountData2 = await supra.account.getAccountInfo({ accountAddress: new HexString(frameworkAddress) });
    console.log("Account data:", accountData2);

    // -------------------------------------------------------------------------
    // Query the modules of an account
    // -------------------------------------------------------------------------
    const { response: accountModules } = await supra.account.getAccountModules({
        accountAddress: frameworkAddress,
        options: { count: 5 },
    });
    console.log(
        "Account modules:",
        accountModules.map((module) => module.abi?.name),
    );

    // -------------------------------------------------------------------------
    // Query one module of an account
    // -------------------------------------------------------------------------
    const accountModule = await supra.account.getAccountModule({
        accountAddress: new HexString(frameworkAddress),
        moduleName: "supra_account",
    });
    console.log("Account module:", accountModule.abi?.name, accountModule.abi?.exposed_functions.length, "functions");

    // -------------------------------------------------------------------------
    // Query the resources of an account, and one resource
    // -------------------------------------------------------------------------
    const { response: accountResources } = await supra.account.getAccountResources({
        accountAddress: frameworkAddress,
    });
    console.log("Account resources:", accountResources.length);

    const accountResource = await supra.account.getAccountResource({
        accountAddress: frameworkAddress,
        resourceType: "0x1::timestamp::CurrentTimeMicroseconds",
    });
    console.log("Account resource:", accountResource);

    // -------------------------------------------------------------------------
    // Queries about an account that has sent transactions
    // -------------------------------------------------------------------------
    if (!canSendTransactions()) {
        console.log("Skipping the queries about an account's history: set SUPRA_PRIVATE_KEY or SUPRA_EXAMPLES_FUND=1.");
        return;
    }

    const [account] = await getFundedAccounts(supra, 1);
    if (account === undefined) {
        throw new Error("No account");
    }
    const address = account.address();

    // The account sends one transfer so that it has a history to read.
    const transfer = await supra.coin.transferSupraCoin({
        senderAccount: account,
        receiverAccountAddress: new SupraAccount().address(),
        amount: 1_000n,
        optionalTransactionArgs: { enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true } },
    });
    console.log("Transfer committed:", transfer.hash);

    const { response: accountTransactions } = await supra.account.getAccountTransactions({
        accountAddress: address,
        options: { count: 1 },
    });
    console.log("Account transaction:", accountTransactions[0]?.hash);

    console.log("Account coins count:", await supra.account.getAccountCoinsCount({ accountAddress: address }));

    const { response: accountCoinTransactions } = await supra.account.getAccountCoinTransactions({
        accountAddress: address,
    });
    console.log("Account coin transactions:", accountCoinTransactions.length);

    const { response: accountAutoTransactions } = await supra.account.getAccountAutoTransactions({
        accountAddress: address,
        options: { count: 10 },
    });
    console.log("Account auto transactions:", accountAutoTransactions.length);

    // -------------------------------------------------------------------------
    // Read a feed page by page: pass the cursor back until it is undefined
    // -------------------------------------------------------------------------
    let cursor: string | undefined;
    do {
        const page = await supra.account.getAccountCoinTransactions({
            accountAddress: address,
            options: { count: 50, start: cursor },
        });
        for (const txn of page.response) {
            // Only user and automated transactions have a header, payload and authenticator.
            if (txn.txn_type === TransactionType.User || txn.txn_type === TransactionType.Auto) {
                console.log(txn.hash, txn.header.sender.Move);
            } else {
                console.log(txn.hash, txn.txn_type);
            }
        }
        cursor = page.cursor;
    } while (cursor !== undefined);

    // -------------------------------------------------------------------------
    // Query the SUPRA balance of an account
    // -------------------------------------------------------------------------
    console.log("SUPRA balance:", await supra.account.getAccountSupraCoinBalance({ accountAddress: address }));
    console.log("SUPRA balance by form:", await supra.account.getAccountSupraBalance({ accountAddress: address }));

    // -------------------------------------------------------------------------
    // Query the balance of a coin type, and of a fungible asset
    // -------------------------------------------------------------------------
    console.log(
        "SUPRA coin balance:",
        await supra.account.getAccountCoinBalance({ accountAddress: address, asset: "0x1::supra_coin::SupraCoin" }),
    );
    console.log(
        "SUPRA fungible asset balance:",
        await supra.account.getAccountCoinBalance({ accountAddress: address, asset: "0xa" }),
    );
});
