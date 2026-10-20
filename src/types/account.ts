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
 * The SUPRA balance of an account in quants, in total and by the form in which it is held. SUPRA is held as a legacy
 * coin (a `CoinStore` resource), as a fungible asset (the account's primary store of the SUPRA fungible asset), or both.
 */
export interface SupraBalance {
    /** The SUPRA the account owns in either form: `coin + fungibleAsset`. */
    total: bigint;
    /** The SUPRA held in the account's `CoinStore<SupraCoin>` resource. */
    coin: bigint;
    /** The SUPRA held in the account's primary store of the SUPRA fungible asset. */
    fungibleAsset: bigint;
}


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
