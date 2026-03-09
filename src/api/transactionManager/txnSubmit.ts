import { BCS, type HexString, type SupraAccount, type TxnBuilderTypes } from "supra-l1-sdk-core";
import type { NetworkConfig } from "../../utils/apiEndpoints";
import type { EnableTransactionWaitAndSimulationArgs } from "../../types/transactionManager/transactionSubmit";
import type { TransactionResponse } from "../../types/transaction";
import { submitMultiAgentTransactionInternal, submitSerializedRawTransactionAndSignatureInternal, submitSerializedRawTransactionInternal, submitSponsorTransactionInternal } from "../../internal/transactionManager/txnSubmit";
import type { AccountAddressInput } from "../../types/account";


/**
 * The Submit class provides methods for submitting transactions to the Supra network.
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
     * Send `entry_function_payload` type tx using raw transaction data
     * @param args.senderAccount - The sender account
     * @param args.rawTransaction - The raw transaction to be submitted
     * @param args.enableTransactionWaitAndSimulationArgs - enable transaction wait and simulation arguments
     * @returns `TransactionResponse`
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     *  
     *   let supraCoinTransferRawTransaction = supra.transaction.build.rawTxnObject(supraTransferPayload)
     * 
     *   let txn = await supra.transaction.submit.submitRawTransaction({
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
     * ```
     * @group Transaction
     */
    async submitRawTransaction(
        args: {
            senderAccount: SupraAccount,
            rawTransaction: TxnBuilderTypes.RawTransaction,
            enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs,
        }
    ): Promise<TransactionResponse> {
        return submitSerializedRawTransactionInternal({ ...args, serializedRawTransaction: BCS.bcsToBytes(args.rawTransaction) }, this.networkInformation);
    }

    /**
     * Send `entry_function_payload` type tx using serialized raw transaction data
     * @param args.senderAccount - The sender account
     * @param args.serializedRawTransaction - Serialized raw transaction data
     * @param args.enableTransactionWaitAndSimulationArgs - enable transaction wait and simulation arguments
     * @returns `TransactionResponse`
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     *  
     *   let supraCoinTransferRawTransaction = supra.transaction.build.rawTxnObject(supraTransferPayload)
     * 
     *   let supraCoinTransferRawTransactionSerializer = new BCS.Serializer();
     *   supraCoinTransferRawTransaction.serialize(
     *       supraCoinTransferRawTransactionSerializer
     *   );
     * 
     *   let txn = await supra.transaction.submit.submitSerializedRawTransaction({
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
    async submitSerializedRawTransaction(
        args: {
            senderAccount: SupraAccount,
            serializedRawTransaction: Uint8Array,
            enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs,
        }
    ): Promise<TransactionResponse> {
        return submitSerializedRawTransactionInternal(args, this.networkInformation);
    }


    /**
     * Send `entry_function_payload` type tx using serialized raw transaction data and ed25519 signature
     * @param args.senderPubkey - Sender ed25519 pubkey
     * @param args.signature - Ed25519 signature
     * @param args.serializedRawTransaction - Serialized raw transaction data
     * @param args.enableTransactionWaitAndSimulationArgs - enable transaction wait and simulation arguments
     * @returns `TransactionResponse`
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     *  
     *   let supraCoinTransferSerializedRawTransaction = supra.transaction.build.rawTxnObject(supraTransferPayload)
     * 
     *   let raw_txn = TxnBuilderTypes.RawTransaction.deserialize(
     *       new BCS.Deserializer(supraCoinTransferSerializedRawTransaction),
     *   );
     * 
     *   let signature = supra.transaction.signTransaction({ senderAccount: account, rawTxn: raw_txn });
     * 
     *   let txn = await supra.transaction.submit.submitSerializedRawTransactionAndSignature({
     *       senderPubkey: account.pubKey(),
     *       signature: signature as HexString,
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
    async submitSerializedRawTransactionAndSignature(
        args: {
            senderPubkey: HexString,
            signature: HexString,
            serializedRawTransaction: Uint8Array,
            enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs,
        }
    ): Promise<TransactionResponse> {
        return submitSerializedRawTransactionAndSignatureInternal(args, this.networkInformation);
    }



    /**
     * Sends sponsor transaction
     * @param args.feePayerAddress - Account address of tx fee payer
     * @param args.secondarySignersAccountAddress - List of account address of tx secondary signers
     * @param args.rawTransaction - The raw transaction to be submitted
     * @param args.senderAuthenticator - The sender account authenticator
     * @param args.feePayerAuthenticator - The fee payer account authenticator
     * @param args.secondarySignersAuthenticator - An optional array of the secondary signers account authenticator
     * @param args.enableTransactionWaitAndSimulationArgs - enable transaction wait and simulation arguments
     * @returns `TransactionResponse`
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     *  
     *   let supraCoinTransferSponsoredRawTransaction = supra.transaction.build.rawTxnObject(supraTransferPayload);
     * 
     *   let sponsorTransactionPayload = new TxnBuilderTypes.FeePayerRawTransaction(
     *       supraCoinTransferSponsoredRawTransaction,
     *       [],
     *       new TxnBuilderTypes.AccountAddress(feePayerAccount.address().toUint8Array())
     *   );
     * 
     *   let sponsorTxnSenderAuthenticator = supra.transaction.signTransaction({
     *       senderAccount: account,
     *       rawTxn: sponsorTransactionPayload
     *   }) as TxnBuilderTypes.AccountAuthenticatorEd25519;
     * 
     *   let feePayerAuthenticator = supra.transaction.signTransaction({
     *       senderAccount: feePayerAccount,
     *       rawTxn: sponsorTransactionPayload
     *   }) as TxnBuilderTypes.AccountAuthenticatorEd25519;
     * 
     *   let txn = await supra.transaction.submit.submitSponsorTransaction({
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
    async submitSponsorTransaction(
        args: {
            feePayerAddress: AccountAddressInput,
            secondarySignersAccountAddress: Array<string>,
            rawTxn: TxnBuilderTypes.RawTransaction,
            senderAuthenticator: TxnBuilderTypes.AccountAuthenticatorEd25519,
            feePayerAuthenticator: TxnBuilderTypes.AccountAuthenticatorEd25519,
            secondarySignersAuthenticator: Array<TxnBuilderTypes.AccountAuthenticatorEd25519>,
            enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs,
        }
    ): Promise<TransactionResponse> {

        return submitSponsorTransactionInternal(args, this.networkInformation);
    }



    /**
     * Sends multi-agent transaction
     * @param args.secondarySignersAccountAddress - List of account address of tx secondary signers
     * @param args.rawTxn - The raw transaction to be submitted
     * @param args.senderAuthenticator - The sender account authenticator
     * @param args.secondarySignersAuthenticator - List of the secondary signers account authenticator
     * @param args.enableTransactionWaitAndSimulationArgs - enable transaction wait and simulation arguments
     * @returns `TransactionResponse`
     * @example
     * ```typescript
     * import {SupraClient,Network} from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     * 
     *     let multiAgentRawTransaction = supra.transaction.build.rawTxnObject({
     *         senderAddress: account.address(),
     *         senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
     *         function: "0x7c6033ca961856298e1412fddf5ebb732c247436046d33016a5bd10f7e090a07::wrapper::two_signers" as MoveFunctionId,
     *         functionTypeArgs: [],
     *         functionArgs: []
     *     });
     * 
     *     // Creating Multi-Agent Transaction Payload
     *     let multiAgentTransactionPayload =
     *         new TxnBuilderTypes.MultiAgentRawTransaction(multiAgentRawTransaction, [
     *             new TxnBuilderTypes.AccountAddress(
     *                 secondarySignerAccount.address().toUint8Array()
     *             ),
     *         ]);
     * 
     *     // Generating sender authenticator
     *     let multiAgentSenderAuthenticator = supra.transaction.signTransaction({
     *         senderAccount: account,
     *         rawTxn: multiAgentTransactionPayload
     *     }) as TxnBuilderTypes.AccountAuthenticatorEd25519;
     * 
     *     // Generating Secondary Signer authenticator
     *     let secondarySignerAuthenticator = supra.transaction.signTransaction({
     *         senderAccount: secondarySignerAccount,
     *         rawTxn: multiAgentTransactionPayload
     *     }) as TxnBuilderTypes.AccountAuthenticatorEd25519;
     * 
     *     // Sending Multi-Agent transaction
     *     let txn = await supra.transaction.submit.submitMultiAgentTransaction({
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
    async submitMultiAgentTransaction(
        args: {
            secondarySignersAccountAddress: Array<string>,
            rawTxn: TxnBuilderTypes.RawTransaction,
            senderAuthenticator: TxnBuilderTypes.AccountAuthenticatorEd25519,
            secondarySignersAuthenticator: Array<TxnBuilderTypes.AccountAuthenticatorEd25519>,
            enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs,
        }
    ): Promise<TransactionResponse> {
        return submitMultiAgentTransactionInternal(args, this.networkInformation);
    }
}