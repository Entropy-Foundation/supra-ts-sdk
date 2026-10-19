import { TypeTagParser } from "supra-ts-sdk";
import { COIN_ABI } from "./abi";
import { assertSuccess, createClient, getFundedAccounts, runExample } from "./setup";

runExample(async () => {
    const supra = createClient();
    // `0x1::coin::transfer` needs a receiver that has a coin store, which an account that was funded has.
    const [account, receiver] = await getFundedAccounts(supra, 2);
    if (account === undefined || receiver === undefined) {
        throw new Error("Missing accounts");
    }

    const contractAbis = [COIN_ABI] as const;
    const instance = supra.contract.fromABI(contractAbis);

    // ---------------------------------------------------------------------------
    // Call a view function: the SUPRA balance of the account
    // ---------------------------------------------------------------------------
    const balance = await instance.contracts.coin.view.balance({
        functionArguments: [account.address().toString()],
        typeArguments: ["0x1::supra_coin::SupraCoin"],
    });
    console.log("Balance:", balance[0]);

    // ---------------------------------------------------------------------------
    // Call an entry function: transfer SUPRA
    // ---------------------------------------------------------------------------
    const txn = await instance.contracts.coin.entry.transfer({
        functionArguments: [account, receiver.address().toString(), 1000n],
        typeArguments: [new TypeTagParser("0x1::supra_coin::SupraCoin").parseTypeTag()],
        enableTransactionWaitAndSimulationArgs: {
            enableTransactionSimulation: true,
            enableWaitForTransaction: true,
        },
    });
    assertSuccess("coin::transfer", txn);
    console.log("Transaction committed:", txn.hash);
});
