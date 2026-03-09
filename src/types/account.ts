import type { HexString } from "supra-l1-sdk-core";

/**
 * The data associated with an account, including its sequence number.
 */
export interface AccountData{
    /**
     * The sequence number of the account.
     */
    sequence_number: bigint;
    /**
     * The authentication key of the account.
     */
    authentication_key: string;
};


/**
 * The address of an account. which can be a string or a HexString
 */
export type AccountAddressInput = string | HexString;


/**
 * A paginated response from the API that includes a cursor for the next page of results.
 * @template T - The type of the response data to be returned.
 */
export interface PaginatedResponse<T> {
    /**
     * The api response which can be of type T.
     */
    response: T,
    /**
     * The cursor for the next page of results. undefined if there are no more results.
     * @optional
     */
    cursor?: string | undefined
}
