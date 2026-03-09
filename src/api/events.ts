import type { PaginatedResponse } from "../types/account";
import type { NetworkConfig } from "../utils/apiEndpoints";
import type { Event, MoveFunctionId } from "../types/move";
import { getEventsByTypeInternal } from "../internal/events";

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
    * @group Faucet
    */
    constructor(networkInformation: NetworkConfig) {
        this.networkInformation = networkInformation;
    }


    /**
     * Get coin info of the given coin type
     * @param args.eventType - Type of event
     * @param args.options.startHeight - Starting block height (inclusive)
     * @param args.options.endHeight - Ending block height (exclusive)
     * @param args.options.limit - Maximum number of events to return. Defaults to 20, max 100.
     * @param args.options.start - Cursor specifying where to start for pagination. Use the cursor returned by the previous request when making the next request.
     * @returns A Promise that resolves to an array of events.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     *    const eventType = "0x1::coin::Transfer";
     *    const {response: events, cursor} = await supra.events.getEventByType({ eventType: eventType });
     *    console.log(events);
     * }
     * 
     * runExample().catch(console.error); 
     * ```
     * @group Events
     */
    async getEventsByType(args: { eventType: MoveFunctionId, options: { startHeight?: number, endHeight?: number, limit?: number, start?: number } }): Promise<PaginatedResponse<Event[]>> {
        return getEventsByTypeInternal(args, this.networkInformation);
    }
}