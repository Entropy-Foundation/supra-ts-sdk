// Portions of this file are derived from @aptos-labs/ts-sdk (https://github.com/aptos-labs/aptos-ts-sdk),
// Copyright © Aptos Foundation, licensed under the Apache License, Version 2.0. See NOTICE.
import type { NetworkConfig } from "../utils/apiEndpoints";
import type {
    CommittedTransactionResponse,
    TransactionQueryType,
    TransactionResponse,
    WaitForTransactionOptions,
} from "../types/transaction";
import {
    getTransactionByHashInternal,
    getTransactionSignatureMessageInternal,
    isPendingTransactionInternal,
    publishPackageInternal,
    signTransactionInternal,
    waitForTransactionInternal,
} from "../internal/transaction";

import { retryWithFreshSequenceNumber } from "../internal/sequenceNumber";
import { Build } from "./transactionManager/txnBuild";
import { TxnBuilderTypes, type AnyRawTransaction, type HexString, type SupraAccount } from "supra-l1-sdk-core";
import { Simulate } from "./transactionManager/txnSimulate";
import { Submit } from "./transactionManager/txnSubmit";
import type { OptionalTransactionArgs, SubmitTransactionResponse } from "../types/transactionManager/transactionSubmit";
import { validateTransactionHash } from "../helper/validation";
import { transactionHashInternal } from "../internal/transactionManager/txnHash";

/**
 * The Transaction class provides methods for interacting with the Supra network.
 * @group Transaction
 */
export class Transaction {
    /**
     * The networkInformation property is A NetworkConfig object that contains information about the network on which the Supra client is running.
     */
    protected readonly networkInformation: NetworkConfig;

    /**
     * The build property is an instance of the Build class, which is used to build transactions.
     */
    readonly build: Build;

    /**
     * The simulate property is an instance of the Simulate class, which is used to simulate transactions.
     */
    readonly simulate: Simulate;

    /**
     * The submit property is an instance of the Submit class, which is used to submit transactions.
     */
    readonly submit: Submit;

    /**
     * The constructor function takes a NetworkConfig object as a parameter and assigns it to the networkInformation property.
     * @param networkInformation - A NetworkConfig object that contains information about the network on which the Supra client is running.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     * ```
     * @group Transaction
     */
    constructor(networkInformation: NetworkConfig) {
        this.networkInformation = networkInformation;
        this.build = new Build(networkInformation);
        this.simulate = new Simulate(networkInformation);
        this.submit = new Submit(networkInformation);
    }

    /**
     * Queries on-chain transactions by their transaction hash, returning both pending and committed transactions.
     * @param args - The arguments for querying the transaction.
     * @param args.transactionHash - The transaction hash should be a hex-encoded bytes string with a 0x prefix.
     * @param args.type - The type of transaction to query. `"settlement"` requires a node from v12 onwards; older
     * nodes reject it with HTTP 400.
     * @param args.exclude_uncommitted - Whether to exclude uncommitted transactions.
     * @returns A Promise that resolves to a TransactionResponse object. Only user and automated transactions have
     * `header`, `payload` and `authenticator`; narrow on `txn_type` before reading them.
     * @throws {SupraAPIError} HTTP 404 for an unknown hash. A hash that is not hexadecimal is HTTP 400 on v12 and
     * HTTP 404 on v11. See "HTTP status codes by node version" in the README.
     * @example
     * ```typescript
     * import { Network, SupraClient } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *   // Fetch a transaction by its hash
     *   const transaction = await supra.transaction.getTransactionByHash({ transactionHash: "0x123" }); // replace with a real transaction hash
     *
     *   console.log(transaction);
     * }
     * runExample().catch(console.error);
     * ```
     * @group Transaction
     */
    async getTransactionByHash(args: {
        transactionHash: string;
        type?: TransactionQueryType;
        exclude_uncommitted?: boolean;
    }): Promise<TransactionResponse> {
        validateTransactionHash(args.transactionHash);
        return getTransactionByHashInternal(args, this.networkInformation);
    }

    /**
     * Reads a transaction by its hash and tells whether it has no final status yet.
     * @param args - The arguments for querying the transaction.
     * @param args.transactionHash - The transaction hash should be a hex-encoded bytes string with a 0x prefix.
     * @returns A Promise that resolves to true when the status is `Pending` or `PendingAfterExecution`, and to false
     * when it is `Success`, `Fail` or `Invalid`.
     * @throws {SupraNotFoundError} When the node has no transaction with the hash.
     * @example
     * ```typescript
     * import { Network, SupraClient } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *   // Read a transaction by its hash
     *   const isPending = await supra.transaction.isPendingTransaction({ transactionHash: "0x123" }); // replace with a real transaction hash
     *
     *   console.log(isPending);
     * }
     * runExample().catch(console.error);
     * ```
     * @group Transaction
     */
    async isPendingTransaction(args: { transactionHash: string }): Promise<boolean> {
        validateTransactionHash(args.transactionHash);
        return isPendingTransactionInternal(args, this.networkInformation);
    }

