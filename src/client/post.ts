import type { RequestParams } from "./get";
import { type NetworkConfig } from "../utils/apiEndpoints";
import { SupraAPIError } from "../errors/apiError";
import { DEFAULT_RPC_VERSION, DEFAULT_REQUEST_TIMEOUT_MS } from "../utils/constants";

/**
* The post method is an asynchronous function that takes a RequestParams object as an argument and returns a Promise that resolves to a response of type Res. The method uses the native fetch API to make a POST request to the specified path on the Supra API, including any data provided in the request. It checks the response status code and throws a SupraAPIError if the status code indicates an error (400 or above). If the status code indicates a successful response (200-299), it returns the response data.
* @param args - An object containing the path and optional data for the request.
* @returns A Promise that resolves to the response data of type Res.
*/
export async function post<Req extends object, Res>(args: RequestParams, config: NetworkConfig, rpcVersion: string = DEFAULT_RPC_VERSION): Promise<Res> {

    const url = `${config.rpcUrl}/rpc/${rpcVersion}${args.path}`;

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: args.data ? JSON.stringify(args.data as Req) : null,
        signal: AbortSignal.timeout(config.timeout ?? DEFAULT_REQUEST_TIMEOUT_MS),
    });

    const data = await response.json();

    if (response.ok) {
        return data as Res;
    }

    throw new SupraAPIError({
        status: response.status,
        statusText: response.statusText,
        url,
        data,
    });
}
