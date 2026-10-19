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

/** `TypeTag`s of the primitive type names that a type argument may use. */
const PRIMITIVE_TYPE_TAGS: ReadonlyMap<string, () => TxnBuilderTypes.TypeTag> = new Map([
    ["bool", () => new TypeTagBool()],
    ["u8", () => new TypeTagU8()],
    ["u16", () => new TypeTagU16()],
    ["u32", () => new TypeTagU32()],
    ["u64", () => new TypeTagU64()],
    ["u128", () => new TypeTagU128()],
    ["u256", () => new TypeTagU256()],
    ["address", () => new TypeTagAddress()],
    ["signer", () => new TypeTagSigner()],
]);

/** Words that a node reads as keywords in a type string; they are not module or struct names. */
const TYPE_KEYWORDS: ReadonlySet<string> = new Set([...PRIMITIVE_TYPE_TAGS.keys(), "vector", "true", "false"]);

/** Depth at which a node stops parsing a type string; the outermost type is at depth 0. */
const MAX_TYPE_NESTING = 9;

/** Number of hex digits of an address. */
const ADDRESS_HEX_DIGITS = 64;

type TypeToken = { kind: "<" | ">" | "," | "::" } | { kind: "address"; hex: string } | { kind: "name"; value: string };

/**
 * Splits a type string into tokens: `<`, `>`, `,`, `::`, addresses (`0x` or `0X` followed by hex digits) and names
 * (a letter followed by letters, digits and `_`). Whitespace separates tokens and is dropped.
 */
function tokenizeTypeString(input: string, fail: (reason: string) => never): TypeToken[] {
    const tokens: TypeToken[] = [];
    let pos = 0;
    while (pos < input.length) {
        const rest = input.slice(pos);
        const space = /^[ \t\n\r\f]+/.exec(rest);
        if (space) {
            pos += space[0].length;
            continue;
        }
        const punctuation = /^(::|<|>|,)/.exec(rest);
        if (punctuation) {
            tokens.push({ kind: punctuation[1] as "<" | ">" | "," | "::" });
            pos += punctuation[1]!.length;
            continue;
        }
        const address = /^0[xX]([0-9a-fA-F]+)/.exec(rest);
        if (address) {
            tokens.push({ kind: "address", hex: address[1]! });
            pos += address[0].length;
            continue;
        }
        const name = /^[A-Za-z][A-Za-z0-9_]*/.exec(rest);
        if (name) {
            tokens.push({ kind: "name", value: name[0] });
            pos += name[0].length;
            continue;
        }
        fail(`unexpected character ${JSON.stringify(input[pos])} at position ${pos}`);
    }
    return tokens;
}

function describeToken(token: TypeToken | undefined): string {
    if (token === undefined) return "the end of the string";
    if (token.kind === "address") return `address 0x${token.hex}`;
    if (token.kind === "name") return `"${token.value}"`;
    return `"${token.kind}"`;
}

