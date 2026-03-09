import { post } from "../client/post";
import { convertValueToAbiReturnTypedValue } from "../helper/general";
import { generateViewFunctionPayload } from "../helper/view";
import type { InputViewFunctionData, InputViewRawFunctionData } from "../types/methods";
import type { MoveModuleBytecode, MoveValue } from "../types/move";
import type { NetworkConfig } from "../utils/apiEndpoints";


/**
 * Queries for a Move view function
 * @param args.function - The name of the function to query.
 * @param args.typeArguments - An array of type arguments for the function.
 * @param args.functionArguments - An array of arguments for the function.
 * @returns A Promise that resolves to an array of MoveValue objects.
 * @note This is for fully typed and parsed data.
 * Abi type conversion and parsing is handled internally
 */
export async function viewInternal<T extends Array<MoveValue>>(args: InputViewFunctionData, config: NetworkConfig): Promise<T> {

    // Generate payload for view
    let { functionArguments, typeArguments, returnType } = await generateViewFunctionPayload(args, config);

    let rawResponse = await post<InputViewFunctionData, { result: T }>({
        path: `/view`,
        data: {
            function: args.function,
            type_arguments: typeArguments ?? [],
            arguments: functionArguments ?? []
        }
    }, config).then(res => res.result);

    // Convert response into a typed value
    return convertValueToAbiReturnTypedValue(returnType, rawResponse) as T;

}


/**
 * Queries for a Move view function
 * @param args.function - The name of the function to query.
 * @param args.typeArguments - An array of type arguments for the function.
 * @param args.functionArguments - An array of arguments for the function.
 * @returns A Promise that resolves to an array of MoveValue objects.
 * @note This is for raw data without type conversion or parsing.
 */
export async function viewRawInternal<T extends Array<any>>(args: InputViewRawFunctionData, config: NetworkConfig): Promise<T> {

    return await post<InputViewFunctionData, { result: T }>({
        path: `/view`,
        data: {
            function: args.function,
            type_arguments: args.typeArguments ?? [],
            arguments: args.functionArguments ?? []
        }
    }, config).then(res => res.result);

}

