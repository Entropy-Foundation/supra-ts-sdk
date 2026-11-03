import { post } from "../client/post";
import { SupraError } from "../errors/supraError";
import { convertValueToAbiReturnTypedValue } from "../helper/general";
import { generateViewFunctionPayload } from "../helper/view";
import { nodeReportsReleaseInternal } from "./nodeRelease";
import type { InputViewFunctionData, InputViewRawFunctionData } from "../types/methods";
import type { MoveValue } from "../types/move";
import type { NetworkConfig } from "../utils/apiEndpoints";

/**
 * Queries for a Move view function
 * @param args.function - The name of the function to query.
 * @param args.typeArguments - An array of type arguments for the function.
 * @param args.functionArguments - An array of arguments for the function.
 * @returns A Promise that resolves to an array of MoveValue objects.
 * @remarks This is for fully typed and parsed data.
 * Abi type conversion and parsing is handled internally. A call with a type argument that a node before
 * `supra_node_v12.0.0` reads as an `address` (`typeArgumentReadAsAddress`) first checks that the node reports a
 * `release` (`nodeReportsReleaseInternal`: `GET /rpc/v3/version`, read again until the node reports one).
 * @throws {SupraError} If such a call is made to a node that reports no `release`; no view request is sent.
 */
export async function viewInternal<T extends Array<MoveValue>>(
    args: InputViewFunctionData,
    config: NetworkConfig,
): Promise<T> {
    // Generate payload for view
    let { functionArguments, typeArguments, returnType, typeArgumentTypes, typeArgumentNeedingV12 } =
        await generateViewFunctionPayload(args, config);

    if (typeArgumentNeedingV12 !== undefined && !(await nodeReportsReleaseInternal(config))) {
        throw new SupraError(
            `The view function ${args.function} with the type argument ${typeArgumentNeedingV12} needs a node from ` +
                `supra_node_v12.0.0: the node at ${config.rpcUrl} is older and reads every type parameter as address`,
        );
    }

    let rawResponse = await post<InputViewFunctionData, { result: T }>(
        {
            path: `/view`,
            data: {
                function: args.function,
                type_arguments: typeArguments ?? [],
                arguments: functionArguments ?? [],
            },
        },
        config,
    ).then((res) => res.result);

    // Convert response into a typed value
    return convertValueToAbiReturnTypedValue(returnType, rawResponse, typeArgumentTypes) as T;
}

/**
 * Queries for a Move view function
 * @param args.function - The name of the function to query.
 * @param args.typeArguments - An array of type arguments for the function.
 * @param args.functionArguments - An array of arguments for the function.
 * @returns A Promise that resolves to an array of MoveValue objects.
 * @remarks This is for raw data without type conversion or parsing.
 */
export async function viewRawInternal<T extends Array<unknown>>(
    args: InputViewRawFunctionData,
    config: NetworkConfig,
): Promise<T> {
    return await post<InputViewFunctionData, { result: T }>(
        {
            path: `/view`,
            data: {
                function: args.function,
                type_arguments: args.typeArguments ?? [],
                arguments: args.functionArguments ?? [],
            },
        },
        config,
    ).then((res) => res.result);
}
