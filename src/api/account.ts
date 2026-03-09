import type { NetworkConfig } from "../utils/apiEndpoints";
import type { AccountAddressInput, AccountData, PaginatedResponse } from "../types/account";
import type { MoveModuleBytecode, MoveResource, MoveStructId } from "../types/move";
import type { AutoTransactionResponse, TransactionQueryType, TransactionResponse } from "../types/transaction";
import { getAccountAutoTransactionsInternal, getAccountCoinBalanceInternal, getAccountCoinsCountInternal, getAccountCoinTransactionsInternal, getAccountInfoInternal, getAccountLegacyCoins, getAccountModuleInternal, getAccountModulesInternal, getAccountResourceInternal, getAccountResourcesInternal, getAccountTransactionsInternal, isAccountExistsInternal } from "../internal/account";
import { SUPRA_COIN_TYPE } from "../utils/constants";


/**
 * The Account class provides methods for querying the state of an account.
 * @group Account
 */
export class Account {

    /**
     * The networkInformation property is A NetworkConfig object that contains information about the network on which the Supra client is running.
     */
    protected readonly networkInformation: NetworkConfig;


    /**
     * The constructor function takes a NetworkConfig object as a parameter and assigns it to the networkInformation property.
     * @param networkInformation - A NetworkConfig object that contains information about the network on which the SupraClient is running.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * ```  
     * @group Account
     */
    constructor(networkInformation: NetworkConfig) {
        this.networkInformation = networkInformation;
    }

    /**
     * Check whether given account exists onchain or not
     * @param args.account - The address of the account to query.
     * @returns `true` if account exists otherwise `false`
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     *    const accountAddress = "0x1"; 
     *    const isAccountExists = await supra.account.isAccountExists({ account: accountAddress});
     *    console.log(isAccountExists);
     * }
     * 
     * runExample().catch(console.error);
     * ```
     * @group Account
     */
    async isAccountExists(args: { accountAddress: AccountAddressInput }): Promise<boolean> {
        return isAccountExistsInternal(args, this.networkInformation);
    }

    /**
     * Queries the current state of an account, including its sequence number and authentication key.
     * @param args.accountAddress - The address of the account to query.
     * @returns A Promise that resolves to an AccountData object containing the sequence number and authentication key of the account.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     *    const accountAddress = "0x1"; 
     *    const accountData = await supra.account.getAccountInfo({ accountAddress: accountAddress}); });
     *   console.log(accountData);
     * }
     * 
     * runExample().catch(console.error); 
     * ```
     * @group Account
     */
    async getAccountInfo(args: { accountAddress: AccountAddressInput }): Promise<AccountData> {

        return getAccountInfoInternal(args, this.networkInformation);

    }

    /**
     * Queries the modules of an account.
     * @param args.accountAddress - The address of the account to query.
     * @param args.options.count - The number of modules to return.
     * @param args.options.start - Cursor specifying where to start for pagination. Use the cursor returned by the previous request when making the next request.
     * @returns A Promise that resolves to an array of MoveModuleBytecode objects representing the modules of the account with optional cursor.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     *    const accountAddress = "0x1";
     *    const {response: accountModules, cursor} = await supra.account.getAccountModules({ accountAddress: accountAddress });
     *    console.log(accountModules);
     * }
     * 
     * runExample().catch(console.error); 
     * ```
     * @group Account
     */
    async getAccountModules(args: {
        accountAddress: AccountAddressInput;
        options?: { count?: number; start?: string };
    }): Promise<PaginatedResponse<MoveModuleBytecode[]>> {
        return getAccountModulesInternal(args, this.networkInformation);
    }

    /**
     * Queries a specific module of an account.
     * @param args.accountAddress - The address of the account to query.
     * @param args.moduleName - The name of the module to query.
     * @returns A Promise that resolves to a MoveModuleBytecode object representing the module of the account.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     *    const accountAddress = "0x1";
     *    const accountModule = await supra.account.getAccountModule({ accountAddress: accountAddress, moduleName: "module_name" });
     *    console.log(accountModule);
     * }
     * 
     * runExample().catch(console.error); 
     * ```
     * @group Account  
     */
    async getAccountModule(args: {
        accountAddress: AccountAddressInput;
        moduleName: string;
    }): Promise<MoveModuleBytecode> {
        return getAccountModuleInternal(args, this.networkInformation);
    }



