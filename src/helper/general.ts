// Portions of this file are derived from @aptos-labs/ts-sdk (https://github.com/aptos-labs/aptos-ts-sdk),
// Copyright © Aptos Foundation, licensed under the Apache License, Version 2.0. See NOTICE.
import { HexString, TxnBuilderTypes } from "supra-l1-sdk-core";
import type { InputViewFunctionData } from "../types/methods";
import type { MoveFunction, MoveFunctionId, SimpleEntryFunctionArgumentTypes, TypeArgument } from "../types/move";
import { parseTypeArgument, typeTagToString } from "./typeTag";

/**
 * Splits a function identifier into its constituent parts: module address, module name, and function name.
 * This function helps in validating and extracting details from a function identifier string.
 *
 * @param functionArg - The function identifier string in the format "moduleAddress::moduleName::functionName".
 * @returns An object containing the module address, module name, and function name.
 * @throws Error if the function identifier does not contain exactly three parts.
 */
export function getFunctionParts(functionArg: MoveFunctionId): {
    moduleAddress: string;
    moduleName: string;
    functionName: string;
} {
    const funcNameParts = functionArg.split("::");
    if (funcNameParts.length !== 3) {
        throw new Error(`Invalid function ${functionArg}`);
    }
    const moduleAddress = funcNameParts[0]!;
    const moduleName = funcNameParts[1]!;
    const functionName = funcNameParts[2]!;
    return { moduleAddress, moduleName, functionName };
}

/**
 * Converts type arguments to JSON parsable
 */
export function convertPayloadTypeArgsToJSONParsable(functionAbi: MoveFunction, args: InputViewFunctionData): string[] {
    // Find the ABI for this function
    if (!args.typeArguments || args.typeArguments.length == 0) return [];

    // Check type arguments length
    if (functionAbi.generic_type_params.length !== args.typeArguments.length) {
        throw new Error(
            `Function ${functionAbi.name} has ${functionAbi.generic_type_params.length} type arguments, but ${args.typeArguments.length} were provided`,
        );
    }

    let typeArguments = args.typeArguments.map((_, idx) => {
        return convertTypeArgsValueToJSONParsable(args.typeArguments![idx]);
    });

    return typeArguments;
}

export function convertPayloadTypeArgsToMoveType(
    functionAbi: MoveFunction,
    args: InputViewFunctionData,
): TxnBuilderTypes.TypeTag[] {
    // Find the ABI for this function
    if (!args.typeArguments || args.typeArguments.length == 0) return [];

    // Check type arguments length
    if (functionAbi.generic_type_params.length !== args.typeArguments.length) {
        throw new Error(
            `Function ${functionAbi.name} has ${functionAbi.generic_type_params.length} type arguments, but ${args.typeArguments.length} were provided`,
        );
    }

    let typeArguments = args.typeArguments.map((_, idx) => {
        return convertTypeArgsValueToMoveTypeValue(args.typeArguments![idx]);
    });

    return typeArguments;
}

/**
 * Converts the arguments of a view request to the node's JSON, each as its parameter type with the type parameters
 * replaced by the request's type arguments (`substituteTypeParameters`).
 * @throws Error if an argument does not convert at its substituted type
 */
export function convertPayloadArgsToJSONParsable(functionAbi: MoveFunction, args: InputViewFunctionData) {
    // Convert return values
    if (!args.functionArguments || args.functionArguments.length === 0) return [];

    if (functionAbi.params.length !== args.functionArguments.length) {
        throw new Error(
            `Function ${functionAbi.name} has ${functionAbi.params.length} arguments, but ${args.functionArguments.length} were provided`,
        );
    }

    const typeArguments = typeArgumentTypeStrings(args.typeArguments);
    return functionAbi.params.map((typeStr, idx) => {
        return convertArgsValueToJSONParsable(
            substituteTypeParameters(typeStr, typeArguments),
            args.functionArguments![idx],
        );
    });
}

/**
 * A type parameter of a function's ABI, `T` followed by its index, where it stands as a type in a type string: not
 * part of a longer name and not a module or struct name next to `::`. The first group is the character before it (or
 * the empty start of the string), the second its index. Written without a lookbehind, which Safari before 16.4 does
 * not parse.
 */
const TYPE_PARAMETER = /(^|[^\w:])T(\d+)(?![\w:])/g;

