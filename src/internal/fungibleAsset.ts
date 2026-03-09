import { BCS, HexString, TypeTagParser, type SupraAccount } from "supra-l1-sdk-core";
import type { AccountAddressInput } from "../types/account";
import type { FungibleAssetMetadata } from "../types/fungibleAsset";
import type { NetworkConfig } from "../utils/apiEndpoints";
import { DEFAULT_MAX_GAS_FOR_SUPRA_TRANSFER_WHEN_RECEIVER_EXISTS, DEFAULT_MAX_GAS_FOR_SUPRA_TRANSFER_WHEN_RECEIVER_NOT_EXISTS, SUPRA_FRAMEWORK_ADDRESS } from "../utils/constants";
import { getAccountInfoInternal, getAccountResourceInternal, isAccountExistsInternal } from "./account";
import type { OptionalTransactionArgs } from "../types/transactionManager/transactionSubmit";
import type { TransactionResponse } from "../types/transaction";
import type { MoveFunctionId } from "../types/move";
import { rawTxnObjectInternal, sendTxnPayloadInternal } from "./transactionManager/txnBuild";
import { submitTxnInternal } from "./transactionManager/txnSubmit";

export async function getFungibleAssetMetadataInternal(args: { assetAddress: AccountAddressInput }, config: NetworkConfig): Promise<FungibleAssetMetadata> {
    return await getAccountResourceInternal<FungibleAssetMetadata>({
        accountAddress: args.assetAddress,
        resourceType: `${SUPRA_FRAMEWORK_ADDRESS}::fungible_asset::Metadata`,
    }, config).then(res => res.data);
}

export async function transferFungibleAssetInternal(
    args: {
        senderAccount: SupraAccount,
        receiverAccountAddress: AccountAddressInput,
        amount: number | bigint,
        assetAddress: AccountAddressInput,
        optionalTransactionArgs?: OptionalTransactionArgs,
    },
    config: NetworkConfig
): Promise<TransactionResponse> {

    let receiverAccountAddress = typeof args.receiverAccountAddress === "string" ? new HexString(args.receiverAccountAddress.toString()) : args.receiverAccountAddress;
    let assetAddress = typeof args.assetAddress === "string" ? new HexString(args.assetAddress.toString()) : args.assetAddress;

    if (args.assetAddress == "0x000000000000000000000000000000000000000000000000000000000000000a" && args.optionalTransactionArgs?.optionalTransactionPayloadArgs &&
        !args.optionalTransactionArgs?.optionalTransactionPayloadArgs?.maxGas) {

        let maxGas = BigInt(
            DEFAULT_MAX_GAS_FOR_SUPRA_TRANSFER_WHEN_RECEIVER_EXISTS,
        );
        if ((await isAccountExistsInternal({ accountAddress: receiverAccountAddress }, config)) === false) {
            maxGas = BigInt(
                DEFAULT_MAX_GAS_FOR_SUPRA_TRANSFER_WHEN_RECEIVER_NOT_EXISTS,
            );
        }
        args.optionalTransactionArgs.optionalTransactionPayloadArgs.maxGas = maxGas;

    }

    // Fungible Asset Transfer Payload
    let supraTransferPayload = {
        senderAddress: args.senderAccount.address(),
        senderSequenceNumber: (await getAccountInfoInternal({ accountAddress: args.senderAccount.address() }, config)).sequence_number,
        function: `${SUPRA_FRAMEWORK_ADDRESS}::primary_fungible_store::transfer` as MoveFunctionId,
        functionTypeArgs: [new TypeTagParser("0x1::fungible_asset::Metadata").parseTypeTag()],
        functionArgs: [assetAddress.toUint8Array(), receiverAccountAddress.toUint8Array(), BCS.bcsSerializeUint64(args.amount)]
    }

    let raw_txn = rawTxnObjectInternal(supraTransferPayload, config);

    let sendTxPayload = sendTxnPayloadInternal({ senderAccount: args.senderAccount, rawTxn: raw_txn });

    return await submitTxnInternal({
        sendTxJsonPayload: sendTxPayload,
        enableTransactionWaitAndSimulationArgs: args.optionalTransactionArgs?.enableTransactionWaitAndSimulationArgs ?? {},
    }, config);
}