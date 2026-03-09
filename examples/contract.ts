import { TypeTagParser } from 'supra-l1-sdk-core';
import { SupraClient, Network } from '../src/index';
import { account } from '../testAccount';
import { COIN_ABI, VOTNIG_ABI as VOTING_ABI } from '../src/abi';


(async () => {

    // const account = SupraAccount.fromSupraAccountObject({
    //     address: "AccountAddress",
    //     privateKeyHex: `${"PrivateKey"}${"PublicKey (Without 0x)"}`,
    //     publicKeyHex: `0x${"PublicKey (Without 0x)"}`
    // });

    const supra = new SupraClient({ network: Network.TESTNET });


    const contract_abis = [
        COIN_ABI,
        VOTING_ABI
    ] as const;

    const instance = supra.contract.fromABI(contract_abis);

    // ---------------------------------------------------------------------------
    // Get supra coin balance
    // ---------------------------------------------------------------------------

    let balance = await instance.contracts.coin.view.balance({
        functionArguments: ["0x10cdf6e0c4c5c762bb23be3eac5c7eaa272c1b4abe0573cd1386c5632b7992ca"],
        typeArguments: ["0x1::supra_coin::SupraCoin"]
    })

    console.log("Balance:", balance[0]);


    // ---------------------------------------------------------------------------
    // Transfer supra coin
    // ---------------------------------------------------------------------------

    let txn = await instance.contracts.coin.entry.transfer({
        functionArguments: [account, "0x10cdf6e0c4c5c762bb23be3eac5c7eaa272c1b4abe0573cd1386c5632b7992ca", 1000n],
        typeArguments: [new TypeTagParser("0x1::supra_coin::SupraCoin").parseTypeTag()],
        enableTransactionWaitAndSimulationArgs: {
            enableTransactionSimulation: true,
            enableWaitForTransaction: true
        },
    })

    console.log("Transaction submitted:", txn);


})();
