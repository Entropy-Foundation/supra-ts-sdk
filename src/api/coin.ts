import type { SupraAccount } from "supra-l1-sdk-core";
import type { AccountAddressInput } from "../types/account";
import type { NetworkConfig } from "../utils/apiEndpoints";
import type { OptionalTransactionArgs } from "../types/transactionManager/transactionSubmit";
import type { TransactionResponse } from "../types/transaction";
import { getCoinInfoInternal, transferCoinInternal } from "../internal/coin";
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
     * Get coin info of the given coin type
     * @param args.coinType Type of a coin resource
     * @returns CoinInfo
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
     * Transfer SupraCoin from one account to another.
     * @param args.senderAccount - The account sending the SupraCoin.
     * @param args.receiverAccountAddress - The address of the account receiving the SupraCoin.
     * @param args.amount - The amount of SupraCoin to transfer.
     * @param args.optionalTransactionArgs - Optional transaction arguments.
     * @returns A Promise that resolves to a TransactionResponse object.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     *    const receiverAccountAddress = "0x2";
     *    const amount = 100;
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
    ): Promise<TransactionResponse> {
        validateAddress(args.receiverAccountAddress, "receiverAccountAddress");
        validateAmount(args.amount, "amount");
        return transferCoinInternal({
            ...args,
            coinType: "0x1::supra_coin::SupraCoin",
        }, this.networkInformation);
    }

    /**
     * Transfer a coin from one account to another.
     * @param args.senderAccount - The account sending the coin.
     * @param args.receiverAccountAddress - The address of the account receiving the coin.
     * @param args.amount - The amount of the coin to transfer.
     * @param args.coinType - The type of the coin to transfer.
     * @param args.optionalTransactionArgs - Optional transaction arguments.
     * @returns A Promise that resolves to a TransactionResponse object.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     *    const receiverAccountAddress = "0x2";
     *    const amount = 100;
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
    ): Promise<TransactionResponse> {
        validateAddress(args.receiverAccountAddress, "receiverAccountAddress");
        validateAmount(args.amount, "amount");
        validateStructId(args.coinType, "coinType");
        return transferCoinInternal(args, this.networkInformation);
    }
}
