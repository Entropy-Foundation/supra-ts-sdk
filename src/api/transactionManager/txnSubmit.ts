import { BCS, type HexString, type SupraAccount, type TxnBuilderTypes } from "supra-l1-sdk-core";
import type { NetworkConfig } from "../../utils/apiEndpoints";
import type {
    EnableTransactionWaitAndSimulationArgs,
    SubmitTransactionResponse,
} from "../../types/transactionManager/transactionSubmit";
import {
    submitMultiAgentTransactionInternal,
    submitSerializedRawTransactionAndSignatureInternal,
    submitSerializedRawTransactionInternal,
    submitSponsorTransactionInternal,
} from "../../internal/transactionManager/txnSubmit";
import type { AccountAddressInput } from "../../types/account";

/**
 * The Submit class provides methods for submitting transactions to the Supra network.
 *
 * Every submission in the SDK (the methods of this class, the submit methods of a built transaction, the coin and
 * fungible asset transfers, `publishPackage` and the entry functions of `Contract.fromABI`) behaves as follows,
 * controlled by `enableTransactionWaitAndSimulationArgs`:
 *
 * 1. With `enableTransactionSimulation`, the transaction is simulated first. A simulated status other than `Success`
 *    throws `SupraSimulationFailedError` and nothing is submitted; a simulation refused because the gas unit price is
 *    below the node's minimum throws `SupraGasUnitPriceBelowMinimumError` instead (its `cause` is the
 *    `SupraSimulationFailedError`).
 * 2. The transaction's hash is derived from the signed transaction (as `deriveTransactionHash` does), and the
 *    transaction is submitted.
 *    - The node accepts it with a 2xx status. Its answer is the transaction's hash; an answer that is not a hash (a
 *      body that is not JSON, an empty body, or another value) is replaced by the derived hash. Steps 3 and 4 follow.
 *    - The node refuses it with a 4xx status or 503: `SupraAPIError` is thrown; the transaction was not accepted. A
 *      refusal because the gas unit price is below the node's minimum (a 400) throws
 *      `SupraGasUnitPriceBelowMinimumError`, which is not a `SupraAPIError` (its `cause` is the `SupraAPIError`). A v12
 *      node whose transaction pool is full answers 503; the transaction can be submitted again later.
 *    - The request times out, the connection fails before the node answers, or the node answers with a 5xx status
 *      other than 503: the node may have accepted the transaction, and `SupraSubmissionOutcomeUnknownError` is thrown
 *      with the derived `hash`, `sender`, `sequenceNumber`, `expirationTimestampSecs` and the error of the request
 *      (`SupraTimeoutError`, `SupraNetworkError` or `SupraAPIError`) as `cause`. Look the hash up or wait for it before
 *      sending the transaction again. A v11 node whose transaction pool is full answers 500, which is reported this
 *      way (see "HTTP status codes by node version" in the README). With `enableWaitForTransaction`, the call first
 *      waits for the derived hash as in step 3, and throws `SupraSubmissionOutcomeUnknownError` (with the wait's
 *      `SupraTransactionTimeoutError` as `waitError`) only when the wait ends without a final status.
 *    - Any other error of the request is thrown as it is.
 * 3. With `enableWaitForTransaction`, the call waits until the transaction has a final status, as
 *    `waitForTransaction` does:
 *    - `Success`: the transaction is returned.
 *    - `Fail` (executed and failed, for example a Move abort or `Out of gas`; the sequence number was incremented) or
 *      `Invalid` (discarded; the sequence number was not incremented): `SupraTransactionFailedError` is thrown with
 *      `hash`, `status`, `vm_status`, `major_status`, `sub_status` and `transaction`, unless `checkSuccess` is false.
 *    - `Pending` (not executed yet) and `PendingAfterExecution` (executed with a status that may change in a later
 *      execution) are not final; the call keeps reading the transaction, also while a read fails or returns 404.
 *      Without a final status within `waitTimeoutMs` (default `SupraConfig.waitTimeoutMs`, else 60000 ms)
 *      `SupraTransactionTimeoutError` is thrown with `hash` and `lastStatus`.
 * 4. Without `enableWaitForTransaction`, the transaction is read once and returned as the node reports it (usually
 *    `Pending`). When that read fails, the call returns `{ hash, status: "NotReadBack", readError }` instead of
 *    throwing, because the node has accepted the transaction.
 *
 * Every error thrown after the node answered the submission with the transaction's hash carries that hash, and so does
 * `SupraSubmissionOutcomeUnknownError`.
 * @group Transaction
 */
