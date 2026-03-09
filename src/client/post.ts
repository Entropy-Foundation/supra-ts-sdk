import axios from "axios";
import type { RequestParams } from "./get";
import { type NetworkConfig } from "../utils/apiEndpoints";
import { SupraAPIError } from "../errors/apiError";
import { DEFAULT_RPC_VERSION } from "../utils/constants";

/**
* The post method is an asynchronous function that takes a RequestParams object as an argument and returns a Promise that resolves to a response of type Res. The method uses the axios library to make a POST request to the specified path on the Supra API, including any data provided in the request. It checks the response status code and throws a SupraAPIError if the status code indicates an error (400 or above). If the status code indicates a successful response (200-299), it returns the response data.
* @param args - An object containing the path and optional data for the request.
* @returns A Promise that resolves to the response data of type Res.
*/
export async function post<Req extends {}, Res>(args: RequestParams, config: NetworkConfig, rpcVersion: string = DEFAULT_RPC_VERSION): Promise<Res> {

    const { path, data } = args;

    let response = await axios({
        method: "post",
        baseURL: config.rpcUrl + `/rpc/${rpcVersion}`,
        url: path,
        data: data as Req,
        headers: {
            "Content-Type": "application/json"
        },
        validateStatus: () => true // Allow handling of all status codes in the response
    });

    // Check if the response status code is in the 200-299 range, which indicates a successful response. If it is, return the response data.
    if (response.status >= 200 && response.status < 300) {
        return response.data as Res;
    }


    // If the response status code is 400 or above, it indicates a client or server error. In this case, throw a SupraAPIError with the relevant information from the response.
    if (response.status >= 400) {

        throw new SupraAPIError({
            status: response.status,
            statusText: response.statusText,
            url: `${config.rpcUrl}/rpc/${rpcVersion}${path}`,
            data: response.data,
            request: response,

        });
    }

    // If the response status code is not in the 200-299 range and is not 400 or above, it indicates an unexpected status code. In this case, also throw a SupraAPIError with the relevant information from the response.
    throw new SupraAPIError({
        status: response.status,
        statusText: response.statusText,
        url: `${config.rpcUrl}/rpc/${rpcVersion}${path}`,
        data: response.data,
        request: response
    });

}