/**
 * `type`, a parameter or return type of a function's ABI, with each type parameter `T<n>` in it replaced by
 * `typeArguments[n]`: the type itself, and type parameters inside `vector<…>`, `0x1::option::Option<…>`,
 * `0x1::object::Object<…>` and the type arguments of any other struct, at any depth. A type parameter with no type
 * argument at its index is kept. A node from `supra_node_v12.0.0` reads the parameter and return types of a view
 * function this way; an earlier node reads each type parameter as `address`.
 * @param type - The type, as the ABI writes it.
 * @param typeArguments - The type arguments of the call, as Move type strings (see `typeArgumentTypeStrings`).
 * @example
 * substituteTypeParameters("T0", ["u64"]) // "u64"
 * substituteTypeParameters("vector<0x1::option::Option<T1>>", ["bool", "u64"]) // "vector<0x1::option::Option<u64>>"
 * substituteTypeParameters("0x1::object::Object<T0>", ["0x1::fungible_asset::Metadata"])
 * // "0x1::object::Object<0x1::fungible_asset::Metadata>"
 */
export function substituteTypeParameters(type: string, typeArguments: readonly string[]): string {
    return type.replace(
        TYPE_PARAMETER,
        (match: string, prefix: string, index: string) =>
            `${prefix}${typeArguments[Number(index)] ?? match.slice(prefix.length)}`,
    );
}

/** Object type prefix as the ABI and `typeTagToString` write it. */
const OBJECT_TYPE_PREFIX = "0x1::object::Object<";

/**
 * Whether a node before `supra_node_v12.0.0`, which reads every type parameter as `address`, reads a value of this
 * type argument as a node from `supra_node_v12.0.0` does: `address` and `signer` anywhere, and
 * `0x1::object::Object<…>` where the type parameter is a whole parameter or return type. Inside a `vector`, an
 * `Option` or a struct a v12 node reads an `Object` as `{ inner: <address> }` and an earlier node as an address.
 * @param typeArgument - A type argument in the form `typeTagToString` writes.
 * @param wholeType - Whether the type parameter is a whole parameter or return type.
 */
export function isAddressLikeTypeArgument(typeArgument: string, wholeType = true): boolean {
    return (
        typeArgument === "address" ||
        typeArgument === "signer" ||
        (wholeType && typeArgument.startsWith(OBJECT_TYPE_PREFIX))
    );
}

/** `type` without its `0x1::object::Object<…>` types, which every node reads as an address whatever they contain. */
function withoutObjectTypes(type: string): string {
    let rest = type;
    for (let start = rest.indexOf(OBJECT_TYPE_PREFIX); start >= 0; start = rest.indexOf(OBJECT_TYPE_PREFIX)) {
        let depth = 0;
        let end = start + OBJECT_TYPE_PREFIX.length - 1;
        for (; end < rest.length; end++) {
            if (rest[end] === "<") depth++;
            if (rest[end] === ">" && --depth === 0) break;
        }
        rest = `${rest.slice(0, start)}address${rest.slice(end + 1)}`;
    }
    return rest;
}

/**
 * The first type argument of a call that a node before `supra_node_v12.0.0` reads differently from a v12 node: one
 * whose type parameter occurs in a parameter or return type outside `0x1::object::Object<…>` and that is not
 * address-like there (`isAddressLikeTypeArgument`). Such a node reads the value of that type parameter as an
 * `address`. `undefined` when there is none, so that the call is read the same way by every node.
 * @param types - The parameter and return types of the function's ABI.
 * @param typeArguments - The type arguments of the call, in the form `typeTagToString` writes.
 */
export function typeArgumentReadAsAddress(
    types: readonly string[],
    typeArguments: readonly string[],
): string | undefined {
    for (const type of types) {
        const outsideObjects = withoutObjectTypes(type);
        for (const match of outsideObjects.matchAll(TYPE_PARAMETER)) {
            const typeArgument = typeArguments[Number(match[2])];
            const wholeType = outsideObjects.trim() === `T${match[2]}`;
            if (typeArgument !== undefined && !isAddressLikeTypeArgument(typeArgument, wholeType)) {
                return typeArgument;
            }
        }
    }
    return undefined;
}

/**
 * The type arguments of a view request as Move type strings in the form `typeTagToString` writes, for
 * `substituteTypeParameters`. Strings are parsed with `parseTypeArgument`.
 * @throws Error if a string is not a valid type argument
 */
