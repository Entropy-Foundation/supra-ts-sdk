import { BCS, type SupraAccount } from "supra-l1-sdk-core";
import { SupraInsufficientFungibleAssetBalanceError } from "../errors/fungibleAssetError";
import { addressToBytes, standardizeAddress } from "../helper/account";
import { parseTypeArgument } from "../helper/typeTag";
import type { AccountAddressInput } from "../types/account";
import type { FungibleAssetMetadata } from "../types/fungibleAsset";
import type { NetworkConfig } from "../utils/apiEndpoints";
import { SUPRA_COIN_TYPE, SUPRA_FRAMEWORK_ADDRESS, SUPRA_FUNGIBLE_ASSET_ADDRESS } from "../utils/constants";
import { getAccountResourceInternal, getAccountSupraBalanceInternal } from "./account";
import type { OptionalTransactionArgs, SubmitTransactionResponse } from "../types/transactionManager/transactionSubmit";
import type { MoveFunctionId } from "../types/move";
import { buildAndSubmitEntryFunctionInternal } from "./transactionManager/txnSubmit";

export async function getFungibleAssetMetadataInternal(
    args: { assetAddress: AccountAddressInput },
    config: NetworkConfig,
): Promise<FungibleAssetMetadata> {
    return await getAccountResourceInternal<FungibleAssetMetadata>(
        {
            accountAddress: args.assetAddress,
            resourceType: `${SUPRA_FRAMEWORK_ADDRESS}::fungible_asset::Metadata`,
        },
        config,
    ).then((res) => res.data);
}

export async function transferFungibleAssetInternal(
    args: {
        senderAccount: SupraAccount;
        receiverAccountAddress: AccountAddressInput;
        amount: number | bigint;
        assetAddress: AccountAddressInput;
        optionalTransactionArgs?: OptionalTransactionArgs;
    },
    config: NetworkConfig,
): Promise<SubmitTransactionResponse> {
    if (standardizeAddress(args.assetAddress) === SUPRA_FUNGIBLE_ASSET_ADDRESS) {
        await assertSupraFungibleAssetBalanceInternal(args.senderAccount, BigInt(args.amount), config);
    }

    // Fungible Asset Transfer Payload
    let supraTransferPayload = {
        function: `${SUPRA_FRAMEWORK_ADDRESS}::primary_fungible_store::transfer` as MoveFunctionId,
        functionTypeArgs: [parseTypeArgument("0x1::fungible_asset::Metadata")],
        functionArgs: [
            addressToBytes(args.assetAddress),
            addressToBytes(args.receiverAccountAddress),
            BCS.bcsSerializeUint64(args.amount),
        ],
    };

    return await buildAndSubmitEntryFunctionInternal(
        {
            senderAccount: args.senderAccount,
            payload: supraTransferPayload,
            optionalTransactionArgs: args.optionalTransactionArgs,
        },
        config,
    );
}

/**
 * Migrates the sender's balance of a coin type from its `CoinStore` resource to the primary fungible store of the
 * paired fungible asset (`0x1::coin::migrate_to_fungible_store`).
 */
export async function migrateCoinToFungibleStoreInternal(
    args: {
        senderAccount: SupraAccount;
        coinType?: MoveFunctionId;
        optionalTransactionArgs?: OptionalTransactionArgs;
    },
    config: NetworkConfig,
): Promise<SubmitTransactionResponse> {
    let migrationPayload = {
        function: `${SUPRA_FRAMEWORK_ADDRESS}::coin::migrate_to_fungible_store` as MoveFunctionId,
        functionTypeArgs: [parseTypeArgument(args.coinType ?? SUPRA_COIN_TYPE)],
        functionArgs: [],
    };

    return await buildAndSubmitEntryFunctionInternal(
        {
            senderAccount: args.senderAccount,
            payload: migrationPayload,
            optionalTransactionArgs: args.optionalTransactionArgs,
        },
        config,
    );
}

/** Throws unless the sender's primary store of the SUPRA fungible asset holds at least `amount`. */
async function assertSupraFungibleAssetBalanceInternal(
    senderAccount: SupraAccount,
    amount: bigint,
    config: NetworkConfig,
): Promise<void> {
    const balance = await getAccountSupraBalanceInternal({ accountAddress: senderAccount.address() }, config);
    if (balance.fungibleAsset < amount) {
        throw new SupraInsufficientFungibleAssetBalanceError({
            senderAddress: standardizeAddress(senderAccount.address()),
            assetAddress: SUPRA_FUNGIBLE_ASSET_ADDRESS,
            amount,
            fungibleAssetBalance: balance.fungibleAsset,
            coinBalance: balance.coin,
        });
    }
}
