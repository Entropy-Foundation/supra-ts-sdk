import { post } from "../client/post";
import type { AccountAddressInput } from "../types/account";
import type { TableItemRequest } from "../types/table";
import type { NetworkConfig } from "../utils/apiEndpoints";


/**
 * Query a table item on Supra.
 */
export async function getTableItemInternal<T>(
    args: { handle: AccountAddressInput; data: TableItemRequest; },
    config: NetworkConfig
): Promise<T> {
    return await post<TableItemRequest, T>({
        path: `tables/${args.handle}/item`,
        data: args.data
    }, config).then(res => res);
}