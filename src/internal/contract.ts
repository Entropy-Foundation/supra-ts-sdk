import { BCS, SupraAccount } from "supra-l1-sdk-core";
import type { NetworkConfig } from "../utils/apiEndpoints";
import { simpleInternal } from "./transactionManager/txnBuild";
import { getAccountInfoInternal } from "./account";
import type { MoveFunctionId, MoveModule, SimpleEntryFunctionArgumentTypes, TypeArgument } from "../types/move";
import { submitSerializedRawTransactionInternal } from "./transactionManager/txnSubmit";
import type { TransactionResponse } from "../types/transaction";
import type { OptionalTransactionPayloadArgs } from "../types/transactionManager/transactionBuild";
import type { EnableTransactionWaitAndSimulationArgs } from "../types/transactionManager/transactionSubmit";

export interface CallContractArgs {
    function: MoveFunctionId;
    functionArguments: Array<SimpleEntryFunctionArgumentTypes | SupraAccount>;
    typeArguments?: Array<TypeArgument>;
    optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs;
    enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs;
    abi?: MoveModule;
}

export async function callContractInternal(args: CallContractArgs, config: NetworkConfig): Promise<TransactionResponse> {

    const signers: SupraAccount[] = [];
    const functionArguments: Array<Exclude<SimpleEntryFunctionArgumentTypes, Uint8Array>> = [];

    args.functionArguments.forEach((f) => {
        if (f instanceof SupraAccount) {
            signers.push(f);
        } else {
            functionArguments.push(f as Exclude<SimpleEntryFunctionArgumentTypes, Uint8Array>);
        }
    });


    // Call multi agent
    if (signers.length > 1) {
        throw new Error("Multi agent not supported");
    }


    const senderAccount = args.functionArguments[0];

    if (!(senderAccount instanceof SupraAccount)) {
        throw new Error("Sender account must be SupraAccount");
    }

    const simpleRawTxn = await simpleInternal({
        senderAddress: senderAccount.address(),
        senderSequenceNumber: (await getAccountInfoInternal({ accountAddress: senderAccount.address() }, config)).sequence_number,
        function: args.function,
        functionTypeArgs: args.typeArguments ?? [],
        functionArgs: functionArguments,
        optionalTransactionPayloadArgs: args.optionalTransactionPayloadArgs ?? {},
        abi: args.abi as MoveModule
    }, config);

    return await submitSerializedRawTransactionInternal({
        senderAccount: senderAccount,
        serializedRawTransaction: BCS.bcsToBytes(simpleRawTxn),
        enableTransactionWaitAndSimulationArgs: args.enableTransactionWaitAndSimulationArgs ?? {}

    }, config);
}
