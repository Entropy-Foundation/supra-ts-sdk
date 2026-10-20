import type { SupraAccount } from "supra-l1-sdk-core";
import type { AccountAddressInput } from "../types/account";
import type { NetworkConfig } from "../utils/apiEndpoints";
import type { OptionalTransactionArgs, SubmitTransactionResponse } from "../types/transactionManager/transactionSubmit";
import { getCoinInfoInternal, transferCoinInternal } from "../internal/coin";
import { retryWithFreshSequenceNumber } from "../internal/sequenceNumber";
import type { MoveFunctionId } from "../types/move";
import type { CoinInfo } from "../types/coin";
import { validateAddress, validateAmount, validateStructId } from "../helper/validation";

/**
 * The Coin class provides methods for interacting with the legacy coins on the Supra network.
 * @group Coin
 */
export class Coin {


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
    * @group Coin
    */
    constructor(networkInformation: NetworkConfig) {
        this.networkInformation = networkInformation;
    }


    /**
     * Reads the name, symbol and decimals of a coin type from the `0x1::coin::CoinInfo` resource that the account
     * defining the coin holds.
     * @param args.coinType Type of the coin, for example `0x1::supra_coin::SupraCoin`
     * @returns CoinInfo
     * @throws {SupraNotFoundError} When the coin type has no `CoinInfo` resource.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     *    const coinType = "0x1::supra_coin::SupraCoin";
     *    const coinInfo = await supra.coin.getCoinInfo({ coinType: coinType });
     *    console.log(coinInfo);
     * }
     * 
     * runExample().catch(console.error); 
     * ```
     * @group Coin
     */
    async getCoinInfo(args: { coinType: MoveFunctionId }): Promise<CoinInfo> {
        validateStructId(args.coinType, "coinType");
        return getCoinInfoInternal(args, this.networkInformation);
    }

    /**
     * Transfer SUPRA from one account to another with `0x1::supra_account::transfer_coins`. The transfer moves SUPRA
     * held in the sender's `CoinStore` or in its fungible asset store.
     *
     * The sequence number comes from the client's counter unless `optionalTransactionPayloadArgs.sequenceNumber` is
     * set, and the client submits its calls from one account one after another. The client checks the chain ID of its
     * node before it signs; see {@link SupraConfig}.
     * @param args.senderAccount - The account sending the SUPRA.
     * @param args.receiverAccountAddress - The address of the account receiving the SUPRA. The account is created
     * when it does not exist.
     * @param args.amount - The amount of SUPRA to transfer, in quants.
     * @param args.optionalTransactionArgs - Optional transaction arguments. The gas settings in
     * `optionalTransactionPayloadArgs` apply to the transaction; without `maxGas` it is estimated
     * (see {@link OptionalTransactionPayloadArgs}). The object is not modified.
     * @returns A Promise that resolves to a `SubmitTransactionResponse`. {@link Submit} describes the statuses and
     * errors of a submission.
     * @throws {SupraSimulationFailedError} When the estimating simulation or an enabled simulation does not succeed.
     * @throws {SupraTransactionFailedError} When `enableWaitForTransaction` is set and the transaction fails.
     * @throws {SupraChainIdMismatchError} Before signing, when the chain ID is not the node's.
     * @example
     * ```typescript
     * import { Network, SupraAccount, SupraClient } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     * const senderAccount = new SupraAccount(); // an account that holds SUPRA
     *
     * async function runExample() {
     *    const receiverAccountAddress = "0x2";
     *    const amount = 100n;
     *    const transactionResponse = await supra.coin.transferSupraCoin({ senderAccount: senderAccount, receiverAccountAddress: receiverAccountAddress, amount: amount });
     *    console.log(transactionResponse);
     * }
     * 
     * runExample().catch(console.error); 
     * ```
     * @group Coin
     */
    async transferSupraCoin(
        args: {
            senderAccount: SupraAccount,
            receiverAccountAddress: AccountAddressInput,
            amount: number | bigint,
            optionalTransactionArgs?: OptionalTransactionArgs,
        }
    ): Promise<SubmitTransactionResponse> {
        validateAddress(args.receiverAccountAddress, "receiverAccountAddress");
        validateAmount(args.amount, "amount");
        return retryWithFreshSequenceNumber(args.optionalTransactionArgs?.optionalTransactionPayloadArgs?.sequenceNumber, () => transferCoinInternal({
            ...args,
            coinType: "0x1::supra_coin::SupraCoin",
        }, this.networkInformation));
    }

    /**
     * Transfer a coin from one account to another with `0x1::supra_account::transfer_coins`.
     *
     * The sequence number comes from the client's counter unless `optionalTransactionPayloadArgs.sequenceNumber` is
     * set, and the client submits its calls from one account one after another. The client checks the chain ID of its
     * node before it signs; see {@link SupraConfig}.
     * @param args.senderAccount - The account sending the coin.
     * @param args.receiverAccountAddress - The address of the account receiving the coin.
     * @param args.amount - The amount of the coin to transfer, in the smallest unit of the coin (quants for SUPRA).
     * @param args.coinType - The type of the coin to transfer.
     * @param args.optionalTransactionArgs - Optional transaction arguments. The gas settings in
     * `optionalTransactionPayloadArgs` apply to the transaction; without `maxGas` it is estimated
     * (see {@link OptionalTransactionPayloadArgs}). The object is not modified.
     * @returns A Promise that resolves to a `SubmitTransactionResponse`. {@link Submit} describes the statuses and
     * errors of a submission.
     * @throws {SupraSimulationFailedError} When the estimating simulation or an enabled simulation does not succeed.
     * @throws {SupraTransactionFailedError} When `enableWaitForTransaction` is set and the transaction fails.
     * @throws {SupraChainIdMismatchError} Before signing, when the chain ID is not the node's.
     * @example
     * ```typescript
     * import { Network, SupraAccount, SupraClient } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     * const senderAccount = new SupraAccount(); // an account that holds SUPRA
     *
     * async function runExample() {
     *    const receiverAccountAddress = "0x2";
     *    const amount = 100n;
     *    const coinType = "0x1::supra_coin::SupraCoin";
     *    const transactionResponse = await supra.coin.transferCoin({ senderAccount: senderAccount, receiverAccountAddress: receiverAccountAddress, amount: amount, coinType: coinType });
     *    console.log(transactionResponse);
     * }
     * 
     * runExample().catch(console.error); 
     * ```
     * @group Coin
     */
    async transferCoin(
        args: {
            senderAccount: SupraAccount,
            receiverAccountAddress: AccountAddressInput,
            amount: number | bigint,
            coinType: MoveFunctionId,
            optionalTransactionArgs?: OptionalTransactionArgs,
        }
    ): Promise<SubmitTransactionResponse> {
        validateAddress(args.receiverAccountAddress, "receiverAccountAddress");
        validateAmount(args.amount, "amount");
        validateStructId(args.coinType, "coinType");
        return retryWithFreshSequenceNumber(
            args.optionalTransactionArgs?.optionalTransactionPayloadArgs?.sequenceNumber,
            () => transferCoinInternal(args, this.networkInformation),
        );
    }
}
