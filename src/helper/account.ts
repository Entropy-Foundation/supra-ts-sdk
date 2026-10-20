import { HexString } from "supra-l1-sdk-core";
import type { AccountAddressInput } from "../types/account";

/** One to 64 hex digits, in either case. */
const HEX_DIGITS = /^[0-9a-fA-F]{1,64}$/;

/**
 * Standardize an address
 * @param address - The address to standardize: 1 to 64 hex digits in either case, after an optional `0x` or `0X`
 * prefix
 * @returns The standardized address: `0x` followed by 64 lower-case hex digits, padded with leading zeros
 * @throws {RangeError} When the address, after the optional prefix, is not 1 to 64 hex digits
 * @example
 * ```typescript
 * import { standardizeAddress } from "supra-ts-sdk";
 *
 * const standardizedAddress = standardizeAddress("0x1234");
 * console.log(standardizedAddress); // "0x" followed by 64 hex digits, "1234" at the end
 * ```
 */
export function standardizeAddress(address: AccountAddressInput): string {
    const digits = String(address).replace(/^0[xX]/, "");
    if (!HEX_DIGITS.test(digits)) {
        throw new RangeError(`Address ${String(address)} is not 1 to 64 hex digits after an optional 0x prefix`);
    }
    return `0x${digits.toLowerCase().padStart(64, "0")}`;
}

/**
 * Encode an address as the 32-byte argument the node expects. Addresses shorter than 64 hex
 * characters are left-padded with zeros.
 * @param address - The address to encode
 * @returns The 32 address bytes
 * @throws {RangeError} If the address, after an optional `0x` or `0X` prefix, is not 1 to 64 hex digits
 */
export function addressToBytes(address: AccountAddressInput): Uint8Array {
    return new HexString(standardizeAddress(address)).toUint8Array();
}
