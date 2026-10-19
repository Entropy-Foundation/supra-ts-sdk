import { HexString } from "supra-l1-sdk-core";
import type { AccountAddressInput } from "../types/account";

/**
 * Standardize an address
 * @param address - The address to standardize
 * @returns The standardized address: `0x` followed by 64 lower-case hex digits, padded with leading zeros
 * @throws {RangeError} When the address has more than 64 hex digits
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

    const accountAddress = typeof address === "string" ? HexString.ensure(address).toString() : address.toString();

    const cleanAddress = accountAddress.replace(/^0x/i, "").toLowerCase();

    if (cleanAddress.length > 64) {
        throw new RangeError(`Address ${String(address)} has more than 64 hex digits`);
    }

    return `0x${cleanAddress.padStart(64, "0")}`;
}