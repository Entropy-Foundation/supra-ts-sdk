import type { SupraAccount } from "supra-l1-sdk-core";
import { validateAddress, validateAmount, validateFunctionId } from "../helper/validation";
import type { AccountAddressInput } from "../types/account";
import type {
    CreateMultisigAccountResponse,
    MultisigEntryFunctionPayload,
    MultisigProposal,
    MultisigSequenceNumbers,
} from "../types/multisig";
import type { OptionalTransactionArgs, SubmitTransactionResponse } from "../types/transactionManager/transactionSubmit";
import type { NetworkConfig } from "../utils/apiEndpoints";
import { MIN_MULTISIG_TIMEOUT_DURATION_SECS } from "../utils/constants";
import {
    createMultisigAccountInternal,
    executeMultisigTransactionInternal,
    executeRejectedMultisigTransactionInternal,
    getMultisigProposalInternal,
    getMultisigSequenceNumbersInternal,
    getNextMultisigProposalInternal,
    proposeMultisigTransactionInternal,
    proposeMultisigTransactionWithHashInternal,
    voteMultisigTransactionInternal,
} from "../internal/multisig";
import { retryWithFreshSequenceNumber } from "../internal/sequenceNumber";

function validatePayload(payload: MultisigEntryFunctionPayload): void {
    validateFunctionId(payload.function, "payload.function");
}

function validateSequenceNumber(value: unknown): void {
    validateAmount(value, "sequenceNumber");
    if (BigInt(value as number | bigint) < 1n) {
        throw new Error(`Invalid sequenceNumber: proposals are numbered from 1, got ${String(value)}`);
    }
}

async function vote(
    args: {
        senderAccount: SupraAccount;
        multisigAddress: AccountAddressInput;
        sequenceNumber: number | bigint;
        optionalTransactionArgs?: OptionalTransactionArgs;
    },
    approved: boolean,
    config: NetworkConfig,
): Promise<SubmitTransactionResponse> {
    validateAddress(args.multisigAddress, "multisigAddress");
    validateSequenceNumber(args.sequenceNumber);
    return retryWithFreshSequenceNumber(
        args.optionalTransactionArgs?.optionalTransactionPayloadArgs?.sequenceNumber,
        () => voteMultisigTransactionInternal({ ...args, approved }, config),
    );
}

/**
 * The Multisig class provides methods for the lifecycle of a multisig account (`0x1::multisig_account`): creating the
 * account, proposing a transaction, approving or rejecting it, executing it, and removing a rejected one.
 *
 * Each method that sends a transaction takes the sender's `SupraAccount` and `optionalTransactionArgs` and goes
 * through the same path as the other helpers: the sequence number comes from the client's counter unless
 * `optionalTransactionPayloadArgs.sequenceNumber` is set, the client submits its calls from one account one after
 * another, the client checks the chain ID of its node before it signs (see {@link SupraConfig}), and without a
 * `maxGas` the max gas is estimated (see {@link OptionalTransactionPayloadArgs}).
 * @group Multisig
 */
export class Multisig {
    /**
     * The networkInformation property is A NetworkConfig object that contains information about the network on which the Supra client is running.
     */
    protected readonly networkInformation: NetworkConfig;

    /**
     * The constructor function takes a NetworkConfig object as a parameter and assigns it to the networkInformation property.
     * @param networkInformation - A NetworkConfig object that contains information about the network on which the Supra client is running.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     * ```
     * @group Multisig
     */
    constructor(networkInformation: NetworkConfig) {
        this.networkInformation = networkInformation;
    }

