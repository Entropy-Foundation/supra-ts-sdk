import { TxnBuilderTypes, TypeTagParser } from "supra-l1-sdk-core";
import type { InputViewFunctionData } from "../types/methods";
import type { MoveFunction, MoveFunctionId, SimpleEntryFunctionArgumentTypes, TypeArgument } from "../types/move";

/**
 * Splits a function identifier into its constituent parts: module address, module name, and function name.
 * This function helps in validating and extracting details from a function identifier string.
 *
 * @param functionArg - The function identifier string in the format "moduleAddress::moduleName::functionName".
 * @returns An object containing the module address, module name, and function name.
 * @throws Error if the function identifier does not contain exactly three parts.
 */
export function getFunctionParts(functionArg: MoveFunctionId): { moduleAddress: string, moduleName: string, functionName: string } {
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
        throw new Error(`Function ${functionAbi.name} has ${functionAbi.generic_type_params.length} type arguments, but ${args.typeArguments.length} were provided`);
    }

    let typeArguments = args.typeArguments.map((_, idx) => {
        return convertTypeArgsValueToJSONParsable(args.typeArguments![idx]);
    });

    return typeArguments;
}

export function convertPayloadTypeArgsToMoveType(functionAbi: MoveFunction, args: InputViewFunctionData): TxnBuilderTypes.TypeTag[] {
    // Find the ABI for this function
    if (!args.typeArguments || args.typeArguments.length == 0) return [];

    // Check type arguments length
    if (functionAbi.generic_type_params.length !== args.typeArguments.length) {
        throw new Error(`Function ${functionAbi.name} has ${functionAbi.generic_type_params.length} type arguments, but ${args.typeArguments.length} were provided`);
    }

    let typeArguments = args.typeArguments.map((_, idx) => {
        return convertTypeArgsValueToMoveTypeValue(args.typeArguments![idx]);
    });

    return typeArguments;
}


/**
 * Converts arguments to JSON parsable
 */
export function convertPayloadArgsToJSONParsable(functionAbi: MoveFunction, args: InputViewFunctionData) {

    // Convert return values
    if (!args.functionArguments || args.functionArguments.length === 0) return [];

    if (functionAbi.params.length !== args.functionArguments.length) {
        throw new Error(`Function ${functionAbi.name} has ${functionAbi.params.length} arguments, but ${args.functionArguments.length} were provided`);
    }

    // Multiple return
    return functionAbi.params.map((typeStr, idx) => {
        return convertArgsValueToJSONParsable(typeStr, args.functionArguments![idx]);

    });
}


/**
 * Converts a Move value to a JSON parsable value
 */
export function convertTypeArgsValueToJSONParsable(value: TypeArgument | undefined): string {

    if (typeof value === "string") {
        return value;
    }

    if (value instanceof TxnBuilderTypes.TypeTag) {
        // Use the TypeTagParser to parse the string literal into a TypeTagStruct
        const typeTagStruct = value as TxnBuilderTypes.TypeTagStruct;

        return `${typeTagStruct.value.address.toHexString()}::${typeTagStruct.value.module_name.value}::${typeTagStruct.value.name.value}`;
    }

    throw new Error(`Invalid type argument: ${value}`);
}

/**
 * Converts a Move value to a JSON parsable value
 */
export function convertTypeArgsValueToMoveTypeValue(value: TypeArgument | undefined): TxnBuilderTypes.TypeTag {

    if (typeof value === "string") {
        return new TypeTagParser(value).parseTypeTag();
    }

    if (value instanceof TxnBuilderTypes.TypeTag) {
        return value;
    }

    throw new Error(`Invalid type argument: ${value}`);
}


/**
 * Converts a Move value to a JSON parsable value
 */