    /**
     * Waits until a transaction has a final status and returns it.
     *
     * Statuses of a transaction:
     * - `Pending`: the RPC node accepted the transaction and it is not executed yet. Not final.
     * - `PendingAfterExecution`: the transaction was executed and discarded with a status that may change in a later
     *   execution (for example `SEQUENCE_NUMBER_TOO_NEW`). Not final. A transaction that keeps this status does not
     *   commit; it can be submitted again once the cause is resolved.
     * - `Success`: executed successfully. Final.
     * - `Fail`: executed and failed (for example a Move abort or `Out of gas`); the sequence number was incremented and
     *   the gas was charged. Final.
     * - `Invalid`: discarded, and discarded on every execution; the sequence number was not incremented. Final.
     *
     * The transaction is read again while its status is not final and while a read fails, including HTTP 404 for a
     * transaction the node has not seen yet. The timeout is wall-clock time from the start of the call.
     *
     * @param args.transactionHash - The transaction hash should be a hex-encoded bytes string with a 0x prefix.
     * @param args.options - The timeout and whether a final status other than `Success` throws; see
     * {@link WaitForTransactionOptions}. Optional.
     * @returns A Promise that resolves to the transaction with its final status: `Success`, or any final status when
     * `checkSuccess` is false.
     * @throws `SupraTransactionFailedError` (with `hash`, `status`, `vm_status`, `major_status`, `sub_status` and
     * `transaction`) when the final status is `Fail` or `Invalid` and `checkSuccess` is not false.
     * @throws `SupraTransactionTimeoutError` (with `hash` and `lastStatus`) when there is no final status within the
     * timeout.
     * @example
     * ```typescript
     * import { Network, SupraClient } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *   // Wait for a transaction to commit
     *   const transaction = await supra.transaction.waitForTransaction({
     *     transactionHash: "0x123", // replace with a real transaction hash
     *     options: { timeoutMs: 30_000 },
     *   });
     *
     *   console.log(transaction);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Transaction
     */
    async waitForTransaction(args: {
        transactionHash: string;
        options?: WaitForTransactionOptions;
    }): Promise<CommittedTransactionResponse> {
        validateTransactionHash(args.transactionHash);
        return waitForTransactionInternal(args, this.networkInformation);
    }

    /**
     * Generates signature message for supra transaction using `AnyRawTransaction`
     * @param args.rawTxn a RawTransaction, MultiAgentRawTransaction or FeePayerRawTransaction
     * @returns Signature message
     * @example
     * ```typescript
     * import { BCS, Network, SupraAccount, SupraClient } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     * const account = new SupraAccount(); // an account that holds SUPRA
     *
     * async function runExample() {
     *
     *   const rawTxn = supra.transaction.build.rawTxnObject({
     *     senderAddress: account.address(),
     *     senderSequenceNumber: 0n, // the account's sequence number
     *     function: "0x1::supra_account::transfer",
     *     functionTypeArgs: [],
     *     functionArgs: [new SupraAccount().address().toUint8Array(), BCS.bcsSerializeUint64(10000n)],
     *     optionalTransactionPayloadArgs: { gasUnitPrice: await supra.getEstimatedGasUnitPrice() },
     *   });
     *
     *   const signatureMessage = supra.transaction.getTransactionSignatureMessage({ rawTxn });
     *
     *   console.log(signatureMessage);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Transaction
     */
    getTransactionSignatureMessage(args: { rawTxn: AnyRawTransaction }): Uint8Array {
        return getTransactionSignatureMessageInternal(args);
    }

