import type { MoveFunctionId, MoveModule, SimpleEntryFunctionArgumentTypes, TypeArgument } from "./move";
import type { SubmitTransactionResponse } from "./transactionManager/transactionSubmit";

/**
 * The entry function a multisig proposal runs as the multisig account. The arguments are encoded with the function's
 * ABI, as for `transaction.build.simple`; the leading `&signer` parameter is the multisig account and is not passed.
 */
export interface MultisigEntryFunctionPayload {
    /** The entry function, `address::module::function`. */
    function: MoveFunctionId;
    /** The type arguments of the function. */
    functionTypeArgs?: Array<TypeArgument>;
    /** The arguments of the function, without the `&signer` parameter. */
    functionArgs: Array<SimpleEntryFunctionArgumentTypes>;
    /** The ABI of the function's module, to skip the request that reads it. */
    abi?: MoveModule;
}

/** The vote of one owner on a proposal. */
export interface MultisigVote {
    /** The owner's address, `0x` followed by 64 hex digits. */
    owner: string;
    /** `true` for an approval, `false` for a rejection. */
    approved: boolean;
}

/**
 * A proposal of a multisig account, as `0x1::multisig_account::get_transaction` returns it. A proposal stores either
 * its payload (`create_transaction`) or the SHA3-256 hash of its payload (`create_transaction_with_hash`).
 */
export interface MultisigProposal {
    /** The proposal's number in the multisig account's queue, starting at 1. */
    sequenceNumber: bigint;
    /**
     * The BCS bytes of the stored payload (a `MultiSigTransactionPayload`: a variant index followed by the entry
     * function) as `0x`-prefixed hex; `undefined` when the proposal stores only a hash.
     */
    payload: string | undefined;
    /** The stored SHA3-256 hash of the payload as `0x`-prefixed hex; `undefined` when the proposal stores its payload. */
    payloadHash: string | undefined;
    /** The votes cast so far, in the order the node returns them. */
    votes: MultisigVote[];
    /** The owner who created the proposal, `0x` followed by 64 hex digits. */
    creator: string;
    /** The time the proposal was created, in seconds since the Unix epoch. */
    creationTimeSecs: bigint;
}

/**
 * The positions in a multisig account's queue of proposals. Proposals `lastResolved + 1` up to `next - 1` are pending;
 * the next proposal to execute or remove is `lastResolved + 1`, and a new proposal gets the number `next`. The queue is
 * empty when `lastResolved + 1 === next`.
 */
export interface MultisigSequenceNumbers {
    /** The number of the last proposal that was executed (successfully or not) or removed; 0 before the first. */
    lastResolved: bigint;
    /** The number the next new proposal gets; 1 before the first. */
    next: bigint;
}

/**
 * The result of `createMultisigAccount`: the address of the new multisig account and the transaction that creates it.
 */
export interface CreateMultisigAccountResponse {
    /** The address of the new multisig account, `0x` followed by 64 hex digits. */
    multisigAddress: string;
    /** The submission's result; {@link SubmitTransactionResponse} describes it. */
    transaction: SubmitTransactionResponse;
}