    /**
     * Creates a multisig account (`0x1::multisig_account::create_with_owners`) owned by the sender and
     * `additionalOwners`, and returns its address.
     *
     * The address is derived from the sender's address and the sequence number of the creating transaction, as the
     * framework derives it ({@link deriveMultisigAccountAddress}); it is returned whether or not the call waits for the
     * commit, and the account exists once the transaction has executed successfully. When the submission's outcome is
     * unknown (`SupraSubmissionOutcomeUnknownError`) no address is returned; the error's `sender` and `sequenceNumber`
     * give it. The account holds no SUPRA at first; send SUPRA to its address to fund transactions it executes.
     * @param args.senderAccount - The account that creates the multisig account and becomes one of its owners.
     * @param args.additionalOwners - The addresses of the other owners. The sender must not be in the list and the
     * list must hold no duplicates.
     * @param args.signaturesRequired - The number of approvals a proposal needs, from 1 to the number of owners (the
     * sender included).
     * @param args.timeoutDurationSecs - The time in seconds that a proposal can be executed after its creation, at
     * least `MIN_MULTISIG_TIMEOUT_DURATION_SECS` (300). Default `DEFAULT_MULTISIG_TIMEOUT_DURATION_SECS` (seven days).
     * @param args.optionalTransactionArgs - Optional transaction arguments (see {@link OptionalTransactionArgs}).
     * @returns A Promise that resolves to the account's address and the `SubmitTransactionResponse` of the creating
     * transaction. {@link Submit} describes the statuses and errors of a submission.
     * @throws {SupraSimulationFailedError} When the estimating simulation or an enabled simulation does not succeed,
     * for example when `signaturesRequired` exceeds the number of owners.
     * @throws {SupraTransactionFailedError} When `enableWaitForTransaction` is set and the transaction fails.
     * @example
     * ```typescript
     * import { Network, SupraAccount, SupraClient } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     * const senderAccount = new SupraAccount(); // an account that holds SUPRA
     * const secondOwner = new SupraAccount().address();
     *
     * async function runExample() {
     *    const { multisigAddress } = await supra.multisig.createMultisigAccount({
     *        senderAccount: senderAccount,
     *        additionalOwners: [secondOwner],
     *        signaturesRequired: 2,
     *        optionalTransactionArgs: { enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true } },
     *    });
     *    console.log(multisigAddress);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Multisig
     */
    async createMultisigAccount(args: {
        senderAccount: SupraAccount;
        additionalOwners?: AccountAddressInput[];
        signaturesRequired: number | bigint;
        timeoutDurationSecs?: number | bigint;
        optionalTransactionArgs?: OptionalTransactionArgs;
    }): Promise<CreateMultisigAccountResponse> {
        for (const owner of args.additionalOwners ?? []) {
            validateAddress(owner, "additionalOwners");
        }
        validateAmount(args.signaturesRequired, "signaturesRequired");
        if (args.timeoutDurationSecs !== undefined) {
            validateAmount(args.timeoutDurationSecs, "timeoutDurationSecs");
            if (BigInt(args.timeoutDurationSecs) < BigInt(MIN_MULTISIG_TIMEOUT_DURATION_SECS)) {
                throw new Error(
                    `Invalid timeoutDurationSecs: at least ${MIN_MULTISIG_TIMEOUT_DURATION_SECS} seconds, got ${String(args.timeoutDurationSecs)}`,
                );
            }
        }
        return retryWithFreshSequenceNumber(
            args.optionalTransactionArgs?.optionalTransactionPayloadArgs?.sequenceNumber,
            () => createMultisigAccountInternal(args, this.networkInformation),
        );
    }

    /**
     * Proposes a transaction of a multisig account with its payload stored on chain
     * (`0x1::multisig_account::create_transaction`). The proposal has the sender's approval. Any owner can execute it
     * once it has enough approvals, with `executeMultisigTransaction`, which sends no payload for it.
     *
     * The proposal's number is the `next` of {@link getMultisigSequenceNumbers} before the call (when no other owner
     * proposes at the same time).
     * @param args.senderAccount - An owner of the multisig account.
     * @param args.multisigAddress - The address of the multisig account.
     * @param args.payload - The entry function the multisig account runs.
     * @param args.optionalTransactionArgs - Optional transaction arguments (see {@link OptionalTransactionArgs}).
     * @returns A Promise that resolves to a `SubmitTransactionResponse`. {@link Submit} describes the statuses and
     * errors of a submission.
     * @example
     * ```typescript
     * import { Network, SupraAccount, SupraClient } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     * const senderAccount = new SupraAccount(); // an owner of the multisig account, holding SUPRA
     * const multisigAddress = "0x1234"; // replace with the address of the multisig account
     *
     * async function runExample() {
     *    const response = await supra.multisig.proposeMultisigTransaction({
     *        senderAccount: senderAccount,
     *        multisigAddress: multisigAddress,
     *        payload: { function: "0x1::supra_account::transfer", functionArgs: ["0x2", 1000n] },
     *        optionalTransactionArgs: { enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true } },
     *    });
     *    console.log(response);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Multisig
     */
    async proposeMultisigTransaction(args: {
        senderAccount: SupraAccount;
        multisigAddress: AccountAddressInput;
        payload: MultisigEntryFunctionPayload;
        optionalTransactionArgs?: OptionalTransactionArgs;
    }): Promise<SubmitTransactionResponse> {
        validateAddress(args.multisigAddress, "multisigAddress");
        validatePayload(args.payload);
        return retryWithFreshSequenceNumber(
            args.optionalTransactionArgs?.optionalTransactionPayloadArgs?.sequenceNumber,
            () => proposeMultisigTransactionInternal(args, this.networkInformation),
        );
    }

