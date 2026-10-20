import { SupraAccount } from "supra-l1-sdk-core";
import type { NetworkConfig } from "../utils/apiEndpoints";
import { sendTxnPayloadInternal, simpleInternal, withSequenceNumber } from "./transactionManager/txnBuild";
import { bindReservation, withSequenceNumberInternal } from "./sequenceNumber";
import type { MoveFunctionId, MoveModule, SimpleEntryFunctionArgumentTypes, TypeArgument } from "../types/move";
import { mapCallGasUnitPriceRefusalInternal, withResolvedGasUnitPriceInternal } from "./transactionManager/gasPrice";
import { submitTxnInternal, validateSubmitOptions } from "./transactionManager/txnSubmit";
import type { OptionalTransactionPayloadArgs } from "../types/transactionManager/transactionBuild";
import type {
    EnableTransactionWaitAndSimulationArgs,
    SubmitTransactionResponse,
} from "../types/transactionManager/transactionSubmit";

export interface CallContractArgs {
    function: MoveFunctionId;
    functionArguments: Array<SimpleEntryFunctionArgumentTypes | SupraAccount>;
    typeArguments?: Array<TypeArgument>;
    optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs;
    enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs;
    abi?: MoveModule;
}

export async function callContractInternal(
    args: CallContractArgs,
    config: NetworkConfig,
): Promise<SubmitTransactionResponse> {
    const signers: SupraAccount[] = [];
    const functionArguments: Array<SimpleEntryFunctionArgumentTypes> = [];

    args.functionArguments.forEach((f) => {
        if (f instanceof SupraAccount) {
            signers.push(f);
        } else {
            functionArguments.push(f as SimpleEntryFunctionArgumentTypes);
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

    validateSubmitOptions(args.enableTransactionWaitAndSimulationArgs ?? {});
    // The read of the node's gas unit price estimate starts before the account's lock is requested and is awaited
    // inside the lock, so the lock is requested in the order of the calls and the read overlaps the calls ahead. The
    // no-op catch keeps a rejection from being reported as unhandled before it is awaited.
    const priceRead = withResolvedGasUnitPriceInternal(args.optionalTransactionPayloadArgs, config);
    priceRead.catch(() => undefined);
    // A number from the client's counter is taken under the account's lock, which the submission releases when the
    // node answers it (`withSequenceNumberInternal`).
    return withSequenceNumberInternal(
        {
            address: senderAccount.address(),
            sequenceNumber: args.optionalTransactionPayloadArgs?.sequenceNumber,
        },
        config,
        async (senderSequenceNumber, reservation) => {
            const optionalTransactionPayloadArgs = await priceRead;
            // The max gas estimate simulates the transaction with `senderSequenceNumber`.
            const simpleRawTxn = await simpleInternal(
                {
                    senderAddress: senderAccount.address(),
                    senderSequenceNumber,
                    function: args.function,
                    functionTypeArgs: args.typeArguments ?? [],
                    functionArgs: functionArguments,
                    optionalTransactionPayloadArgs,
                    abi: args.abi as MoveModule,
                    senderAccount,
                    reservation,
                },
                config,
            );
            const sendTxPayload = await sendTxnPayloadInternal({ senderAccount, rawTxn: simpleRawTxn }, config);
            if (reservation !== undefined) {
                bindReservation(sendTxPayload, reservation, (sequenceNumber) =>
                    sendTxnPayloadInternal(
                        { senderAccount, rawTxn: withSequenceNumber(simpleRawTxn, sequenceNumber) },
                        config,
                    ),
                );
            }
            return await submitTxnInternal(
                {
                    sendTxJsonPayload: sendTxPayload,
                    enableTransactionWaitAndSimulationArgs: args.enableTransactionWaitAndSimulationArgs ?? {},
                    deferGasPriceRefusalMapping: true,
                },
                config,
            );
        },
    ).catch(async (error: unknown) => {
        // A refusal for a gas unit price below the node's minimum is mapped after the lock is released, as the read of
        // the node's minimum is not made under it.
        throw await mapCallGasUnitPriceRefusalInternal(error, priceRead, config);
    });
}
