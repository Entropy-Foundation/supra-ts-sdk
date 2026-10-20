import { get } from "../client/get";
import { standardizeAddress } from "../helper/account";
import { isMoveStruct } from "../helper/general";
import type { AccountAddressInput, AccountData, PaginatedResponse, SupraBalance } from "../types/account";
import type { MoveModuleBytecode, MoveResource, MoveStructId } from "../types/move";
import type { AutoTransactionResponse, TransactionQueryType, TransactionResponse } from "../types/transaction";
import type { NetworkConfig } from "../utils/apiEndpoints";
import { OBJECT_CORE, SUPRA_COIN_TYPE, SUPRA_FUNGIBLE_ASSET_ADDRESS } from "../utils/constants";
import { viewInternal } from "./methods";

export function getAccountLegacyCoins(resources: MoveResource[]) {
    return resources
        .filter((resource) => resource.type.startsWith("0x1::coin::CoinStore<"))
        .reduce<Record<string, string>>((acc, resource) => {
            const data = resource.data as { coin: { value: string } };
            acc[resource.type] = data.coin.value;
            return acc;
        }, {});
}


export async function getAccountInfoInternal(args: { accountAddress: AccountAddressInput }, config: NetworkConfig): Promise<AccountData> {

    return (await get<AccountData>({
        path: `/accounts/${standardizeAddress(args.accountAddress)}`,
    }, config)).data;

}


export async function getAccountModulesInternal(
    args: {
        accountAddress: AccountAddressInput;
        options?: { count?: number; start?: string };
    },
    config: NetworkConfig
): Promise<PaginatedResponse<MoveModuleBytecode[]>> {

    let { data, cursor } = await get<MoveModuleBytecode[]>({
        path: `/accounts/${standardizeAddress(args.accountAddress)}/modules`,
        query: {
            count: args.options?.count,
            start: args.options?.start
        }
    }, config);

    return { response: data, cursor };
}


export async function getAccountModuleInternal(
    args: {
        accountAddress: AccountAddressInput;
        moduleName: string;
    },
    config: NetworkConfig
): Promise<MoveModuleBytecode> {
    return (await get<MoveModuleBytecode>({
        path: `/accounts/${standardizeAddress(args.accountAddress)}/modules/${encodeURIComponent(args.moduleName)}`,
    }, config)).data;
}


export async function getAccountResourcesInternal(
    args: {
        accountAddress: AccountAddressInput;
        options?: { count?: number; start?: string };
    },
    config: NetworkConfig
): Promise<PaginatedResponse<MoveResource[]>> {
    let { data, cursor } = await get<MoveResource[]>({
        path: `/accounts/${standardizeAddress(args.accountAddress)}/resources`,
        query: {
            count: args.options?.count,
            start: args.options?.start
        }
    }, config);

    return { response: data, cursor };
}


// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getAccountResourceInternal<T extends object = any>(
    args: {
        accountAddress: AccountAddressInput;
        resourceType: MoveStructId;
    },
    config: NetworkConfig
): Promise<MoveResource<T>> {
    return (await get<MoveResource<T>>({
        path: `/accounts/${standardizeAddress(args.accountAddress)}/resources/${encodeURIComponent(args.resourceType)}`,
    }, config)).data;
}



export async function getAccountTransactionsInternal<T extends TransactionResponse = TransactionResponse>(
    args: {
        accountAddress: AccountAddressInput;
        options?: {
            count?: number;
            start?: string;
            ascending?: boolean;
        };
    },
    config: NetworkConfig
): Promise<PaginatedResponse<T[]>> {
    let { data, cursor } = await get<T[]>({
        path: `/accounts/${standardizeAddress(args.accountAddress)}/transactions`,
        query: {
            count: args.options?.count,
            start: args.options?.start,
            ascending: args.options?.ascending
        }
    }, config);

    return { response: data, cursor };
}


export async function getAccountCoinTransactionsInternal<T extends TransactionResponse = TransactionResponse>(
    args: {
        accountAddress: AccountAddressInput;
        options?: {
            count?: number;
            start?: string;
            ascending?: boolean;
            type?: TransactionQueryType
        };
    },
    config: NetworkConfig
): Promise<PaginatedResponse<T[]>> {
    let { data, cursor } = await get<T[]>({
        path: `/accounts/${standardizeAddress(args.accountAddress)}/coin_transactions`,
        query: {
            count: args.options?.count,
            start: args.options?.start,
            ascending: args.options?.ascending,
            type: args.options?.type

        }
    }, config);

    return { response: data, cursor };
}


