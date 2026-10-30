// Portions of this file are derived from @aptos-labs/ts-sdk (https://github.com/aptos-labs/aptos-ts-sdk),
// Copyright © Aptos Foundation, licensed under the Apache License, Version 2.0. See NOTICE.
import type { MoveStructId } from "./move";

/**
 * The key and value types for a table item.
 */
export type TableKeyValueTypeHelper<T extends string = string> =
    | "bool"
    | "u8"
    | "u16"
    | "u32"
    | "u64"
    | "u128"
    | "u256"
    | "address"
    | "signer"
    | `vector<${T}>`
    | MoveStructId;

// The final type
export type TableKeyValueType = TableKeyValueTypeHelper<TableKeyValueTypeHelper>;

/**
 * The request payload for the GetTableItem API.
 */
export type TableItemRequest = {
    /** The Move type of the table's keys. */
    key_type: TableKeyValueType;
    /** The Move type of the table's values. */
    value_type: TableKeyValueType;
    /**
     * The value of the table item's key, as JSON (a `u64` key is a string).
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    key: any;
};