/**
 * Parses a Move type string given as a type argument into a `TypeTag`.
 *
 * The grammar is the one Supra nodes parse: a primitive type (`bool`, `u8` to `u256`, `address`, `signer`),
 * `vector<T>`, or a struct `address::module::Name` with optional type parameters `<T1, T2>`. Addresses are `0x`
 * followed by 1 to 64 hex digits; whitespace between tokens is allowed, and so is a comma after the last type
 * parameter. A struct type keeps its address, module, name and type parameters, so
 * `0x1::object::Object<0x1::fungible_asset::Metadata>` is the struct `Object` with the type parameter `Metadata`.
 * The SDK parses type argument strings with this function; use it to build the `TypeTag`s of builders that take
 * `TypeTag`s, such as `transaction.build.rawTxnObject`. `TypeTagParser` of `supra-l1-sdk-core` parses
 * `0x1::object::Object<T>` as `address` and refuses names that contain `T` followed by digits, such as `USDT0`.
 *
 * @param input - The type string, for example `0x1::coin::CoinStore<0x1::supra_coin::SupraCoin>`.
 * @returns The `TypeTag` of the type.
 * @throws Error when the string is not exactly one type: text after the type, an unknown type name, a generic type
 *   parameter such as `T0` (type arguments are concrete types), an address of more than 64 hex digits, or nesting
 *   deeper than nodes accept.
 * @example
 * ```typescript
 * import { BCS, Network, SupraAccount, SupraClient, parseTypeArgument } from "supra-ts-sdk";
 *
 * const supra = new SupraClient({ network: Network.TESTNET });
 * const sender = new SupraAccount(); // the signing account
 *
 * const rawTxn = supra.transaction.build.rawTxnObject({
 *     senderAddress: sender.address(),
 *     senderSequenceNumber: 0n, // the account's sequence number, obtained separately
 *     function: "0x1::supra_account::transfer_coins",
 *     functionTypeArgs: [parseTypeArgument("0x1::supra_coin::SupraCoin")],
 *     functionArgs: [new SupraAccount().address().toUint8Array(), BCS.bcsSerializeUint64(1_000n)],
 *     optionalTransactionPayloadArgs: { maxGas: 5_000n },
 * });
 * const metadata = parseTypeArgument("0x1::object::Object<0x1::fungible_asset::Metadata>"); // a struct type tag
 * ```
 */
export function parseTypeArgument(input: string): TxnBuilderTypes.TypeTag {
    const fail = (reason: string): never => {
        throw new Error(`Invalid type argument ${JSON.stringify(input)}: ${reason}`);
    };
    const tokens = tokenizeTypeString(input, fail);
    let index = 0;

    const peek = (): TypeToken | undefined => tokens[index];
    const next = (): TypeToken | undefined => tokens[index++];
    const expect = (kind: "<" | ">" | "," | "::"): void => {
        const token = next();
        if (token?.kind !== kind) {
            fail(`expected "${kind}", found ${describeToken(token)}`);
        }
    };
    const identifier = (role: string): string => {
        const token = next();
        if (token?.kind !== "name" || TYPE_KEYWORDS.has(token.value)) {
            return fail(`expected a ${role} name, found ${describeToken(token)}`);
        }
        return token.value;
    };

    const parseType = (depth: number): TxnBuilderTypes.TypeTag => {
        if (depth >= MAX_TYPE_NESTING) {
            fail(`types are nested more than ${MAX_TYPE_NESTING} levels deep`);
        }
        const token = next();
        if (token?.kind === "name") {
            const primitive = PRIMITIVE_TYPE_TAGS.get(token.value);
            if (primitive !== undefined) {
                return primitive();
            }
            if (token.value === "vector") {
                expect("<");
                const inner = parseType(depth + 1);
                expect(">");
                return new TypeTagVector(inner);
            }
            if (/^T\d+$/.test(token.value)) {
                return fail(`the generic type parameter ${token.value} is not a concrete type`);
            }
            return fail(`unknown type "${token.value}"`);
        }
        if (token?.kind === "address") {
            if (token.hex.length > ADDRESS_HEX_DIGITS) {
                fail(`the address 0x${token.hex} has more than ${ADDRESS_HEX_DIGITS} hex digits`);
            }
            const address = TxnBuilderTypes.AccountAddress.fromHex(`0x${token.hex}`);
            expect("::");
            const module = identifier("module");
            expect("::");
            const name = identifier("struct");
            const typeArgs: TxnBuilderTypes.TypeTag[] = [];
            if (peek()?.kind === "<") {
                next();
                while (peek()?.kind !== ">") {
                    typeArgs.push(parseType(depth + 1));
                    if (peek()?.kind === ">") break;
                    expect(",");
                }
                expect(">");
            }
            return new TypeTagStruct(
                new TxnBuilderTypes.StructTag(
                    address,
                    new TxnBuilderTypes.Identifier(module),
                    new TxnBuilderTypes.Identifier(name),
                    typeArgs,
                ),
            );
        }
        return fail(`expected a type, found ${describeToken(token)}`);
    };

    const tag = parseType(0);
    if (index < tokens.length) {
        fail(`unexpected ${describeToken(peek())} after the type`);
    }
    return tag;
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
