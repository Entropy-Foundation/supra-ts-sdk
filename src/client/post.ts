import type { RequestParams } from "./get";
import { type NetworkConfig } from "../utils/apiEndpoints";
import { createSupraAPIError } from "../errors/apiError";
import { parseJsonResponse } from "./parseResponse";
import { sendRequest } from "./request";
import { DEFAULT_REQUEST_TIMEOUT_MS, DEFAULT_RPC_VERSION } from "../utils/constants";
import { buildRpcUrl } from "./url";
import { stringifyWithBigInt } from "../utils/json";

/**
* The post method is an asynchronous function that takes a RequestParams object as an argument and returns a Promise that resolves to a response of type Res. The method uses the native fetch API to make a POST request to the specified path on the Supra API, including any data provided in the request. It checks the response status code and throws a SupraAPIError if the status code indicates an error (400 or above). If the status code indicates a successful response (200-299), it returns the response data.
* @param args - An object containing the path and optional data for the request.
* @returns A Promise that resolves to the response data of type Res.
*/
export async function post<Req extends object, Res>(args: RequestParams, config: NetworkConfig, rpcVersion: string = DEFAULT_RPC_VERSION): Promise<Res> {

    const url = buildRpcUrl(config.rpcUrl, rpcVersion, args.path).toString();

    const response = await sendRequest(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        // `stringifyWithBigInt`, not `JSON.stringify`: request bodies carry `u64`/`u128`
        // values as `bigint`, which must reach the wire exactly rather than being
        // rounded through a JavaScript `number`.
        body: args.data ? stringifyWithBigInt(args.data as Req) : null,
    }, config, false);

    const data = await parseJsonResponse(response, url, config.timeout ?? DEFAULT_REQUEST_TIMEOUT_MS);

    if (response.ok) {
        return data as Res;
    }

    throw createSupraAPIError({
        status: response.status,
        statusText: response.statusText,
        url,
        data,
    }, response.headers.get("retry-after"));
}