export class Submit {
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
     * @group Transaction
     */
    constructor(networkInformation: NetworkConfig) {
        this.networkInformation = networkInformation;
    }

    /**
     * Signs a raw transaction with the sender's key and submits it. The client checks the chain ID of its node before
     * it signs; see {@link SupraConfig}.
     * @param args.senderAccount - The sender account
     * @param args.rawTransaction - The raw transaction to be submitted
     * @param args.enableTransactionWaitAndSimulationArgs - enable transaction wait and simulation arguments
     * @returns `SubmitTransactionResponse`. The class description lists the statuses and errors of a submission.
     * @throws {SupraGasUnitPriceBelowMinimumError} When the node refuses the submission or an enabled simulation
     * because the gas unit price is below its minimum (this replaces `SupraSimulationFailedError` and `SupraAPIError`
     * for that refusal).
     * @throws {SupraSubmissionOutcomeUnknownError} When the submission request times out, fails before the node
     * answers or is answered with a 5xx status other than 503 (after the wait, with `enableWaitForTransaction`);
     * carries the hash derived before the submission.
     * @throws {SupraChainIdMismatchError} Before signing, when the chain ID is not the node's.
     * @example
     * ```typescript
     * import { BCS, Network, SupraAccount, SupraClient } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     * const account = new SupraAccount(); // an account that holds SUPRA
     *
     * async function runExample() {
     *
     *   const supraCoinTransferRawTransaction = supra.transaction.build.rawTxnObject({
     *       senderAddress: account.address(),
     *       senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
     *       function: "0x1::supra_account::transfer",
     *       functionTypeArgs: [],
     *       functionArgs: [new SupraAccount().address().toUint8Array(), BCS.bcsSerializeUint64(10000n)],
     *       optionalTransactionPayloadArgs: { gasUnitPrice: await supra.getEstimatedGasUnitPrice() },
     *   });
     *
     *   const txn = await supra.transaction.submit.submitRawTransaction({
     *       senderAccount: account,
     *       rawTransaction: supraCoinTransferRawTransaction,
     *       enableTransactionWaitAndSimulationArgs: {
     *           enableTransactionSimulation: true,
     *           enableWaitForTransaction: true
     *       }
     *   });
     *
     *   console.log("Transaction submitted:", txn);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Transaction
     */
    async submitRawTransaction(args: {
        senderAccount: SupraAccount;
        rawTransaction: TxnBuilderTypes.RawTransaction;
        enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs;
    }): Promise<SubmitTransactionResponse> {
        return submitSerializedRawTransactionInternal(
            { ...args, serializedRawTransaction: BCS.bcsToBytes(args.rawTransaction) },
            this.networkInformation,
        );
    }

    /**
     * Signs a serialized raw transaction with the sender's key and submits it. The client checks the chain ID of its
     * node before it signs; see {@link SupraConfig}.
     * @param args.senderAccount - The sender account
     * @param args.serializedRawTransaction - Serialized raw transaction data
     * @param args.enableTransactionWaitAndSimulationArgs - enable transaction wait and simulation arguments
     * @returns `SubmitTransactionResponse`. The class description lists the statuses and errors of a submission.
     * @throws {SupraGasUnitPriceBelowMinimumError} When the node refuses the submission or an enabled simulation
     * because the gas unit price is below its minimum (this replaces `SupraSimulationFailedError` and `SupraAPIError`
     * for that refusal).
     * @throws {SupraSubmissionOutcomeUnknownError} When the submission request times out, fails before the node
     * answers or is answered with a 5xx status other than 503 (after the wait, with `enableWaitForTransaction`);
     * carries the hash derived before the submission.
     * @throws {SupraChainIdMismatchError} Before signing, when the chain ID is not the node's.
     * @example
     * ```typescript
     * import { BCS, Network, SupraAccount, SupraClient } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     * const account = new SupraAccount(); // an account that holds SUPRA
     *
     * async function runExample() {
     *
     *   const supraCoinTransferRawTransaction = supra.transaction.build.rawTxnObject({
     *       senderAddress: account.address(),
     *       senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
     *       function: "0x1::supra_account::transfer",
     *       functionTypeArgs: [],
     *       functionArgs: [new SupraAccount().address().toUint8Array(), BCS.bcsSerializeUint64(10000n)],
     *       optionalTransactionPayloadArgs: { gasUnitPrice: await supra.getEstimatedGasUnitPrice() },
     *   });
     *
     *   const supraCoinTransferRawTransactionSerializer = new BCS.Serializer();
     *   supraCoinTransferRawTransaction.serialize(
     *       supraCoinTransferRawTransactionSerializer
     *   );
     *
     *   const txn = await supra.transaction.submit.submitSerializedRawTransaction({
     *       senderAccount: account,
     *       serializedRawTransaction: supraCoinTransferRawTransactionSerializer.getBytes(),
     *       enableTransactionWaitAndSimulationArgs: {
     *           enableTransactionSimulation: true,
     *           enableWaitForTransaction: true
     *       }
     *   });
     *
     *   console.log("Transaction submitted:", txn);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Transaction
     */
    async submitSerializedRawTransaction(args: {
        senderAccount: SupraAccount;
        serializedRawTransaction: Uint8Array;
        enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs;
    }): Promise<SubmitTransactionResponse> {
        return submitSerializedRawTransactionInternal(args, this.networkInformation);
    }