export function convertArgsValueToJSONParsable(type: string, value: SimpleEntryFunctionArgumentTypes): unknown {

    // ----------------------------
    // 1️⃣ Handle null for Option
    // ----------------------------
    if (value === null || value === undefined) {

        const optionInner = extractOptionInner(type);
        if (optionInner) {
            if (optionInner === "u8") return { vec: "" };
            if (optionInner === "vector<u8>") return { vec: [] };
            return { vec: [] };
        }
        return null;
    }

    const intTypes = ["u8", "u16", "u32", "i8", "i16", "i32"];
    const bigIntTypes = ["u64", "u128", "u256", "i64", "i128", "i256"];

    // ----------------------------
    // 2️⃣ Option<T>
    // ----------------------------
    // Handle Option<T> types
    const optionInner = extractOptionInner(type);
    if (optionInner) {

        // Special RPC convention: Option<u8> is directly serialized
        if (optionInner === "u8") {
            return { vec: String(value) };
        }

        // Option<vector<u8>> → wrap hex string inside array
        if (optionInner === "vector<u8>") {
            if (typeof value === "string") return { vec: [value] };

            if (value instanceof Uint8Array) return { vec: [uint8ArrayToHexString(value)] };

            if (value instanceof ArrayBuffer) return { vec: [uint8ArrayToHexString(new Uint8Array(value))] };

            if (Array.isArray(value)) {
                const hex = value.map(v => Number(v).toString(16).padStart(2, "0")).join("");
                return { vec: [hex] };
            }
            throw new Error("Invalid Option<vector<u8>> value");
        }

        // Nested Option, vector, or struct inside Option
        return { vec: [convertArgsValueToJSONParsable(optionInner, value)] };
    }

    // ----------------------------
    // 3️⃣ vector<u8> (SPECIAL CASE)
    // ----------------------------
    if (type === "vector<u8>") {
        // Allow string or byte array
        if (typeof value === "string") {
            return value; // assume hex/base64 handled upstream
        }

        if (value instanceof Uint8Array) return uint8ArrayToHexString(value);

        if (value instanceof ArrayBuffer) return uint8ArrayToHexString(new Uint8Array(value));


        if (Array.isArray(value)) {
            // convert number array to hex string
            return value.map(v => {
                const n = Number(v);
                if (n < 0 || n > 255) throw new Error("Invalid u8 value in vector<u8>");
                return n.toString(16).padStart(2, "0");
            }).join("");
        }
        throw new Error("Invalid vector<u8> input");
    }

    // ----------------------------
    // 4️⃣ vector<T>
    // ----------------------------
    const vectorInner = extractVectorInner(type);
    if (vectorInner) {
        if (!Array.isArray(value)) {
            throw new Error(`Expected array for type '${type}'`);
        }
        return value.map(v =>
            convertArgsValueToJSONParsable(vectorInner, v)
        );
    }

    // ----------------------------
    // 5️⃣ Primitives
    // ----------------------------
    if (intTypes.includes(type)) return Number(value);
    if (bigIntTypes.includes(type)) return value.toString();
    if (type === "bool") return Boolean(value);
    if (type === "address") return String(value);

    // ----------------------------
    // 6️⃣ Struct
    // ----------------------------
    if (isMoveStruct(type)) {
        return value;
    }

    return value;
}



/**
 * Convert a Move value to a TS value
 */
export function convertValueToAbiReturnTypedValue(returnType: string[], response: unknown[]) {

    // Convert return values
    if (!returnType || returnType.length === 0) return [];


    // Multiple return
    return returnType.map((typeStr, idx) =>
        convertValueToReturnTypedValue(typeStr, response[idx])
    );
}

/**
 * Convert a Move value to a TS value
 */
export function convertValueToReturnTypedValue(type: string, value: unknown): unknown {

    const intTypes = ["u8", "u16", "u32", "i8", "i16", "i32"];
    const bigIntTypes = ["u64", "u128", "u256", "i64", "i128", "i256"];

    // --------------------
    // 0️⃣ Object
    // --------------------
    if (type.startsWith("0x1::object::Object")) {
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
        return value.map(v =>
            convertValueToReturnTypedValue(vectorInner, v)
        );
    }

    // --------------------
    // 4️⃣ Primitives
    // --------------------
    if (intTypes.includes(type)) return Number(value);
    if (bigIntTypes.includes(type)) return BigInt(value as string | number | bigint);
    if (type === "bool") return Boolean(value);
    if (type === "address") return String(value);

    // --------------------
    // 5️⃣ Struct
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


function uint8ArrayToHexString(bytes: Uint8Array) {
    return Array.from(bytes)
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
}