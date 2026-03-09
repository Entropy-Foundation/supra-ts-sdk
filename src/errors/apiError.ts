import type { AxiosResponse } from "axios";

/**
 * SupraAPIErrorOptions is an interface that defines the properties of the SupraAPIError class.
 */
export interface SupraAPIErrorOptions {
    status: number;
    statusText: string;
    url: string;
    data?: any;
    request: AxiosResponse | undefined;
}

/**
 * SupraAPIError is a custom error class that extends the built-in Error class. It is used to represent errors that occur when making requests to the Supra API.
 * The class has properties for the status code, status text, URL, and any additional data that may be returned by the API.
 * @group SupraAPIError 
 */
export class SupraAPIError extends Error {
    readonly status: number;
    readonly statusText: string;

    readonly url: string;
    readonly data?: any;

    readonly request: AxiosResponse;

    readonly major_status: string | undefined;

    constructor(args: SupraAPIErrorOptions) {
        super(args.statusText);
        this.name = "SupraAPIError";
        this.status = args.status;
        this.statusText = args.statusText;
        this.url = args.url;
        this.data = args.data;
        this.request = args.request!;

        let message: string = args.request?.data?.message?.toString();

        const match = message?.match(/major_status: (\w+)/);

        this.major_status = match ? match[1] : "unknown";
    }
}