    /**
     * Submits a serialized raw transaction with an ed25519 signature made elsewhere. No key is used and the chain ID
     * is not checked; the node rejects a signature that does not match.
     * @param args.senderPubkey - Sender ed25519 pubkey
     * @param args.signature - Ed25519 signature
     * @param args.serializedRawTransaction - Serialized raw transaction data
     * @param args.enableTransactionWaitAndSimulationArgs - enable transaction wait and simulation arguments
     * @returns `SubmitTransactionResponse`. The class description lists the statuses and errors of a submission.
     * @throws {SupraGasUnitPriceBelowMinimumError} When the node refuses the submission or an enabled simulation
     * because the gas unit price is below its minimum (this replaces `SupraSimulationFailedError` and `SupraAPIError`
     * for that refusal).
     * @throws {SupraSubmissionOutcomeUnknownError} When the submission request times out, fails before the node
     * answers or is answered with a 5xx status other than 503 (after the wait, with `enableWaitForTransaction`);
     * carries the hash derived before the submission.
     * @throws {RangeError} Before submitting, when `senderPubkey` or `signature` is not hex digits in pairs after its
     * `0x` prefix.
     * @example
     * ```typescript
     * import { BCS, Network, SupraAccount, SupraClient, TxnBuilderTypes } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     * const account = new SupraAccount(); // an account that holds SUPRA
     *
     * async function runExample() {
     *
     *   const supraCoinTransferRawTransaction = supra.transaction.build.rawTxnObject({
     *       senderAddress: account.address(),
     *       senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
     *       function: "0x1::supra_account::transfer",
     *       functionTypeArgs: [],
     *       functionArgs: [new SupraAccount().address().toUint8Array(), BCS.bcsSerializeUint64(10000n)],
     *       optionalTransactionPayloadArgs: { gasUnitPrice: await supra.getEstimatedGasUnitPrice() },
     *   });
     *   const supraCoinTransferSerializedRawTransaction = BCS.bcsToBytes(supraCoinTransferRawTransaction);
     *
     *   const raw_txn = TxnBuilderTypes.RawTransaction.deserialize(
     *       new BCS.Deserializer(supraCoinTransferSerializedRawTransaction),
     *   );
     *
     *   const signature = await supra.transaction.signTransaction({ senderAccount: account, rawTxn: raw_txn });
     *
     *   const txn = await supra.transaction.submit.submitSerializedRawTransactionAndSignature({
     *       senderPubkey: account.pubKey(),
     *       signature,
     *       serializedRawTransaction: supraCoinTransferSerializedRawTransaction,
     *       enableTransactionWaitAndSimulationArgs: {
     *           enableTransactionSimulation: true,
     *           enableWaitForTransaction: true
     *       }
     *   });
     *
     *   console.log("Transaction submitted:", txn);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Transaction
     *
     */
    async submitSerializedRawTransactionAndSignature(args: {
        senderPubkey: HexString;
        signature: HexString;
        serializedRawTransaction: Uint8Array;
        enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs;
    }): Promise<SubmitTransactionResponse> {
        return submitSerializedRawTransactionAndSignatureInternal(args, this.networkInformation);
    }

