import type { NetworkConfig } from "../utils/apiEndpoints";
import type { CommittedTransactionResponse, TransactionQueryType, TransactionResponse, WaitForTransactionOptions } from "../types/transaction";
import { getTransactionByHashInternal, getTransactionSignatureMessageInternal, isPendingTransactionInternal, publishPackageInternal, signTransactionInternal, waitForTransactionInternal } from "../internal/transaction";

import { retryWithFreshSequenceNumber } from "../internal/sequenceNumber";
import { Build } from "./transactionManager/txnBuild";
import { BCS, TxnBuilderTypes, type AnyRawTransaction, type HexString, type SupraAccount } from "supra-l1-sdk-core";
import { Simulate } from "./transactionManager/txnSimulate";
import { Submit } from "./transactionManager/txnSubmit";
import type { OptionalTransactionArgs, SubmitTransactionResponse } from "../types/transactionManager/transactionSubmit";
import sha3 from "js-sha3";
import { validateTransactionHash } from "../helper/validation";

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
    readonly submit: Submit

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
    * @template {TransactionResponse} T - The type of the transaction to be returned.
    * @param args - The arguments for querying the transaction.
    * @param args.transactionHash - The transaction hash should be a hex-encoded bytes string with a 0x prefix.
    * @param args.type - The type of transaction to query.
    * @param args.exclude_uncommitted - Whether to exclude uncommitted transactions.
    * @returns A Promise that resolves to a TransactionResponse object.
    * @example
    * ```typescript
    * import {SupraClient, Network} from "supra-l1-sdk";
    *
    * const supra = new SupraClient({ network: Network.TESTNET });
    *
    * async function runExample() {
    *   // Fetch a transaction by its hash
    *   const transaction = await supra.getTransactionByHash({ transactionHash: "0x123" }); // replace with a real transaction hash
    *
    *   console.log(transaction);
    * }
    * runExample().catch(console.error);
    * ```
    * @group Transaction
    */
    async getTransactionByHash<T extends TransactionResponse>(args: { transactionHash: string, type?: TransactionQueryType, exclude_uncommitted?: boolean }): Promise<TransactionResponse> {
        validateTransactionHash(args.transactionHash);
        return getTransactionByHashInternal<T>(args, this.networkInformation);
    }


    /**
    * Reads a transaction by its hash and tells whether it has no final status yet.
    * @param args - The arguments for querying the transaction.
    * @param args.transactionHash - The transaction hash should be a hex-encoded bytes string with a 0x prefix.
    * @returns A Promise that resolves to true when the status is `Pending` or `PendingAfterExecution`, and to false
    * when it is `Success`, `Fail` or `Invalid`.
    * @example
    * ```typescript
    * import {Supra, Network} from "supra-l1-sdk";
    *
    * const supra = new SupraClient({ network: Network.TESTNET });
    *
    * async function runExample() {
    *   // Fetch a transaction by its hash
    *   const isPending = await supra.isPendingTransaction({ transactionHash: "0x123" }); // replace with a real transaction hash
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
     * @param args.options.timeoutMs - The longest time to wait for a final status, in milliseconds. Default
     * `waitTimeoutMs` of `SupraConfig`, else 60000.
     * @param args.options.timeoutSecs - Deprecated: the same timeout in seconds. `timeoutMs` takes precedence.
     * @param args.options.checkSuccess - Throw `SupraTransactionFailedError` for a final status other than `Success`.
     * Default true.
     * @returns A Promise that resolves to the transaction with its final status: `Success`, or any final status when
     * `checkSuccess` is false.
     * @throws `SupraTransactionFailedError` (with `hash`, `status`, `vm_status`, `major_status`, `sub_status` and
     * `transaction`) when the final status is `Fail` or `Invalid` and `checkSuccess` is not false.
     * @throws `SupraTransactionTimeoutError` (with `hash` and `lastStatus`) when there is no final status within the
     * timeout.
     * @example
     * ```typescript
     * import {Supra, Network} from "supra-l1-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     *   // Fetch a transaction by its hash
     *   const transaction = await supra.transaction.waitForTransaction({ transactionHash: "0x123" }); // replace with a real transaction hash
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
        options?: WaitForTransactionOptions
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
     * import {Supra, Network} from "supra-l1-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     * 
     *   let supraCoinTransferSponsoredRawTransaction = supra.transaction.build.rawTxnObject(supraTransferPayload);
     * 
     *   // Fetch a transaction by its hash
     *   const signatureMessage = await supra.getTransactionSignatureMessage({ rawTxn: supraCoinTransferSponsoredRawTransaction }); // replace with a real transaction hash
     * 
     *   console.log(signatureMessage);
     * }
     * 
     * runExample().catch(console.error);
     * ```
     * @group Transaction
     */
    getTransactionSignatureMessage(
        args: {
            rawTxn: AnyRawTransaction,
        }
    ): Uint8Array {
        return getTransactionSignatureMessageInternal(args);
    }

    /**
     * Sign any supra transaction.
     * signer authenticator to be used to submit the transaction.
     * @param args.senderAccount the account to sign on the transaction
     * @param args.rawTxn a RawTransaction, MultiAgentRawTransaction or FeePayerRawTransaction
     * @returns ed25519 signature in `HexString` or signer authenticator
     * @throws `SupraChainIdMismatchError` before signing when the client's chain ID or the chain ID of `rawTxn` is not
     * the node's. The node's chain ID is read before the first signature of the client; with `verifyChainId: false`
     * nothing is read or checked and no request is sent.
     * @example
     * ```typescript
     * import {Supra, Network} from "supra-l1-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *
     *   let supraCoinTransferSponsoredRawTransaction = supra.transaction.build.rawTxnObject(supraTransferPayload);
     *
     *   // Fetch a transaction by its hash
     *   const signature = await supra.signTransaction({ senderAccount: account, rawTxn: supraCoinTransferSponsoredRawTransaction }); // replace with a real transaction hash
     *
     *   console.log(signature);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Transaction
     */
    signTransaction(
        args: {
            senderAccount: SupraAccount,
            rawTxn: AnyRawTransaction,
        }
    ): Promise<HexString | TxnBuilderTypes.AccountAuthenticatorEd25519> {
        return signTransactionInternal(args, this.networkInformation);
    }


    /**
     * Derives the transaction hash from a signed transaction.
     * @param args.signedTransaction - The signed transaction.
     * @returns The transaction hash.
     * @group Transaction
     */
    deriveTransactionHash(
        args: {
            signedTransaction: TxnBuilderTypes.SignedTransaction,
        }
    ): string {
        return sha3.keccak256(BCS.bcsToBytes(args.signedTransaction));
    }

    /**
   * Publish package or module on supra network
   * @param args.senderAccount - Module Publisher KeyPair
   * @param args.packageMetadata - Package Metadata
   * @param args.modulesCode - module code
   * @param args.optionalTransactionArgs optional arguments for transaction. The gas settings in
   * `optionalTransactionPayloadArgs` apply to the transaction; without `maxGas` it is estimated
   * (see {@link OptionalTransactionPayloadArgs}). The object is not modified.
   * @returns `SubmitTransactionResponse`; {@link Submit} describes the statuses and errors of a submission
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   * 
   *   const response = await supra.transaction.publishPackage({
   *      senderAccount: account,
   *      packageMetadata: Uint8Array.from([]),
   *      modulesCode: [Uint8Array.from([])],
   *   });
   * 
   *   console.log(response);
   * }
   * runExample().catch(console.error);
   * ```
   * @group Transaction
   */
    async publishPackage(
        args: {
            senderAccount: SupraAccount,
            packageMetadata: Uint8Array,
            modulesCode: Uint8Array[],
            optionalTransactionArgs?: OptionalTransactionArgs,
        }
    ): Promise<SubmitTransactionResponse> {
        return retryWithFreshSequenceNumber(
            args.optionalTransactionArgs?.optionalTransactionPayloadArgs?.sequenceNumber,
            () => publishPackageInternal(args, this.networkInformation),
        );
    }

}