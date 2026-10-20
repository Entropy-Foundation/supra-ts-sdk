import { type NetworkConfig } from "../utils/apiEndpoints";
import { createSupraAPIError } from "../errors/apiError";
import { parseJsonResponse } from "./parseResponse";
import { sendRequest } from "./request";
import { DEFAULT_REQUEST_TIMEOUT_MS, DEFAULT_RPC_VERSION } from "../utils/constants";
import { buildRpcUrl } from "./url";

export interface RequestParams {
    path: string;
    query?: Record<string, string | number | boolean | undefined>;
    data?: unknown;
    /**
     * Whether `get` may repeat the request under the client's retry policy (default true). A request that has an
     * effect on the node, such as the faucet's, is sent once.
     */
    retryable?: boolean;
}

/**
 * The get method is an asynchronous function that takes a RequestParams object as an argument and returns a Promise that resolves to a response of type Res. The method uses the native fetch API to make a GET request to the specified path on the Supra API. It checks the response status code and throws a SupraAPIError if the status code indicates an error (400 or above). If the status code indicates a successful response (200-299), it returns the response data.
 * @param args - An object containing the path and optional data for the request.
 * @returns A Promise that resolves to the response data of type Res.
 */
export async function get<Res>(
    args: RequestParams,
    config: NetworkConfig,
    rpcVersion: string = DEFAULT_RPC_VERSION,
): Promise<{ data: Res; cursor?: string | undefined }> {
    const url = buildRpcUrl(config.rpcUrl, rpcVersion, args.path);
    if (args.query) {
        for (const [key, value] of Object.entries(args.query)) {
            if (value !== undefined) {
                url.searchParams.set(key, String(value));
            }
        }
    }

    const response = await sendRequest(
        url.toString(),
        {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
            },
        },
        config,
        args.retryable ?? true,
    );

    const cursor = response.headers.get("x-supra-cursor") ?? undefined;
    const data = await parseJsonResponse(response, url.toString(), config.timeout ?? DEFAULT_REQUEST_TIMEOUT_MS);

    if (response.ok) {
        return {
            data: data as Res,
            cursor,
        };
    }

    throw createSupraAPIError(
        {
            status: response.status,
            statusText: response.statusText,
            url: url.toString(),
            data,
        },
        response.headers.get("retry-after"),
    );
}
