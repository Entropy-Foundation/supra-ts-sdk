import type { HexString } from "supra-l1-sdk-core";

/**
 * The data associated with an account, including its sequence number.
 */
export interface AccountData{
    /**
     * The sequence number of the account, a `u64`. The node sends it as a JSON number; the SDK converts it.
     */
    sequence_number: bigint;
    /**
     * The authentication key of the account.
     */
    authentication_key: string;
};


/**
 * The SUPRA balance of an account in quants, in total and by the form in which it is held. SUPRA is held as a legacy
 * coin (a `CoinStore` resource), as a fungible asset (the account's primary store of the SUPRA fungible asset), or both.
 */
export interface SupraBalance {
    /** The SUPRA the account owns in either form: `coin + fungibleAsset`. */
    total: bigint;
    /** The SUPRA held in the account's `CoinStore<SupraCoin>` resource. */
    coin: bigint;
    /** The SUPRA held in the account's primary store of the SUPRA fungible asset. */
    fungibleAsset: bigint;
}


/**
 * The address of an account. which can be a string or a HexString
 */
export type AccountAddressInput = string | HexString;


/**
 * One page of a feed, with the cursor of the next page.
 *
 * Read a feed to its end by passing `cursor` back as the method's `start` (or `cursor`) option until it is
 * `undefined`:
 *
 * ```typescript
 * let cursor: string | undefined;
 * do {
 *     const page = await supra.account.getAccountResources({ accountAddress, options: { start: cursor } });
 *     handle(page.response);
 *     cursor = page.cursor;
 * } while (cursor !== undefined);
 * ```
 *
 * - `cursor` is `undefined` exactly when the feed has no further items. The SDK reads the end of the feed the same
 *   way from every node version: v12 nodes omit the `x-supra-cursor` header, and v11 nodes send an empty header,
 *   `"0"` or the request's own cursor on an empty page.
 * - A page can be empty and still carry a cursor, for example when a `type` filter excluded every transaction
 *   the node read for the page. Continue from the cursor; only `undefined` ends the feed.
 * - The last page that lists items usually carries a cursor, and the request that continues from it returns an
 *   empty page with `cursor` `undefined`.
 * - A cursor is opaque. Pass it back unchanged, to the same method with the same filters and order.
 *
 * @template T - The type of the response data to be returned.
 */
export interface PaginatedResponse<T> {
    /**
     * The items of this page. It can be empty when `cursor` is defined.
     */
    response: T,
    /**
     * The cursor of the next page, or `undefined` when there are no more results.
     */
    cursor?: string | undefined
}