export function typeArgumentTypeStrings(typeArguments: readonly TypeArgument[] | undefined): string[] {
    return (typeArguments ?? []).map((typeArgument) =>
        typeTagToString(convertTypeArgsValueToMoveTypeValue(typeArgument)),
    );
}

/**
 * Converts a type argument to the type string of a view request. A string is checked with `parseTypeArgument` and
 * returned unchanged; a `TypeTag` is written as its Move type string.
 * @throws Error if a string is not a valid type argument
 */
export function convertTypeArgsValueToJSONParsable(value: TypeArgument | undefined): string {
    if (typeof value === "string") {
        parseTypeArgument(value);
        return value;
    }

    if (value instanceof TxnBuilderTypes.TypeTag) {
        return typeTagToString(value);
    }

    throw new Error(`Invalid type argument: ${value}`);
}

/**
 * Converts a type argument to a `TypeTag`. A string is parsed with `parseTypeArgument`; a `TypeTag` is returned as is.
 * @throws Error if a string is not a valid type argument
 */
export function convertTypeArgsValueToMoveTypeValue(value: TypeArgument | undefined): TxnBuilderTypes.TypeTag {
    if (typeof value === "string") {
        return parseTypeArgument(value);
    }

    if (value instanceof TxnBuilderTypes.TypeTag) {
        return value;
    }

    throw new Error(`Invalid type argument: ${value}`);
}

/**
 * Converts a Move value to a JSON parsable value.
 *
 * A `0x1::object::Object<…>` is given as its address. As a parameter type the node reads it as an address; inside a
 * `vector` or an `Option` it reads it as the struct `{ inner: <address> }`, so it is sent in that form there.
 * @param nested - Whether `type` is inside a `vector` or an `Option` of the parameter type.
 */
export function convertArgsValueToJSONParsable(
    type: string,
    value: SimpleEntryFunctionArgumentTypes,
    nested = false,
): unknown {
    const optionInner = extractOptionInner(type);

    // ----------------------------
    // 1. Option<T>
    // ----------------------------
    // The node reads an Option<T> as the struct { vec: vector<T> }: `vec` is a hex string for
    // T = u8 and an array holding zero or one element of T otherwise.
    if (optionInner) {
        const isNone = value === null || value === undefined;
        if (optionInner === "u8") {
            return { vec: isNone ? "" : uint8ArrayToHexString(Uint8Array.of(Number(integerArgument("u8", value)))) };
        }
        return { vec: isNone ? [] : [convertArgsValueToJSONParsable(optionInner, value, true)] };
    }

    if (value === null || value === undefined) {
        return null;
    }

    const intTypes = ["u8", "u16", "u32", "i8", "i16", "i32"];
    const bigIntTypes = ["u64", "u128", "u256", "i64", "i128", "i256"];

    // ----------------------------
    // 2. vector<u8>
    // ----------------------------
    if (type === "vector<u8>") {
        return vectorU8ToHex(value);
    }

    // ----------------------------
    // 4️⃣ vector<T>
    // ----------------------------
    const vectorInner = extractVectorInner(type);
    if (vectorInner) {
        if (!Array.isArray(value)) {
            throw new Error(`Expected array for type '${type}'`);
        }
        return value.map((v) => convertArgsValueToJSONParsable(vectorInner, v, true));
    }

    // ----------------------------
    // 5️⃣ Primitives
    // ----------------------------
    if (intTypes.includes(type)) return Number(integerArgument(type, value));
    if (bigIntTypes.includes(type)) return integerArgument(type, value).toString();
    if (type === "bool") return boolArgument(value);
    if (type === "address") return addressArgument(value, type);
    if (isObjectType(type)) {
        const address = addressArgument(value, type);
        return nested ? { inner: address } : address;
    }

    // ----------------------------
    // 6️⃣ Fixed-point structs: the node reads { value: "<raw integer>" }
    // ----------------------------
    const fixedPointType = fixedPointRawType(type);
    if (fixedPointType) {
        return { value: integerArgument(fixedPointType, value).toString() };
    }

    // ----------------------------
    // 7️⃣ Struct
    // ----------------------------
    if (isMoveStruct(type)) {
        return value;
    }

    return value;
}

/**
 * Converts the results of a view function to TypeScript values, each as its return type with the type parameters
 * replaced by the call's type arguments.
 *
 * A node from `supra_node_v12.0.0` answers a result of a type parameter as its type argument. An earlier node answers
 * it as an `address`, which is the same JSON for the address-like type arguments (`isAddressLikeTypeArgument`); a call
 * with any other type argument is refused before it reaches such a node (see `viewInternal`).
 * @param returnType - The return types of the function's ABI.
 * @param response - The results, as the node sent them.
 * @param typeArguments - The type arguments of the call, as Move type strings (see `typeArgumentTypeStrings`).
 */
