import { post } from "../client/post";
import { SupraError } from "../errors/supraError";
import { standardizeAddress } from "../helper/account";
import { convertValueToAbiReturnTypedValue, getFunctionParts } from "../helper/general";
import { generateViewFunctionPayload } from "../helper/view";
import { nodeReportsReleaseInternal } from "./nodeRelease";
import type {
    InputViewFunctionData,
    InputViewRawFunctionData,
    ViewBatchEntry,
    ViewBatchResponse,
} from "../types/methods";
import type { MoveFunctionId, MoveModule, MoveValue } from "../types/move";
import type { NetworkConfig } from "../utils/apiEndpoints";
import { getAccountModuleInternal } from "./account";
import { V4_RPC_VERSION, withV4RouteSupport } from "./routeSupport";

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
 * Executes several Move view functions with `POST /rpc/v4/view/batch`.
 *
 * Each element is prepared as `viewInternal` prepares one function: the ABI of its module (read once per module for
 * the whole batch unless the element carries it) encodes its arguments and converts its results, with the type
 * parameters replaced by the element's type arguments. An element whose ABI cannot be read, or whose arguments do not
 * match it, throws before any request is sent. An element the node fails is reported in its entry as `error`.
 *
 * `viewInternal` reads the node release before it sends a call whose type arguments a node before v12 reads as
 * `address` (`typeArgumentNeedingV12`). A batch does not: the route exists only from v12, so a node that reads type
 * parameters as `address` answers HTTP 404 for it, which is thrown as `SupraRouteUnsupportedError`.
 */
export async function viewBatchInternal<T extends Array<MoveValue> = Array<MoveValue>>(
    args: { requests: InputViewFunctionData[] },
    config: NetworkConfig,
): Promise<ViewBatchResponse<T>> {
    const abis = new Map<string, Promise<MoveModule>>();
    const abiOf = (functionId: MoveFunctionId): Promise<MoveModule> => {
        const { moduleAddress, moduleName } = getFunctionParts(functionId);
        const key = `${standardizeAddress(moduleAddress)}::${moduleName}`;
        let abi = abis.get(key);
        if (abi === undefined) {
            abi = getAccountModuleInternal({ accountAddress: moduleAddress, moduleName }, config).then(
                (module) => module.abi!,
            );
            abis.set(key, abi);
        }
        return abi;
    };

    const payloads = await Promise.all(
        args.requests.map(async (request) =>
            generateViewFunctionPayload({ ...request, abi: request.abi ?? (await abiOf(request.function)) }, config),
        ),
    );

    const response = await withV4RouteSupport({ method: "viewBatch" }, () =>
        post<object, { state_height?: number | null; results: Array<ViewBatchEntry> }>(
            {
                path: "/view/batch",
                data: {
                    requests: payloads.map((payload) => ({
                        function: payload.function,
                        type_arguments: payload.typeArguments ?? [],
                        arguments: payload.functionArguments ?? [],
                    })),
                },
            },
            config,
            V4_RPC_VERSION,
        ),
    );

    const results = response.results.map((entry, index): ViewBatchEntry<T> => {
        if (entry.error !== undefined) {
            return { error: entry.error };
        }
        return {
            result: convertValueToAbiReturnTypedValue(
                payloads[index]!.returnType,
                entry.result ?? [],
                payloads[index]!.typeArgumentTypes,
            ) as T,
        };
    });
    return response.state_height === undefined ? { results } : { state_height: response.state_height, results };
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