    /**
     * Proposes a transaction of a multisig account storing only the SHA3-256 hash of its payload on chain
     * (`0x1::multisig_account::create_transaction_with_hash`). The executor provides the payload:
     * `executeMultisigTransaction` with the same `payload` checks it against the stored hash and sends it.
     * @param args.senderAccount - An owner of the multisig account.
     * @param args.multisigAddress - The address of the multisig account.
     * @param args.payload - The entry function the multisig account runs.
     * @param args.optionalTransactionArgs - Optional transaction arguments (see {@link OptionalTransactionArgs}).
     * @returns A Promise that resolves to a `SubmitTransactionResponse`. {@link Submit} describes the statuses and
     * errors of a submission.
     * @example
     * ```typescript
     * import { Network, SupraAccount, SupraClient } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     * const senderAccount = new SupraAccount(); // an owner of the multisig account, holding SUPRA
     * const multisigAddress = "0x1234"; // replace with the address of the multisig account
     *
     * async function runExample() {
     *    const response = await supra.multisig.proposeMultisigTransactionWithHash({
     *        senderAccount: senderAccount,
     *        multisigAddress: multisigAddress,
     *        payload: { function: "0x1::supra_account::transfer", functionArgs: ["0x2", 1000n] },
     *    });
     *    console.log(response);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Multisig
     */
    async proposeMultisigTransactionWithHash(args: {
        senderAccount: SupraAccount;
        multisigAddress: AccountAddressInput;
        payload: MultisigEntryFunctionPayload;
        optionalTransactionArgs?: OptionalTransactionArgs;
    }): Promise<SubmitTransactionResponse> {
        validateAddress(args.multisigAddress, "multisigAddress");
        validatePayload(args.payload);
        return retryWithFreshSequenceNumber(
            args.optionalTransactionArgs?.optionalTransactionPayloadArgs?.sequenceNumber,
            () => proposeMultisigTransactionWithHashInternal(args, this.networkInformation),
        );
    }

    /**
     * Approves a proposal of a multisig account (`0x1::multisig_account::approve_transaction`). An owner who has
     * rejected the proposal changes the vote to an approval.
     * @param args.senderAccount - An owner of the multisig account.
     * @param args.multisigAddress - The address of the multisig account.
     * @param args.sequenceNumber - The proposal's number, from 1.
     * @param args.optionalTransactionArgs - Optional transaction arguments (see {@link OptionalTransactionArgs}).
     * @returns A Promise that resolves to a `SubmitTransactionResponse`. {@link Submit} describes the statuses and
     * errors of a submission.
     * @example
     * ```typescript
     * import { Network, SupraAccount, SupraClient } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     * const senderAccount = new SupraAccount(); // an owner of the multisig account, holding SUPRA
     * const multisigAddress = "0x1234"; // replace with the address of the multisig account
     *
     * async function runExample() {
     *    const response = await supra.multisig.approveMultisigTransaction({
     *        senderAccount: senderAccount,
     *        multisigAddress: multisigAddress,
     *        sequenceNumber: 1,
     *    });
     *    console.log(response);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Multisig
     */
    async approveMultisigTransaction(args: {
        senderAccount: SupraAccount;
        multisigAddress: AccountAddressInput;
        sequenceNumber: number | bigint;
        optionalTransactionArgs?: OptionalTransactionArgs;
    }): Promise<SubmitTransactionResponse> {
        return vote(args, true, this.networkInformation);
    }

