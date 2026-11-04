import { SupraAccount } from "supra-ts-sdk";
import { createClient, fundFromFaucet, MAINNET_CHAIN_ID, runExample } from "./setup";

/**
 * Creates an account funded by one faucet grant, for running all the examples. This is not an example.
 *
 * It generates a fresh account, requests SUPRA for it from the faucet once (with the retry of the examples while the
 * faucet has no free account), waits until the balance shows the funds, and prints the account's private key as hex on
 * stdout, on one line and nothing else. The address and the progress go to stderr. The output is meant to be assigned
 * to `SUPRA_PRIVATE_KEY`, so that the examples fund their accounts by transfers from this account instead of each
 * requesting funds from the faucet:
 *
 *     SUPRA_PRIVATE_KEY="$(pnpm exec tsx examples/faucetFunder.ts)" pnpm examples
 *
 * The network comes from the same environment as the examples (see `setup.ts`). It refuses Mainnet.
 */
runExample(async () => {
    const supra = createClient();
    if (supra.networkInformation.chainId === MAINNET_CHAIN_ID) {
        throw new Error("The examples do not send transactions to Mainnet");
    }

    const funder = new SupraAccount();
    console.error(`Funding account: ${funder.address().toString()}`);
    await fundFromFaucet(supra, funder);
    console.error(`Funded ${funder.address().toString()}`);

    process.stdout.write(`${funder.toPrivateKeyObject().privateKeyHex}\n`);
});
