import { getPage } from "../client/cursor";
import { get } from "../client/get";
import { SupraAPIError, SupraNotFoundError, SupraRouteUnsupportedError } from "../errors/apiError";
import { standardizeAddress } from "../helper/account";
import { isMoveStruct } from "../helper/general";
import type {
    AccountAddressInput,
    AccountData,
    AccountHistoryCategory,
    AccountHistoryEntry,
    AccountHistoryPage,
    PaginatedResponse,
    SupraBalance,
} from "../types/account";
import type { MoveModuleBytecode, MoveResource, MoveStructId } from "../types/move";
import type {
    AutoTransactionResponse,
    CommittedTransactionResponse,
    TransactionQueryType,
    TransactionResponse,
} from "../types/transaction";
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

export async function getAccountInfoInternal(
    args: { accountAddress: AccountAddressInput },
    config: NetworkConfig,
): Promise<AccountData> {
    // The node reports the sequence number as a JSON number.
    const { data } = await get<{ sequence_number: number | string; authentication_key: string }>(
        {
            path: `/accounts/${standardizeAddress(args.accountAddress)}`,
        },
        config,
    );

    return {
        sequence_number: BigInt(data.sequence_number),
        authentication_key: data.authentication_key,
    };
}

export async function getAccountModulesInternal(
    args: {
        accountAddress: AccountAddressInput;
        options?: { count?: number; start?: string | undefined };
    },
    config: NetworkConfig,
): Promise<PaginatedResponse<MoveModuleBytecode[]>> {
    return getPage<MoveModuleBytecode[], MoveModuleBytecode>(
        {
            path: `/accounts/${standardizeAddress(args.accountAddress)}/modules`,
            query: {
                count: args.options?.count,
                start: args.options?.start,
            },
            cursorParam: "start",
        },
        config,
        (data) => data,
    );
}

export async function getAccountModuleInternal(
    args: {
        accountAddress: AccountAddressInput;
        moduleName: string;
    },
    config: NetworkConfig,
): Promise<MoveModuleBytecode> {
    return (
        await get<MoveModuleBytecode>(
            {
                path: `/accounts/${standardizeAddress(args.accountAddress)}/modules/${encodeURIComponent(args.moduleName)}`,
            },
            config,
        )
    ).data;
}

