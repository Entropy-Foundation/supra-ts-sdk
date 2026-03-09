import { BCS, HexString, TxnBuilderTypes } from "supra-l1-sdk-core";
import type { AccountAddressInput } from "../../types/account";
import type { OptionalTransactionPayloadArgs } from "../../types/transactionManager/transactionBuild";
import type { NetworkConfig } from "../../utils/apiEndpoints";
import { buildEntryFunctionInternal, rawTxnObjectInnerInternal, rawTxnObjectInternal } from "./txnBuild";
import type { MoveFunctionId } from "../../types/move";
import { SUPRA_FRAMEWORK_ADDRESS } from "../../utils/constants";
import sha3 from "js-sha3";

export function serializedRawTxnObjectInternal(
    args: {
        senderAddress: AccountAddressInput,
        senderSequenceNumber: bigint,
        function: MoveFunctionId,
        functionTypeArgs: TxnBuilderTypes.TypeTag[],
        functionArgs: Uint8Array[],
        optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs,
    },
    config: NetworkConfig
): Uint8Array {
    return BCS.bcsToBytes(rawTxnObjectInternal(args, config));
}

export function serializedScriptRawTxnObjectInternal(
    args: {
        senderAddress: AccountAddressInput,
        senderSequenceNumber: bigint,
        scriptCode: Uint8Array,
        scriptTypeArgs: TxnBuilderTypes.TypeTag[],
        scriptArgs: TxnBuilderTypes.TransactionArgument[],
        optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs,
    },
    config: NetworkConfig
): Uint8Array {
    let payload = new TxnBuilderTypes.TransactionPayloadScript(
        new TxnBuilderTypes.Script(args.scriptCode, args.scriptTypeArgs, args.scriptArgs),
    );

    return BCS.bcsToBytes(rawTxnObjectInnerInternal({
        senderAddress: args.senderAddress,
        senderSequenceNumber: args.senderSequenceNumber,
        payload: payload,
        optionalTransactionPayloadArgs: args.optionalTransactionPayloadArgs ?? {},
    }, config));

}


export function serializedAutomationRegistrationRawTxnObjectInternal(
    args: {
        senderAddress: AccountAddressInput,
        senderSequenceNumber: bigint,
        function: MoveFunctionId,
        functionTypeArgs: TxnBuilderTypes.TypeTag[],
        functionArgs: Uint8Array[],
        automationMaxGasAmount: bigint,
        automationGasPriceCap: bigint,
        automationFeeCapForEpoch: bigint,
        automationExpirationTimestampSecs: bigint,
        automationAuxData: Uint8Array[],
        optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs,
    },
    config: NetworkConfig
): Uint8Array {

    let payload = new TxnBuilderTypes.TransactionPayloadAutomationRegistration(
        new TxnBuilderTypes.AutomationRegistrationParamsV1(
            new TxnBuilderTypes.AutomationRegistrationParamsV1Data(
                buildEntryFunctionInternal({
                    function: args.function,
                    functionTypeArgs: args.functionTypeArgs,
                    functionArgs: args.functionArgs
                }),
                args.automationMaxGasAmount,
                args.automationGasPriceCap,
                args.automationFeeCapForEpoch,
                args.automationExpirationTimestampSecs,
                args.automationAuxData,
            ),
        ),
    );
    return BCS.bcsToBytes(
        rawTxnObjectInnerInternal({
            senderAddress: args.senderAddress,
            senderSequenceNumber: args.senderSequenceNumber,
            payload: payload,
            optionalTransactionPayloadArgs: args.optionalTransactionPayloadArgs ?? {},
        }, config),
    );
}


export function serializedMultisigRawTxnObjectInternal(
    args: {
        senderAddress: AccountAddressInput,
        senderSequenceNumber: bigint,
        multisigAddress: AccountAddressInput,
        function: MoveFunctionId,
        functionTypeArgs: TxnBuilderTypes.TypeTag[],
        functionArgs: Uint8Array[],
        optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs,
    },
    config: NetworkConfig
): Uint8Array {
    let multisigAddress = typeof args.multisigAddress === "string" ? new HexString(args.multisigAddress.toString()) : args.multisigAddress;

    let payload = new TxnBuilderTypes.TransactionPayloadMultisig(
        new TxnBuilderTypes.MultiSig(
            TxnBuilderTypes.AccountAddress.fromHex(multisigAddress),
            new TxnBuilderTypes.MultiSigTransactionPayload(
                buildEntryFunctionInternal({
                    function: args.function,
                    functionTypeArgs: args.functionTypeArgs,
                    functionArgs: args.functionArgs
                })
            ),
        ),
    );
    return BCS.bcsToBytes(
        rawTxnObjectInnerInternal(
            {
                senderAddress: args.senderAddress,
                senderSequenceNumber: args.senderSequenceNumber,
                payload: payload,
                optionalTransactionPayloadArgs: args.optionalTransactionPayloadArgs ?? {},
            }, config),
    );
}


export function multisigProposalTxRawTxnObjectInternal(
    args: {
        senderAddress: AccountAddressInput,
        senderSequenceNumber: bigint,
        multisigAddress: AccountAddressInput,
        function: MoveFunctionId,
        functionTypeArgs: TxnBuilderTypes.TypeTag[],
        functionArgs: Uint8Array[],
        optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs,
    },
    config: NetworkConfig
): Uint8Array {
    let multisigAddress = typeof args.multisigAddress === "string" ? new HexString(args.multisigAddress.toString()) : args.multisigAddress;

    let multisigPayload = new TxnBuilderTypes.MultiSigTransactionPayload(
        buildEntryFunctionInternal({
            function: args.function,
            functionTypeArgs: args.functionTypeArgs,
            functionArgs: args.functionArgs
        })
    );
    let multisigPayloadHash = new HexString(
        sha3.sha3_256(BCS.bcsToBytes(multisigPayload)),
    );

    return serializedRawTxnObjectInternal(
        {
            senderAddress: args.senderAddress,
            senderSequenceNumber: args.senderSequenceNumber,
            function: `${SUPRA_FRAMEWORK_ADDRESS}::multisig_account::create_transaction_with_hash`,
            functionTypeArgs: [],
            functionArgs: [
                BCS.bcsToBytes(TxnBuilderTypes.AccountAddress.fromHex(multisigAddress)),
                BCS.bcsSerializeBytes(multisigPayloadHash.toUint8Array()),
            ],
            optionalTransactionPayloadArgs: args.optionalTransactionPayloadArgs ?? {},
        }, config
    );
}