    /**
     * Sends sponsor transaction. The authenticators are made with `supra.transaction.signTransaction` on a
     * `FeePayerRawTransaction`, which checks the chain ID of the node before it signs; this method signs nothing.
     * @param args.feePayerAddress - Account address of tx fee payer
     * @param args.secondarySignersAccountAddress - List of account address of tx secondary signers
     * @param args.rawTxn - The raw transaction to be submitted
     * @param args.senderAuthenticator - The sender account authenticator
     * @param args.feePayerAuthenticator - The fee payer account authenticator
     * @param args.secondarySignersAuthenticator - An optional array of the secondary signers account authenticator
     * @param args.enableTransactionWaitAndSimulationArgs - enable transaction wait and simulation arguments
     * @returns `SubmitTransactionResponse`. The class description lists the statuses and errors of a submission.
     * @throws {SupraGasUnitPriceBelowMinimumError} When the node refuses the submission or an enabled simulation
     * because the gas unit price is below its minimum (this replaces `SupraSimulationFailedError` and `SupraAPIError`
     * for that refusal).
     * @throws {SupraSubmissionOutcomeUnknownError} When the submission request times out, fails before the node
     * answers or is answered with a 5xx status other than 503 (after the wait, with `enableWaitForTransaction`);
     * carries the hash derived before the submission.
     * @throws {RangeError} Before submitting, when the fee payer address or a secondary signer address is not 1 to 64
     * hex digits after an optional `0x` or `0X`.
     * @example
     * ```typescript
     * import { BCS, Network, SupraAccount, SupraClient, TxnBuilderTypes } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     * const account = new SupraAccount(); // the sender
     * const feePayerAccount = new SupraAccount(); // an account that holds SUPRA and pays the fee
     *
     * async function runExample() {
     *
     *   const supraCoinTransferSponsoredRawTransaction = supra.transaction.build.rawTxnObject({
     *       senderAddress: account.address(),
     *       senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
     *       function: "0x1::supra_account::transfer",
     *       functionTypeArgs: [],
     *       functionArgs: [new SupraAccount().address().toUint8Array(), BCS.bcsSerializeUint64(10000n)],
     *       optionalTransactionPayloadArgs: { gasUnitPrice: await supra.getEstimatedGasUnitPrice() },
     *   });
     *
     *   const sponsorTransactionPayload = new TxnBuilderTypes.FeePayerRawTransaction(
     *       supraCoinTransferSponsoredRawTransaction,
     *       [],
     *       new TxnBuilderTypes.AccountAddress(feePayerAccount.address().toUint8Array())
     *   );
     *
     *   const sponsorTxnSenderAuthenticator = await supra.transaction.signTransaction({
     *       senderAccount: account,
     *       rawTxn: sponsorTransactionPayload
     *   });
     *
     *   const feePayerAuthenticator = await supra.transaction.signTransaction({
     *       senderAccount: feePayerAccount,
     *       rawTxn: sponsorTransactionPayload
     *   });
     *
     *   const txn = await supra.transaction.submit.submitSponsorTransaction({
     *       feePayerAddress: feePayerAccount.address().toString(),
     *       secondarySignersAccountAddress: [],
     *       rawTxn: supraCoinTransferSponsoredRawTransaction,
     *       senderAuthenticator: sponsorTxnSenderAuthenticator,
     *       feePayerAuthenticator: feePayerAuthenticator,
     *       secondarySignersAuthenticator: [],
     *       enableTransactionWaitAndSimulationArgs: {
     *           enableTransactionSimulation: true,
     *           enableWaitForTransaction: true
     *       }
     *   });
     *
     *   console.log("Transaction submitted:", txn);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Transaction
     *
     */
    async submitSponsorTransaction(args: {
        feePayerAddress: AccountAddressInput;
        secondarySignersAccountAddress: Array<string>;
        rawTxn: TxnBuilderTypes.RawTransaction;
        senderAuthenticator: TxnBuilderTypes.AccountAuthenticatorEd25519;
        feePayerAuthenticator: TxnBuilderTypes.AccountAuthenticatorEd25519;
        secondarySignersAuthenticator: Array<TxnBuilderTypes.AccountAuthenticatorEd25519>;
        enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs;
    }): Promise<SubmitTransactionResponse> {
        return submitSponsorTransactionInternal(args, this.networkInformation);
    }