export async function getAccountResourcesInternal(
    args: {
        accountAddress: AccountAddressInput;
        options?: { count?: number; start?: string | undefined };
    },
    config: NetworkConfig,
): Promise<PaginatedResponse<MoveResource[]>> {
    return getPage<MoveResource[], MoveResource>(
        {
            path: `/accounts/${standardizeAddress(args.accountAddress)}/resources`,
            query: {
                count: args.options?.count,
                start: args.options?.start,
            },
            cursorParam: "start",
        },
        config,
        (data) => data,
    );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getAccountResourceInternal<T extends object = any>(
    args: {
        accountAddress: AccountAddressInput;
        resourceType: MoveStructId;
    },
    config: NetworkConfig,
): Promise<MoveResource<T>> {
    return (
        await get<MoveResource<T>>(
            {
                path: `/accounts/${standardizeAddress(args.accountAddress)}/resources/${encodeURIComponent(args.resourceType)}`,
            },
            config,
        )
    ).data;
}

/**
 * The cursor of the next page of `/accounts/{address}/transactions`, which the node pages by sequence number
 * (inclusive in both orders) and without an `x-supra-cursor` header: the sequence number after the last item in
 * the requested order, as a decimal string, or `undefined` when the page is empty or ends at sequence number 0
 * in descending order.
 */
export function nextSequenceNumberCursor(
    items: readonly TransactionResponse[],
    ascending: boolean,
): string | undefined {
    const last = items[items.length - 1];
    if (last === undefined || !("header" in last)) {
        return undefined;
    }
    const sequenceNumber = BigInt(last.header.sequence_number);
    if (ascending) {
        return (sequenceNumber + 1n).toString();
    }
    return sequenceNumber === 0n ? undefined : (sequenceNumber - 1n).toString();
}

export async function getAccountTransactionsInternal<T extends TransactionResponse = TransactionResponse>(
    args: {
        accountAddress: AccountAddressInput;
        options?: {
            count?: number;
            start?: string | number | bigint | undefined;
            ascending?: boolean;
        };
    },
    config: NetworkConfig,
): Promise<PaginatedResponse<T[]>> {
    const start = args.options?.start;
    const ascending = args.options?.ascending ?? false;
    const { data } = await get<T[]>(
        {
            path: `/accounts/${standardizeAddress(args.accountAddress)}/transactions`,
            query: {
                count: args.options?.count,
                start: start === undefined || start === "" ? undefined : String(start),
                ascending: args.options?.ascending,
            },
        },
        config,
    );

    return { response: data, cursor: nextSequenceNumberCursor(data, ascending) };
}

export async function getAccountCoinTransactionsInternal<T extends TransactionResponse = TransactionResponse>(
    args: {
        accountAddress: AccountAddressInput;
        options?: {
            count?: number;
            start?: string | undefined;
            ascending?: boolean;
            type?: TransactionQueryType;
        };
    },
    config: NetworkConfig,
): Promise<PaginatedResponse<T[]>> {
    return getPage<T[], T>(
        {
            path: `/accounts/${standardizeAddress(args.accountAddress)}/coin_transactions`,
            query: {
                count: args.options?.count,
                start: args.options?.start,
                ascending: args.options?.ascending,
                type: args.options?.type,
            },
            cursorParam: "start",
        },
        config,
        (data) => data,
    );
}

/**
 * Reads `/accounts/{address}/fa_transactions`. The end of the feed is read as for `coin_transactions`, see
 * {@link nextPageCursor}.
 */
export async function getAccountFaTransactionsInternal<T extends TransactionResponse = TransactionResponse>(
    args: {
        accountAddress: AccountAddressInput;
        options?: {
            count?: number;
            start?: string | undefined;
            ascending?: boolean;
            type?: TransactionQueryType;
        };
    },
    config: NetworkConfig,
): Promise<PaginatedResponse<T[]>> {
    return getPage<T[], T>(
        {
            path: `/accounts/${standardizeAddress(args.accountAddress)}/fa_transactions`,
            query: {
                count: args.options?.count,
                start: args.options?.start,
                ascending: args.options?.ascending,
                type: args.options?.type,
            },
            cursorParam: "start",
        },
        config,
        (data) => data,
    );
}

/** Minimum node release that serves `/accounts/{address}/history`. */
export const ACCOUNT_HISTORY_MIN_NODE_RELEASE = "supra_node_v12.0.0";

function heightHeader(headers: Headers | undefined, name: string): number | undefined {
    const value = headers?.get(name);
    if (value === undefined || value === null || !/^\d+$/.test(value)) {
        return undefined;
    }
    return Number(value);
}

/**
 * Reads `/accounts/{address}/history`. The feed ends only when the response has no `x-supra-cursor` header: a page
 * can be empty and carry a cursor, and `"0"` is a valid cursor. A 404 means the node is older than v12 and is
 * thrown as {@link SupraRouteUnsupportedError}.
 */
export async function getAccountHistoryInternal<T extends CommittedTransactionResponse = CommittedTransactionResponse>(
    args: {
        accountAddress: AccountAddressInput;
        options?: {
            categories?: readonly AccountHistoryCategory[];
            count?: number;
            ascending?: boolean;
            start?: string | undefined;
        };
    },
    config: NetworkConfig,
): Promise<AccountHistoryPage<T>> {
    const start = args.options?.start;
    const categories = args.options?.categories;
    let result;
    try {
        result = await get<AccountHistoryEntry<T>[]>(
            {
                path: `/accounts/${standardizeAddress(args.accountAddress)}/history`,
                query: {
                    categories: categories === undefined ? undefined : categories.join(","),
                    count: args.options?.count,
                    ascending: args.options?.ascending,
                    start: start === undefined || start === "" ? undefined : start,
                },
            },
            config,
        );
    } catch (error) {
        if (error instanceof SupraNotFoundError && !(error instanceof SupraRouteUnsupportedError)) {
            throw new SupraRouteUnsupportedError({
                status: error.status,
                statusText: error.statusText,
                url: error.url,
                data: error.data,
                method: "getAccountHistory",
                minimumNodeRelease: ACCOUNT_HISTORY_MIN_NODE_RELEASE,
            });
        }
        throw error;
    }

    const { data, cursor, headers } = result;
    return {
        response: data,
        cursor: cursor === undefined || cursor === "" ? undefined : cursor,
        indexedFrom: heightHeader(headers, "x-supra-history-indexed-from"),
        oldestBlock: heightHeader(headers, "x-supra-oldest-block"),
    };
}

export async function getAccountAutoTransactionsInternal<T extends AutoTransactionResponse = AutoTransactionResponse>(
    args: {
        accountAddress: AccountAddressInput;
        options?: {
            count?: number;
            block_height?: number;
            cursor?: string | undefined;
            ascending?: boolean;
        };
    },
    config: NetworkConfig,
): Promise<PaginatedResponse<T[]>> {
    return getPage<T[], T>(
        {
            path: `/accounts/${standardizeAddress(args.accountAddress)}/automated_transactions`,
            query: {
                count: args.options?.count,
                block_height: args.options?.block_height,
                cursor: args.options?.cursor,
                ascending: args.options?.ascending,
            },
            cursorParam: "cursor",
        },
        config,
        (data) => data,
    );
}

export async function getAccountCoinsCountInternal(
    args: {
        accountAddress: AccountAddressInput;
    },
    config: NetworkConfig,
): Promise<number> {
    let cursor: string | undefined;
    let legacyTokensCount = 0;
    let hasSupraCoinStore = false;

    do {
        const page = await getAccountResourcesInternal(
            { accountAddress: args.accountAddress, options: { start: cursor } },
            config,
        );
        const tokens = getAccountLegacyCoins(page.response);
        legacyTokensCount += Object.keys(tokens).length;
        hasSupraCoinStore ||= `0x1::coin::CoinStore<${SUPRA_COIN_TYPE}>` in tokens;
        cursor = page.cursor;
    } while (cursor !== undefined);

    // The SUPRA primary fungible store counts as SUPRA once an account has no SUPRA coin store (migrated accounts).
    if (!hasSupraCoinStore && (await getAccountHasSupraFungibleStoreInternal(args, config))) {
        legacyTokensCount += 1;
    }

    return legacyTokensCount;
}

async function getAccountHasSupraFungibleStoreInternal(
    args: { accountAddress: AccountAddressInput },
    config: NetworkConfig,
): Promise<boolean> {
    return await viewInternal<[boolean]>(
        {
            function: "0x1::primary_fungible_store::primary_store_exists",
            functionArguments: [args.accountAddress.toString(), SUPRA_FUNGIBLE_ASSET_ADDRESS],
            typeArguments: [OBJECT_CORE],
        },
        config,
    ).then((res) => res[0]);
}

/**
 * Reads the SUPRA balance of an account in both forms. `0x1::coin::balance` returns the sum of the `CoinStore`
 * balance and the balance of the paired fungible asset store; `0x1::primary_fungible_store::balance` returns the
 * fungible asset store only.
 */
export async function getAccountSupraBalanceInternal(
    args: { accountAddress: AccountAddressInput },
    config: NetworkConfig,
): Promise<SupraBalance> {
    const [total, fungibleAsset] = await Promise.all([
        getAccountCoinBalanceInternal({ accountAddress: args.accountAddress, asset: SUPRA_COIN_TYPE }, config),
        getAccountCoinBalanceInternal(
            { accountAddress: args.accountAddress, asset: SUPRA_FUNGIBLE_ASSET_ADDRESS },
            config,
        ),
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
    config: NetworkConfig,
): Promise<bigint> {
    if (isMoveStruct(args.asset.toString())) {
        return await viewInternal<[bigint]>(
            {
                function: "0x1::coin::balance",
                functionArguments: [args.accountAddress.toString()],
                typeArguments: [args.asset.toString()],
            },
            config,
        ).then((res) => res[0]);
    } else {
        return await viewInternal<[bigint]>(
            {
                function: "0x1::primary_fungible_store::balance",
                functionArguments: [args.accountAddress.toString(), args.asset.toString()],
                typeArguments: [OBJECT_CORE],
            },
            config,
        ).then((res) => res[0]);
    }
}

/**
 * Whether the account exists. Only the node's answer for an absent account is `false`: HTTP 404 on v12 nodes, and
 * on v11 nodes HTTP 400 with a "Resource not found" message (a v11 node also answers 400 for its own faults). Any
 * other failure is thrown.
 */
export async function isAccountExistsInternal(
    args: { accountAddress: AccountAddressInput },
    config: NetworkConfig,
): Promise<boolean> {
    try {
        await getAccountInfoInternal({ accountAddress: args.accountAddress }, config);

        return true;
    } catch (error) {
        if (error instanceof SupraAPIError && isAbsentAccountAnswer(error)) {
            return false;
        }

        throw error;
    }
}

function isAbsentAccountAnswer(error: SupraAPIError): boolean {
    if (error.status === 404) {
        return true;
    }
    if (error.status !== 400) {
        return false;
    }
    const message = (error.data as { message?: unknown } | null | undefined)?.message;
    return typeof message === "string" && /resource not found/i.test(message);
}
