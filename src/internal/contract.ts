import { BCS, SupraAccount } from "supra-l1-sdk-core";
import type { NetworkConfig } from "../utils/apiEndpoints";
import { simpleInternal } from "./transactionManager/txnBuild";
import { releaseSequenceNumberInternal, reserveSequenceNumberInternal } from "./sequenceNumber";
import type { MoveFunctionId, MoveModule, SimpleEntryFunctionArgumentTypes, TypeArgument } from "../types/move";
import { submitSerializedRawTransactionInternal } from "./transactionManager/txnSubmit";
import type { OptionalTransactionPayloadArgs } from "../types/transactionManager/transactionBuild";
import type { EnableTransactionWaitAndSimulationArgs, SubmitTransactionResponse } from "../types/transactionManager/transactionSubmit";

export interface CallContractArgs {
    function: MoveFunctionId;
    functionArguments: Array<SimpleEntryFunctionArgumentTypes | SupraAccount>;
    typeArguments?: Array<TypeArgument>;
    optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs;
    enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs;
    abi?: MoveModule;
}

export async function callContractInternal(args: CallContractArgs, config: NetworkConfig): Promise<SubmitTransactionResponse> {

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

    const senderSequenceNumber = await reserveSequenceNumberInternal({
        address: senderAccount.address(),
        sequenceNumber: args.optionalTransactionPayloadArgs?.sequenceNumber,
    }, config);

    let simpleRawTxn;
    try {
        simpleRawTxn = await simpleInternal({
            senderAddress: senderAccount.address(),
            senderSequenceNumber,
            function: args.function,
            functionTypeArgs: args.typeArguments ?? [],
            functionArgs: functionArguments,
            optionalTransactionPayloadArgs: args.optionalTransactionPayloadArgs ?? {},
            abi: args.abi as MoveModule
        }, config);
    } catch (error) {
        // The transaction was not built, so its number is not used.
        releaseSequenceNumberInternal({ address: senderAccount.address(), sequenceNumber: senderSequenceNumber }, config);
        throw error;
    }

    return await submitSerializedRawTransactionInternal({
        senderAccount: senderAccount,
        serializedRawTransaction: BCS.bcsToBytes(simpleRawTxn),
        enableTransactionWaitAndSimulationArgs: args.enableTransactionWaitAndSimulationArgs ?? {}

    }, config);
}
