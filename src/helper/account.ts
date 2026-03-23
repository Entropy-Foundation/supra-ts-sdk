import { HexString } from "supra-l1-sdk-core";
import type { AccountAddressInput } from "../types/account";
import { SupraAPIError } from "../errors/apiError";

/**
 * Standardize an address
 * @param address - The address to standardize
 * @returns The standardized address
 * @example
 * ```typescript
 * import { functions } from "supra-l1-sdk";
 * 
 * const address = "1234...";
 * const standardizedAddress = functions.standardizeAddress(address);
 * console.log(standardizedAddress); // "0x1234..."
 * ```
 */
export function standardizeAddress(address: AccountAddressInput): string {

    let accountAddress = typeof address === "string" ? HexString.ensure(address).toString() : address.toString();

    let cleanAddress = accountAddress.replace(/^0x/, "");

    if (cleanAddress.length < 64) {
        cleanAddress = cleanAddress.padStart(64, "0");
    }
    if (cleanAddress.length > 64) {
        throw new SupraAPIError({
            url: "",
            status: 400,
            statusText: `Address ${address} is not a valid address`,
        });
    }

    return `0x${cleanAddress}`;
}