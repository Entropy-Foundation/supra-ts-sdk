import { SupraError } from "./supraError";

/**
 * SupraMultisigNoProposalError is thrown by `executeMultisigTransaction` when the multisig account has no pending
 * proposal. No transaction is submitted.
 * @group Errors
 */
export class SupraMultisigNoProposalError extends SupraError {
    /** The address of the multisig account. */
    readonly multisigAddress: string;

    constructor(args: { multisigAddress: string }) {
        super(`The multisig account ${args.multisigAddress} has no pending proposal to execute`);
        this.name = "SupraMultisigNoProposalError";
        this.multisigAddress = args.multisigAddress;
    }

    toJSON() {
        return { name: this.name, message: this.message, multisigAddress: this.multisigAddress };
    }
}

/**
 * SupraMultisigPayloadError is thrown by `executeMultisigTransaction` when the payload of the call cannot execute the
 * next proposal. No transaction is submitted. `reason` is:
 *
 * - `"required"`: the proposal stores only the hash of its payload and the call gave no payload.
 * - `"hash-mismatch"`: the proposal stores only the hash of its payload and the SHA3-256 hash of the call's payload is
 *   another one.
 * - `"stored-mismatch"`: the proposal stores its payload and the call's payload encodes to other bytes.
 * - `"stored-undecodable"`: the proposal stores a payload that is not an entry function payload in the BCS form the SDK
 *   writes (another variant, trailing bytes, or bytes that do not decode), and the call has no `maxGas` or enables
 *   `enableTransactionSimulation`: the node refuses to simulate an execution without a payload, and the SDK simulates
 *   it with the stored payload. Give `maxGas` (on the call or the client) and leave `enableTransactionSimulation` off.
 * @group Errors
 */
export class SupraMultisigPayloadError extends SupraError {
    /** Why the payload cannot execute the proposal. */
    readonly reason: "required" | "hash-mismatch" | "stored-mismatch" | "stored-undecodable";
    /** The address of the multisig account. */
    readonly multisigAddress: string;
    /** The number of the proposal that the call would have executed. */
    readonly sequenceNumber: bigint;

    constructor(args: {
        reason: "required" | "hash-mismatch" | "stored-mismatch" | "stored-undecodable";
        multisigAddress: string;
        sequenceNumber: bigint;
    }) {
        const where = `proposal ${args.sequenceNumber} of the multisig account ${args.multisigAddress}`;
        const detail = {
            required: `${where} stores only the hash of its payload, and the call gave no payload to execute it with`,
            "hash-mismatch": `the hash of the payload of the call is not the hash that ${where} stores`,
            "stored-mismatch": `the payload of the call is not the payload that ${where} stores`,
            "stored-undecodable":
                `the payload that ${where} stores cannot be decoded, so the execution cannot be simulated; ` +
                `give maxGas and leave enableTransactionSimulation off`,
        }[args.reason];
        super(`The payload cannot execute the proposal: ${detail}`);
        this.name = "SupraMultisigPayloadError";
        this.reason = args.reason;
        this.multisigAddress = args.multisigAddress;
        this.sequenceNumber = args.sequenceNumber;
    }

    toJSON() {
        return {
            name: this.name,
            message: this.message,
            reason: this.reason,
            multisigAddress: this.multisigAddress,
            sequenceNumber: this.sequenceNumber.toString(),
        };
    }
}
