import { get } from "../client/get";
import type { PaginatedResponse } from "../types/account";
import type { Event, MoveFunctionId } from "../types/move";
import type { NetworkConfig } from "../utils/apiEndpoints";

export async function getEventsByTypeInternal(args: { eventType: MoveFunctionId, options: { startHeight?: number, endHeight?: number, limit?: number, start?: number } }, config: NetworkConfig): Promise<PaginatedResponse<Event[]>> {

    let { data, cursor } = await get<{ data: Event[] }>({
        path: `/events/${args.eventType}`,
        query: {
            start_height: args.options.startHeight,
            end_height: args.options.endHeight,
            limit: args.options.limit,
            start: args.options.start
        }
    }, config);

    return { response: data.data as Event[], cursor };
}