export function convertValueToAbiReturnTypedValue(
    returnType: string[],
    response: unknown[],
    typeArguments: readonly string[] = [],
) {
    // Convert return values
    if (!returnType || returnType.length === 0) return [];

    // Multiple return
    return returnType.map((typeStr, idx) =>
        convertValueToReturnTypedValue(substituteTypeParameters(typeStr, typeArguments), response[idx]),
    );
}

/**
 * Convert a Move value to a TS value
 */
export function convertValueToReturnTypedValue(type: string, value: unknown): unknown {
    const intTypes = ["u8", "u16", "u32", "i8", "i16", "i32"];
    const bigIntTypes = ["u64", "u128", "u256", "i64", "i128", "i256"];

    // --------------------
    // 0️⃣ Object: `{ inner }` from a node, or an address where a type parameter was answered as one
    // --------------------
    if (type.startsWith(OBJECT_TYPE_PREFIX)) {
        if (typeof value == "object" && value !== null && "inner" in value) {
            return (value as { inner: unknown }).inner;
        }
    }

    // --------------------
    // 1️⃣ Option<T>
    // --------------------
    const optionInner = extractOptionInner(type);
    if (optionInner) {
        const optVal = value as { vec?: unknown[] };
        // Special RPC quirk for Option<u8>
        if (optionInner === "u8") return optVal.vec;
        // Empty Option
        if (!optVal.vec || optVal.vec.length === 0) return null;
        // Recursive conversion
        return convertValueToReturnTypedValue(optionInner, optVal.vec[0]);
    }

    // --------------------
    // 2️⃣ vector<u8> (SPECIAL)
    // --------------------
    if (type === "vector<u8>") {
        if (typeof value === "string") {
            // assume base64 or hex string
            return value; // or decode to Uint8Array if you want
        }
        return value;
    }

    // --------------------
    // 3️⃣ vector<T>
    // --------------------
    const vectorInner = extractVectorInner(type);
    if (vectorInner) {
        if (!Array.isArray(value)) {
            throw new Error(`Expected array for ${type}`);
        }
        return value.map((v) => convertValueToReturnTypedValue(vectorInner, v));
    }

    // --------------------
    // 4️⃣ Primitives
    // --------------------
    if (intTypes.includes(type)) return Number(value);
    if (bigIntTypes.includes(type)) return BigInt(value as string | number | bigint);
    if (type === "bool") return Boolean(value);
    if (type === "address") return String(value);

    // --------------------
    // 5️⃣ Fixed-point structs: { value: "<raw integer>" } becomes { value: bigint }
    // --------------------
    if (fixedPointRawType(type)) {
        if (typeof value !== "object" || value === null || !("value" in value)) {
            throw new Error(`Expected an object with a value field for ${type}, got ${describeArgument(value)}`);
        }
        return { value: BigInt((value as { value: string | number | bigint }).value) };
    }

    // --------------------
    // 6️⃣ Struct
    // --------------------
    if (isMoveStruct(type)) return value;

    return value;
}

/**
 * Check if a type is an option
 * @example
 * isOption("0x1::option::Option<u8>") // true
 * isOption("u8") // false
 * */
export function isOption(type: string) {
    return /^0x[0-9a-fA-F]+::option::Option<.*>$/.test(type);
}

/**
 * Check if a type is a vector
 * @example
 * extractOptionInner("0x1::option::Option<u8>") // u8
 * extractOptionInner("u8") // null
 * */
export function extractOptionInner(type: string): string | null {
    const match = type.match(/^0x[0-9a-fA-F]+::option::Option<(.*)>$/);
    return match ? match[1]! : null;
}

/**
 * Check if a type is a vector
 * @example
 * extractVectorInner("vector<u8>") // u8
 * extractVectorInner("u8") // null
 */
export function extractVectorInner(type: string): string | null {
    const match = type.match(/^vector<(.*)>$/);
    return match ? match[1]! : null;
}

/**
 * Check if a type is a struct
 * @example
 * isMoveStruct("0x1::option::Option<u8>") // true
 * isMoveStruct("u8") // false
 */
export function isMoveStruct(type: string) {
    return /^0x[0-9a-fA-F]+::[0-9a-zA-Z_]+::[0-9a-zA-Z_]+$/.test(type);
}