    /**
     * Sign any supra transaction.
     * signer authenticator to be used to submit the transaction.
     * @param args.senderAccount the account to sign on the transaction
     * @param args.rawTxn a RawTransaction, MultiAgentRawTransaction or FeePayerRawTransaction
     * @returns A promise of the ed25519 signature as a `HexString` for a `RawTransaction`, and of the signer's
     * `AccountAuthenticatorEd25519` for a `MultiAgentRawTransaction` or `FeePayerRawTransaction`.
     * @throws `SupraChainIdMismatchError` before signing when the client's chain ID or the chain ID of `rawTxn` is not
     * the node's. The node's chain ID is read before the first signature of the client; with `verifyChainId: false`
     * nothing is read or checked and no request is sent.
     * @example
     * ```typescript
     * import { BCS, Network, SupraAccount, SupraClient } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     * const account = new SupraAccount(); // an account that holds SUPRA
     *
     * async function runExample() {
     *
     *   const rawTxn = supra.transaction.build.rawTxnObject({
     *     senderAddress: account.address(),
     *     senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
     *     function: "0x1::supra_account::transfer",
     *     functionTypeArgs: [],
     *     functionArgs: [new SupraAccount().address().toUint8Array(), BCS.bcsSerializeUint64(10000n)],
     *     optionalTransactionPayloadArgs: { gasUnitPrice: await supra.getEstimatedGasUnitPrice() },
     *   });
     *
     *   const signature = await supra.transaction.signTransaction({ senderAccount: account, rawTxn });
     *
     *   console.log(signature.toString());
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Transaction
     */
    signTransaction(args: { senderAccount: SupraAccount; rawTxn: TxnBuilderTypes.RawTransaction }): Promise<HexString>;
    signTransaction(args: {
        senderAccount: SupraAccount;
        rawTxn: TxnBuilderTypes.MultiAgentRawTransaction | TxnBuilderTypes.FeePayerRawTransaction;
    }): Promise<TxnBuilderTypes.AccountAuthenticatorEd25519>;
    signTransaction(args: {
        senderAccount: SupraAccount;
        rawTxn: AnyRawTransaction;
    }): Promise<HexString | TxnBuilderTypes.AccountAuthenticatorEd25519>;
    signTransaction(args: {
        senderAccount: SupraAccount;
        rawTxn: AnyRawTransaction;
    }): Promise<HexString | TxnBuilderTypes.AccountAuthenticatorEd25519> {
        return signTransactionInternal(args, this.networkInformation);
    }

    /**
     * Derives the transaction hash from a signed transaction: the Keccak-256 of its BCS bytes, the hash the node gives
     * the transaction. The submit helpers derive the hash the same way before they submit, and report it in
     * `SupraSubmissionOutcomeUnknownError` when the outcome of the submission request is unknown.
     * @param args.signedTransaction - The signed transaction.
     * @returns The transaction hash as a `0x`-prefixed lower-case hex string, the form `getTransactionByHash` and
     * `waitForTransaction` accept.
     * @group Transaction
     */
    deriveTransactionHash(args: { signedTransaction: TxnBuilderTypes.SignedTransaction }): string {
        return transactionHashInternal(args.signedTransaction);
    }

    /**
     * Publish a package or module on the Supra network with `0x1::code::publish_package_txn`. The sequence number
     * comes from the client's counter unless `optionalTransactionPayloadArgs.sequenceNumber` is set, and the client
     * submits its calls from one account one after another. The client checks the chain ID of its node before it signs;
     * see {@link SupraConfig}.
     * @param args.senderAccount - Module Publisher KeyPair
     * @param args.packageMetadata - The BCS-encoded package metadata (the `package-metadata.bcs` file of a build)
     * @param args.modulesCode - The bytecode of each module of the package
     * @param args.optionalTransactionArgs optional arguments for transaction. The gas settings in
     * `optionalTransactionPayloadArgs` apply to the transaction; without `maxGas` it is estimated
     * (see {@link OptionalTransactionPayloadArgs}). The object is not modified.
     * @returns `SubmitTransactionResponse`; {@link Submit} describes the statuses and errors of a submission
     * @throws {SupraSimulationFailedError} When the estimating simulation or an enabled simulation does not succeed.
     * @throws {SupraGasUnitPriceBelowMinimumError} When the node refuses the submission or a simulation because the gas
     * unit price is below its minimum (this replaces `SupraSimulationFailedError` and `SupraAPIError` for that refusal).
     * @throws {SupraTransactionFailedError} When `enableWaitForTransaction` is set and the transaction fails.
     * @throws {SupraSubmissionOutcomeUnknownError} When the submission request times out, fails before the node
     * answers or is answered with a 5xx status other than 503 (after the wait, with `enableWaitForTransaction`).
     * @throws {SupraChainIdMismatchError} Before signing, when the chain ID is not the node's.
     * @example
     * ```typescript
     * import { readFileSync } from "node:fs";
     * import { Network, SupraAccount, SupraClient } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     * const account = new SupraAccount(); // an account that holds SUPRA
     *
     * async function runExample() {
     *
     *   const response = await supra.transaction.publishPackage({
     *      senderAccount: account,
     *      packageMetadata: readFileSync("build/MyPackage/package-metadata.bcs"),
     *      modulesCode: [readFileSync("build/MyPackage/bytecode_modules/my_module.mv")],
     *   });
     *
     *   console.log(response);
     * }
     * runExample().catch(console.error);
     * ```
     * @group Transaction
     */
    async publishPackage(args: {
        senderAccount: SupraAccount;
        packageMetadata: Uint8Array;
        modulesCode: Uint8Array[];
        optionalTransactionArgs?: OptionalTransactionArgs;
    }): Promise<SubmitTransactionResponse> {
        return retryWithFreshSequenceNumber(
            args.optionalTransactionArgs?.optionalTransactionPayloadArgs?.sequenceNumber,
            () => publishPackageInternal(args, this.networkInformation),
        );
    }
}
