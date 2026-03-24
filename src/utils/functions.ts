import { BCS, TxnBuilderTypes } from "supra-l1-sdk-core";
import type { MoveToTS } from "../types/contract";
import type { FunctionTypeArgs, ScriptArgumentJson } from "../types/transactionManager/transactionBuild";

/**
 * Sleep for the specified amount of time in milliseconds.
 * This function can be used to introduce delays in asynchronous operations.
 *
 * @param timeMs - The time in milliseconds to sleep.
 * @group Implementation
 * @category Utils
 */
export async function sleep(timeMs: number): Promise<null> {
    return new Promise((resolve) => {
        setTimeout(resolve, timeMs);
    });
}

export const parseFunctionTypeArgs = (
    functionTypeArgs: TxnBuilderTypes.TypeTag[]
): Array<FunctionTypeArgs> => {
    const functionTypeArgsParsed: Array<FunctionTypeArgs> = [];
    functionTypeArgs.forEach((data) => {
        const structTagData = (data as TxnBuilderTypes.TypeTagStruct).value;
        functionTypeArgsParsed.push({
            struct: {
                address: structTagData.address.toHexString().toString(),
                module: structTagData.module_name.value,
                name: structTagData.name.value,
                type_args: parseFunctionTypeArgs(structTagData.type_args),
            },
        });
    });
    return functionTypeArgsParsed;
};

export const parseScriptArgs = (
    scriptArgs: TxnBuilderTypes.TransactionArgument[]
): Array<ScriptArgumentJson> => {
    const parsedArgs: Array<ScriptArgumentJson> = [];
    scriptArgs.forEach((arg) => {
        if (arg instanceof TxnBuilderTypes.TransactionArgumentU8) {
            parsedArgs.push({ U8: arg.value });
        } else if (arg instanceof TxnBuilderTypes.TransactionArgumentU32) {
            parsedArgs.push({ U32: arg.value });
        } else if (arg instanceof TxnBuilderTypes.TransactionArgumentU64) {
            parsedArgs.push({ U64: Number(arg.value) });
        } else if (arg instanceof TxnBuilderTypes.TransactionArgumentU128) {
            parsedArgs.push({ U128: Number(arg.value) });
        } else if (arg instanceof TxnBuilderTypes.TransactionArgumentU256) {
            parsedArgs.push({ U256: Array.from(BCS.bcsSerializeU256(arg.value)) });
        } else if (arg instanceof TxnBuilderTypes.TransactionArgumentAddress) {
            parsedArgs.push({ Address: arg.value.toHexString().toString() });
        } else if (arg instanceof TxnBuilderTypes.TransactionArgumentU8Vector) {
            parsedArgs.push({ U8Vector: Array.from(arg.value) });
        } else if (arg instanceof TxnBuilderTypes.TransactionArgumentBool) {
            parsedArgs.push({ Bool: arg.value });
        } else {
            throw new Error("Invalid script argument variant");
        }
    });
    return parsedArgs;
};

export const fromUint8ArrayToJSArray = (
    arr: Uint8Array[]
): Array<Array<number>> => {
    const resData: Array<Array<number>> = [];
    for (let i = 0; i < arr.length; i++) {
        if (arr[i]) {
            resData.push(Array.from(arr[i]!));
        }
    }
    return resData;
};

/**
 * Convert a Move value to a JSON parsable value
 */
export function convertMoveValueToJSONParsable<T extends string>(type: T, value: unknown): unknown {
    // Primitive types
    if (type === 'u8' || type === 'u16' || type === 'u32') return String(value);
    if (type === 'u64' || type === 'u128' || type === 'u256') return String(value);
    if (type === 'address') return String(value);
    if (type === 'bool') return Boolean(value);
    if (type.startsWith('vector<')) {
        const innerType = type.slice(7, -1) as string;
        return (value as unknown[]).map(v => convertMoveValueToJSONParsable(innerType, v));
    }
    // fallback for structs or unknown
    return value;
}

/**
 * Convert a Move value to a TS value
 */
export function convertMoveValue<T extends string>(type: T, value: unknown): MoveToTS<T> {
    // Primitive types
    if (type === 'u8' || type === 'u16' || type === 'u32') return Number(value) as MoveToTS<T>;
    if (type === 'u64' || type === 'u128' || type === 'u256') return BigInt(value as string | number | bigint) as MoveToTS<T>;
    if (type === 'address') return String(value) as MoveToTS<T>;
    if (type === 'bool') return Boolean(value) as MoveToTS<T>;
    if (type.startsWith('vector<')) {
        const innerType = type.slice(7, -1) as string;
        return (value as unknown[]).map(v => convertMoveValue(innerType, v)) as MoveToTS<T>;
    }
    // fallback for structs or unknown
    return value as MoveToTS<T>;
}