    /**
     * Rejects a proposal of a multisig account (`0x1::multisig_account::reject_transaction`). An owner who has
     * approved the proposal changes the vote to a rejection. With enough rejections, any owner can remove the proposal
     * with `executeRejectedMultisigTransaction`.
     * @param args.senderAccount - An owner of the multisig account.
     * @param args.multisigAddress - The address of the multisig account.
     * @param args.sequenceNumber - The proposal's number, from 1.
     * @param args.optionalTransactionArgs - Optional transaction arguments (see {@link OptionalTransactionArgs}).
     * @returns A Promise that resolves to a `SubmitTransactionResponse`. {@link Submit} describes the statuses and
     * errors of a submission.
     * @example
     * ```typescript
     * import { Network, SupraAccount, SupraClient } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     * const senderAccount = new SupraAccount(); // an owner of the multisig account, holding SUPRA
     * const multisigAddress = "0x1234"; // replace with the address of the multisig account
     *
     * async function runExample() {
     *    const response = await supra.multisig.rejectMultisigTransaction({
     *        senderAccount: senderAccount,
     *        multisigAddress: multisigAddress,
     *        sequenceNumber: 1,
     *    });
     *    console.log(response);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Multisig
     */
    async rejectMultisigTransaction(args: {
        senderAccount: SupraAccount;
        multisigAddress: AccountAddressInput;
        sequenceNumber: number | bigint;
        optionalTransactionArgs?: OptionalTransactionArgs;
    }): Promise<SubmitTransactionResponse> {
        return vote(args, false, this.networkInformation);
    }

    /**
     * Executes the next proposal of a multisig account, the one after the last executed or removed. The method reads
     * the proposal first and sends the transaction that matches it:
     *
     * - A proposal that stores its payload (`proposeMultisigTransaction`) is executed without a payload; the node reads
     *   it from the proposal. When the call gives a `payload` too, it must encode to the stored bytes.
     * - A proposal that stores only a hash (`proposeMultisigTransactionWithHash`) is executed with the call's
     *   `payload`, whose SHA3-256 hash must be the stored one.
     *
     * The sender pays the gas and the proposal runs as the multisig account. The node executes the proposal only when
     * it has enough approvals (counting the sender's implicit approval) and has not timed out; otherwise it refuses
     * the transaction. The proposal can change between the read and the submission (another owner executes it first);
     * the transaction then runs the proposal that is next when the node executes it, or is refused when that is a
     * proposal that stores only a hash.
     *
     * The nodes of v11.7.0 and v12.0.0.rc6 do not simulate an execution without a payload (they report
     * `MISSING_DATA`). The max gas estimate and `enableTransactionSimulation` therefore simulate the execution with the
     * stored payload carried, and the sent transaction, its signature and its hash are those of the execution without
     * a payload.
     * @param args.senderAccount - An owner of the multisig account.
     * @param args.multisigAddress - The address of the multisig account.
     * @param args.payload - The entry function of the proposal. Required for a proposal that stores only a hash;
     * optional for one that stores its payload.
     * @param args.optionalTransactionArgs - Optional transaction arguments (see {@link OptionalTransactionArgs}).
     * @returns A Promise that resolves to a `SubmitTransactionResponse`. {@link Submit} describes the statuses and
     * errors of a submission. A final status of `Success` means the multisig transaction was executed; whether the
     * proposal's own function succeeded is in the transaction's events.
     * @throws {SupraMultisigNoProposalError} When the multisig account has no pending proposal.
     * @throws {SupraMultisigPayloadError} Before submitting, when the proposal stores only a hash and `payload` is
     * missing or hashes to another value, or when the proposal stores its payload and `payload` encodes to other bytes.
     * @example
     * ```typescript
     * import { Network, SupraAccount, SupraClient } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     * const senderAccount = new SupraAccount(); // an owner of the multisig account, holding SUPRA
     * const multisigAddress = "0x1234"; // replace with the address of the multisig account
     *
     * async function runExample() {
     *    const response = await supra.multisig.executeMultisigTransaction({
     *        senderAccount: senderAccount,
     *        multisigAddress: multisigAddress,
     *        optionalTransactionArgs: { enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true } },
     *    });
     *    console.log(response);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Multisig
     */
    async executeMultisigTransaction(args: {
        senderAccount: SupraAccount;
        multisigAddress: AccountAddressInput;
        payload?: MultisigEntryFunctionPayload;
        optionalTransactionArgs?: OptionalTransactionArgs;
    }): Promise<SubmitTransactionResponse> {
        validateAddress(args.multisigAddress, "multisigAddress");
        if (args.payload !== undefined) {
            validatePayload(args.payload);
        }
        return retryWithFreshSequenceNumber(
            args.optionalTransactionArgs?.optionalTransactionPayloadArgs?.sequenceNumber,
            () => executeMultisigTransactionInternal(args, this.networkInformation),
        );
    }

