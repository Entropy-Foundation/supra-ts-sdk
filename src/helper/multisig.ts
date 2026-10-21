import { BCS } from "supra-l1-sdk-core";
import sha3 from "js-sha3";
import type { AccountAddressInput } from "../types/account";
import { addressToBytes } from "./account";

/** The salt that `0x1::multisig_account` puts before the creator's sequence number in the seed of the account. */
const MULTISIG_ACCOUNT_SEED_PREFIX = "supra_framework::multisig_account";

/** The scheme byte that ends the preimage of a resource account address (`DERIVE_RESOURCE_ACCOUNT_SCHEME`). */
const RESOURCE_ACCOUNT_SCHEME = 0xff;

/**
 * The address of the multisig account that `0x1::multisig_account::create_with_owners` (and `create`) creates when it
 * runs in the transaction of `creatorAddress` with the sequence number `sequenceNumber`: the framework creates a
 * resource account from the creator's address and the creator's sequence number. `createMultisigAccount` returns this
 * address. It is also the address of the account that a transaction with this sender and sequence number would create
 * when its outcome is unknown (`SupraSubmissionOutcomeUnknownError` carries both).
 * @param args.creatorAddress - The address of the account that sends the creating transaction.
 * @param args.sequenceNumber - The sequence number of the creating transaction.
 * @returns The multisig account's address, `0x` followed by 64 lower-case hex digits.
 * @throws {RangeError} If `creatorAddress` is not 1 to 64 hex digits after an optional `0x` prefix, or
 * `sequenceNumber` is not an integer from 0 to 2^64 - 1.
 * @example
 * ```typescript
 * import { deriveMultisigAccountAddress } from "supra-ts-sdk";
 *
 * const multisigAddress = deriveMultisigAccountAddress({ creatorAddress: "0x1234", sequenceNumber: 0n });
 * console.log(multisigAddress);
 * ```
 * @group Multisig
 */
export function deriveMultisigAccountAddress(args: {
    creatorAddress: AccountAddressInput;
    sequenceNumber: bigint | number;
}): string {
    const sequenceNumber = BigInt(args.sequenceNumber);
    if (sequenceNumber < 0n || sequenceNumber >= 1n << 64n) {
        throw new RangeError(
            `sequenceNumber must be an integer from 0 to 2^64 - 1, got ${String(args.sequenceNumber)}`,
        );
    }
    const seed = new TextEncoder().encode(MULTISIG_ACCOUNT_SEED_PREFIX);
    const nonce = BCS.bcsSerializeUint64(sequenceNumber);
    const creator = addressToBytes(args.creatorAddress);
    const preimage = new Uint8Array(creator.length + seed.length + nonce.length + 1);
    preimage.set(creator, 0);
    preimage.set(seed, creator.length);
    preimage.set(nonce, creator.length + seed.length);
    preimage[preimage.length - 1] = RESOURCE_ACCOUNT_SCHEME;
    return `0x${sha3.sha3_256(preimage)}`;
}
