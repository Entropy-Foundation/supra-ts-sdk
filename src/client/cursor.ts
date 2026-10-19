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
 * - `"0"` on a page without items (coin transactions);
 * - the request's own cursor on a page without items (resources and modules).
 *
 * A page without items that carries any other cursor does not end the feed: the node read entries that the
 * request's filters excluded, and the next page continues after them.
 *
 * @param args.header - The `x-supra-cursor` header, `null` or `undefined` when it is absent.
 * @param args.sent - The cursor the request was sent with, if any.
 * @param args.itemCount - The number of items in the page.
 */
export function nextPageCursor(args: {
    header: string | null | undefined;
    sent: string | undefined;
    itemCount: number;
}): string | undefined {
    const { header, sent, itemCount } = args;
    if (header === undefined || header === null || header === "") {
        return undefined;
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
    const { cursorParam, ...request } = args;
    const sentValue = request.query[cursorParam];
    const sent = sentValue === undefined || sentValue === "" ? undefined : String(sentValue);
    const query = { ...request.query, [cursorParam]: sent };

    const { data, cursor: header } = await get<Res>({ ...request, query }, config);
    const response = items(data);
    return { response, cursor: nextPageCursor({ header, sent, itemCount: response.length }) };
}
