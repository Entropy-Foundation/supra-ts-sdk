import type { PaginatedResponse } from "../types/account";
import type { NetworkConfig } from "../utils/apiEndpoints";
import { get, type RequestParams } from "./get";

/**
 * Returns the cursor of the next page of a feed from the `x-supra-cursor` header of a response, or `undefined`
 * when the response ends the feed.
 *
 * A node from v12 onwards ends a feed by omitting the header. A v11 node ends it with one of these values, each
 * of which is read as the end of the feed:
 * - an empty header (events, automated transactions, and the resources or modules of an account without any);
 * - `"0"` on a page without items (coin and fungible asset transactions);
 * - the request's own cursor on a page without items (resources and modules).
 *
 * A page without items that carries any other cursor does not end the feed: the node read entries that the
 * request's filters excluded, and the next page continues after them.
 *
 * `"0"` is also a valid cursor: block 0 has timestamp 0, so the first row of a store funded at genesis has the
 * cursor 0. A node returns the cursor of the last row it read, so a `type` filter that excludes that row leaves an
 * empty page with `"0"`. For the first request of an ascending read with a `type` filter, `zeroContinues` keeps the
 * `"0"`, and the next request continues with `start=0`. A v12 node scans after `start`; a v11 node skips the first
 * row it reads from `start=0`, which is that same row. On a feed without rows both nodes answer the request with
 * `start=0` with `"0"` again, which the echo rule above ends, so the rule costs at most one more request.
 *
 * @param args.header - The `x-supra-cursor` header, `null` or `undefined` when it is absent.
 * @param args.sent - The cursor the request was sent with, if any.
 * @param args.itemCount - The number of items in the page.
 * @param args.zeroContinues - Whether the request had no cursor, was ascending and carried a `type` filter.
 */
export function nextPageCursor(args: {
    header: string | null | undefined;
    sent: string | undefined;
    itemCount: number;
    zeroContinues?: boolean;
}): string | undefined {
    const { header, sent, itemCount, zeroContinues } = args;
    if (header === undefined || header === null || header === "") {
        return undefined;
    }
    if (itemCount === 0 && header === "0" && zeroContinues === true) {
        return header;
    }
    if (itemCount === 0 && (header === "0" || header === sent)) {
        return undefined;
    }
    return header;
}

/**
 * A request for one page of a feed paginated by `x-supra-cursor`.
 */
export interface PageRequestParams extends RequestParams {
    query: Record<string, string | number | boolean | undefined>;
    /** The query parameter that carries the cursor: `start` for most feeds, `cursor` for automated transactions. */
    cursorParam: string;
    /**
     * Set for a feed whose cursor `"0"` can be the position of a genesis row (coin and fungible asset transactions).
     * See `zeroContinues` of {@link nextPageCursor}.
     */
    zeroMayBeCursor?: boolean;
}

/**
 * Requests one page of a feed paginated by `x-supra-cursor`, and returns its items with the cursor of the next
 * page as computed by {@link nextPageCursor}. An empty cursor in the request is not sent.
 *
 * @param items - Extracts the items from the response body.
 */
export async function getPage<Res, Item>(
    args: PageRequestParams,
    config: NetworkConfig,
    items: (data: Res) => Item[],
): Promise<PaginatedResponse<Item[]>> {
    const { cursorParam, zeroMayBeCursor, ...request } = args;
    const sentValue = request.query[cursorParam];
    const sent = sentValue === undefined || sentValue === "" ? undefined : String(sentValue);
    const query = { ...request.query, [cursorParam]: sent };
    const zeroContinues =
        zeroMayBeCursor === true && sent === undefined && query["ascending"] === true && query["type"] !== undefined;

    const { data, cursor: header } = await get<Res>({ ...request, query }, config);
    const response = items(data);
    return { response, cursor: nextPageCursor({ header, sent, itemCount: response.length, zeroContinues }) };
}
