import type { SupraAccount } from "supra-l1-sdk-core";
import type { AccountAddressInput } from "../types/account";
import type { NetworkConfig } from "../utils/apiEndpoints";
import type { OptionalTransactionArgs, SubmitTransactionResponse } from "../types/transactionManager/transactionSubmit";
import type { CoinInfo } from "../types/coin";
import { getFungibleAssetMetadataInternal, transferFungibleAssetInternal } from "../internal/fungibleAsset";
import { retryWithFreshSequenceNumber } from "../internal/sequenceNumber";
import { validateAddress, validateAmount } from "../helper/validation";

/**
 * The FungibleAsset class provides methods for interacting with the FungibleAsset on the Supra network.
 * @group FungibleAsset
 */
export class FungibleAsset {


    /**
    * The networkInformation property is A NetworkConfig object that contains information about the network on which the Supra client is running.
    */
    protected readonly networkInformation: NetworkConfig;


    /**
    * The constructor function takes a NetworkConfig object as a parameter and assigns it to the networkInformation property.
    * @param networkInformation - A NetworkConfig object that contains information about the network on which the Supra client is running.
    * @example
    * ```typescript
    * import { SupraClient,Network } from "supra-ts-sdk";
    * 
    * const supra = new SupraClient({ network: Network.TESTNET });
    * ```  
    * @group FungibleAsset
    */
    constructor(networkInformation: NetworkConfig) {
        this.networkInformation = networkInformation;
    }


    /**
     * Get the metadata of a fungible asset.
     * @param args.assetAddress - The address of the fungible asset.
     * @returns A Promise that resolves to the metadata of the fungible asset.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     *    const assetAddress = "0x1";
     *    const fungibleAssetMetadata = await supra.fungibleAsset.getFungibleAssetMetadata({ assetAddress: assetAddress });
     *    console.log(fungibleAssetMetadata);
     * }
     * 
     * runExample().catch(console.error); 
     * ```
     * @group FungibleAsset
     */
    async getFungibleAssetMetadata(args: { assetAddress: AccountAddressInput }): Promise<CoinInfo> {
        validateAddress(args.assetAddress, "assetAddress");
        return getFungibleAssetMetadataInternal(args, this.networkInformation);
    }

    /**
     * Transfer supra fungible asset from one account to another.
     * @param args.senderAccount - The account sending the SupraCoin.
     * @param args.receiverAccountAddress - The address of the account receiving the SupraCoin.
     * @param args.amount - The amount of SupraCoin to transfer.
     * @param args.optionalTransactionArgs - Optional transaction arguments.
     * @returns A Promise that resolves to a `SubmitTransactionResponse`. {@link Submit} describes the statuses and
     * errors of a submission.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     *    const receiverAccountAddress = "0x2";
     *    const amount = 100;
     *    const transactionResponse = await supra.fungibleAsset.transferSupraFungibleAsset({ senderAccount: senderAccount, receiverAccountAddress: receiverAccountAddress, amount: amount });
     *    console.log(transactionResponse);
     * }
     * 
     * runExample().catch(console.error); 
     * ```
     * @group FungibleAsset
     */
    async transferSupraFungibleAsset(
        args: {
            senderAccount: SupraAccount,
            receiverAccountAddress: AccountAddressInput,
            amount: number | bigint,
            optionalTransactionArgs?: OptionalTransactionArgs,
        }
    ): Promise<SubmitTransactionResponse> {
        validateAddress(args.receiverAccountAddress, "receiverAccountAddress");
        validateAmount(args.amount, "amount");
        return retryWithFreshSequenceNumber(
            args.optionalTransactionArgs?.optionalTransactionPayloadArgs?.sequenceNumber,
            () => transferFungibleAssetInternal({
                ...args,
                assetAddress: "0x000000000000000000000000000000000000000000000000000000000000000a",
            }, this.networkInformation),
        );
    }

    /**
     * Transfer a fungible asset from one account to another.
     * @param args.senderAccount - The account sending the coin.
     * @param args.receiverAccountAddress - The address of the account receiving the coin.
     * @param args.amount - The amount of the coin to transfer.
     * @param args.assetAddress - The address of the coin to transfer.
     * @param args.optionalTransactionArgs - Optional transaction arguments.
     * @returns A Promise that resolves to a `SubmitTransactionResponse`. {@link Submit} describes the statuses and
     * errors of a submission.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     *    const receiverAccountAddress = "0x2";
     *    const amount = 100;
     *    const assetAddress = "0x000000000000000000000000000000000000000000000000000000000000000a";
     *    const transactionResponse = await supra.fungibleAsset.transferFungibleAsset({ senderAccount: senderAccount, receiverAccountAddress: receiverAccountAddress, amount: amount, assetAddress: assetAddress });
     *    console.log(transactionResponse);
     * }
     * 
     * runExample().catch(console.error); 
     * ```
     * @group FungibleAsset
     */
    async transferFungibleAsset(
        args: {
            senderAccount: SupraAccount,
            receiverAccountAddress: AccountAddressInput,
            amount: number | bigint,
            assetAddress: AccountAddressInput,
            optionalTransactionArgs?: OptionalTransactionArgs,
        }
    ): Promise<SubmitTransactionResponse> {
        validateAddress(args.receiverAccountAddress, "receiverAccountAddress");
        validateAmount(args.amount, "amount");
        validateAddress(args.assetAddress, "assetAddress");
        return retryWithFreshSequenceNumber(
            args.optionalTransactionArgs?.optionalTransactionPayloadArgs?.sequenceNumber,
            () => transferFungibleAssetInternal(args, this.networkInformation),
        );
    }
}