    /**
     * Sends multi-agent transaction. The authenticators are made with `supra.transaction.signTransaction` on a
     * `MultiAgentRawTransaction`, which checks the chain ID of the node before it signs; this method signs nothing.
     * @param args.secondarySignersAccountAddress - List of account address of tx secondary signers
     * @param args.rawTxn - The raw transaction to be submitted
     * @param args.senderAuthenticator - The sender account authenticator
     * @param args.secondarySignersAuthenticator - List of the secondary signers account authenticator
     * @param args.enableTransactionWaitAndSimulationArgs - enable transaction wait and simulation arguments
     * @returns `SubmitTransactionResponse`. The class description lists the statuses and errors of a submission.
     * @throws {SupraGasUnitPriceBelowMinimumError} When the node refuses the submission or an enabled simulation
     * because the gas unit price is below its minimum (this replaces `SupraSimulationFailedError` and `SupraAPIError`
     * for that refusal).
     * @throws {SupraSubmissionOutcomeUnknownError} When the submission request times out, fails before the node
     * answers or is answered with a 5xx status other than 503 (after the wait, with `enableWaitForTransaction`);
     * carries the hash derived before the submission.
     * @throws {RangeError} Before submitting, when a secondary signer address is not 1 to 64 hex digits after an
     * optional `0x` or `0X`.
     * @example
     * ```typescript
     * import { Network, SupraAccount, SupraClient, TxnBuilderTypes } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     * const account = new SupraAccount(); // an account that holds SUPRA
     * const secondarySignerAccount = new SupraAccount();
     *
     * async function runExample() {
     *
     *     const multiAgentRawTransaction = supra.transaction.build.rawTxnObject({
     *         senderAddress: account.address(),
     *         senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
     *         function: "0x1234::wrapper::two_signers", // a function of a published module that takes two signers
     *         functionTypeArgs: [],
     *         functionArgs: [],
     *         optionalTransactionPayloadArgs: { gasUnitPrice: await supra.getEstimatedGasUnitPrice() },
     *     });
     *
     *     // Creating Multi-Agent Transaction Payload
     *     const multiAgentTransactionPayload =
     *         new TxnBuilderTypes.MultiAgentRawTransaction(multiAgentRawTransaction, [
     *             new TxnBuilderTypes.AccountAddress(
     *                 secondarySignerAccount.address().toUint8Array()
     *             ),
     *         ]);
     *
     *     // Generating sender authenticator
     *     const multiAgentSenderAuthenticator = await supra.transaction.signTransaction({
     *         senderAccount: account,
     *         rawTxn: multiAgentTransactionPayload
     *     });
     *
     *     // Generating Secondary Signer authenticator
     *     const secondarySignerAuthenticator = await supra.transaction.signTransaction({
     *         senderAccount: secondarySignerAccount,
     *         rawTxn: multiAgentTransactionPayload
     *     });
     *
     *     // Sending Multi-Agent transaction
     *     const txn = await supra.transaction.submit.submitMultiAgentTransaction({
     *         secondarySignersAccountAddress: [secondarySignerAccount.address().toString()],
     *         rawTxn: multiAgentRawTransaction,
     *         senderAuthenticator: multiAgentSenderAuthenticator,
     *         secondarySignersAuthenticator: [secondarySignerAuthenticator],
     *         enableTransactionWaitAndSimulationArgs: {
     *             enableWaitForTransaction: true,
     *             enableTransactionSimulation: true,
     *         }
     *     });
     *
     *     console.log("Transaction submitted:", txn);
     * }
     * runExample().catch(console.error);
     * ```
     * @group Transaction
     */
    async submitMultiAgentTransaction(args: {
        secondarySignersAccountAddress: Array<string>;
        rawTxn: TxnBuilderTypes.RawTransaction;
        senderAuthenticator: TxnBuilderTypes.AccountAuthenticatorEd25519;
        secondarySignersAuthenticator: Array<TxnBuilderTypes.AccountAuthenticatorEd25519>;
        enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs;
    }): Promise<SubmitTransactionResponse> {
        return submitMultiAgentTransactionInternal(args, this.networkInformation);
    }
}
