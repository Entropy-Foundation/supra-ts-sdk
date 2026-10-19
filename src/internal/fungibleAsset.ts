import { BCS, HexString, TypeTagParser, type SupraAccount } from "supra-l1-sdk-core";
import type { AccountAddressInput } from "../types/account";
import type { FungibleAssetMetadata } from "../types/fungibleAsset";
import type { NetworkConfig } from "../utils/apiEndpoints";
import { SUPRA_FRAMEWORK_ADDRESS } from "../utils/constants";
import { getAccountResourceInternal } from "./account";
import type { OptionalTransactionArgs, SubmitTransactionResponse } from "../types/transactionManager/transactionSubmit";
import type { MoveFunctionId } from "../types/move";
import { buildAndSubmitEntryFunctionInternal } from "./transactionManager/txnSubmit";

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
): Promise<SubmitTransactionResponse> {

    let receiverAccountAddress = typeof args.receiverAccountAddress === "string" ? new HexString(args.receiverAccountAddress.toString()) : args.receiverAccountAddress;
    let assetAddress = typeof args.assetAddress === "string" ? new HexString(args.assetAddress.toString()) : args.assetAddress;

    // Fungible Asset Transfer Payload
    let supraTransferPayload = {
        function: `${SUPRA_FRAMEWORK_ADDRESS}::primary_fungible_store::transfer` as MoveFunctionId,
        functionTypeArgs: [new TypeTagParser("0x1::fungible_asset::Metadata").parseTypeTag()],
        functionArgs: [assetAddress.toUint8Array(), receiverAccountAddress.toUint8Array(), BCS.bcsSerializeUint64(args.amount)]
    }

    return await buildAndSubmitEntryFunctionInternal({
        senderAccount: args.senderAccount,
        payload: supraTransferPayload,
        optionalTransactionArgs: args.optionalTransactionArgs,
    }, config);
}
