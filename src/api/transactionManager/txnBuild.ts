import { SupraAccount, TxnBuilderTypes } from "supra-l1-sdk-core";
import type { NetworkConfig } from "../../utils/apiEndpoints";
import type { OptionalTransactionPayloadArgs, SendTxnPayload } from "../../types/transactionManager/transactionBuild";
import type { AccountAddressInput } from "../../types/account";
import type { MoveFunctionId, MoveModule, SimpleEntryFunctionArgumentTypes, TypeArgument } from "../../types/move";
import { rawTxnObjectInternal, sendTxnPayloadInternal, signedTransactionInternal, simpleInternal } from "../../internal/transactionManager/txnBuild";
import { Serialized } from "./txnBuildSerialized";

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
     * The serialized property is an instance of the Serialized class, which is used to build serialize transactions.
     */
    readonly serialized: Serialized;

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
        this.serialized = new Serialized(networkInformation);
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
    ): Promise<TxnBuilderTypes.RawTransaction> {
        return simpleInternal(args, this.networkInformation);
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
    ): TxnBuilderTypes.RawTransaction {
        return rawTxnObjectInternal(args, this.networkInformation);
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