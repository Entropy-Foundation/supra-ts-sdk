import { TxnBuilderTypes } from "supra-l1-sdk-core";
import type { FunctionTypeArgs } from "../types/transactionManager/transactionBuild";

const {
    TypeTagBool,
    TypeTagU8,
    TypeTagU16,
    TypeTagU32,
    TypeTagU64,
    TypeTagU128,
    TypeTagU256,
    TypeTagAddress,
    TypeTagSigner,
    TypeTagVector,
    TypeTagStruct,
} = TxnBuilderTypes;

/** Name of a primitive `TypeTag` variant, as written in Move source and in the node's JSON. */
function primitiveName(tag: TxnBuilderTypes.TypeTag): string | undefined {
    if (tag instanceof TypeTagBool) return "bool";
    if (tag instanceof TypeTagU8) return "u8";
    if (tag instanceof TypeTagU16) return "u16";
    if (tag instanceof TypeTagU32) return "u32";
    if (tag instanceof TypeTagU64) return "u64";
    if (tag instanceof TypeTagU128) return "u128";
    if (tag instanceof TypeTagU256) return "u256";
    if (tag instanceof TypeTagAddress) return "address";
    if (tag instanceof TypeTagSigner) return "signer";
    return undefined;
}

/**
 * Formats an address the way Move prints it: `0x` followed by the shortest hex form for the framework
 * addresses `0x0` to `0xf`, and by all 64 hex digits for every other address.
 */
function addressToString(address: TxnBuilderTypes.AccountAddress): string {
    const bytes = address.address;
    const last = bytes[bytes.length - 1] ?? 0;
    const isSpecial = bytes.slice(0, -1).every((byte) => byte === 0) && last < 0x10;
    return isSpecial ? `0x${last.toString(16)}` : `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The Move type string of a `TypeTag`, for example `u64`, `vector<u8>` or
 * `0x1::coin::CoinStore<0x1::supra_coin::SupraCoin>`. Type parameters are separated by `,` without a space.
 *
 * @throws Error when the tag is not one of the variants of `TypeTag`.
 */
export function typeTagToString(tag: TxnBuilderTypes.TypeTag): string {
    const primitive = primitiveName(tag);
    if (primitive !== undefined) {
        return primitive;
    }
    if (tag instanceof TypeTagVector) {
        return `vector<${typeTagToString(tag.value)}>`;
    }
    if (tag instanceof TypeTagStruct) {
        const { address, module_name, name, type_args } = tag.value;
        const base = `${addressToString(address)}::${module_name.value}::${name.value}`;
        return type_args.length === 0 ? base : `${base}<${type_args.map(typeTagToString).join(",")}>`;
    }
    throw new Error("Unknown variant of `TypeTag`");
}

/**
 * The JSON form of a `TypeTag` in a transaction payload: the name of a primitive type, `{ vector }` or
 * `{ struct }`.
 *
 * @throws Error when the tag is not one of the variants of `TypeTag`.
 */
export function typeTagToJSON(tag: TxnBuilderTypes.TypeTag): FunctionTypeArgs {
    const primitive = primitiveName(tag);
    if (primitive !== undefined) {
        return primitive as FunctionTypeArgs;
    }
    if (tag instanceof TypeTagVector) {
        return { vector: typeTagToJSON(tag.value) };
    }
    if (tag instanceof TypeTagStruct) {
        const { address, module_name, name, type_args } = tag.value;
        return {
            struct: {
                address: address.toHexString().toString(),
                module: module_name.value,
                name: name.value,
                type_args: type_args.map(typeTagToJSON),
            },
        };
    }
    throw new Error("Unknown variant of `TypeTag`");
}
