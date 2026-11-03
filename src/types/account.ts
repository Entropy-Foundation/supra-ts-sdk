// Portions of this file are derived from @aptos-labs/ts-sdk (https://github.com/aptos-labs/aptos-ts-sdk),
// Copyright © Aptos Foundation, licensed under the Apache License, Version 2.0. See NOTICE.
import type { HexString } from "supra-l1-sdk-core";
import type { CommittedTransactionResponse } from "./transaction";

/**
 * The data associated with an account, including its sequence number.
 */
export interface AccountData {
    /**
     * The sequence number of the account, a `u64`. The node sends it as a JSON number; the SDK converts it.
     */
    sequence_number: bigint;
    /**
     * The authentication key of the account.
     */
    authentication_key: string;
}

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
 * import { Network, SupraClient } from "supra-ts-sdk";
 *
 * const supra = new SupraClient({ network: Network.TESTNET });
 * const accountAddress = "0x1";
 *
 * let cursor: string | undefined;
 * do {
 *     const page = await supra.account.getAccountResources({ accountAddress, options: { start: cursor } });
 *     console.log(page.response.length);
 *     cursor = page.cursor;
 * } while (cursor !== undefined);
 * ```
 *
 * - `cursor` is `undefined` exactly when the feed has no further items. The SDK reads the end of the feed the same
 *   way from every node version: v12 nodes omit the `x-supra-cursor` header, and v11 nodes send an empty header,
 *   `"0"` or the request's own cursor on an empty page. For `getAccountCoinTransactions` and
 *   `getAccountFaTransactions`, an ascending read with a `type` filter and no `start` that returns an empty page
 *   with `"0"` continues with `"0"`, because the node's first row can have the cursor 0.
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
    response: T;
    /**
     * The cursor of the next page, or `undefined` when there are no more results.
     */
    cursor?: string | undefined;
}

/**
 * A category of an account's transaction history:
 * - `sent`: the account sent the transaction;
 * - `coin`: the transaction withdrew coins from or deposited coins to the account;
 * - `fa`: the transaction withdrew from or deposited to a fungible asset store that the account owned at that
 *   point in its block;
 * - `da`: a digital asset or object event of the transaction names the account.
 */
export type AccountHistoryCategory = "sent" | "coin" | "fa" | "da";

/**
 * One transaction of an account's history.
 * @template T - The type of the transaction.
 */
export interface AccountHistoryEntry<T extends CommittedTransactionResponse = CommittedTransactionResponse> {
    /** The categories the transaction matched for the account, in the order `sent`, `coin`, `fa`, `da`. */
    categories: AccountHistoryCategory[];
    /** The transaction, in the shape the block and transaction queries return. */
    transaction: T;
}

/**
 * A page of an account's transaction history: {@link PaginatedResponse} of {@link AccountHistoryEntry} items, with
 * the headers of the response that describe the coverage of the history.
 * @template T - The type of the transactions.
 */
export interface AccountHistoryPage<
    T extends CommittedTransactionResponse = CommittedTransactionResponse,
> extends PaginatedResponse<AccountHistoryEntry<T>[]> {
    /**
     * The lowest block height the account history covers (`x-supra-history-indexed-from`), or `undefined` when the
     * history covers every block the node holds. The transactions of the blocks below it are not listed.
     */
    indexedFrom?: number | undefined;
    /** The height of the oldest block the node holds (`x-supra-oldest-block`), or `undefined` when the node sends none. */
    oldestBlock?: number | undefined;
}