    /**
     * Queries the resources of an account.
     * @param args.accountAddress - The address of the account to query.
     * @param args.options.count - The number of resources to return.
     * @param args.options.start - Cursor specifying where to start for pagination. Use the cursor returned by the previous request when making the next request.
     * @returns A Promise that resolves to an array of MoveResource objects representing the resources of the account with optional cursor.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     *    const accountAddress = "0x1";
     *    const {response: accountResources, cursor} = await supra.account.getAccountResources({ accountAddress: accountAddress });
     *    console.log(accountResources);
     * }
     * 
     * runExample().catch(console.error); 
     * ```
     * @group Account
     */
    async getAccountResources(args: {
        accountAddress: AccountAddressInput;
        options?: { count?: number; start?: string };
    }): Promise<PaginatedResponse<MoveResource[]>> {

        return getAccountResourcesInternal(args, this.networkInformation);
    }

    /**
     * Queries a specific resource of an account.
     * @template T - The type of the resource to be returned.
     * @param args.accountAddress - The address of the account to query.
     * @param args.resourceType - The type of the resource to query.
     * @returns A Promise that resolves to a MoveResource object representing the resource of the account.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     *    const accountAddress = "0x1";
     *    const accountResource = await supra.account.getAccountResource({ accountAddress: accountAddress, resourceType: "0x1::coin::CoinStore<0x1::supra_coin::SupraCoin>" });
     *    console.log(accountResource);
     * }
     * 
     * runExample().catch(console.error); 
     * ```
     * @group Account
     */
    async getAccountResource<T extends {}>(args: {
        accountAddress: AccountAddressInput;
        resourceType: MoveStructId;
    }): Promise<MoveResource<T>> {
        return getAccountResourceInternal<T>(args, this.networkInformation);
    }


    /**
     * Queries the transactions of an account.
     * @template {TransactionResponse} T - The type of the transaction to be returned.
     * @param args.accountAddress - The address of the account to query.
     * @param args.options.count - The number of transactions to return.
     * @param args.options.start - Cursor specifying where to start for pagination. Use the cursor returned by the previous request when making the next request.
     * @param args.options.ascending - Whether to return the transactions in ascending order.   
     * @note Maximum number of items to return default is 20 and maximum is 100.
     * @returns A Promise that resolves to an array of TransactionResponse objects representing the transactions of the account with optional cursor.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     *    const accountAddress = "0x1";
     *    const {response: accountTransactions, cursor} = await supra.account.getAccountTransactions({ accountAddress: accountAddress });
     *    console.log(accountTransactions);
     * }
     * 
     * runExample().catch(console.error); 
     * ```
     * @group Account
     */
    async getAccountTransactions<T extends TransactionResponse>(args: {
        accountAddress: AccountAddressInput;
        options?: {
            count?: number;
            start?: string;
            ascending?: boolean;
        };
    }): Promise<PaginatedResponse<T[]>> {
        return getAccountTransactionsInternal<T>(args, this.networkInformation);
    }


    /**
     * Queries the coin transactions of an account.
     * @template {TransactionResponse} T - The type of the transaction to be returned.
     * @param args.accountAddress - The address of the account to query.
     * @param args.options.count - The number of transactions to return.
     * @param args.options.start - Cursor specifying where to start for pagination. Use the cursor returned by the previous request when making the next request.
     * @param args.options.ascending - Whether to return the transactions in ascending order.
     * @note Maximum number of items to return default is 20 and maximum is 100.
     * @returns A Promise that resolves to an array of TransactionResponse objects representing the coin transactions of the account with optional cursor.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     *    const accountAddress = "0x1";
     *    const {response: accountCoinTransactions , cursor} = await supra.account.getAccountCoinTransactions({ accountAddress: accountAddress });
     *    console.log(accountCoinTransactions);
     * }
     * 
     * runExample().catch(console.error); 
     * ```
     * @group Account
     */
    async getAccountCoinTransactions<T extends TransactionResponse>(args: {
        accountAddress: AccountAddressInput;
        options?: {
            count?: number;
            start?: string;
            ascending?: boolean;
            type?: TransactionQueryType
        };
    }): Promise<PaginatedResponse<T[]>> {

        return getAccountCoinTransactionsInternal<T>(args, this.networkInformation);
    }

