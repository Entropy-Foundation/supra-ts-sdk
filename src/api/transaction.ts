import type { NetworkConfig } from "../utils/apiEndpoints";
import type { CommittedTransactionResponse, TransactionQueryType, TransactionResponse, WaitForTransactionOptions } from "../types/transaction";
import { getTransactionByHashInternal, getTransactionSignatureMessageInternal, isPendingTransactionInternal, publishPackageInternal, signTransactionInternal, waitForTransactionInternal } from "../internal/transaction";

import { Build } from "./transactionManager/txnBuild";
import { BCS, TxnBuilderTypes, type AnyRawTransaction, type HexString, type SupraAccount } from "supra-l1-sdk-core";
import { Simulate } from "./transactionManager/txnSimulate";
import { Submit } from "./transactionManager/txnSubmit";
import type { OptionalTransactionArgs } from "../types/transactionManager/transactionSubmit";
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
    * Queries on-chain transactions by their transaction hash, returning both transactions status.
    * @param args - The arguments for querying the transaction.
    * @param args.transactionHash - The transaction hash should be a hex-encoded bytes string with a 0x prefix.
    * @returns A Promise that resolves to a boolean.
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
     * Queries on-chain transactions by their transaction hash, returning both pending and committed transactions.
     * @param args.transactionHash - The transaction hash should be a hex-encoded bytes string with a 0x prefix.
     * @param args.options.timeoutSecs - The maximum number of seconds to wait for the transaction to be committed. default: 20 seconds
     * @param args.options.checkSuccess - Whether to check the success of the transaction.
     * @returns A Promise that resolves to a CommittedTransactionResponse object.
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
    ): HexString | TxnBuilderTypes.AccountAuthenticatorEd25519 {
        return signTransactionInternal(args);
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
   * @param args.optionalTransactionArgs optional arguments for transaction
   * @returns `TransactionResponse`
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
    ): Promise<TransactionResponse> {
        return publishPackageInternal(args, this.networkInformation);
    }

}