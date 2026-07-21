/**
 * A minimal, hand-written ABI for the framework `0x1::coin` module, containing
 * just the `balance` view function and the `transfer` entry function used by
 * `contract.ts`.
 *
 * In a real app you would fetch the full ABI on-chain instead of hard-coding it:
 *
 *   const mod = await supra.account.getAccountModule({
 *       accountAddress: "0x1",
 *       moduleName: "coin",
 *   });
 *   const COIN_ABI = mod.abi!;
 *
 * The `as const` assertion is what lets `fromABI` infer the fully-typed proxy.
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
} as const;
