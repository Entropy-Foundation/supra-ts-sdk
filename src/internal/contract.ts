import { BCS, SupraAccount } from "supra-l1-sdk-core";
import type { NetworkConfig } from "../utils/apiEndpoints";
import { simpleInternal } from "./transactionManager/txnBuild";
import { getAccountInfoInternal } from "./account";
import type { MoveModule, SimpleEntryFunctionArgumentTypes } from "../types/move";
import { submitSerializedRawTransactionInternal } from "./transactionManager/txnSubmit";
import type { TransactionResponse } from "../types/transaction";


export async function callContractInternal<T>(args: any, config: NetworkConfig): Promise<TransactionResponse> {

    let signers: SupraAccount[] = []
    let functionArguments: SimpleEntryFunctionArgumentTypes[] = [];

    args.functionArguments.map((f: any) => {
        if (f instanceof SupraAccount) {
            signers.push(f)
        } else {
            functionArguments.push(f)
        }
    });


    // Call multi agent 
    if (signers.length > 1) {
        throw new Error("Multi agent not supported");
    }


    let senderAccount = args.functionArguments[0];

    if (!(senderAccount instanceof SupraAccount)) {
        throw new Error("Sender account must be SupraAccount");
    }

    let simpleRawTxn = await simpleInternal({
        senderAddress: senderAccount.address(),
        senderSequenceNumber: (await getAccountInfoInternal({ accountAddress: senderAccount.address() }, config)).sequence_number,
        function: args.function,
        functionTypeArgs: args.typeArguments ?? [],
        functionArgs: args.functionArguments.slice(1) ?? [],
        optionalTransactionPayloadArgs: args.optionalTransactionPayloadArgs ?? {},
        abi: args.abi as MoveModule
    }, config);

    return await submitSerializedRawTransactionInternal({
        senderAccount: senderAccount,
        serializedRawTransaction: BCS.bcsToBytes(simpleRawTxn),
        enableTransactionWaitAndSimulationArgs: args.enableTransactionWaitAndSimulationArgs ?? {}

    }, config);
}

