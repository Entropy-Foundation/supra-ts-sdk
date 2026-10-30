import { SupraAccount, TxnBuilderTypes } from "supra-l1-sdk-core";
import type { NetworkConfig } from "../../utils/apiEndpoints";
import type {
    AutomationTaskType,
    MultisigExecutionPayloadArgs,
    OptionalTransactionPayloadArgs,
    SendTxnPayload,
} from "../../types/transactionManager/transactionBuild";
import type { AccountAddressInput } from "../../types/account";
import type { MoveFunctionId, MoveModule, SimpleEntryFunctionArgumentTypes, TypeArgument } from "../../types/move";
import {
    ExtendedRawTransaction,
    rawTxnObjectInternal,
    sendTxnPayloadInternal,
    signedTransactionInternal,
    simpleInternal,
    extendedRawTransaction,
    scriptRawTxnObjectInternal,
    automationRegistrationRawTxnObjectInternal,
    multisigRawTxnObjectInternal,
    multisigProposalTxRawTxnObjectInternal,
} from "../../internal/transactionManager/txnBuild";

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
     * When neither the call nor the client sets `maxGas`, the max gas is `DEFAULT_MAX_GAS_UNITS`, at most the number
     * of gas units that the sender's SUPRA balance pays for at the gas unit price (one balance read; none with
     * `estimateMaxGas: false`). See {@link OptionalTransactionPayloadArgs}.
     * @param args.senderAddress - Sender account address
     * @param args.senderSequenceNumber - Sender account sequence number
     * @param args.function - Target function name as MoveFunctionId
     * @param args.functionTypeArgs - Target function type args
     * @param args.functionArgs - Target function args
     * @param args.optionalTransactionPayloadArgs - Optional arguments for transaction payload
     * @returns Raw transaction object
     * @example
     * ```typescript
     * import { Network, SupraAccount, SupraClient } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     * const account = new SupraAccount(); // an account that holds SUPRA
     *
     * async function runExample() {
     *
     *     const supraCoinTransferRawTransaction = await supra.transaction.build.simple({
     *         senderAddress: account.address(),
     *         senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
     *         function: "0x1::supra_account::transfer",
     *         functionTypeArgs: [],
     *         functionArgs: ["0x2", 10000n]
     *     });
     *
     *     console.log(supraCoinTransferRawTransaction);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Transaction
     */
    async simple(args: {
        senderAddress: AccountAddressInput;
        senderSequenceNumber: bigint;
        function: MoveFunctionId;
        functionTypeArgs: Array<TypeArgument>;
        functionArgs: Array<SimpleEntryFunctionArgumentTypes>;
        abi?: MoveModule;
        optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs;
    }): Promise<ExtendedRawTransaction> {
        return extendedRawTransaction(
            { rawTxn: await simpleInternal(args, this.networkInformation) },
            this.networkInformation,
        );
    }

    /**
     * Create raw transaction object for `entry_function_payload` type txn
     * @param args.senderAddress - Sender account address
     * @param args.senderSequenceNumber - Sender account sequence number
     * @param args.function - Target function name as MoveFunctionId
     * @param args.functionTypeArgs - Target function type args
     * @param args.functionArgs - Target function args
     * @param args.optionalTransactionPayloadArgs - Optional arguments for transaction payload. This builder makes no
     * request: without a `maxGas` on the call or the client, the max gas is `DEFAULT_MAX_GAS_UNITS` (20,000 units). The
     * node requires the sender's SUPRA balance to cover `max gas × gas unit price` at validation: 20,000 units at a
     * price of 100,000 quants need 20 SUPRA (2,000,000,000 quants). A sender with less must set `maxGas`. The builder
     * cannot read the node's gas unit price estimate: without a `gasUnitPrice` on the call or the client it throws a
     * `RangeError`; `supra.getEstimatedGasUnitPrice()` returns the estimate.
     * @returns Raw transaction object
     * @example
     * ```typescript
     * import { BCS, Network, SupraAccount, SupraClient } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     * const account = new SupraAccount(); // an account that holds SUPRA
     * const receiverAddress = new SupraAccount().address();
     *
     * async function runExample() {
     *
     *     const supraCoinTransferRawTransaction = supra.transaction.build.rawTxnObject({
     *         senderAddress: account.address(),
     *         senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
     *         function: "0x1::supra_account::transfer",
     *         functionTypeArgs: [],
     *         functionArgs: [receiverAddress.toUint8Array(), BCS.bcsSerializeUint64(10000n)],
     *         optionalTransactionPayloadArgs: { gasUnitPrice: await supra.getEstimatedGasUnitPrice() },
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
    rawTxnObject(args: {
        senderAddress: AccountAddressInput;
        senderSequenceNumber: bigint;
        function: MoveFunctionId;
        functionTypeArgs: TxnBuilderTypes.TypeTag[];
        functionArgs: Uint8Array[];
        optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs;
    }): ExtendedRawTransaction {
        return extendedRawTransaction(
            { rawTxn: rawTxnObjectInternal(args, this.networkInformation) },
            this.networkInformation,
        );
    }

    /**
     * Create raw transaction for `script_payload` type txn
     * @param args.senderAddress - Sender account address
     * @param args.senderSequenceNumber - Sender account sequence number
     * @param args.scriptCode - Move script bytecode
     * @param args.scriptTypeArgs - Type arguments that move script bytecode requires
     * @param args.scriptArgs - Arguments to the move script bytecode function
     * @param args.optionalTransactionPayloadArgs - Optional arguments for transaction payload. This builder makes no
     * request: without a `maxGas` on the call or the client, the max gas is `DEFAULT_MAX_GAS_UNITS` (20,000 units). The
     * node requires the sender's SUPRA balance to cover `max gas × gas unit price` at validation: 20,000 units at a
     * price of 100,000 quants need 20 SUPRA (2,000,000,000 quants). A sender with less must set `maxGas`. The builder
     * cannot read the node's gas unit price estimate: without a `gasUnitPrice` on the call or the client it throws a
     * `RangeError`; `supra.getEstimatedGasUnitPrice()` returns the estimate.
     * @returns Raw script transaction object
     * @example
     * ```typescript
     * import { HexString, Network, SupraAccount, SupraClient, TxnBuilderTypes } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     * const account = new SupraAccount(); // an account that holds SUPRA
     *
     * async function runExample() {
     *
     *     const moveScriptCodeHex = "0xa11ceb0b06000000050100040..."; // the compiled script
     *
     *     const supraCoinTransferSerializedScriptRawTransaction = supra.transaction.build.scriptRawTxnObject({
     *         senderAddress: account.address(),
     *         senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
     *         scriptCode: new HexString(moveScriptCodeHex).toUint8Array(),
     *         scriptTypeArgs: [],
     *         scriptArgs: [new TxnBuilderTypes.TransactionArgumentU64(BigInt(1000))],
     *         optionalTransactionPayloadArgs: { gasUnitPrice: await supra.getEstimatedGasUnitPrice() }
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
    scriptRawTxnObject(args: {
        senderAddress: AccountAddressInput;
        senderSequenceNumber: bigint;
        scriptCode: Uint8Array;
        scriptTypeArgs: TxnBuilderTypes.TypeTag[];
        scriptArgs: TxnBuilderTypes.TransactionArgument[];
        optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs;
    }): ExtendedRawTransaction {
        return extendedRawTransaction(
            { rawTxn: scriptRawTxnObjectInternal(args, this.networkInformation) },
            this.networkInformation,
        );
    }

    /**
     * Create raw transaction object for `automation_registration_payload` type txn
     *
     * The registration parameters are version 2 when `automationTaskType` or `automationPriority` is given, and
     * version 1 otherwise. Nodes of the v11.7.0 and v12 lines accept both versions. A version 1 registration and a
     * version 2 registration of task type `User` without a priority register the same task; the node records the
     * version in the transaction's payload.
     *
     * The node registers the task with `0x1::automation_registry`, which emits an
     * `0x1::automation_registry::AutomationTaskMetaData` event whose `task_index` is the index that
     * `Automation.cancelAutomationTask` and `Automation.stopAutomationTasks` take.
     * @param args.senderAddress - Sender account address
     * @param args.senderSequenceNumber - Sender account sequence number
     * @param args.function - Target function name as MoveFunctionId
     * @param args.functionTypeArgs - Target function type args
     * @param args.functionArgs - Target function args
     * @param args.automationMaxGasAmount - Max gas amount for automated transaction
     * @param args.automationGasPriceCap - Gas unit price upper limit that user is willing to pay. The node refuses a
     * registration whose cap is below its minimum gas unit price.
     * @param args.automationFeeCapForEpoch - Maximum automation fee that user is willing to pay for epoch.
     * @param args.automationExpirationTimestampSecs - Expiration time of the automated transaction in seconds since UTC Epoch start.
     * @param args.automationAuxData - Reserved for future extensions of registration parameters. Where the node adds
     * the task type and the priority to the auxiliary data (feature `SUPRA_AUTOMATION_V2`, enabled on Mainnet, Testnet
     * and Devnet), the registry accepts only an empty list.
     * @param args.automationTaskType - Task type of a version 2 registration: `"User"` (the default when only
     * `automationPriority` is given) or `"System"`. Only an account that the Supra framework has authorised to
     * register system tasks can register a `"System"` task; the registration of any other account aborts.
     * @param args.automationPriority - Priority of a version 2 registration, a `u64`. Without a priority the registry
     * assigns the task's index.
     * @param args.optionalTransactionPayloadArgs Optional arguments for transaction payload. This builder makes no
     * request: without a `maxGas` on the call or the client, the max gas is `DEFAULT_MAX_GAS_UNITS` (20,000 units). The
     * node requires the sender's SUPRA balance to cover `max gas × gas unit price` at validation: 20,000 units at a
     * price of 100,000 quants need 20 SUPRA (2,000,000,000 quants). A sender with less must set `maxGas`. The builder
     * cannot read the node's gas unit price estimate: without a `gasUnitPrice` on the call or the client it throws a
     * `RangeError`; `supra.getEstimatedGasUnitPrice()` returns the estimate.
     * @returns Raw transaction object
     * @throws `RangeError` before building when `automationTaskType` is not `"User"` or `"System"`, or
     * `automationPriority` is not a `bigint` from 0 to 2^64 - 1
     * @example
     * ```typescript
     * import { BCS, MILLISECONDS_PER_SECOND, Network, SupraAccount, SupraClient } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     * const account = new SupraAccount(); // an account that holds SUPRA
     * const receiverAddress = new SupraAccount().address();
     *
     * async function runExample() {
     *     const gasUnitPrice = await supra.getEstimatedGasUnitPrice();
     *
     *     // Version 2 registration of a user task with priority 10
     *     const registration = supra.transaction.build.automationRegistrationRawTxnObject({
     *         senderAddress: account.address(),
     *         senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
     *         function: "0x1::supra_account::transfer",
     *         functionTypeArgs: [],
     *         functionArgs: [receiverAddress.toUint8Array(), BCS.bcsSerializeUint64(1000n)],
     *         automationMaxGasAmount: 500n,
     *         automationGasPriceCap: 2n * gasUnitPrice,
     *         automationFeeCapForEpoch: 1_000_000_000n,
     *         automationExpirationTimestampSecs: BigInt(Math.floor(Date.now() / MILLISECONDS_PER_SECOND) + 60 * 60),
     *         automationAuxData: [],
     *         automationTaskType: "User",
     *         automationPriority: 10n,
     *         optionalTransactionPayloadArgs: { gasUnitPrice },
     *     });
     *
     *     const response = await registration.submitTransaction({
     *         senderAccount: account,
     *         enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true },
     *     });
     *     console.log(response.hash, response.status);
     * }
     *
     * runExample().catch(console.error);
     *
     * ```
     * @group Transaction
     */
    automationRegistrationRawTxnObject(args: {
        senderAddress: AccountAddressInput;
        senderSequenceNumber: bigint;
        function: MoveFunctionId;
        functionTypeArgs: TxnBuilderTypes.TypeTag[];
        functionArgs: Uint8Array[];
        automationMaxGasAmount: bigint;
        automationGasPriceCap: bigint;
        automationFeeCapForEpoch: bigint;
        automationExpirationTimestampSecs: bigint;
        automationAuxData: Uint8Array[];
        automationTaskType?: AutomationTaskType;
        automationPriority?: bigint;
        optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs;
    }): ExtendedRawTransaction {
        return extendedRawTransaction(
            { rawTxn: automationRegistrationRawTxnObjectInternal(args, this.networkInformation) },
            this.networkInformation,
        );
    }

    /**
     * Create raw transaction object for `multisig_payload` type txn: the execution of a multisig proposal.
     *
     * Give `function`, `functionTypeArgs` and `functionArgs` to execute a proposal that stores only the hash of its
     * payload (`create_transaction_with_hash`), or to have the node check the payload stored on chain against them.
     * Give none of the three to execute a proposal whose payload is stored on chain (`create_transaction`); the
     * transaction then carries no payload and the node reads it from the proposal. `supra.multisig.executeMultisigTransaction`
     * reads the proposal and chooses.
     *
     * A transaction without a payload cannot be simulated (`transaction.simulate.simple`, `transaction.simulate.serialized`,
     * `enableTransactionSimulation` when it is submitted): the node refuses with `MISSING_DATA`.
     * @param args.senderAddress - Sender account address
     * @param args.senderSequenceNumber - Sender account sequence number
     * @param args.multisigAddress - Multisig account address
     * @param args.function - Target function name as MoveFunctionId; absent for a proposal whose payload is stored on chain
     * @param args.functionTypeArgs - Target function type args; absent when `function` is
     * @param args.functionArgs - Target function args; absent when `function` is
     * @param args.optionalTransactionPayloadArgs Optional arguments for transaction payload. This builder makes no
     * request: without a `maxGas` on the call or the client, the max gas is `DEFAULT_MAX_GAS_UNITS` (20,000 units). The
     * node requires the sender's SUPRA balance to cover `max gas × gas unit price` at validation: 20,000 units at a
     * price of 100,000 quants need 20 SUPRA (2,000,000,000 quants). A sender with less must set `maxGas`. The builder
     * cannot read the node's gas unit price estimate: without a `gasUnitPrice` on the call or the client it throws a
     * `RangeError`; `supra.getEstimatedGasUnitPrice()` returns the estimate.
     * @returns Raw transaction object
     * @example
     * ```typescript
     * import { BCS, Network, SupraAccount, SupraClient } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     * const account = new SupraAccount(); // an owner of the multisig account, holding SUPRA
     * const multisigAccountAddress = "0x1234"; // replace with the address of the multisig account
     * const receiverAddress = new SupraAccount().address();
     *
     * async function runExample() {
     *
     *     const supraCoinTransferSerializedMultisigRawTransaction = supra.transaction.build.multisigRawTxnObject({
     *         senderAddress: account.address(),
     *         senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
     *         multisigAddress: multisigAccountAddress,
     *         function: "0x1::supra_account::transfer",
     *         functionTypeArgs: [],
     *         functionArgs: [receiverAddress.toUint8Array(), BCS.bcsSerializeUint64(1000n)],
     *         optionalTransactionPayloadArgs: { gasUnitPrice: await supra.getEstimatedGasUnitPrice() }
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
    multisigRawTxnObject(args: {
        senderAddress: AccountAddressInput;
        senderSequenceNumber: bigint;
        multisigAddress: AccountAddressInput;
        function?: MoveFunctionId;
        functionTypeArgs?: TxnBuilderTypes.TypeTag[];
        functionArgs?: Uint8Array[];
        optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs;
    }): ExtendedRawTransaction {
        const { function: targetFunction, functionTypeArgs, functionArgs, ...common } = args;
        let execution: MultisigExecutionPayloadArgs = {};
        if (targetFunction !== undefined) {
            if (functionTypeArgs === undefined || functionArgs === undefined) {
                throw new TypeError("function, functionTypeArgs and functionArgs are given together or not at all");
            }
            execution = { function: targetFunction, functionTypeArgs, functionArgs };
        } else if (functionTypeArgs !== undefined || functionArgs !== undefined) {
            throw new TypeError("function, functionTypeArgs and functionArgs are given together or not at all");
        }
        return extendedRawTransaction(
            { rawTxn: multisigRawTxnObjectInternal({ ...common, ...execution }, this.networkInformation) },
            this.networkInformation,
        );
    }

    /**
     * Create raw transaction object to create multisig transaction
     * @param args.senderAddress - Sender account address
     * @param args.senderSequenceNumber - Sender account sequence number
     * @param args.multisigAddress - Multisig account address
     * @param args.function - Target function name as MoveFunctionId
     * @param args.functionTypeArgs - Target function type args
     * @param args.functionArgs - Target function args
     * @param args.optionalTransactionPayloadArgs - Optional arguments for transaction payload. This builder makes no
     * request: without a `maxGas` on the call or the client, the max gas is `DEFAULT_MAX_GAS_UNITS` (20,000 units). The
     * node requires the sender's SUPRA balance to cover `max gas × gas unit price` at validation: 20,000 units at a
     * price of 100,000 quants need 20 SUPRA (2,000,000,000 quants). A sender with less must set `maxGas`. The builder
     * cannot read the node's gas unit price estimate: without a `gasUnitPrice` on the call or the client it throws a
     * `RangeError`; `supra.getEstimatedGasUnitPrice()` returns the estimate.
     * @returns Raw transaction object
     * @example
     * ```typescript
     * import { BCS, Network, SupraAccount, SupraClient } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     * const account = new SupraAccount(); // an owner of the multisig account, holding SUPRA
     * const multisigAccountAddress = "0x1234"; // replace with the address of the multisig account
     * const receiverAddress = new SupraAccount().address();
     *
     * async function runExample() {
     *
     *     const supraCoinTransferSerializedMultisigHashedRawTransaction = supra.transaction.build.multisigProposalTxRawTxnObject(
     *         {
     *             senderAddress: account.address(),
     *             senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
     *             multisigAddress: multisigAccountAddress,
     *             function: "0x1::supra_account::transfer",
     *             functionTypeArgs: [],
     *             functionArgs: [receiverAddress.toUint8Array(), BCS.bcsSerializeUint64(1000n)],
     *             optionalTransactionPayloadArgs: { gasUnitPrice: await supra.getEstimatedGasUnitPrice() }
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
    multisigProposalTxRawTxnObject(args: {
        senderAddress: AccountAddressInput;
        senderSequenceNumber: bigint;
        multisigAddress: AccountAddressInput;
        function: MoveFunctionId;
        functionTypeArgs: TxnBuilderTypes.TypeTag[];
        functionArgs: Uint8Array[];
        optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs;
    }): ExtendedRawTransaction {
        return extendedRawTransaction(
            { rawTxn: multisigProposalTxRawTxnObjectInternal(args, this.networkInformation) },
            this.networkInformation,
        );
    }

    /**
     * Create signed transaction payload
     * @param args.senderAccount - Sender KeyPair
     * @param args.rawTxn - Raw transaction payload
     * @returns `SignedTransaction`
     * @example
     * ```typescript
     * import { BCS, Network, SupraAccount, SupraClient } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     * const account = new SupraAccount(); // an account that holds SUPRA
     * const receiverAddress = new SupraAccount().address();
     *
     * async function runExample() {
     *
     *     const supraCoinTransferRawTransaction = supra.transaction.build.rawTxnObject({
     *         senderAddress: account.address(),
     *         senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
     *         function: "0x1::supra_account::transfer",
     *         functionTypeArgs: [],
     *         functionArgs: [receiverAddress.toUint8Array(), BCS.bcsSerializeUint64(10000n)],
     *         optionalTransactionPayloadArgs: { gasUnitPrice: await supra.getEstimatedGasUnitPrice() },
     *     });
     *
     *     const signedTransaction = await supra.transaction.build.signedTransaction({
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
     * @throws `SupraChainIdMismatchError` before signing when the client's or the transaction's chain ID is not the
     * node's (see `SupraConfig.verifyChainId`)
     * @group Transaction
     */
    signedTransaction(args: {
        senderAccount: SupraAccount;
        rawTxn: TxnBuilderTypes.RawTransaction;
    }): Promise<TxnBuilderTypes.SignedTransaction> {
        return signedTransactionInternal(args, this.networkInformation);
    }

    /**
     * Generate `SendTxnPayload` using `RawTransaction` to send transaction request
     * Generated data can be used to send transaction directly using `/rpc/v3/transactions/submit` endpoint of `rpc_node`
     * @param args.senderAccount - Sender KeyPair
     * @param args.rawTxn - Raw transaction data
     * @returns `SendTxPayload`. Its `u64` fields are `bigint`, which `JSON.stringify` rejects; serialize it with
     * `stringifyWithBigInt`, which writes them as exact JSON numbers.
     * @example
     * ```typescript
     * import { BCS, Network, SupraAccount, SupraClient, stringifyWithBigInt } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     * const account = new SupraAccount(); // an account that holds SUPRA
     * const receiverAddress = new SupraAccount().address();
     *
     * async function runExample() {
     *
     *     const supraCoinTransferRawTransaction = supra.transaction.build.rawTxnObject({
     *         senderAddress: account.address(),
     *         senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
     *         function: "0x1::supra_account::transfer",
     *         functionTypeArgs: [],
     *         functionArgs: [receiverAddress.toUint8Array(), BCS.bcsSerializeUint64(10000n)],
     *         optionalTransactionPayloadArgs: { gasUnitPrice: await supra.getEstimatedGasUnitPrice() },
     *     });
     *
     *     const supraCoinTransferSendTxnPayload = await supra.transaction.build.sendTxnPayload({
     *         senderAccount: account,
     *         rawTxn: supraCoinTransferRawTransaction
     *     });
     *
     *     let txn = await fetch("https://rpc-testnet.supra.com/rpc/v3/transactions/submit", {
     *         method: "POST",
     *         body: stringifyWithBigInt(supraCoinTransferSendTxnPayload),
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
     * @throws `SupraChainIdMismatchError` before signing when the client's or the transaction's chain ID is not the
     * node's (see `SupraConfig.verifyChainId`)
     * @group Transaction
     */
    sendTxnPayload(args: {
        senderAccount: SupraAccount;
        rawTxn: TxnBuilderTypes.RawTransaction;
    }): Promise<SendTxnPayload> {
        return sendTxnPayloadInternal(args, this.networkInformation);
    }
}
