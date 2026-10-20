import type { PaginatedResponse } from "../types/account";
import type { NetworkConfig } from "../utils/apiEndpoints";
import type { Event, MoveFunctionId } from "../types/move";
import { getEventsByTypeInternal } from "../internal/events";
import { validatePaginationCount, validateStructId } from "../helper/validation";

/**
 * The Events class provides methods for fetching events on the Supra network.
 * @group Events
 */
export class Events {


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
    * @group Events
    */
    constructor(networkInformation: NetworkConfig) {
        this.networkInformation = networkInformation;
    }


    /**
     * Get the events of the given type.
     * @param args.eventType - Type of event
     * @param args.options - The options object is required and can be empty.
     * @param args.options.startHeight - Starting block height (inclusive)
     * @param args.options.endHeight - Ending block height (exclusive)
     * @param args.options.limit - Maximum number of events to return. Defaults to 20, max 100.
     * @param args.options.start - The `cursor` of the previous page, a hex string. Omit it, or pass `undefined`, for the first page.
     * @returns A Promise that resolves to an array of events, with the cursor of the next page. `cursor` is
     * `undefined` when there are no more events; a page can hold fewer than `limit` events and still carry a
     * cursor. See {@link PaginatedResponse}.
     * @throws {SupraAPIError} HTTP 410 when the requested heights have been pruned from the node.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     *    const eventType = "0x1::coin::Transfer";
     *    const {response: events, cursor} = await supra.events.getEventsByType({ eventType: eventType, options: {} });
     *    console.log(events);
     * }
     * 
     * runExample().catch(console.error); 
     * ```
     * @group Events
     */
    async getEventsByType(args: { eventType: MoveFunctionId, options: { startHeight?: number, endHeight?: number, limit?: number, start?: string | undefined } }): Promise<PaginatedResponse<Event[]>> {
        validateStructId(args.eventType, "eventType");
        validatePaginationCount(args.options?.limit, "limit");
        return getEventsByTypeInternal(args, this.networkInformation);
    }
}