/**
 * Whether a parameter type of a function's ABI is `0x1::object::Object<T>`, whose values are addresses.
 * @example
 * isObjectType("0x1::object::Object<T0>") // true
 * isObjectType("address") // false
 */
export function isObjectType(type: string): boolean {
    return /^0x0*1::object::Object<.*>$/.test(type);
}

/**
 * The integer type of the raw value of a fixed-point struct: `u64` for `0x1::fixed_point32::FixedPoint32` and `u128`
 * for `0x1::fixed_point64::FixedPoint64`. Arguments and results of these types are their raw values.
 * @example
 * fixedPointRawType("0x1::fixed_point32::FixedPoint32") // "u64"
 * fixedPointRawType("0x1::fixed_point64::FixedPoint64") // "u128"
 * fixedPointRawType("u64") // null
 */
export function fixedPointRawType(type: string): "u64" | "u128" | null {
    if (/^0x0*1::fixed_point32::FixedPoint32$/.test(type)) return "u64";
    if (/^0x0*1::fixed_point64::FixedPoint64$/.test(type)) return "u128";
    return null;
}

/** A value for an error message: strings and objects as JSON, bigints with an `n` suffix. */
export function describeArgument(value: unknown): string {
    if (typeof value === "bigint") return `${value}n`;
    if (typeof value === "string") return JSON.stringify(value);
    if (value instanceof HexString) return `HexString(${value.toString()})`;
    return typeof value === "object" && value !== null ? Object.prototype.toString.call(value) : String(value);
}

/**
 * Converts a `bool` argument to a boolean. Accepts a boolean and the strings `"true"` and `"false"`.
 * @throws Error for any other value
 */
export function boolArgument(value: unknown): boolean {
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    throw new Error(`Expected a boolean, "true" or "false" for bool, got ${describeArgument(value)}`);
}

/** An address argument: an optional `0x` followed by 1 to 64 hex digits in either case. */
const ADDRESS_ARGUMENT = /^(?:0x)?[0-9a-fA-F]{1,64}$/;

/**
 * Validates an `address` or `0x1::object::Object<T>` argument and returns it as a string. The argument is a string
 * or a `HexString` holding an optional `0x` followed by 1 to 64 hex digits, the form `validateAddress` accepts with
 * the prefix optional.
 * @param value - The argument.
 * @param type - The parameter type, for the error message.
 * @returns The address as given, or the string of a `HexString`.
 * @throws Error for any other value, including `""`, `"0x"`, `"0X1"` and addresses of more than 64 hex digits
 */
export function addressArgument(value: unknown, type: string): string {
    const address = value instanceof HexString ? value.toString() : value;
    if (typeof address !== "string" || !ADDRESS_ARGUMENT.test(address)) {
        throw new Error(
            `Expected an address (0x followed by 1 to 64 hex digits) as a string or HexString for ${type}, got ${describeArgument(value)}`,
        );
    }
    return address;
}

