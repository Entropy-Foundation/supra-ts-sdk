import { SupraAccount } from "supra-ts-sdk";
import { createClient, runExample } from "./setup";

runExample(async () => {
    const supra = createClient();

    // The faucet sends SUPRA to the test accounts of a network. It is called only when SUPRA_EXAMPLES_FUND=1 is set.
    if (process.env["SUPRA_EXAMPLES_FUND"] !== "1") {
        console.log("Skipping the faucet request: set SUPRA_EXAMPLES_FUND=1 to request funds for a new account.");
        return;
    }

    // ---------------------------------------------------------------------------
    // Fund an account with the faucet
    // ---------------------------------------------------------------------------
    const account = new SupraAccount();
    const faucetResponse = await supra.faucet.fundAccountWithFaucet({ accountAddress: account.address() });
    console.log("Faucet response:", faucetResponse);

    // ---------------------------------------------------------------------------
    // Read the faucet transaction. The faucet answers before the transaction executes, so the read is repeated until
    // the node reports a final status.
    // ---------------------------------------------------------------------------
    const deadline = Date.now() + 120_000;
    let status = "Pending";
    for (;;) {
        try {
            const faucetTransaction = await supra.faucet.getFaucetTransaction({ transactionHash: faucetResponse.hash });
            status = faucetTransaction.status;
        } catch (error) {
            if (Date.now() > deadline) {
                throw error;
            }
        }
        if (status !== "Pending") {
            break;
        }
        if (Date.now() > deadline) {
            throw new Error("The faucet transaction has no final status after 120 s");
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    if (status !== "Success") {
        throw new Error(`The faucet transaction ended with status ${status}`);
    }
    console.log("Faucet transaction:", faucetResponse.hash, status);

    console.log("Balance:", await supra.account.getAccountSupraCoinBalance({ accountAddress: account.address() }));
});
