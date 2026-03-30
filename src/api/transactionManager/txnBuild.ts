import { SupraAccount, TxnBuilderTypes } from "supra-l1-sdk-core";
import type { NetworkConfig } from "../../utils/apiEndpoints";
import type { OptionalTransactionPayloadArgs, SendTxnPayload } from "../../types/transactionManager/transactionBuild";
import type { AccountAddressInput } from "../../types/account";
import type { MoveFunctionId, MoveModule, SimpleEntryFunctionArgumentTypes, TypeArgument } from "../../types/move";
import {  ExtendedRawTransaction, rawTxnObjectInternal, sendTxnPayloadInternal, signedTransactionInternal, simpleInternal, extendedRawTransaction, scriptRawTxnObjectInternal, automationRegistrationRawTxnObjectInternal, multisigRawTxnObjectInternal, multisigProposalTxRawTxnObjectInternal } from "../../internal/transactionManager/txnBuild";

/**
 * The Build class provides methods for building raw transactions.
 * @group Transaction
 */
export class Build {

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
     * Create raw transaction object for `simple` type txn
     * Don't need to serialize arguments as they serialize on the fly using function abi.
     * @param args.senderAddress - Sender account address
     * @param args.senderSequenceNumber - Sender account sequence number
     * @param args.function - Target function name as MoveFunctionId
     * @param args.functionTypeArgs - Target function type args
     * @param args.functionArgs - Target function args
     * @param args.optionalTransactionPayloadArgs - Optional arguments for transaction payload
     * @returns Raw transaction object
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     * 
     *     const supraCoinTransferRawTransaction = supra.transaction.build.simple({
     *         senderAddress: account.address(),
     *         senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
     *         function: "0x1::supra_account::transfer" as MoveFunctionId,
     *         functionTypeArgs: [],
     *         functionArgs: ["0x2", 10000]
     *     });
     * 
     *     console.log(supraCoinTransferRawTransaction);
     * }
     * ```
     * @group Transaction
     */
    async simple(
        args: {
            senderAddress: AccountAddressInput,
            senderSequenceNumber: bigint,
            function: MoveFunctionId,
            functionTypeArgs: Array<TypeArgument>,
            functionArgs: Array<Exclude<SimpleEntryFunctionArgumentTypes, Uint8Array>>,
            abi?: MoveModule,
            optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs,
        }
    ): Promise<ExtendedRawTransaction> {
        return extendedRawTransaction({ rawTxn: await simpleInternal(args, this.networkInformation) }, this.networkInformation);
    }


    /**
    * Create raw transaction object for `entry_function_payload` type txn
    * @param args.senderAddress - Sender account address
    * @param args.senderSequenceNumber - Sender account sequence number
    * @param args.function - Target function name as MoveFunctionId
    * @param args.functionTypeArgs - Target function type args
    * @param args.functionArgs - Target function args
    * @param args.optionalTransactionPayloadArgs - Optional arguments for transaction payload
    * @returns Raw transaction object
    * @example
    * ```typescript
    * import { SupraClient,Network } from "supra-ts-sdk";
    * 
    * const supra = new SupraClient({ network: Network.TESTNET });
    * 
    * async function runExample() {
    * 
    *     const supraCoinTransferRawTransaction = supra.transaction.build.rawTxnObject({
    *         senderAddress: account.address(),
    *         senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
    *         function: "0x1::supra_account::transfer" as MoveFunctionId,
    *         functionTypeArgs: [],
    *         functionArgs: [receiverAddress.toUint8Array(), BCS.bcsSerializeUint64(10000)]
    *     });
    * 
    *     console.log(supraCoinTransferRawTransaction);
    * }
    * 
    * runExample().catch(console.error);
    *  
    * ```
    * @group Transaction
    */
    rawTxnObject(
        args: {
            senderAddress: AccountAddressInput,
            senderSequenceNumber: bigint,
            function: MoveFunctionId,
            functionTypeArgs: TxnBuilderTypes.TypeTag[],
            functionArgs: Uint8Array[],
            optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs,
        }
    ): ExtendedRawTransaction {
        return extendedRawTransaction({ rawTxn: rawTxnObjectInternal(args, this.networkInformation) }, this.networkInformation);
    }


    /**
    * Create raw transaction for `script_payload` type txn
    * @param args.senderAddress - Sender account address
    * @param args.senderSequenceNumber - Sender account sequence number
    * @param args.scriptCode - Move script bytecode
    * @param args.scriptTypeArgs - Type arguments that move script bytecode requires
    * @param args.scriptArgs - Arguments to the move script bytecode function
    * @param args.optionalTransactionPayloadArgs - Optional arguments for transaction payload
    * @returns Raw script transaction object
    * @example
    * ```typescript
    * import { SupraClient,Network } from "supra-ts-sdk";
    * 
    * const supra = new SupraClient({ network: Network.TESTNET });
    * 
    * async function runExample() {
    *     
    *     let moveScriptCodeHex = "a11ceb0b06000000050100040...";
    * 
    *     let supraCoinTransferSerializedScriptRawTransaction = supra.transaction.build.scriptRawTxnObject({
    *         senderAddress: account.address(),
    *         senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
    *         scriptCode: Uint8Array.from(Buffer.from(moveScriptCodeHex, "hex")),
    *         scriptTypeArgs: [],
    *         scriptArgs: [new TxnBuilderTypes.TransactionArgumentU64(BigInt(1000))]
    *     }).toBytes();
    * 
    *     console.log(supraCoinTransferSerializedScriptRawTransaction);
    * }
    *
    * runExample().catch(console.error);
    *
    * ```
    * @group Transaction
    */
    scriptRawTxnObject(
        args: {
            senderAddress: AccountAddressInput,
            senderSequenceNumber: bigint,
            scriptCode: Uint8Array,
            scriptTypeArgs: TxnBuilderTypes.TypeTag[],
            scriptArgs: TxnBuilderTypes.TransactionArgument[],
            optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs,
        }
    ): ExtendedRawTransaction {
        return extendedRawTransaction({ rawTxn: scriptRawTxnObjectInternal(args, this.networkInformation) }, this.networkInformation);
    }


    /**
     * Create raw transaction object for `automation_registration_payload` type txn
     * @param args.senderAddress - Sender account address
     * @param args.senderSequenceNumber - Sender account sequence number
     * @param function - Target function name as MoveFunctionId
     * @param args.functionTypeArgs - Target function type args
     * @param args.functionArgs - Target function args
     * @param args.automationMaxGasAmount - Max gas amount for automated transaction
     * @param args.automationGasPriceCap - Gas Uint price upper limit that user is willing to pay
     * @param args.automationFeeCapForEpoch - Maximum automation fee that user is willing to pay for epoch.
     * @param args.automationFeeCapForEpoch - Expiration time of the automated transaction in seconds since UTC Epoch start.
     * @param args.automationAuxData - Reserved for future extensions of registration parameters.
     * @param optionalTransactionPayloadArgs Optional arguments for transaction payload
     * @returns Raw transaction object
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     *     
     *     let supraCoinTransferAutomationSerializedRawTransaction = supra.transaction.build.automationRegistrationRawTxnObject({
     *         senderAddress: account.address(),
     *         senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
     *         function: "0x1::supra_account::transfer" as MoveFunctionId,
     *         functionTypeArgs: [],
     *         functionArgs: [receiverAddress.toUint8Array(), BCS.bcsSerializeUint64(1000)],
     *         automationMaxGasAmount: BigInt(500),
     *         automationGasPriceCap: BigInt(100),
     *         automationFeeCapForEpoch: BigInt(1000000000),
     *         automationExpirationTimestampSecs: BigInt(Math.floor(Date.now() / MILLISECONDS_PER_SECOND) + 2 * 60 * 60),
     *         automationAuxData: [],
     *     }).toBytes();
     * 
     *     console.log(supraCoinTransferAutomationSerializedRawTransaction);
     * }
     *
     * runExample().catch(console.error);
     *
     * ```
     * @group Transaction
     */
    automationRegistrationRawTxnObject(
        args: {
            senderAddress: AccountAddressInput,
            senderSequenceNumber: bigint,
            function: MoveFunctionId,
            functionTypeArgs: TxnBuilderTypes.TypeTag[],
            functionArgs: Uint8Array[],
            automationMaxGasAmount: bigint,
            automationGasPriceCap: bigint,
            automationFeeCapForEpoch: bigint,
            automationExpirationTimestampSecs: bigint,
            automationAuxData: Uint8Array[],
            optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs,
        }
    ): ExtendedRawTransaction {
        return extendedRawTransaction({ rawTxn: automationRegistrationRawTxnObjectInternal(args, this.networkInformation) }, this.networkInformation);
    }


    /**
     * Create raw transaction object for `multisig_payload` type txn
     * @param args.senderAddress - Sender account address
     * @param args.senderSequenceNumber - Sender account sequence number
     * @param args.multisigAddress - Multisig account address
     * @param args.function - Target function name as MoveFunctionId
     * @param args.functionTypeArgs - Target function type args
     * @param args.functionArgs - Target function args
     * @param args.optionalTransactionPayloadArgs Optional arguments for transaction payload
     * @returns Raw transaction object
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     *     
     *     let supraCoinTransferSerializedMultisigRawTransaction = supra.transaction.build.multisigRawTxnObject({
     *         senderAddress: account.address(),
     *         senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
     *         multisigAddress: multisigAccountAddress,
     *         function: "0x1::supra_account::transfer",
     *         functionTypeArgs: [],
     *         functionArgs: [receiverAddress.toUint8Array(), BCS.bcsSerializeUint64(1000)]
     *     }).toBytes();
     * 
     *     console.log(supraCoinTransferSerializedMultisigRawTransaction);
     * }
     * 
     * runExample().catch(console.error);
     * 
     * ```
     * @group Transaction
     */
    multisigRawTxnObject(
        args: {
            senderAddress: AccountAddressInput,
            senderSequenceNumber: bigint,
            multisigAddress: AccountAddressInput,
            function: MoveFunctionId,
            functionTypeArgs: TxnBuilderTypes.TypeTag[],
            functionArgs: Uint8Array[],
            optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs,
        }
    ): ExtendedRawTransaction {
        return extendedRawTransaction({ rawTxn: multisigRawTxnObjectInternal(args, this.networkInformation) }, this.networkInformation);
    }


    /**
    * Create raw transaction object to create multisig transaction
    * @param args.senderAddress - Sender account address
    * @param args.senderSequenceNumber - Sender account sequence number
    * @param args.multisigAddress - Multisig account address
    * @param args.function - Target function name as MoveFunctionId
    * @param args.functionTypeArgs - Target function type args
    * @param args.functionArgs - Target function args
    * @param args.optionalTransactionPayloadArgs - Optional arguments for transaction payload
    * @returns Raw transaction object
    * @example
    * ```typescript
    * import { SupraClient,Network } from "supra-ts-sdk";
    * 
    * const supra = new SupraClient({ network: Network.TESTNET });
    * 
    * async function runExample() {
    *     
    *     let supraCoinTransferSerializedMultisigHashedRawTransaction = supra.transaction.build.multisigProposalTxRawTxnObject(
    *         {
    *             senderAddress: account.address(),
    *             senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
    *             multisigAddress: multisigAccountAddress,
    *             function: "0x1::supra_account::transfer",
    *             functionTypeArgs: [],
    *             functionArgs: [receiverAddress.toUint8Array(), BCS.bcsSerializeUint64(1000)]
    *         }
    *     ).toBytes();
    * 
    *     console.log(supraCoinTransferSerializedMultisigHashedRawTransaction);
    * }
    * 
    * runExample().catch(console.error);
    * 
    * ```
    * @group Transaction
    */
    multisigProposalTxRawTxnObject(
        args: {
            senderAddress: AccountAddressInput,
            senderSequenceNumber: bigint,
            multisigAddress: AccountAddressInput,
            function: MoveFunctionId,
            functionTypeArgs: TxnBuilderTypes.TypeTag[],
            functionArgs: Uint8Array[],
            optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs,
        }
    ): ExtendedRawTransaction {
        return extendedRawTransaction({ rawTxn: multisigProposalTxRawTxnObjectInternal(args, this.networkInformation) }, this.networkInformation);
    }

    /**
     * Create signed transaction payload
     * @param args.senderAccount - Sender KeyPair
     * @param args.rawTxn - Raw transaction payload
     * @returns `SignedTransaction`
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     * 
     *     const supraCoinTransferRawTransaction = supra.transaction.build.rawTxnObject({
     *         senderAddress: account.address(),
     *         senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
     *         function: "0x1::supra_account::transfer" as MoveFunctionId,
     *         functionTypeArgs: [],
     *         functionArgs: [receiverAddress.toUint8Array(), BCS.bcsSerializeUint64(10000)]
     *     });
     * 
     *     const signedTransaction = supra.transaction.build.signedTransaction({
     *         senderAccount: account,
     *         rawTxn: supraCoinTransferRawTransaction
     *     });
     *     
     *     // Convert to SendTxPayload to send transaction
     *     console.log(signedTransaction);
     * }
     * 
     * runExample().catch(console.error);
     *  
     * ```
     * @group Transaction
     */
    signedTransaction(
        args: {
            senderAccount: SupraAccount,
            rawTxn: TxnBuilderTypes.RawTransaction,
        }
    ): TxnBuilderTypes.SignedTransaction {
        return signedTransactionInternal(args);
    }


    /**
     * Generate `SendTxnPayload` using `RawTransaction` to send transaction request
     * Generated data can be used to send transaction directly using `/rpc/v3/transactions/submit` endpoint of `rpc_node`
     * @param args.senderAccount - Sender KeyPair
     * @param args.rawTxn - Raw transaction data
     * @returns `SendTxPayload`
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     * 
     *     const supraCoinTransferRawTransaction = supra.transaction.build.rawTxnObject({
     *         senderAddress: account.address(),
     *         senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
     *         function: "0x1::supra_account::transfer" as MoveFunctionId,
     *         functionTypeArgs: [],
     *         functionArgs: [receiverAddress.toUint8Array(), BCS.bcsSerializeUint64(10000)]
     *     });
     * 
     *     const supraCoinTransferSendTxnPayload = supra.transaction.build.sendTxnPayload({
     *         senderAccount: account,
     *         rawTxn: supraCoinTransferRawTransaction
     *     });
     * 
     *     let txn = await fetch("https://rpc-testnet.supra.com/rpc/v3/transactions/submit", {
     *         method: "POST",
     *         body: JSON.stringify(supraCoinTransferSendTxnPayload),
     *         headers: {
     *             "Content-Type": "application/json"
     *         }
     *     });
     * 
     *     console.log("Transaction submitted:", await txn.json());
     * 
     * }
     * 
     * runExample().catch(console.error);
     *  
     * ```  
     * @group Transaction
     */
    sendTxnPayload(
        args: {
            senderAccount: SupraAccount,
            rawTxn: TxnBuilderTypes.RawTransaction,
        }
    ): SendTxnPayload {
        return sendTxnPayloadInternal(args);
    }




}