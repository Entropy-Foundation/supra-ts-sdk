import { SupraAccount } from "supra-l1-sdk-core";
import type { NetworkConfig } from "../utils/apiEndpoints";
import { sendTxnPayloadInternal, simpleInternal } from "./transactionManager/txnBuild";
import { bindReservation, releaseSequenceNumberInternal, reserveSequenceNumberInternal } from "./sequenceNumber";
import type { MoveFunctionId, MoveModule, SimpleEntryFunctionArgumentTypes, TypeArgument } from "../types/move";
import { submitTxnInternal } from "./transactionManager/txnSubmit";
import type { OptionalTransactionPayloadArgs, SendTxnPayload } from "../types/transactionManager/transactionBuild";
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

    const explicitSequenceNumber = args.optionalTransactionPayloadArgs?.sequenceNumber;
    const { sequenceNumber: senderSequenceNumber, reservation } = await reserveSequenceNumberInternal({
        address: senderAccount.address(),
        sequenceNumber: explicitSequenceNumber,
    }, config);

    let sendTxPayload: SendTxnPayload;
    try {
        const simpleRawTxn = await simpleInternal({
            senderAddress: senderAccount.address(),
            senderSequenceNumber,
            function: args.function,
            functionTypeArgs: args.typeArguments ?? [],
            functionArgs: functionArguments,
            optionalTransactionPayloadArgs: args.optionalTransactionPayloadArgs ?? {},
            abi: args.abi as MoveModule
        }, config);
        sendTxPayload = await sendTxnPayloadInternal({ senderAccount, rawTxn: simpleRawTxn }, config);
    } catch (error) {
        // The transaction was not submitted, so a number from the counter is not used.
        if (reservation !== undefined) {
            releaseSequenceNumberInternal(reservation, config);
        }
        throw error;
    }
    if (reservation !== undefined) {
        bindReservation(sendTxPayload, reservation);
    }

    return await submitTxnInternal({
        sendTxJsonPayload: sendTxPayload,
        enableTransactionWaitAndSimulationArgs: args.enableTransactionWaitAndSimulationArgs ?? {}
    }, config);
}
