import { getTableItemInternal } from "../internal/table";
import type { AccountAddressInput } from "../types/account";
import type { TableItemRequest } from "../types/table";
import type { NetworkConfig } from "../utils/apiEndpoints";
import { validateAddress } from "../helper/validation";

/**
 * The Table class provides methods for querying table items on the Supra network.
 * @group Table
 */
export class Table {
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
     * @group Table
     */
    constructor(networkInformation: NetworkConfig) {
        this.networkInformation = networkInformation;
    }

    /**
     * Query a table item on Supra.
     * @template T - The type of the response data to be returned.
     * @param args.handle - The table handle.
     * @param args.data - The key type, the value type and the key of the item; see {@link TableItemRequest}.
     * @returns A Promise that resolves to the table item's value as the node returns it, without type conversion.
     * @throws {SupraAPIError} When the node rejects the handle, the key or the types (HTTP 400) or has no such item.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *    const handle = "0x1";
     *    const key = "0x1";
     *    const keyType = "address";
     *    const valueType = "u64";
     *    const tableItem = await supra.table.getTableItem({ handle: handle, data: { key_type: keyType, value_type: valueType, key: key }});
     *    console.log(tableItem);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Table
     */
    async getTableItem<T>(args: { handle: AccountAddressInput; data: TableItemRequest }): Promise<T> {
        validateAddress(args.handle, "handle");
        return getTableItemInternal<T>(args, this.networkInformation);
    }
}
