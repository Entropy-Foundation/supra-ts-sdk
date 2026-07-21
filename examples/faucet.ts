import { SupraClient, Network } from "supra-ts-sdk";


(async () => {
    const supra = new SupraClient({ network: Network.TESTNET });

    // ---------------------------------------------------------------------------
    // Fund an account with the faucet
    // ---------------------------------------------------------------------------

    let faucetResponse = await supra.faucet.fundAccountWithFaucet({ accountAddress: "0x10cdf6e0c4c5c762bb23be3eac5c7eaa272c1b4abe0573cd1386c5632b7992ca" });

    console.log(faucetResponse);




})();