export async function getAccountAutoTransactionsInternal<T extends AutoTransactionResponse = AutoTransactionResponse>(
    args: {
        accountAddress: AccountAddressInput;
        options?: {
            count?: number;
            block_height?: number;
            cursor?: string;
            ascending?: boolean;
        };
    },
    config: NetworkConfig
): Promise<PaginatedResponse<T[]>> {
    let { data, cursor } = await get<T[]>({
        path: `/accounts/${standardizeAddress(args.accountAddress)}/automated_transactions`,
        query: {
            count: args.options?.count,
            block_height: args.options?.block_height,
            cursor: args.options?.cursor,
            ascending: args.options?.ascending
        }
    }, config);

    return { response: data, cursor };
}


export async function getAccountCoinsCountInternal(
    args: {
        accountAddress: AccountAddressInput;
    },
    config: NetworkConfig
): Promise<number> {
    let cursor: string | undefined = "";
    let legacyTokensCount = 0;
    let hasSupraCoinStore = false;

    while (cursor !== undefined) {

        let { response: resources, cursor: cursorInfo } = await getAccountResourcesInternal({ accountAddress: args.accountAddress, options: cursor ? { start: cursor } : {} }, config);

        // get legacy tokens list from the resources
        let tokens = getAccountLegacyCoins(resources);

        if (cursorInfo != cursor) {
            cursor = cursorInfo;
        } else {
            cursor = undefined;
        }

        legacyTokensCount += Object.keys(tokens).length;
        hasSupraCoinStore ||= `0x1::coin::CoinStore<${SUPRA_COIN_TYPE}>` in tokens;

    }

    // The SUPRA primary fungible store counts as SUPRA once an account has no SUPRA coin store (migrated accounts).
    if (!hasSupraCoinStore && (await getAccountHasSupraFungibleStoreInternal(args, config))) {
        legacyTokensCount += 1;
    }

    return legacyTokensCount;
}


async function getAccountHasSupraFungibleStoreInternal(
    args: { accountAddress: AccountAddressInput },
    config: NetworkConfig
): Promise<boolean> {
    return await viewInternal<[boolean]>({
        function: "0x1::primary_fungible_store::primary_store_exists",
        functionArguments: [args.accountAddress.toString(), SUPRA_FUNGIBLE_ASSET_ADDRESS],
        typeArguments: [OBJECT_CORE]
    }, config).then(res => res[0]);
}


/**
 * Reads the SUPRA balance of an account in both forms. `0x1::coin::balance` returns the sum of the `CoinStore`
 * balance and the balance of the paired fungible asset store; `0x1::primary_fungible_store::balance` returns the
 * fungible asset store only.
 */
export async function getAccountSupraBalanceInternal(
    args: { accountAddress: AccountAddressInput },
    config: NetworkConfig
): Promise<SupraBalance> {
    const [total, fungibleAsset] = await Promise.all([
        getAccountCoinBalanceInternal({ accountAddress: args.accountAddress, asset: SUPRA_COIN_TYPE }, config),
        getAccountCoinBalanceInternal({ accountAddress: args.accountAddress, asset: SUPRA_FUNGIBLE_ASSET_ADDRESS }, config),
    ]);
    // The two reads can straddle a block; the coin part is never reported as negative.
    const coin = total > fungibleAsset ? total - fungibleAsset : BigInt(0);
    return { total, coin, fungibleAsset };
}


export async function getAccountCoinBalanceInternal(
    args: {
        accountAddress: AccountAddressInput;
        asset: MoveStructId | AccountAddressInput;
    },
    config: NetworkConfig
): Promise<bigint> {

    if (isMoveStruct(args.asset.toString())) {
        return await viewInternal<[bigint]>({
            function: "0x1::coin::balance",
            functionArguments: [args.accountAddress.toString()],
            typeArguments: [args.asset.toString()]
        }, config).then(res => res[0]);
    } else {
        return await viewInternal<[bigint]>({
            function: "0x1::primary_fungible_store::balance",
            functionArguments: [args.accountAddress.toString(), args.asset.toString()],
            typeArguments: [OBJECT_CORE]
        }, config).then(res => res[0]);
    }

}


export async function isAccountExistsInternal(args: { accountAddress: AccountAddressInput }, config: NetworkConfig): Promise<boolean> {

    try {

        await getAccountInfoInternal({ accountAddress: args.accountAddress }, config);

        return true;

    } catch {

        // account not found
        return false;
    }

}