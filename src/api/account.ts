import type { NetworkConfig } from "../utils/apiEndpoints";
import type { AccountAddressInput, AccountData, PaginatedResponse, SupraBalance } from "../types/account";
import type { MoveModuleBytecode, MoveResource, MoveStructId } from "../types/move";
import type { AutoTransactionResponse, TransactionQueryType, TransactionResponse } from "../types/transaction";
import { getAccountAutoTransactionsInternal, getAccountCoinBalanceInternal, getAccountCoinsCountInternal, getAccountCoinTransactionsInternal, getAccountInfoInternal, getAccountModuleInternal, getAccountModulesInternal, getAccountResourceInternal, getAccountResourcesInternal, getAccountSupraBalanceInternal, getAccountTransactionsInternal, isAccountExistsInternal } from "../internal/account";
import { SUPRA_COIN_TYPE } from "../utils/constants";
import { validateAddress, validateMoveIdentifier, validatePaginationCount, validateStructId } from "../helper/validation";


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
     * @param args.accountAddress - The address of the account to query.
     * @returns `true` if account exists otherwise `false`. The node reports an absent account with HTTP 404 on v12
     * and HTTP 400 with a "Resource not found" message on v11; both give `false`.
     * @throws Any other failure, such as an unreachable node, a timeout, a rate limit (HTTP 429) or a node fault
     * (HTTP 5xx), is thrown and does not mean the account is absent.
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
        validateAddress(args.accountAddress, "accountAddress");
        return isAccountExistsInternal(args, this.networkInformation);
    }

    /**
     * Queries the current state of an account, including its sequence number and authentication key.
     * @param args.accountAddress - The address of the account to query.
     * @returns A Promise that resolves to an AccountData object containing the sequence number and authentication key of the account.
     * @throws {SupraAPIError} For an account that does not exist: HTTP 404 on v12, HTTP 400 on v11. See "HTTP status
     * codes by node version" in the README.
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
        validateAddress(args.accountAddress, "accountAddress");
        return getAccountInfoInternal(args, this.networkInformation);
    }

    /**
     * Queries the modules of an account.
     * @param args.accountAddress - The address of the account to query.
     * @param args.options.count - The number of modules to return.
     * @param args.options.start - The `cursor` of the previous page. Omit it, or pass `undefined`, for the first page.
     * @returns A Promise that resolves to an array of MoveModuleBytecode objects representing the modules of the account with optional cursor.
     * `cursor` is `undefined` when there are no more modules; see {@link PaginatedResponse}.
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
        options?: { count?: number; start?: string | undefined };
    }): Promise<PaginatedResponse<MoveModuleBytecode[]>> {
        validateAddress(args.accountAddress, "accountAddress");
        validatePaginationCount(args.options?.count);
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
        validateAddress(args.accountAddress, "accountAddress");
        validateMoveIdentifier(args.moduleName, "moduleName");
        return getAccountModuleInternal(args, this.networkInformation);
    }



    /**
     * Queries the resources of an account.
     * @param args.accountAddress - The address of the account to query.
     * @param args.options.count - The number of resources to return.
     * @param args.options.start - The `cursor` of the previous page. Omit it, or pass `undefined`, for the first page.
     * @returns A Promise that resolves to an array of MoveResource objects representing the resources of the account with optional cursor.
     * `cursor` is `undefined` when there are no more resources; see {@link PaginatedResponse}.
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
        options?: { count?: number; start?: string | undefined };
    }): Promise<PaginatedResponse<MoveResource[]>> {
        validateAddress(args.accountAddress, "accountAddress");
        validatePaginationCount(args.options?.count);
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
    async getAccountResource<T extends object>(args: {
        accountAddress: AccountAddressInput;
        resourceType: MoveStructId;
    }): Promise<MoveResource<T>> {
        validateAddress(args.accountAddress, "accountAddress");
        validateStructId(args.resourceType, "resourceType");
        return getAccountResourceInternal<T>(args, this.networkInformation);
    }


    /**
     * Queries the transactions of an account.
     * @template {TransactionResponse} T - The type of the transaction to be returned.
     * @param args.accountAddress - The address of the account to query.
     * @param args.options.count - The number of transactions to return.
     * @param args.options.start - The sequence number to start from, inclusive in both orders, or the `cursor` of
     * the previous page. Omit it for the most recent transactions (descending) or the first ones (ascending).
     * @param args.options.ascending - Whether to return the transactions in ascending order.
     * @note Maximum number of items to return default is 20 and maximum is 100.
     * @note The node pages this feed by sequence number and sends no `x-supra-cursor` header. The SDK computes
     * `cursor` as the sequence number after the last transaction of the page in the requested order, so it is
     * passed back as `start` like the cursor of the other feeds. It is `undefined` when the page is empty, or ends
     * at sequence number 0 in descending order.
     * @returns A Promise that resolves to an array of TransactionResponse objects representing the transactions of the account with optional cursor.
     * The items are user transactions.
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
            start?: string | number | bigint | undefined;
            ascending?: boolean;
        };
    }): Promise<PaginatedResponse<T[]>> {
        validateAddress(args.accountAddress, "accountAddress");
        validatePaginationCount(args.options?.count);
        return getAccountTransactionsInternal<T>(args, this.networkInformation);
    }


    /**
     * Queries the coin transactions of an account.
     * @template {TransactionResponse} T - The type of the transaction to be returned.
     * @param args.accountAddress - The address of the account to query.
     * @param args.options.count - The number of transactions to return.
     * @param args.options.start - The `cursor` of the previous page, exclusive. Omit it, or pass `undefined`, for the first page.
     * @param args.options.ascending - Whether to return the transactions in ascending order.
     * @param args.options.type - Return only transactions of this type. `"settlement"` requires a node from v12
     * onwards; older nodes reject it with HTTP 400. A page filtered by type can be empty and still carry a cursor.
     * @note Maximum number of items to return default is 20 and maximum is 100.
     * @returns A Promise that resolves to an array of TransactionResponse objects representing the coin transactions of the account with optional cursor.
     * Items can be of any `txn_type`, including `settlement` items, which have no `header`, `payload` or
     * `authenticator`; narrow on `txn_type` before reading them. `cursor` is `undefined` when there are no more
     * transactions; see {@link PaginatedResponse}.
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
            start?: string | undefined;
            ascending?: boolean;
            type?: TransactionQueryType
        };
    }): Promise<PaginatedResponse<T[]>> {
        validateAddress(args.accountAddress, "accountAddress");
        validatePaginationCount(args.options?.count);
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
     * @param args.options.cursor - The `cursor` of the previous page, exclusive. Omit it, or pass `undefined`, for the first page.
     * If provided, returns :count of transactions starting from this cursor in the specified order. For order see :ascending flag.
     * If not specified, the lookup will be done based on the :block_height parameter value. 
     * @note If both :cursor and :block_height are specified then :cursor has precedence.
     * @param args.options.ascending - Whether to return the transactions in ascending order.
     * @note Maximum number of items to return default is 20 and maximum is 100.
     * @returns A Promise that resolves to an array of AutoTransactionResponse objects representing the auto transactions of the account with optional cursor.
     * `cursor` is `undefined` when there are no more transactions; see {@link PaginatedResponse}.
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
            cursor?: string | undefined;
            ascending?: boolean;
        };
    }): Promise<PaginatedResponse<T[]>> {
        validateAddress(args.accountAddress, "accountAddress");
        validatePaginationCount(args.options?.count);
        return getAccountAutoTransactionsInternal(args, this.networkInformation);
    }



    /**
     * Queries the number of coin types an account holds: the legacy coins (`CoinStore` resources of the account) plus
     * SUPRA when the account holds it as a fungible asset and has no `CoinStore<SupraCoin>` (an account that migrated
     * its SUPRA with `migrateCoinToFungibleStore` has none), so SUPRA counts once.
     * The node has no listing of an account's fungible asset stores, so fungible assets other than SUPRA are not
     * counted.
     * @param args.accountAddress - The address of the account to query.
     * @returns A Promise that resolves to the number of legacy coins plus one when SUPRA is held as a fungible asset only.
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
        validateAddress(args.accountAddress, "accountAddress");
        return getAccountCoinsCountInternal(args, this.networkInformation);
    }

    /**
     * Queries the total SUPRA balance of an account in quants: the `CoinStore<SupraCoin>` balance plus the balance of the
     * account's SUPRA fungible asset store (`0x1::coin::balance`, which includes the paired fungible asset). The value
     * is the SUPRA the account owns whichever form it is held in; {@link getAccountSupraBalance} reports the two
     * forms separately. A fungible asset transfer (`transferSupraFungibleAsset`) moves only the fungible asset
     * part.
     * @param args.accountAddress - The address of the account to query.
     * @returns A Promise that resolves to the total SUPRA balance of the account.
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
    }): Promise<bigint> {
        return this.getAccountCoinBalance({ accountAddress: args.accountAddress, asset: SUPRA_COIN_TYPE });
    }


    /**
     * Queries the SUPRA balance of an account in quants, in total and by the form in which it is held: as a legacy coin
     * (`CoinStore<SupraCoin>`) and as a fungible asset (the primary store of the SUPRA fungible asset `0xa`).
     * `total` is `0x1::coin::balance`, which already includes the fungible asset balance, so the two parts are not
     * added twice. The two values are read by separate requests.
     * @param args.accountAddress - The address of the account to query.
     * @returns A Promise that resolves to `{ total, coin, fungibleAsset }`.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *    const accountAddress = "0x1";
     *    const { total, coin, fungibleAsset } = await supra.account.getAccountSupraBalance({ accountAddress: accountAddress });
     *    console.log(total, coin, fungibleAsset);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Account
     */
    async getAccountSupraBalance(args: {
        accountAddress: AccountAddressInput;
    }): Promise<SupraBalance> {
        validateAddress(args.accountAddress, "accountAddress");
        return getAccountSupraBalanceInternal(args, this.networkInformation);
    }


    /**
     * Queries the balance of a coin or fungible asset owned by an account. What the balance covers depends on `asset`:
     *
     * - A coin type (`0x1::supra_coin::SupraCoin`): `0x1::coin::balance`, the `CoinStore` balance plus the balance of
     *   the paired fungible asset store.
     * - A fungible asset address (`0xa` for SUPRA): `0x1::primary_fungible_store::balance`, the account's primary store
     *   of that asset only. SUPRA held in a `CoinStore` is not included, so the balance of `0xa` is 0 for an account
     *   that has not migrated its SUPRA.
     * @param args.accountAddress - The address of the account to query.
     * @param args.asset - The coin type or the address of the fungible asset to query.
     * @returns A Promise that resolves to the balance of the coin or fungible asset owned by the account.
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
    }): Promise<bigint> {
        validateAddress(args.accountAddress, "accountAddress");
        return getAccountCoinBalanceInternal(args, this.networkInformation);
    }



}