    /**
     * Queries the auto transactions of an account.
     * @template {TransactionResponse} T - The type of the transaction to be returned.
     * @param args.accountAddress - The address of the account to query.
     * @param args.options.count - The number of transactions to return.
     * @param args.options.block_height - Starting block height (inclusive). Optional.
     *  The block height at which to start lookup for transactions. If provided, returns :count of transactions starting from it in the specified order. For order see :ascending flag.
     * @note If a :cursor is specified then this field will be ignored. 
     * @param args.options.cursor - Cursor specifying where to start for pagination. Use the cursor returned by the previous request when making the next request.
     * If provided, returns :count of transactions starting from this cursor in the specified order. For order see :ascending flag.
     * If not specified, the lookup will be done based on the :block_height parameter value. 
     * @note If both :cursor and :block_height are specified then :cursor has precedence.
     * @param args.options.ascending - Whether to return the transactions in ascending order.
     * @note Maximum number of items to return default is 20 and maximum is 100.
     * @returns A Promise that resolves to an array of AutoTransactionResponse objects representing the auto transactions of the account with optional cursor.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     *    const accountAddress = "0x1";
     *    const {response: accountAutoTransactions, cursor} = await supra.account.getAccountAutoTransactions({ accountAddress: accountAddress });
     *    console.log(accountAutoTransactions);
     * }
     * 
     * runExample().catch(console.error);
     * ```
     * @group Account
     */
    async getAccountAutoTransactions<T extends AutoTransactionResponse>(args: {
        accountAddress: AccountAddressInput;
        options?: {
            count?: number;
            block_height?: number;
            cursor?: string;
            ascending?: boolean;
        };
    }): Promise<PaginatedResponse<T[]>> {

        return getAccountAutoTransactionsInternal(args, this.networkInformation);
    }



    /**
     * Queries the number of coins owned by an account.
     * @param args.accountAddress - The address of the account to query.
     * @note This method is only available for legacy coins for now.
     * @returns A Promise that resolves to the number of coins owned by the account.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     *    const accountAddress = "0x1";
     *    const accountCoinsCount = await supra.account.getAccountCoinsCount({ accountAddress: accountAddress });
     *    console.log(accountCoinsCount);
     * }
     * 
     * runExample().catch(console.error); 
     * ```
     * @group Account
     */
    async getAccountCoinsCount(args: {
        accountAddress: AccountAddressInput;
    }): Promise<number> {

        return getAccountCoinsCountInternal(args, this.networkInformation);
    }

    /**
     * Queries the balance of SupraCoin owned by an account.
     * @param args.accountAddress - The address of the account to query.
     * @returns A Promise that resolves to the balance of SupraCoin owned by the account.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     *    const accountAddress = "0x1";
     *    const accountSupraCoinBalance = await supra.account.getAccountSupraCoinBalance({ accountAddress: accountAddress });
     *    console.log(accountSupraCoinBalance);
     * }
     * 
     * runExample().catch(console.error); 
     * ```
     * @group Account
     */
    async getAccountSupraCoinBalance(args: {
        accountAddress: AccountAddressInput;
    }): Promise<BigInt> {
        return this.getAccountCoinBalance({ accountAddress: args.accountAddress, asset: SUPRA_COIN_TYPE });
    }


    /**
     * Queries the balance of a coin owned by an account.
     * @param args.accountAddress - The address of the account to query.
     * @param args.asset - The address of the coin to query wether it is a legacy coin or fungible asset.
     * @returns A Promise that resolves to the balance of the coin owned by the account.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     *    const accountAddress = "0x1";
     *    const accountSupraCoinBalance = await supra.account.getAccountCoinBalance({ accountAddress: accountAddress, asset: "0x1::supra_coin::SupraCoin" });
     *    console.log(accountSupraCoinBalance);
     * }
     * 
     * runExample().catch(console.error); 
     * ```
     * @group Account
     */
    async getAccountCoinBalance(args: {
        accountAddress: AccountAddressInput;
        asset: MoveStructId | AccountAddressInput;
    }): Promise<BigInt> {

        return getAccountCoinBalanceInternal(args, this.networkInformation);
    }



}
