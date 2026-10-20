import type { SupraAccount } from "supra-l1-sdk-core";
import type { AccountAddressInput } from "../types/account";
import type { NetworkConfig } from "../utils/apiEndpoints";
import type { OptionalTransactionArgs, SubmitTransactionResponse } from "../types/transactionManager/transactionSubmit";
import type { FungibleAssetMetadata } from "../types/fungibleAsset";
import type { MoveFunctionId } from "../types/move";
import { getFungibleAssetMetadataInternal, migrateCoinToFungibleStoreInternal, transferFungibleAssetInternal } from "../internal/fungibleAsset";
import { retryWithFreshSequenceNumber } from "../internal/sequenceNumber";
import { validateAddress, validateAmount, validateStructId } from "../helper/validation";
import { SUPRA_FUNGIBLE_ASSET_ADDRESS } from "../utils/constants";

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
    async getFungibleAssetMetadata(args: { assetAddress: AccountAddressInput }): Promise<FungibleAssetMetadata> {
        validateAddress(args.assetAddress, "assetAddress");
        return getFungibleAssetMetadataInternal(args, this.networkInformation);
    }

    /**
     * Transfer the SUPRA fungible asset from one account to another (`0x1::primary_fungible_store::transfer`).
     *
     * The transfer moves SUPRA held in the sender's primary fungible store only; SUPRA held in a `CoinStore` is not
     * part of it. The sender's fungible asset balance is read first, and when it is below `amount` the method throws
     * {@link SupraInsufficientFungibleAssetBalanceError}, naming the fungible asset balance and the coin balance,
     * without submitting a transaction. {@link migrateCoinToFungibleStore} moves the coin balance into the fungible
     * store; `supra.coin.transferSupraCoin` transfers SUPRA held in either form.
     * @param args.senderAccount - The account sending the SUPRA.
     * @param args.receiverAccountAddress - The address of the account receiving the SUPRA.
     * @param args.amount - The amount of SUPRA to transfer, in quants.
     * @param args.optionalTransactionArgs - Optional transaction arguments. The gas settings in
     * `optionalTransactionPayloadArgs` apply to the transaction; without `maxGas` it is estimated
     * (see {@link OptionalTransactionPayloadArgs}). The object is not modified.
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
                assetAddress: SUPRA_FUNGIBLE_ASSET_ADDRESS,
            }, this.networkInformation),
        );
    }

    /**
     * Migrates the sender's balance of a coin type from its `CoinStore` resource to the primary fungible store of the
     * paired fungible asset (`0x1::coin::migrate_to_fungible_store`). The coin store is removed; the balance is
     * unchanged as reported by `0x1::coin::balance` and is available to fungible asset transfers afterwards. The
     * transaction aborts when the chain has the migration disabled or the coin type has no coin info.
     * @param args.senderAccount - The account whose balance is migrated.
     * @param args.coinType - The coin type to migrate. Defaults to SUPRA, `0x1::supra_coin::SupraCoin`.
     * @param args.optionalTransactionArgs - Optional transaction arguments. The gas settings in
     * `optionalTransactionPayloadArgs` apply to the transaction; without `maxGas` it is estimated
     * (see {@link OptionalTransactionPayloadArgs}). The object is not modified.
     * @returns A Promise that resolves to a `SubmitTransactionResponse`. {@link Submit} describes the statuses and
     * errors of a submission.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *    const transactionResponse = await supra.fungibleAsset.migrateCoinToFungibleStore({
     *        senderAccount: senderAccount,
     *        optionalTransactionArgs: { enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true } },
     *    });
     *    console.log(transactionResponse);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group FungibleAsset
     */
    async migrateCoinToFungibleStore(
        args: {
            senderAccount: SupraAccount,
            coinType?: MoveFunctionId,
            optionalTransactionArgs?: OptionalTransactionArgs,
        }
    ): Promise<SubmitTransactionResponse> {
        if (args.coinType !== undefined) {
            validateStructId(args.coinType, "coinType");
        }
        return retryWithFreshSequenceNumber(
            args.optionalTransactionArgs?.optionalTransactionPayloadArgs?.sequenceNumber,
            () => migrateCoinToFungibleStoreInternal(args, this.networkInformation),
        );
    }

    /**
     * Transfer a fungible asset from one account to another (`0x1::primary_fungible_store::transfer`). When
     * `assetAddress` is the SUPRA fungible asset (`0xa`) the method behaves as {@link transferSupraFungibleAsset}:
     * it throws {@link SupraInsufficientFungibleAssetBalanceError} without submitting when the sender's fungible
     * asset balance is below `amount`.
     * @param args.senderAccount - The account sending the coin.
     * @param args.receiverAccountAddress - The address of the account receiving the coin.
     * @param args.amount - The amount of the coin to transfer.
     * @param args.assetAddress - The address of the coin to transfer.
     * @param args.optionalTransactionArgs - Optional transaction arguments. The gas settings in
     * `optionalTransactionPayloadArgs` apply to the transaction; without `maxGas` it is estimated
     * (see {@link OptionalTransactionPayloadArgs}). The object is not modified.
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
