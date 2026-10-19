import { getPage } from "../client/cursor";
import type { PaginatedResponse } from "../types/account";
import type { Event, MoveFunctionId } from "../types/move";
import type { NetworkConfig } from "../utils/apiEndpoints";

export async function getEventsByTypeInternal(
    args: {
        eventType: MoveFunctionId;
        options: { startHeight?: number; endHeight?: number; limit?: number; start?: string | undefined };
    },
    config: NetworkConfig,
): Promise<PaginatedResponse<Event[]>> {
    return getPage<{ data: Event[] }, Event>(
        {
            path: `/events/${encodeURIComponent(args.eventType)}`,
            query: {
                start_height: args.options.startHeight,
                end_height: args.options.endHeight,
                limit: args.options.limit,
                start: args.options.start,
            },
            cursorParam: "start",
        },
        config,
        (data) => data.data,
    );
}