    /**
     * Removes the next proposal of a multisig account when it has enough rejections or has timed out
     * (`0x1::multisig_account::execute_rejected_transaction`). The sender's own rejection is counted. Proposals are
     * resolved in order, so a proposal that cannot be executed blocks the queue until it is removed this way.
     * @param args.senderAccount - An owner of the multisig account.
     * @param args.multisigAddress - The address of the multisig account.
     * @param args.optionalTransactionArgs - Optional transaction arguments (see {@link OptionalTransactionArgs}).
     * @returns A Promise that resolves to a `SubmitTransactionResponse`. {@link Submit} describes the statuses and
     * errors of a submission.
     * @example
     * ```typescript
     * import { Network, SupraAccount, SupraClient } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     * const senderAccount = new SupraAccount(); // an owner of the multisig account, holding SUPRA
     * const multisigAddress = "0x1234"; // replace with the address of the multisig account
     *
     * async function runExample() {
     *    const response = await supra.multisig.executeRejectedMultisigTransaction({
     *        senderAccount: senderAccount,
     *        multisigAddress: multisigAddress,
     *    });
     *    console.log(response);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Multisig
     */
    async executeRejectedMultisigTransaction(args: {
        senderAccount: SupraAccount;
        multisigAddress: AccountAddressInput;
        optionalTransactionArgs?: OptionalTransactionArgs;
    }): Promise<SubmitTransactionResponse> {
        validateAddress(args.multisigAddress, "multisigAddress");
        return retryWithFreshSequenceNumber(
            args.optionalTransactionArgs?.optionalTransactionPayloadArgs?.sequenceNumber,
            () => executeRejectedMultisigTransactionInternal(args, this.networkInformation),
        );
    }

    /**
     * Reads the positions in a multisig account's queue of proposals: the number of the last executed or removed
     * proposal and the number the next new proposal gets. The two are read with two requests.
     * @param args.multisigAddress - The address of the multisig account.
     * @returns A Promise that resolves to `{ lastResolved, next }`; proposals `lastResolved + 1` to `next - 1` are
     * pending.
     * @throws {SupraAPIError} When the address is not a multisig account.
     * @example
     * ```typescript
     * import { Network, SupraClient } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *    const { lastResolved, next } = await supra.multisig.getMultisigSequenceNumbers({ multisigAddress: "0x1234" });
     *    console.log(lastResolved, next);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Multisig
     */
    async getMultisigSequenceNumbers(args: { multisigAddress: AccountAddressInput }): Promise<MultisigSequenceNumbers> {
        validateAddress(args.multisigAddress, "multisigAddress");
        return getMultisigSequenceNumbersInternal(args, this.networkInformation);
    }

    /**
     * Reads a proposal of a multisig account with its votes (`0x1::multisig_account::get_transaction`).
     * @param args.multisigAddress - The address of the multisig account.
     * @param args.sequenceNumber - The proposal's number, from 1.
     * @returns A Promise that resolves to the {@link MultisigProposal}.
     * @throws {SupraAPIError} When the address is not a multisig account or no proposal has that number.
     * @example
     * ```typescript
     * import { Network, SupraClient } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *    const proposal = await supra.multisig.getMultisigProposal({ multisigAddress: "0x1234", sequenceNumber: 1 });
     *    console.log(proposal.votes);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Multisig
     */
    async getMultisigProposal(args: {
        multisigAddress: AccountAddressInput;
        sequenceNumber: number | bigint;
    }): Promise<MultisigProposal> {
        validateAddress(args.multisigAddress, "multisigAddress");
        validateSequenceNumber(args.sequenceNumber);
        return getMultisigProposalInternal(args, this.networkInformation);
    }

    /**
     * Reads the next proposal of a multisig account to execute or remove, with its votes.
     * @param args.multisigAddress - The address of the multisig account.
     * @returns A Promise that resolves to the {@link MultisigProposal}, or `undefined` when the queue is empty.
     * @throws {SupraAPIError} When the address is not a multisig account.
     * @example
     * ```typescript
     * import { Network, SupraClient } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *    const proposal = await supra.multisig.getNextMultisigProposal({ multisigAddress: "0x1234" });
     *    console.log(proposal?.sequenceNumber);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Multisig
     */
    async getNextMultisigProposal(args: {
        multisigAddress: AccountAddressInput;
    }): Promise<MultisigProposal | undefined> {
        validateAddress(args.multisigAddress, "multisigAddress");
        return getNextMultisigProposalInternal(args, this.networkInformation);
    }
}
