import { HexString } from "supra-l1-sdk-core";
import type { AccountAddressInput } from "../types/account";

/**
 * Standardize an address
 * @param address - The address to standardize
 * @returns The standardized address: `0x` followed by 64 lower-case hex digits, padded with leading zeros
 * @throws {RangeError} When the address has more than 64 hex digits
 * @example
 * ```typescript
 * import { standardizeAddress } from "supra-ts-sdk";
 *
 * const standardizedAddress = standardizeAddress("0x1234");
 * console.log(standardizedAddress); // "0x" followed by 64 hex digits, "1234" at the end
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

/**
 * Encode an address as the 32-byte argument the node expects. Addresses shorter than 64 hex
 * characters are left-padded with zeros.
 * @param address - The address to encode
 * @returns The 32 address bytes
 * @throws {RangeError} If the address has more than 64 hex characters
 */
export function addressToBytes(address: AccountAddressInput): Uint8Array {
    return new HexString(standardizeAddress(address)).toUint8Array();
}
