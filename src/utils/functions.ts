import { BCS, TxnBuilderTypes } from "supra-l1-sdk-core";
import type {  MoveToTS } from "../types/contract";
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
    let functionTypeArgsParsed: Array<FunctionTypeArgs> = new Array();
    functionTypeArgs.forEach((data) => {
        let structTagData = (data as TxnBuilderTypes.TypeTagStruct).value;
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
    let parsedArgs: Array<ScriptArgumentJson> = new Array();
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
    let resData: Array<Array<number>> = new Array();
    for (let i = 0; i < arr.length; i++) {
        if (arr[i]) {
            resData.push(Array.from(arr[i]!));
        }
    }
    return resData;
};





























// /**
//  * Convert a Move value to a TS value
//  */
// export function convertToReturnType(abi: ABIRoot, functionName: string, response: any) {
//     // Find the ABI for this function
//     const funcABI = abi.exposed_functions.find(f => f.name === functionName && f.is_view);
//     if (!funcABI) throw new Error(`Function ${functionName} not found in ABI`);

//     // Convert return values
//     if (!funcABI.return || funcABI.return.length === 0) return undefined;

//     // Single return
//     if (funcABI.return.length === 1) {
//         return [convertMoveValue(funcABI.return[0], response)];
//     }

//     // Multiple return
//     return funcABI.return.map((typeStr, idx) =>
//         convertMoveValue(typeStr, response[idx])
//     );
// }

// /**
//  * Convert a Move value to a JSON parsable value
//  */
// export function convertToPayloadType(abi: ABIRoot, functionName: string, response: any) {
//     // Find the ABI for this function
//     const funcABI = abi.exposed_functions.find(f => f.name === functionName && f.is_view);
//     if (!funcABI) throw new Error(`Function ${functionName} not found in ABI`);


//     // Convert return values
//     if (!funcABI.params || funcABI.params.length === 0) return undefined;

//     // Single return
//     if (funcABI.params.length === 1) {
//         return [convertMoveValueToJSONParsable(funcABI.return[0], response)];
//     }

//     // Multiple return
//     return funcABI.params.map((typeStr, idx) => {
//         return convertMoveValueToJSONParsable(typeStr, response[idx])

//     });
// }

/**
 * Convert a Move value to a JSON parsable value
 */
export function convertMoveValueToJSONParsable<T extends string>(type: T, value: any): any {

    // Primitive types
    if (type === 'u8' || type === 'u16' || type === 'u32') return String(value) as any;
    if (type === 'u64' || type === 'u128' || type === 'u256') return String(value) as any;
    if (type === 'address') return String(value) as any;
    if (type === 'bool') return Boolean(value) as any;
    if (type.startsWith('vector<')) {
        const innerType = type.slice(7, -1) as string;
        return (value as any[]).map(v => convertMoveValueToJSONParsable(innerType, v)) as any;
    }
    // fallback for structs or unknown
    return value as any;
}

/**
 * Convert a Move value to a TS value
 */
export function convertMoveValue<T extends string>(type: T, value: any): MoveToTS<T> {
    // Primitive types
    if (type === 'u8' || type === 'u16' || type === 'u32') return Number(value) as any;
    if (type === 'u64' || type === 'u128' || type === 'u256') return BigInt(value) as any;
    if (type === 'address') return String(value) as any;
    if (type === 'bool') return Boolean(value) as any;
    if (type.startsWith('vector<')) {
        const innerType = type.slice(7, -1) as string;
        return (value as any[]).map(v => convertMoveValue(innerType, v)) as any;
    }
    // fallback for structs or unknown
    return value as any;
}



