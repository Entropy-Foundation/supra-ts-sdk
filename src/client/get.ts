import { type NetworkConfig } from "../utils/apiEndpoints";
import { SupraAPIError } from "../errors/apiError";
import { DEFAULT_RPC_VERSION, DEFAULT_REQUEST_TIMEOUT_MS } from "../utils/constants";

export interface RequestParams {
    path: string;
    query?: Record<string, string | number | boolean | undefined>;
    data?: unknown;
}

/**
* The get method is an asynchronous function that takes a RequestParams object as an argument and returns a Promise that resolves to a response of type Res. The method uses the native fetch API to make a GET request to the specified path on the Supra API. It checks the response status code and throws a SupraAPIError if the status code indicates an error (400 or above). If the status code indicates a successful response (200-299), it returns the response data.
* @param args - An object containing the path and optional data for the request.
* @returns A Promise that resolves to the response data of type Res.
*/
export async function get<Res extends object>(args: RequestParams, config: NetworkConfig, rpcVersion: string = DEFAULT_RPC_VERSION): Promise<{ data: Res, cursor?: string | undefined }> {

    const baseURL = `${config.rpcUrl}/rpc/${rpcVersion}${args.path}`;

    const url = new URL(baseURL);
    if (args.query) {
        for (const [key, value] of Object.entries(args.query)) {
            if (value !== undefined) {
                url.searchParams.set(key, String(value));
            }
        }
    }

    const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(config.timeout ?? DEFAULT_REQUEST_TIMEOUT_MS),
    });

    const data = await response.json();
    const cursor = response.headers.get("x-supra-cursor") ?? undefined;

    if (response.ok) {
        return {
            data: data as Res,
            cursor,
        };
    }

    throw new SupraAPIError({
        status: response.status,
        statusText: response.statusText,
        url: url.toString(),
        data,
    });
}
