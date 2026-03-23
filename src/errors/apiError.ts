/**
 * SupraAPIErrorOptions is an interface that defines the properties of the SupraAPIError class.
 */
export interface SupraAPIErrorOptions {
    status: number;
    statusText: string;
    url: string;
    data?: unknown;
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
    readonly data?: unknown;

    readonly major_status: string | undefined;

    constructor(args: SupraAPIErrorOptions) {
        super(args.statusText);
        this.name = "SupraAPIError";
        this.status = args.status;
        this.statusText = args.statusText;
        this.url = args.url;
        this.data = args.data;

        const message: string | undefined = (args.data as { message?: string })?.message?.toString();

        const match = message?.match(/major_status: (\w+)/);

        this.major_status = match ? match[1] : "unknown";
    }

    toJSON() {
        return {
            name: this.name,
            status: this.status,
            statusText: this.statusText,
            url: this.url,
            data: this.data,
            major_status: this.major_status,
        };
    }
}