export function uint8ArrayToHexString(bytes: Uint8Array) {
    return Array.from(bytes)
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

export function addAddressPadding(address: string): string {
    if (!address) return address;
    /**
     * Pads a Move-style LP token address and its inner token addresses for consistent formatting.
     * Example: "0x1::lp_coin::LP<0x2::token::TokenA, 0x3::token::TokenB>"
     */
    const isLpTokenAddressMatch = address.match(/<([^>]+)>/);
    if (isLpTokenAddressMatch && isLpTokenAddressMatch.length === 2) {
        const firstPart = address.slice(0, address.indexOf("<"));
        if (firstPart.includes("::")) {
            const inner = isLpTokenAddressMatch[1] ?? "";
            if (inner) {
                const innerFixed = inner
                    .split(",")
                    .map((part) => addAddressPadding(part.trim()))
                    .join(", ");
                return `${addAddressPadding(firstPart)}<${innerFixed}>`;
            }
        }
    }

    // Normalize uppercase/lowercase and trim spaces
    address = address.trim().replace(/^Ox/, "0x").replace(/^0X/, "0x");

    // Handle module-style address: split by "::"
    if (address.includes("::")) {
        const [addrPart, ...rest] = address.split("::");
        const paddedAddr = addAddressPadding(addrPart as string);
        return `${paddedAddr}::${rest.join("::")}`;
    }

    // Ensure 0x prefix
    if (!address.startsWith("0x")) {
        address = "0x" + address;
    }

    // Strip prefix for padding
    const hexPart = address.slice(2);

    // Left pad with zeros up to 64 hex chars (32 bytes)
    const paddedHex = hexPart.padStart(64, "0");

    return "0x" + paddedHex;
}

/**
 * Converts a `vector<u8>` argument to bytes. Accepts a `number[]` of integers from 0 to 255, a
 * `Uint8Array`, an `ArrayBuffer`, and a hex string of whole bytes with or without a `0x` prefix.
 * @throws Error for any other value
 */
export function vectorU8ToBytes(value: unknown): Uint8Array {
    if (value instanceof Uint8Array) {
        return value;
    }
    if (value instanceof ArrayBuffer) {
        return new Uint8Array(value);
    }
    if (typeof value === "string") {
        const match = /^(?:0x)?((?:[0-9a-fA-F]{2})*)$/.exec(value);
        if (!match) {
            throw new Error(`Expected a hex string of whole bytes for vector<u8>, got ${JSON.stringify(value)}`);
        }
        const hex = match[1]!;
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < bytes.length; i++) {
            bytes[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
        }
        return bytes;
    }
    if (Array.isArray(value)) {
        return Uint8Array.from(value, (item) => {
            const byte = typeof item === "string" && /^\d+$/.test(item) ? Number(item) : item;
            if (typeof byte !== "number" || !Number.isInteger(byte) || byte < 0 || byte > 255) {
                throw new Error(`Invalid u8 value in vector<u8>: ${JSON.stringify(item)}`);
            }
            return byte;
        });
    }
    throw new Error(`Expected number[], Uint8Array or hex string for vector<u8>, got ${typeof value}`);
}

/**
 * Converts a `vector<u8>` argument to the hex string the node expects. A string is validated and
 * returned unchanged; every other accepted form is hex-encoded without a prefix.
 */
export function vectorU8ToHex(value: unknown): string {
    const bytes = vectorU8ToBytes(value);
    return typeof value === "string" ? value : uint8ArrayToHexString(bytes);
}

/**
 * Checks that a `number` given for an integer argument is a safe integer (at most `Number.MAX_SAFE_INTEGER`,
 * 2^53 - 1, in magnitude), which a JavaScript number holds exactly.
 * @param type - The parameter type, for the error message.
 * @param value - The number.
 * @throws Error if the number is not a safe integer
 */
export function assertSafeIntegerArgument(type: string, value: number): void {
    if (!Number.isSafeInteger(value)) {
        throw new Error(
            `${type} value ${value} is not a safe integer (above 2^53 - 1 in magnitude, so it may have been rounded); use a bigint or a decimal string`,
        );
    }
}

/** The smallest and largest value of the integer types `u8` to `u256` and `i8` to `i256`. */
function integerBounds(type: string): { min: bigint; max: bigint } {
    const match = /^([ui])(8|16|32|64|128|256)$/.exec(type);
    if (!match) {
        throw new Error(`Unsupported integer type: ${type}`);
    }
    const bits = BigInt(match[2]!);
    return match[1] === "u"
        ? { min: 0n, max: (1n << bits) - 1n }
        : { min: -(1n << (bits - 1n)), max: (1n << (bits - 1n)) - 1n };
}

/**
 * Converts an integer argument given as a number, bigint or decimal string to a bigint. Signed
 * types accept a leading `-`. Empty, whitespace-only and otherwise malformed strings are rejected.
 * A number must be a safe integer; larger values are given as a bigint or a decimal string.
 * @throws Error if the value is not an integer, is outside the range of the type, or is a number that is not a safe
 *   integer
 */
function integerArgument(type: string, value: unknown): bigint {
    let integer: bigint;
    const pattern = type.startsWith("i") ? /^-?\d+$/ : /^\d+$/;
    if (typeof value === "bigint") {
        integer = value;
    } else if (typeof value === "number" && Number.isInteger(value)) {
        integer = BigInt(value);
    } else if (typeof value === "string" && pattern.test(value)) {
        integer = BigInt(value);
    } else {
        throw new Error(`Expected an integer for ${type}, got ${describeArgument(value)}`);
    }
    const { min, max } = integerBounds(type);
    if (integer < min || integer > max) {
        throw new Error(`${type} value out of range (${min} to ${max}): ${integer}`);
    }
    if (typeof value === "number") {
        assertSafeIntegerArgument(type, value);
    }
    return integer;
}
