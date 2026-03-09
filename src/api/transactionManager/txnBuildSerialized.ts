import { type TxnBuilderTypes } from "supra-l1-sdk-core";
import type { AccountAddressInput } from "../../types/account";
import type { MoveFunctionId } from "../../types/move";
import type { NetworkConfig } from "../../utils/apiEndpoints";
import type { OptionalTransactionPayloadArgs } from "../../types/transactionManager/transactionBuild";
import { serializedAutomationRegistrationRawTxnObjectInternal, multisigProposalTxRawTxnObjectInternal, serializedMultisigRawTxnObjectInternal, serializedScriptRawTxnObjectInternal, serializedRawTxnObjectInternal } from "../../internal/transactionManager/txnBuildSerialized";

/**
 * The Serialized class provides methods for building serialized raw transactions.
 * @group Transaction
 */
export class Serialized {

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
    * Create serialized raw transaction for `entry_function_payload` type txn
    * Under the hood the method utilizes `build.rawTxnObject` method to create a raw transaction
    * and then it serializes using bcs serializer
    * @param args.senderAddress - Sender account address
    * @param args.senderSequenceNumber - Sender account sequence number
    * @param args.function - Target function name as MoveFunctionId
    * @param args.functionTypeArgs - Target function type args
    * @param args.functionArgs - Target function args
    * @param args.optionalTransactionPayloadArgs - Optional arguments for transaction payload
    * @returns Serialized raw transaction object
    * @example
    * ```typescript
    * import { SupraClient,Network } from "supra-ts-sdk";
    * 
    * const supra = new SupraClient({ network: Network.TESTNET });
    * 
    * async function runExample() {
    *     
    *     let supraCoinTransferSerializedRawTransaction = supra.transaction.build.serialized.rawTxnObject({
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
    ): Uint8Array {
        return serializedRawTxnObjectInternal(args, this.networkInformation);
    }


    /**
    * Create serialized raw transaction for `script_payload` type txn
    * @param args.senderAddress - Sender account address
    * @param args.senderSequenceNumber - Sender account sequence number
    * @param args.scriptCode - Move script bytecode
    * @param args.scriptTypeArgs - Type arguments that move script bytecode requires
    * @param args.scriptArgs - Arguments to the move script bytecode function
    * @param args.optionalTransactionPayloadArgs - Optional arguments for transaction payload
    * @returns Serialized raw script transaction object
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
    *     let supraCoinTransferSerializedScriptRawTransaction = supra.transaction.build.serialized.scriptRawTxnObject({
    *         senderAddress: account.address(),
    *         senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
    *         scriptCode: Uint8Array.from(Buffer.from(moveScriptCodeHex, "hex")),
    *         scriptTypeArgs: [],
    *         scriptArgs: [new TxnBuilderTypes.TransactionArgumentU64(BigInt(1000))]
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
    scriptRawTxnObject(
        args: {
            senderAddress: AccountAddressInput,
            senderSequenceNumber: bigint,
            scriptCode: Uint8Array,
            scriptTypeArgs: TxnBuilderTypes.TypeTag[],
            scriptArgs: TxnBuilderTypes.TransactionArgument[],
            optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs,
        }
    ): Uint8Array {
        return serializedScriptRawTxnObjectInternal(args, this.networkInformation);
    }


    /**
     * Create serialized raw transaction object for `automation_registration_payload` type txn
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
     * @returns Serialized raw transaction object
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     *     
     *     let supraCoinTransferAutomationSerializedRawTransaction = supra.transaction.build.serialized.automationRegistrationRawTxnObject({
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
     *     });
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
    ): Uint8Array {
        return serializedAutomationRegistrationRawTxnObjectInternal(args, this.networkInformation);
    }


    /**
     * Create serialized raw transaction object for `multisig_payload` type txn
     * @param args.senderAddress - Sender account address
     * @param args.senderSequenceNumber - Sender account sequence number
     * @param args.multisigAddress - Multisig account address
     * @param args.function - Target function name as MoveFunctionId
     * @param args.functionTypeArgs - Target function type args
     * @param args.functionArgs - Target function args
     * @param args.optionalTransactionPayloadArgs Optional arguments for transaction payload
     * @returns Serialized raw transaction object
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     *     
     *     let supraCoinTransferSerializedMultisigRawTransaction = supra.transaction.build.serialized.multisigRawTxnObject({
     *         senderAddress: account.address(),
     *         senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
     *         multisigAddress: multisigAccountAddress,
     *         function: "0x1::supra_account::transfer",
     *         functionTypeArgs: [],
     *         functionArgs: [receiverAddress.toUint8Array(), BCS.bcsSerializeUint64(1000)]
     *     });
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
    ): Uint8Array {
        return serializedMultisigRawTxnObjectInternal(args, this.networkInformation);
    }


    /**
    * Create serialized raw transaction object to create multisig transaction
    * @param args.senderAddress - Sender account address
    * @param args.senderSequenceNumber - Sender account sequence number
    * @param args.multisigAddress - Multisig account address
    * @param args.function - Target function name as MoveFunctionId
    * @param args.functionTypeArgs - Target function type args
    * @param args.functionArgs - Target function args
    * @param args.optionalTransactionPayloadArgs - Optional arguments for transaction payload
    * @returns Serialized raw transaction object
    * @example
    * ```typescript
    * import { SupraClient,Network } from "supra-ts-sdk";
    * 
    * const supra = new SupraClient({ network: Network.TESTNET });
    * 
    * async function runExample() {
    *     
    *     let supraCoinTransferSerializedMultisigHashedRawTransaction = supra.transaction.build.serialized.multisigProposalTxRawTxnObject(
    *         {
    *             senderAddress: account.address(),
    *             senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
    *             multisigAddress: multisigAccountAddress,
    *             function: "0x1::supra_account::transfer",
    *             functionTypeArgs: [],
    *             functionArgs: [receiverAddress.toUint8Array(), BCS.bcsSerializeUint64(1000)]
    *         }
    *     );
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
    ): Uint8Array {
        return multisigProposalTxRawTxnObjectInternal(args, this.networkInformation);
    }

}