import type { MoveModule } from "../../src/index";

/**
 * Hand-written ABIs of two framework modules, containing the functions the end-to-end tests call
 * through `Contract.fromABI`. `as const` lets `fromABI` infer the typed proxy.
 */
export const COIN_ABI = {
    address: "0x1",
    name: "coin",
    friends: [],
    exposed_functions: [
        {
            name: "balance",
            visibility: "public",
            is_entry: false,
            is_view: true,
            generic_type_params: [{ constraints: [] }],
            params: ["address"],
            return: ["u64"],
        },
        {
            name: "transfer",
            visibility: "public",
            is_entry: true,
            is_view: false,
            generic_type_params: [{ constraints: [] }],
            params: ["&signer", "address", "u64"],
            return: [],
        },
    ],
    structs: [],
} as const satisfies MoveModule;

export const TIMESTAMP_ABI = {
    address: "0x1",
    name: "timestamp",
    friends: [],
    exposed_functions: [
        {
            name: "now_microseconds",
            visibility: "public",
            is_entry: false,
            is_view: true,
            generic_type_params: [],
            params: [],
            return: ["u64"],
        },
    ],
    structs: [],
} as const satisfies MoveModule;
