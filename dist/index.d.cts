import { HexString, TxnBuilderTypes, SupraAccount, AnyRawTransaction } from 'supra-l1-sdk-core';
import { AxiosResponse } from 'axios';

declare enum Network {
    MAINNET = "mainnet",
    TESTNET = "testnet"
}
interface NetworkConfig {
    name: string;
    chainId: number;
    rpcUrl: string;
    maxGas?: bigint;
    minGasUnitPrice?: bigint;
}
declare const NetworkInfo: Record<Network, NetworkConfig>;

/**
 * The data associated with an account, including its sequence number.
 */
interface AccountData {
    /**
     * The sequence number of the account.
     */
    sequence_number: bigint;
    /**
     * The authentication key of the account.
     */
    authentication_key: string;
}
/**
 * The address of an account. which can be a string or a HexString
 */
type AccountAddressInput = string | HexString;
/**
 * A paginated response from the API that includes a cursor for the next page of results.
 * @template T - The type of the response data to be returned.
 */
interface PaginatedResponse<T> {
    /**
     * The api response which can be of type T.
     */
    response: T;
    /**
     * The cursor for the next page of results. undefined if there are no more results.
     * @optional
     */
    cursor?: string | undefined;
}

/**
 * A structure representing a move with a name.
 */
type MoveStructId = `${string}::${string}::${string}`;
/**
 * The move function containing its name. Same as MoveStructId since it reads weird to take a StructId for a Function.
 */
type MoveFunctionId = MoveStructId;
/**
 * The bytecode for a Move script.
 */
type MoveScriptBytecode = {
    bytecode: string;
    abi?: MoveFunction;
};
/**
 * A Move module containing an address.
 */
type MoveModuleBytecode = {
    bytecode: string;
    abi?: MoveModule;
};
/**
 * A Move resource with a type and data.
 */
type MoveResource<T = {}> = {
    type: MoveStructId;
    data: T;
};
/**
 * A Move module
 */
type MoveModule = {
    address: string;
    name: string;
    /**
     * Friends of the module
     */
    friends: Array<MoveModuleId>;
    /**
     * Public functions of the module
     */
    exposed_functions: Array<MoveFunction>;
    /**
     * Structs of the module
     */
    structs: Array<MoveStruct>;
};
/**
 * A move struct
 */
type MoveStruct = {
    name: string;
    /**
     * Whether the struct is a native struct of Move
     */
    is_native: boolean;
    /**
     * Whether the struct is a module event (aka v2 event). This will be false for v1
     * events because the value is derived from the #[event] attribute on the struct in
     * the Move source code. This attribute is only relevant for v2 events.
     */
    is_event?: boolean;
    /**
     * True if the struct is an enum (e.g. enum MyEnum { A, B, C }), false if it is a
     * regular struct (e.g. struct MyStruct { a: u8, b: u8 }).
     */
    is_enum?: boolean;
    /**
     * Abilities associated with the struct
     */
    abilities: Array<MoveAbility>;
    /**
     * Generic types associated with the struct
     */
    generic_type_params: Array<MoveFunctionGenericTypeParam>;
    /**
     * Fields associated with the struct
     */
    fields: Array<MoveStructField>;
};
/**
 * A field in a Move struct, identified by its name.
 */
type MoveStructField = {
    name: string;
    type: string;
};
/**
 * A string representation of a Move module, formatted as `module_name::function_name`.
 * Module names are case-sensitive.
 */
type MoveModuleId = `${string}::${string}`;
/**
 * Specifies the visibility levels for move functions, controlling access permissions.
 */
type MoveFunctionVisibility = "private" | "public" | "friend";
/**
 * Abilities related to moving items within the system.
 */
type MoveAbility = "store" | "drop" | "key" | "copy";
/**
 * Move abilities associated with the generic type parameter of a function.
 */
type MoveFunctionGenericTypeParam = {
    constraints: Array<MoveAbility>;
};
/**
 * Move function
 */
type MoveFunction = {
    name: string;
    visibility: MoveFunctionVisibility;
    /**
     * Whether the function can be called as an entry function directly in a transaction
     */
    is_entry: boolean;
    /**
     * Whether the function is a view function or not
     */
    is_view: boolean;
    /**
     * Generic type params associated with the Move function
     */
    generic_type_params: Array<MoveFunctionGenericTypeParam>;
    /**
     * Parameters associated with the move function
     */
    params: Array<string>;
    /**
     * Return type of the function
     */
    return: Array<string>;
};
interface EventGuid {
    creation_number: string;
    account_address: string;
}
interface MoveEvent {
    guid: EventGuid;
    sequence_number: string;
    type: string;
    data: Record<string, any> | any;
}
/**
 * An event emitted by a transaction.
 */
interface Event {
    event: MoveEvent;
    block_height: number;
    transaction_hash: string;
}
/**
 * Inputs for Entry functions, view functions, and scripts, which can be a string representation of various types including
 * primitive types, vectors, and structured types.
 *
 *  *
 * This can be a string version of the type argument such as:
 * - u8
 * - u16
 * - u32
 * - u64
 * - u128
 * - u256
 * - i8
 * - i16
 * - i32
 * - i64
 * - i128
 * - i256
 * - bool
 * - address
 * - signer
 * - vector<Type>
 * - address::module::struct
 * - address::module::struct<Type1, Type2>
 * @group Implementation
 * @category Transactions
 */
type TypeArgument = TxnBuilderTypes.TypeTag | string;
/**
 * The union of all single account signatures, including Ed25519, and MultiEd25519 signatures.
 */
type AccountSignature = Ed25519Signature | MultiEd25519Signature;
/**
 * The union of all transaction authenticators.
 */
type Authenticator = MoveTransactionAuthenticator | OracleAuthenticator | DkgAuthenticator | AutomationAuthenticator;
/**
 * The union of all move authenticators
 */
type MoveInnerAuthenticator = Ed25519Signature | MultiEd25519Signature | MultiAgentSignature | FeePayerSignature | SingleSenderSignature;
/**
 * The authenticator for a move transaction
 */
type MoveTransactionAuthenticator = {
    Move: Ed25519Signature | MultiEd25519Signature | MultiAgentSignature | FeePayerSignature | SingleSenderSignature;
};
/**
 * The authenticator for an oracle transaction
 */
type OracleAuthenticator = {
    Oracle: {
        signer: string;
        signature: string;
    };
};
/**
 * The authenticator for an Dkg transaction
 */
type DkgAuthenticator = {
    Dkg: {
        signer: string;
        signature: string;
    };
};
/**
 * The structure for an Ed25519 signature in a transaction.
 */
type Ed25519Signature = {
    Ed25519: {
        /**
         * The public key for the Ed25519 signature
         * */
        public_key: string;
        /**
         *  Signature associated with the public key
         * */
        signature: string;
    };
};
/**
 * The structure for a multi-signature transaction using Ed25519.
 */
type MultiEd25519Signature = {
    MultiEd25519: {
        public_keys: Array<string>;
        /**
         * Signature associated with the public keys in the same order
         */
        signatures: Array<string>;
        /**
         * The number of signatures required for a successful transaction
         */
        threshold: number;
        bitmap: string;
    };
};
/**
 * The structure for a multi-agent signature in a transaction.
 */
type MultiAgentSignature = {
    MultiAgent: {
        sender: AccountSignature;
        /**
         * The other involved parties' addresses
         */
        secondary_signer_addresses: Array<string>;
        /**
         * The associated signatures, in the same order as the secondary addresses
         */
        secondary_signers: Array<AccountSignature>;
    };
};
/**
 * The signature of the fee payer in a transaction.
 */
type FeePayerSignature = {
    FeePayer: {
        sender: AccountSignature;
        /**
         * The other involved parties' addresses
         */
        secondary_signer_addresses: Array<string>;
        /**
         * The associated signatures, in the same order as the secondary addresses
         */
        secondary_signers: Array<AccountSignature>;
        fee_payer_address: string;
        fee_payer_signer: AccountSignature;
    };
};
/**
 * The structure for a multi-signature transaction using Ed25519.
 */
type SingleSenderSignature = {
    SingleSender: {
        public_key: {
            value: string;
            type: string;
        };
        signature: {
            value: string;
            type: string;
        };
    };
};
type AutomationAuthenticator = {
    Automation: string;
};
/**
 * Possible Move values acceptable by move functions (entry, view)
 *
 * Map of a Move value to the corresponding TypeScript value
 *
 * `Bool -> boolean`
 *
 * `u8, u16, u32 -> number`
 *
 * `u64, u128, u256 -> string`
 *
 * `i8, i16, i32 -> number`
 *
 * `i64, i128, i256 -> string`
 *
 * `String -> string`
 *
 * `Address -> 0x${string}`
 *
 * `Struct - 0x${string}::${string}::${string}`
 *
 * `Object -> 0x${string}`
 *
 * `Vector -> Array<MoveValue>`
 *
 * `Option -> MoveValue | null | undefined`
 */
type MoveValue = boolean | number | bigint | string | null | undefined | MoveStructId | Object | Array<MoveValue>;
/**
 * Entry function arguments for building a raw transaction using remote ABI, supporting various data types including primitives and arrays.
 */
type SimpleEntryFunctionArgumentTypes = boolean | number | bigint | string | null | undefined | Uint8Array | ArrayBuffer | AccountAddressInput | Array<SimpleEntryFunctionArgumentTypes>;
type SimpleEntryFunctionArgumentTypesRaw = boolean | number | string | Object | Uint8Array | ArrayBuffer | Array<SimpleEntryFunctionArgumentTypes>;

interface OptionalTransactionPayloadArgs {
    maxGas?: bigint;
    gasUnitPrice?: bigint;
    txExpiryTime?: bigint;
}
interface SendTxnPayload {
    Move: {
        raw_txn: RawTxnJSON;
        authenticator: MoveInnerAuthenticator;
    };
}
interface RawTxnJSON {
    sender: string;
    sequence_number: number;
    payload: TransactionPayloadJSON;
    max_gas_amount: number;
    gas_unit_price: number;
    expiration_timestamp_secs: number;
    chain_id: number;
}
type TransactionPayloadJSON = EntryFunctionPayloadJSON | ScriptPayloadJSON | AutomationRegistrationPayloadJSON | MultisigPayloadJSON;
interface EntryFunctionPayloadJSON {
    EntryFunction: EntryFunctionJSON;
}
interface EntryFunctionJSON {
    module: {
        address: string;
        name: string;
    };
    function: string;
    ty_args: Array<FunctionTypeArgs>;
    args: Array<Array<number>>;
}
interface MultisigPayloadJSON {
    Multisig: {
        multisig_address: string;
        transaction_payload?: EntryFunctionPayloadJSON;
    };
}
interface FunctionTypeArgs {
    struct: {
        address: string;
        module: string;
        name: string;
        type_args: Array<any>;
    };
}
interface ScriptPayloadJSON {
    Script: {
        code: Array<number>;
        ty_args: Array<FunctionTypeArgs>;
        args: Array<ScriptArgumentJson>;
    };
}
type ScriptArgumentJson = {
    U8: number;
} | {
    U16: number;
} | {
    U32: number;
} | {
    U64: number;
} | {
    U128: number;
} | {
    U256: Array<number>;
} | {
    Address: string;
} | {
    U8Vector: Array<number>;
} | {
    Bool: boolean;
};
interface AutomationRegistrationPayloadJSON {
    AutomationRegistration: AutomationRegistrationParamV1JSON;
}
interface AutomationRegistrationParamV1JSON {
    V1: {
        automated_function: EntryFunctionJSON;
        max_gas_amount: number;
        gas_price_cap: number;
        automation_fee_cap_for_epoch: number;
        expiration_timestamp_secs: number;
        aux_data: Array<Array<number>>;
    };
}

/**
 * The Serialized class provides methods for building serialized raw transactions.
 * @group Transaction
 */
declare class Serialized {
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
    constructor(networkInformation: NetworkConfig);
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
    rawTxnObject(args: {
        senderAddress: AccountAddressInput;
        senderSequenceNumber: bigint;
        function: MoveFunctionId;
        functionTypeArgs: TxnBuilderTypes.TypeTag[];
        functionArgs: Uint8Array[];
        optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs;
    }): Uint8Array;
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
    scriptRawTxnObject(args: {
        senderAddress: AccountAddressInput;
        senderSequenceNumber: bigint;
        scriptCode: Uint8Array;
        scriptTypeArgs: TxnBuilderTypes.TypeTag[];
        scriptArgs: TxnBuilderTypes.TransactionArgument[];
        optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs;
    }): Uint8Array;
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
        optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs;
    }): Uint8Array;
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
    multisigRawTxnObject(args: {
        senderAddress: AccountAddressInput;
        senderSequenceNumber: bigint;
        multisigAddress: AccountAddressInput;
        function: MoveFunctionId;
        functionTypeArgs: TxnBuilderTypes.TypeTag[];
        functionArgs: Uint8Array[];
        optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs;
    }): Uint8Array;
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
    multisigProposalTxRawTxnObject(args: {
        senderAddress: AccountAddressInput;
        senderSequenceNumber: bigint;
        multisigAddress: AccountAddressInput;
        function: MoveFunctionId;
        functionTypeArgs: TxnBuilderTypes.TypeTag[];
        functionArgs: Uint8Array[];
        optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs;
    }): Uint8Array;
}

/**
 * The Build class provides methods for building raw transactions.
 * @group Transaction
 */
declare class Build {
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
    constructor(networkInformation: NetworkConfig);
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
    simple(args: {
        senderAddress: AccountAddressInput;
        senderSequenceNumber: bigint;
        function: MoveFunctionId;
        functionTypeArgs: Array<TypeArgument>;
        functionArgs: Array<Exclude<SimpleEntryFunctionArgumentTypes, Uint8Array>>;
        abi?: MoveModule;
        optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs;
    }): Promise<TxnBuilderTypes.RawTransaction>;
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
    rawTxnObject(args: {
        senderAddress: AccountAddressInput;
        senderSequenceNumber: bigint;
        function: MoveFunctionId;
        functionTypeArgs: TxnBuilderTypes.TypeTag[];
        functionArgs: Uint8Array[];
        optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs;
    }): TxnBuilderTypes.RawTransaction;
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
    signedTransaction(args: {
        senderAccount: SupraAccount;
        rawTxn: TxnBuilderTypes.RawTransaction;
    }): TxnBuilderTypes.SignedTransaction;
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
    sendTxnPayload(args: {
        senderAccount: SupraAccount;
        rawTxn: TxnBuilderTypes.RawTransaction;
    }): SendTxnPayload;
}

/**
 * The response for a transaction, which can be either pending or committed.
 */
type TransactionResponse = PendingTransactionResponse | CommittedTransactionResponse;
/**
 * The response for a committed transaction, which can be one of several transaction types.
 */
type CommittedTransactionResponse = UserTransactionResponse | AutomationTransactionResponse | BlockMetadataTransactionResponse | AutomationRecordTransactionResponse;
/**
 * The response for an auto transaction, which is a subset of a supra transaction response.
 */
type AutoTransactionResponse = PendingTransactionResponse | AutomationTransactionResponse;
/**
 * The type of a transaction, which can be either user, auto, meta, or record.
 */
declare enum TransactionType {
    User = "user",
    Auto = "automated",
    BlockMetadata = "block_metadata",
    AutomationRecord = "automation_record"
}
/**
 * The status of a transaction, which can be either success, fail, invalid, pending_after_execution, or pending.
 */
declare enum TransactionStatus {
    Success = "Success",
    Fail = "Fail",
    Invalid = "Invalid",
    PendingAfterExecution = "PendingAfterExecution",
    Pending = "Pending"
}
/**
 * The payload for a transaction response, which can be an entry function, script, or multisig payload.
 */
type TransactionPayloadResponse = EntryFunctionPayloadResponse | ScriptPayloadResponse | MultisigPayloadResponse | AutomationRegistrationPayloadResponse;
/**
 * The payload for an entry function, containing the type of the entry and the arguments.
 */
interface EntryFunctionPayload {
    function: MoveFunctionId;
    /**
     * Type arguments of the function
     */
    type_arguments: Array<string>;
    /**
     * Arguments of the function
     */
    arguments: Array<any>;
}
/**
 * The response payload for an entry function, containing the type of the entry.
 */
type EntryFunctionPayloadResponse = {
    type: "entry_function_payload";
} & EntryFunctionPayload;
/**
 * The payload for a script response, containing the type of the script.
 */
type ScriptPayloadResponse = {
    type: 'script_payload';
    code: MoveScriptBytecode;
    /**
     * Type arguments of the function
     */
    type_arguments: Array<string>;
    /**
     * Arguments of the function
     */
    arguments: Array<any>;
};
/**
 * The payload for a multisig transaction, which can be an entry function or automation registration payload.
 */
type MultisigTransactionPayload = EntryFunctionPayloadResponse | AutomationRegistrationParams;
/**
 * The response payload for a multisig transaction, containing the type of the transaction.
 */
type MultisigPayloadResponse = {
    type: "multisig_payload";
    multisig_address: string;
    transaction_payload?: MultisigTransactionPayload;
};
/**
 * Transaction parameters for automation registration
 */
type AutomationRegistrationParams = AutomationRegistrationParamsV1 | AutomationRegistrationParamsV2;
/**
 *  Move transaction payload for automation registration
 */
interface AutomationRegistrationPayloadResponse {
    type: "automation_registration_payload";
    V1?: AutomationRegistrationParamsV1;
    V2?: AutomationRegistrationParamsV2;
}
/**
 * Automation registration payload for version 1
 */
interface AutomationRegistrationParamsV1 {
    automated_function: EntryFunctionPayload;
    expiration_timestamp_secs: number;
    max_gas_amount: number;
    gas_price_cap: number;
    automation_fee_cap: number;
    aux_data: any[];
}
/**
 * Automation registration payload for version 2
 */
interface AutomationRegistrationParamsV2 {
    automated_function: EntryFunctionPayload;
    expiration_timestamp_secs: number;
    max_gas_amount: number;
    gas_price_cap: number;
    automation_fee_cap: number;
    aux_data: any[];
    task_type: "User" | "System";
    task_priority?: number;
}
interface BlockHeader {
    author: string;
    hash: string;
    height: number;
    parent: string;
    timestamp: {
        microseconds_since_unix_epoch: number;
        utc_date_time: string;
    };
    view: {
        epoch_id: {
            chain_id: number;
            epoch: number;
        };
        round: number;
    };
}
interface Headers {
    chain_id: number;
    expiration_timestamp: {
        microseconds_since_unix_epoch: number;
        utc_date_time: string;
    };
    sender: {
        Move: string;
    };
    sequence_number: number;
    gas_unit_price: number;
    max_gas_amount: number;
}
/**
 * The payload for a transaction, which can be either Move, Dkg, Oracle, or Empty.
 */
type TransactionPayload = MoveTransactionPayload | DkgTransactionPayload | OracleTransactionPayload;
/**
 * The payload for a Move transaction, which contains the Move transaction payload.
 */
interface MoveTransactionPayload {
    Move: TransactionPayloadResponse;
}
/**
 * The payload for a Dkg transaction, which contains the Dkg transaction payload.
 */
interface DkgTransactionPayload {
    Dkg: any;
}
/**
 * The payload for an Oracle transaction, which contains the Oracle transaction payload.
 */
interface OracleTransactionPayload {
    Oracle: any;
}
/**
 * The output for a Move transaction, which contains the gas used, events, and vm status.
 */
interface MoveTransactionOutput {
    Move: {
        gas_used: number;
        events: MoveEvent[];
        vm_status: string;
    };
}
/**
 * The output for a Dkg transaction, which contains the status of the transaction.
 */
interface DkgTransactionOutput {
    Dkg: TransactionStatus;
}
/**
 * The output for an Oracle transaction, which contains the status of the transaction.
 */
interface OracleTransactionOutput {
    Oracle: TransactionStatus;
}
/**
 * The output for an empty transaction, which contains null.
 */
interface EmptyTransactionOutput {
    Empty: null;
}
/**
 * The output for a transaction, which can be either Move, Dkg, Oracle, or Empty.
 */
type TransactionOutput = MoveTransactionOutput | DkgTransactionOutput | OracleTransactionOutput | EmptyTransactionOutput;
interface SupraTransactionResponse {
    authenticator: Authenticator;
    /**
     * Block header is null for pending transactions
     */
    block_header: BlockHeader | null;
    hash: string;
    header: Headers;
    payload: TransactionPayload;
    /**
     * Output is null for pending transactions
     */
    output: TransactionOutput | null;
    status: TransactionStatus;
}
/**
 * The response for a pending transaction, which is a subset of a supra transaction response.
 */
interface PendingTransactionResponse extends SupraTransactionResponse {
    txn_type: TransactionType;
    authenticator: Authenticator;
    status: TransactionStatus.Pending;
    block_header: null;
    output: null;
}
/**
 * The response for a user transaction, which is a subset of a supra transaction response.
 */
interface UserTransactionResponse extends SupraTransactionResponse {
    txn_type: TransactionType.User;
    authenticator: MoveTransactionAuthenticator;
}
/**
 * The response for an automation transaction, which is a subset of a supra transaction response.
 */
interface AutomationTransactionResponse extends SupraTransactionResponse {
    txn_type: TransactionType.Auto;
    authenticator: AutomationAuthenticator;
}
/**
 * The response for a block metadata transaction, which is a subset of a supra transaction response.
 */
interface BlockMetadataTransactionResponse extends Pick<SupraTransactionResponse, "hash" | "block_header" | "output" | "status"> {
    txn_type: TransactionType.BlockMetadata;
}
/**
 * The response for an automation record transaction, which is a subset of a supra transaction response.
 */
interface AutomationRecordTransactionResponse extends Pick<SupraTransactionResponse, "hash" | "block_header" | "output" | "status"> {
    txn_type: TransactionType.AutomationRecord;
    data: AutomationRecordData;
}
/**
 * The data for an automation record transaction.
 */
interface AutomationRecordData {
    record_index: number;
    cycle_index: number;
    block_height: number;
    action: {
        Process: any[];
    };
}
/**
 * The type of a transaction query, which can be either user, auto, meta, or record.
 */
type TransactionQueryType = "user" | "auto" | "meta" | "record";
/**
 * Options for configuring the behavior of the waitForTransaction() function.
 */
type WaitForTransactionOptions = {
    timeoutSecs?: number;
    checkSuccess?: boolean;
};

/**
 * The Simulate class provides methods for simulating transactions on the Supra network.
 * @group Transaction
 */
declare class Simulate {
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
    constructor(networkInformation: NetworkConfig);
    /**
     * Simulate a transaction using the provided transaction payload
     * @param args.sendTxPayload -  Transaction payload
     * @returns Transaction simulation result
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *   // Simulate a transaction use sendTxPayload
     *   const response = await supra.transaction.simulate.simple({ sendTxPayload: { ... } }); // replace with a real transaction payload
     *
     *   console.log(response);
     * }
     * runExample().catch(console.error);
     * ```
     * @group Transaction
     */
    simple(args: {
        sendTxPayload: SendTxnPayload;
    }): Promise<TransactionResponse>;
    /**
     * Simulate a transaction using the provided Serialized raw transaction data
     * @param args.txAuthenticator - Transaction authenticator
     * @param args.serializedRawTransaction - Serialized raw transaction data
     * @returns Transaction simulation result
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *   // Simulate a transaction use serializedRawTransaction
     *   const response = await supra.transaction.simulate.serialized({ txAuthenticator: { ... }, serializedRawTransaction: Uint8Array.from([1,2,3]) }); // replace with a real transaction payload
     *
     *   console.log(response);
     * }
     * runExample().catch(console.error);
     * ```
     * @group Transaction
     */
    serialized(args: {
        txAuthenticator: MoveInnerAuthenticator;
        serializedRawTransaction: Uint8Array;
    }): Promise<TransactionResponse>;
}

interface EnableTransactionWaitAndSimulationArgs {
    enableWaitForTransaction?: boolean;
    enableTransactionSimulation?: boolean;
}
interface OptionalTransactionArgs {
    optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs;
    enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs;
}

/**
 * The Submit class provides methods for submitting transactions to the Supra network.
 * @group Transaction
 */
declare class Submit {
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
    constructor(networkInformation: NetworkConfig);
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
    submitRawTransaction(args: {
        senderAccount: SupraAccount;
        rawTransaction: TxnBuilderTypes.RawTransaction;
        enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs;
    }): Promise<TransactionResponse>;
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
    submitSerializedRawTransaction(args: {
        senderAccount: SupraAccount;
        serializedRawTransaction: Uint8Array;
        enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs;
    }): Promise<TransactionResponse>;
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
    submitSerializedRawTransactionAndSignature(args: {
        senderPubkey: HexString;
        signature: HexString;
        serializedRawTransaction: Uint8Array;
        enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs;
    }): Promise<TransactionResponse>;
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
    submitSponsorTransaction(args: {
        feePayerAddress: AccountAddressInput;
        secondarySignersAccountAddress: Array<string>;
        rawTxn: TxnBuilderTypes.RawTransaction;
        senderAuthenticator: TxnBuilderTypes.AccountAuthenticatorEd25519;
        feePayerAuthenticator: TxnBuilderTypes.AccountAuthenticatorEd25519;
        secondarySignersAuthenticator: Array<TxnBuilderTypes.AccountAuthenticatorEd25519>;
        enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs;
    }): Promise<TransactionResponse>;
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
    submitMultiAgentTransaction(args: {
        secondarySignersAccountAddress: Array<string>;
        rawTxn: TxnBuilderTypes.RawTransaction;
        senderAuthenticator: TxnBuilderTypes.AccountAuthenticatorEd25519;
        secondarySignersAuthenticator: Array<TxnBuilderTypes.AccountAuthenticatorEd25519>;
        enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs;
    }): Promise<TransactionResponse>;
}

/**
 * The Account class provides methods for querying the state of an account.
 * @group Account
 */
declare class Account {
    /**
     * The networkInformation property is A NetworkConfig object that contains information about the network on which the Supra client is running.
     */
    protected readonly networkInformation: NetworkConfig;
    /**
     * The constructor function takes a NetworkConfig object as a parameter and assigns it to the networkInformation property.
     * @param networkInformation - A NetworkConfig object that contains information about the network on which the SupraClient is running.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     * ```
     * @group Account
     */
    constructor(networkInformation: NetworkConfig);
    /**
     * Check whether given account exists onchain or not
     * @param args.account - The address of the account to query.
     * @returns `true` if account exists otherwise `false`
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *    const accountAddress = "0x1";
     *    const isAccountExists = await supra.account.isAccountExists({ account: accountAddress});
     *    console.log(isAccountExists);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Account
     */
    isAccountExists(args: {
        accountAddress: AccountAddressInput;
    }): Promise<boolean>;
    /**
     * Queries the current state of an account, including its sequence number and authentication key.
     * @param args.accountAddress - The address of the account to query.
     * @returns A Promise that resolves to an AccountData object containing the sequence number and authentication key of the account.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *    const accountAddress = "0x1";
     *    const accountData = await supra.account.getAccountInfo({ accountAddress: accountAddress}); });
     *   console.log(accountData);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Account
     */
    getAccountInfo(args: {
        accountAddress: AccountAddressInput;
    }): Promise<AccountData>;
    /**
     * Queries the modules of an account.
     * @param args.accountAddress - The address of the account to query.
     * @param args.options.count - The number of modules to return.
     * @param args.options.start - Cursor specifying where to start for pagination. Use the cursor returned by the previous request when making the next request.
     * @returns A Promise that resolves to an array of MoveModuleBytecode objects representing the modules of the account with optional cursor.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *    const accountAddress = "0x1";
     *    const {response: accountModules, cursor} = await supra.account.getAccountModules({ accountAddress: accountAddress });
     *    console.log(accountModules);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Account
     */
    getAccountModules(args: {
        accountAddress: AccountAddressInput;
        options?: {
            count?: number;
            start?: string;
        };
    }): Promise<PaginatedResponse<MoveModuleBytecode[]>>;
    /**
     * Queries a specific module of an account.
     * @param args.accountAddress - The address of the account to query.
     * @param args.moduleName - The name of the module to query.
     * @returns A Promise that resolves to a MoveModuleBytecode object representing the module of the account.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *    const accountAddress = "0x1";
     *    const accountModule = await supra.account.getAccountModule({ accountAddress: accountAddress, moduleName: "module_name" });
     *    console.log(accountModule);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Account
     */
    getAccountModule(args: {
        accountAddress: AccountAddressInput;
        moduleName: string;
    }): Promise<MoveModuleBytecode>;
    /**
     * Queries the resources of an account.
     * @param args.accountAddress - The address of the account to query.
     * @param args.options.count - The number of resources to return.
     * @param args.options.start - Cursor specifying where to start for pagination. Use the cursor returned by the previous request when making the next request.
     * @returns A Promise that resolves to an array of MoveResource objects representing the resources of the account with optional cursor.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *    const accountAddress = "0x1";
     *    const {response: accountResources, cursor} = await supra.account.getAccountResources({ accountAddress: accountAddress });
     *    console.log(accountResources);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Account
     */
    getAccountResources(args: {
        accountAddress: AccountAddressInput;
        options?: {
            count?: number;
            start?: string;
        };
    }): Promise<PaginatedResponse<MoveResource[]>>;
    /**
     * Queries a specific resource of an account.
     * @template T - The type of the resource to be returned.
     * @param args.accountAddress - The address of the account to query.
     * @param args.resourceType - The type of the resource to query.
     * @returns A Promise that resolves to a MoveResource object representing the resource of the account.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *    const accountAddress = "0x1";
     *    const accountResource = await supra.account.getAccountResource({ accountAddress: accountAddress, resourceType: "0x1::coin::CoinStore<0x1::supra_coin::SupraCoin>" });
     *    console.log(accountResource);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Account
     */
    getAccountResource<T extends {}>(args: {
        accountAddress: AccountAddressInput;
        resourceType: MoveStructId;
    }): Promise<MoveResource<T>>;
    /**
     * Queries the transactions of an account.
     * @template {TransactionResponse} T - The type of the transaction to be returned.
     * @param args.accountAddress - The address of the account to query.
     * @param args.options.count - The number of transactions to return.
     * @param args.options.start - Cursor specifying where to start for pagination. Use the cursor returned by the previous request when making the next request.
     * @param args.options.ascending - Whether to return the transactions in ascending order.
     * @note Maximum number of items to return default is 20 and maximum is 100.
     * @returns A Promise that resolves to an array of TransactionResponse objects representing the transactions of the account with optional cursor.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *    const accountAddress = "0x1";
     *    const {response: accountTransactions, cursor} = await supra.account.getAccountTransactions({ accountAddress: accountAddress });
     *    console.log(accountTransactions);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Account
     */
    getAccountTransactions<T extends TransactionResponse>(args: {
        accountAddress: AccountAddressInput;
        options?: {
            count?: number;
            start?: string;
            ascending?: boolean;
        };
    }): Promise<PaginatedResponse<T[]>>;
    /**
     * Queries the coin transactions of an account.
     * @template {TransactionResponse} T - The type of the transaction to be returned.
     * @param args.accountAddress - The address of the account to query.
     * @param args.options.count - The number of transactions to return.
     * @param args.options.start - Cursor specifying where to start for pagination. Use the cursor returned by the previous request when making the next request.
     * @param args.options.ascending - Whether to return the transactions in ascending order.
     * @note Maximum number of items to return default is 20 and maximum is 100.
     * @returns A Promise that resolves to an array of TransactionResponse objects representing the coin transactions of the account with optional cursor.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *    const accountAddress = "0x1";
     *    const {response: accountCoinTransactions , cursor} = await supra.account.getAccountCoinTransactions({ accountAddress: accountAddress });
     *    console.log(accountCoinTransactions);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Account
     */
    getAccountCoinTransactions<T extends TransactionResponse>(args: {
        accountAddress: AccountAddressInput;
        options?: {
            count?: number;
            start?: string;
            ascending?: boolean;
            type?: TransactionQueryType;
        };
    }): Promise<PaginatedResponse<T[]>>;
    /**
     * Queries the auto transactions of an account.
     * @template {TransactionResponse} T - The type of the transaction to be returned.
     * @param args.accountAddress - The address of the account to query.
     * @param args.options.count - The number of transactions to return.
     * @param args.options.block_height - Starting block height (inclusive). Optional.
     *  The block height at which to start lookup for transactions. If provided, returns :count of transactions starting from it in the specified order. For order see :ascending flag.
     * @note If a :cursor is specified then this field will be ignored.
     * @param args.options.cursor - Cursor specifying where to start for pagination. Use the cursor returned by the previous request when making the next request.
     * If provided, returns :count of transactions starting from this cursor in the specified order. For order see :ascending flag.
     * If not specified, the lookup will be done based on the :block_height parameter value.
     * @note If both :cursor and :block_height are specified then :cursor has precedence.
     * @param args.options.ascending - Whether to return the transactions in ascending order.
     * @note Maximum number of items to return default is 20 and maximum is 100.
     * @returns A Promise that resolves to an array of AutoTransactionResponse objects representing the auto transactions of the account with optional cursor.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *    const accountAddress = "0x1";
     *    const {response: accountAutoTransactions, cursor} = await supra.account.getAccountAutoTransactions({ accountAddress: accountAddress });
     *    console.log(accountAutoTransactions);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Account
     */
    getAccountAutoTransactions<T extends AutoTransactionResponse>(args: {
        accountAddress: AccountAddressInput;
        options?: {
            count?: number;
            block_height?: number;
            cursor?: string;
            ascending?: boolean;
        };
    }): Promise<PaginatedResponse<T[]>>;
    /**
     * Queries the number of coins owned by an account.
     * @param args.accountAddress - The address of the account to query.
     * @note This method is only available for legacy coins for now.
     * @returns A Promise that resolves to the number of coins owned by the account.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *    const accountAddress = "0x1";
     *    const accountCoinsCount = await supra.account.getAccountCoinsCount({ accountAddress: accountAddress });
     *    console.log(accountCoinsCount);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Account
     */
    getAccountCoinsCount(args: {
        accountAddress: AccountAddressInput;
    }): Promise<number>;
    /**
     * Queries the balance of SupraCoin owned by an account.
     * @param args.accountAddress - The address of the account to query.
     * @returns A Promise that resolves to the balance of SupraCoin owned by the account.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *    const accountAddress = "0x1";
     *    const accountSupraCoinBalance = await supra.account.getAccountSupraCoinBalance({ accountAddress: accountAddress });
     *    console.log(accountSupraCoinBalance);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Account
     */
    getAccountSupraCoinBalance(args: {
        accountAddress: AccountAddressInput;
    }): Promise<BigInt>;
    /**
     * Queries the balance of a coin owned by an account.
     * @param args.accountAddress - The address of the account to query.
     * @param args.asset - The address of the coin to query wether it is a legacy coin or fungible asset.
     * @returns A Promise that resolves to the balance of the coin owned by the account.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *    const accountAddress = "0x1";
     *    const accountSupraCoinBalance = await supra.account.getAccountCoinBalance({ accountAddress: accountAddress, asset: "0x1::supra_coin::SupraCoin" });
     *    console.log(accountSupraCoinBalance);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Account
     */
    getAccountCoinBalance(args: {
        accountAddress: AccountAddressInput;
        asset: MoveStructId | AccountAddressInput;
    }): Promise<BigInt>;
}

type MoveModules = DeepReadonly<MoveModule[]>;
type MoveToTS<T extends string> = T extends "u8" | "u16" | "u32" | "i8" | "i16" | "i32" ? number : T extends "u64" | "u128" | "u256" | "i64" | "i128" | "i256" ? bigint : T extends "bool" ? boolean : T extends "signer" | "&signer" ? SupraAccount : T extends "address" ? AccountAddressInput : T extends "vector<u8>" ? string | Uint8Array | ArrayBuffer | any[] : T extends `0x1::object::Object<${infer U}>` ? AccountAddressInput : T extends "0x1::option::Option<u8>" ? string | number | null : T extends `0x1::option::Option<${infer U}>` ? MoveToTS<U> | null : T extends `vector<${infer U}>` ? MoveToTS<U>[] : T extends `0x1::string::String` ? string : T extends `${infer CA}::${infer MN}::${infer S}` ? `${CA}::${MN}::${S}` : any;
type ReturnTypes<F extends DeepReadonly<MoveFunction>> = F['return'] extends readonly [...infer R] ? {
    [K in keyof R]: MoveToTS<R[K] & string>;
} : void;
type MapArgs<ARGUMENTS extends readonly string[] | undefined> = ARGUMENTS extends readonly [...infer R] ? {
    [K in keyof R]: MoveToTS<R[K] & string>;
} : [];
type MapTypeArgs<TYPE_ARGUMENTS extends readonly any[] | undefined> = TYPE_ARGUMENTS extends readonly [...infer TRest] ? {
    [K in keyof TRest]: string | TxnBuilderTypes.TypeTag;
} : [];
type Args<FUNCTION extends {
    typeArguments?: readonly any[] | undefined;
    functionArguments?: readonly string[] | undefined;
}> = {
    functionArguments: MapArgs<FUNCTION['functionArguments']>;
    typeArguments: MapTypeArgs<FUNCTION['typeArguments']>;
};
type ViewFunctionsFromABI<CONTRACT extends DeepReadonly<MoveModule>> = {
    [FUNCTION in CONTRACT['exposed_functions'][number] as FUNCTION['is_view'] extends true ? FUNCTION['name'] : never]: (args: Args<{
        functionArguments: FUNCTION['params'];
        typeArguments: ConvertGenerics<FUNCTION['generic_type_params']>;
    }>) => Promise<ReturnTypes<FUNCTION>>;
};
type EntryArgs<FUNCTION extends {
    typeArguments?: readonly any[] | undefined;
    functionArguments?: readonly string[] | undefined;
    optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs;
    enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs;
}> = {
    functionArguments: MapArgs<FUNCTION['functionArguments']>;
    typeArguments: MapTypeArgs<FUNCTION['typeArguments']>;
    optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs;
    enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs;
};
type EntryFunctionsFromABI<CONTRACT extends DeepReadonly<MoveModule>> = {
    [FUNCTION in CONTRACT['exposed_functions'][number] as FUNCTION['is_entry'] extends true ? FUNCTION['name'] : never]: (args: EntryArgs<{
        functionArguments: FUNCTION['params'];
        typeArguments: ConvertGenerics<FUNCTION['generic_type_params']>;
        optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs;
        enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs;
    }>) => Promise<TransactionResponse>;
};
type StructFromABI<T extends DeepReadonly<MoveModule>> = {
    [F in T['structs'][number] as F["name"]]: () => {
        [Field in F['fields'][number] as Field['name']]: Field['type'];
    };
};
type ContractsFromABI<CONTRACTS extends DeepReadonly<MoveModule[]>> = {
    [CONTRACT in CONTRACTS[number] as CONTRACT['name']]: {
        view: ViewFunctionsFromABI<CONTRACT>;
        entry: EntryFunctionsFromABI<CONTRACT>;
    };
};
type DeepReadonly<T> = Readonly<{
    [K in keyof T]: T[K] extends (number | string | symbol) ? Readonly<T[K]> : T[K] extends Array<infer A> ? Readonly<Array<DeepReadonly<A>>> : DeepReadonly<T[K]>;
}>;
type ConvertGenerics<T extends readonly any[], Counter extends any[] = []> = T extends readonly [any, ...infer Rest] ? readonly [`T${Counter['length']}`, ...ConvertGenerics<Rest, [...Counter, any]>] : readonly [];

/**
 * The Contract class provides methods for interacting with the Supra network.
 * @beta
 * @group Contract
 */
declare class Contract {
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
    * @group Faucet
    */
    constructor(networkInformation: NetworkConfig);
    /**
     * The fromABI function takes an array of MoveModule (Contract ABI) objects as input.
     * @beta
     * @param abis - An array of MoveModule (Contract ABI) objects.
     * @returns An object with a contracts property which contains view and entry properties.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *    const instance = supra.contract.fromABI([COIN_ABI] as const);
     *    let balance = await instance.contracts.coin.view.balance({
     *        functionArguments: ["0x10cdf6e0c4c5c762bb23be3eac5c7eaa272c1b4abe0573cd1386c5632b7992ca"],
     *        typeArguments: ["0x1::supra_coin::SupraCoin"]
     *    })
     *    console.log("Balance:", balance[0]);
     * }
     *
     * runExample().catch(console.error);
     *
     * ```
     * @group Contract
     */
    fromABI<T extends DeepReadonly<MoveModule[]>>(abis: T): {
        contracts: ContractsFromABI<T>;
    };
}

interface FaucetTransactionResponse {
    hash: string;
}

/**
 * The Faucet class provides methods for funding accounts on the Supra network.
 * @group Faucet
 */
declare class Faucet {
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
    * @group Faucet
    */
    constructor(networkInformation: NetworkConfig);
    /**
     * Fund an account with faucet for testnet.
     * @param args.accountAddress - The address to fund.
     * @returns A Promise that resolves to a FaucetTransactionResponse object.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *    const accountAddress = "0x1";
     *    const faucetResponse = await supra.faucet.fundAccountWithFaucet({ accountAddress: accountAddress });
     *    console.log(faucetResponse);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Faucet
     */
    fundAccountWithFaucet(args: {
        accountAddress: AccountAddressInput;
    }): Promise<FaucetTransactionResponse>;
}

/**
 * The data needed to generate a View Function payload.
 */
type InputViewFunctionData = {
    function: MoveFunctionId;
    typeArguments?: Array<TypeArgument>;
    functionArguments?: Array<SimpleEntryFunctionArgumentTypes>;
    abi?: MoveModule;
};
/**
 * The data needed to generate a View Function payload.
 */
type InputViewRawFunctionData = {
    function: string;
    typeArguments?: Array<string>;
    functionArguments?: Array<SimpleEntryFunctionArgumentTypesRaw>;
};

/**
 * The Methods class provides general methods for interacting with the Supra network.
 * @group Methods
 */
declare class Methods {
    /**
    * The networkInformation property is A NetworkConfig object that contains information about the network on which the Supra client is running.
    */
    protected readonly networkInformation: NetworkConfig;
    /**
     * The constructor function takes a NetworkConfig object as a parameter and assigns it to the networkInformation property.
     * @param networkInformation - A NetworkConfig object that contains information about the network on which the Supra client is running.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-l1-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     * ```
     * @group Methods
     */
    constructor(networkInformation: NetworkConfig);
    /**
     *  Queries for a Move view function
     * @template T - The type of the MoveValue array to be returned.
     * @param args.function - The name of the function to query.
     * @param args.typeArguments - An array of type arguments for the function.
     * @param args.functionArguments - An array of arguments for the function.
     * @returns A Promise that resolves to an array of MoveValue objects.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *    const accountAddress = "0x1";
     *    const supraCoin = new TypeTagParser("0x1::supra_coin::SupraCoin").parseTypeTag();
     *    const accountSupraBalance = await supra.methods.view({
     *        function: "0x1::coin::balance",
     *        functionArguments: [accountAddress],
     *        typeArguments: [supraCoin]
     *    });
     *    console.log("Account supra balance:", accountSupraBalance[0]);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Methods
     */
    view<T extends Array<MoveValue>>(args: InputViewFunctionData): Promise<T>;
    /**
     * Queries for a Move view function without type conversion or parsing
     * @template T - The type of the array to be returned.
     * @param args.function - The name of the function to query.
     * @param args.typeArguments - An array of type arguments for the function.
     * @param args.functionArguments - An array of arguments for the function.
     * @returns A Promise that resolves to an array of values.
     * @note This is for raw data without type conversion or parsing.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *    const accountAddress = "0x1";
     *    const accountSupraBalance = await supra.methods.viewRaw({
     *        function: "0x1::coin::balance",
     *        functionArguments: [accountAddress],
     *        typeArguments: ["0x1::supra_coin::SupraCoin"]
     *    });
     *    console.log("Account supra balance:", accountSupraBalance[0]);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Methods
     */
    viewRaw<T extends Array<any>>(args: InputViewRawFunctionData): Promise<T>;
}

/**
 * The SupraConfig interface is used to configure the SupraClient class.
 * You can set maxGas and minGasUnitPrice if you want to override global default values
 */
interface SupraConfig {
    network: Network;
    maxGas?: bigint;
    minGasUnitPrice?: bigint;
}
interface GasPrice {
    mean_gas_price: number;
    max_gas_price: number;
    median_gas_price: number;
    min_configured_gas_price: number;
}

/**
 * The key and value types for a table item.
 */
type TableKeyValueTypeHelper<T extends string = string> = "bool" | "u8" | "u16" | "u32" | "u64" | "u128" | "u256" | "address" | "signer" | `vector<${T}>` | MoveStructId;
type TableKeyValueType = TableKeyValueTypeHelper<TableKeyValueTypeHelper>;
/**
 * The request payload for the GetTableItem API.
 */
type TableItemRequest = {
    key_type: TableKeyValueType;
    value_type: TableKeyValueType;
    /**
     * The value of the table item's key
     */
    key: any;
};

/**
 * The Table class provides methods for querying table items on the Supra network.
 * @group Table
 */
declare class Table {
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
     * @group Table
     */
    constructor(networkInformation: NetworkConfig);
    /**
     * Query a table item on Supra.
     * @template T - The type of the response data to be returned.
     * @param args.handle - The table handle.
     * @param args.data.key_type - The type of the table item's key.
     * @param args.data.value_type - The type of the table item's value.
     * param args.data.key - The value of the table item's key.
     * @returns A Promise that resolves to the table item's value.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *    const handle = "0x1";
     *    const key = "0x1";
     *    const keyType = "address";
     *    const valueType = "u64";
     *    const tableItem = await supra.table.getTableItem({ handle: handle, data: { key_type: keyType, value_type: valueType, key: key }});
     *    console.log(tableItem);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Table
     */
    getTableItem<T>(args: {
        handle: AccountAddressInput;
        data: TableItemRequest;
    }): Promise<T>;
}

/**
 * The Transaction class provides methods for interacting with the Supra network.
 * @group Transaction
 */
declare class Transaction {
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
    constructor(networkInformation: NetworkConfig);
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
    getTransactionByHash<T extends TransactionResponse>(args: {
        transactionHash: string;
        type?: TransactionQueryType;
        exclude_uncommitted?: boolean;
    }): Promise<TransactionResponse>;
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
    isPendingTransaction(args: {
        transactionHash: string;
    }): Promise<boolean>;
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
    waitForTransaction(args: {
        transactionHash: string;
        options?: WaitForTransactionOptions;
    }): Promise<CommittedTransactionResponse>;
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
    getTransactionSignatureMessage(args: {
        rawTxn: AnyRawTransaction;
    }): Uint8Array;
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
    signTransaction(args: {
        senderAccount: SupraAccount;
        rawTxn: AnyRawTransaction;
    }): HexString | TxnBuilderTypes.AccountAuthenticatorEd25519;
    /**
     * Derives the transaction hash from a signed transaction.
     * @param args.signedTransaction - The signed transaction.
     * @returns The transaction hash.
     * @group Transaction
     */
    deriveTransactionHash(args: {
        signedTransaction: TxnBuilderTypes.SignedTransaction;
    }): string;
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
    publishPackage(args: {
        senderAccount: SupraAccount;
        packageMetadata: Uint8Array;
        modulesCode: Uint8Array[];
        optionalTransactionArgs?: OptionalTransactionArgs;
    }): Promise<TransactionResponse>;
}

interface CoinInfo {
    name: string;
    symbol: string;
    decimals: number;
}

/**
 * The Coin class provides methods for interacting with the legacy coins on the Supra network.
 * @group Coin
 */
declare class Coin {
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
    * @group Faucet
    */
    constructor(networkInformation: NetworkConfig);
    /**
     * Get coin info of the given coin type
     * @param args.coinType Type of a coin resource
     * @returns CoinInfo
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *    const coinType = "0x1::supra_coin::SupraCoin";
     *    const coinInfo = await supra.coin.getCoinInfo({ coinType: coinType });
     *    console.log(coinInfo);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Coin
     */
    getCoinInfo(args: {
        coinType: MoveFunctionId;
    }): Promise<CoinInfo>;
    /**
     * Transfer SupraCoin from one account to another.
     * @param args.senderAccount - The account sending the SupraCoin.
     * @param args.receiverAccountAddress - The address of the account receiving the SupraCoin.
     * @param args.amount - The amount of SupraCoin to transfer.
     * @param args.optionalTransactionArgs - Optional transaction arguments.
     * @returns A Promise that resolves to a TransactionResponse object.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *    const receiverAccountAddress = "0x2";
     *    const amount = 100;
     *    const transactionResponse = await supra.coin.transferSupraCoin({ senderAccount: senderAccount, receiverAccountAddress: receiverAccountAddress, amount: amount });
     *    console.log(transactionResponse);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Coin
     */
    transferSupraCoin(args: {
        senderAccount: SupraAccount;
        receiverAccountAddress: AccountAddressInput;
        amount: number | bigint;
        optionalTransactionArgs?: OptionalTransactionArgs;
    }): Promise<TransactionResponse>;
    /**
     * Transfer a coin from one account to another.
     * @param args.senderAccount - The account sending the coin.
     * @param args.receiverAccountAddress - The address of the account receiving the coin.
     * @param args.amount - The amount of the coin to transfer.
     * @param args.coinType - The type of the coin to transfer.
     * @param args.optionalTransactionArgs - Optional transaction arguments.
     * @returns A Promise that resolves to a TransactionResponse object.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *    const receiverAccountAddress = "0x2";
     *    const amount = 100;
     *    const coinType = "0x1::supra_coin::SupraCoin";
     *    const transactionResponse = await supra.coin.transferCoin({ senderAccount: senderAccount, receiverAccountAddress: receiverAccountAddress, amount: amount, coinType: coinType });
     *    console.log(transactionResponse);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Coin
     */
    transferCoin(args: {
        senderAccount: SupraAccount;
        receiverAccountAddress: AccountAddressInput;
        amount: number | bigint;
        coinType: MoveFunctionId;
        optionalTransactionArgs?: OptionalTransactionArgs;
    }): Promise<TransactionResponse>;
}

/**
 * The Events class provides methods for fetching events on the Supra network.
 * @group Events
 */
declare class Events {
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
    * @group Faucet
    */
    constructor(networkInformation: NetworkConfig);
    /**
     * Get coin info of the given coin type
     * @param args.eventType - Type of event
     * @param args.options.startHeight - Starting block height (inclusive)
     * @param args.options.endHeight - Ending block height (exclusive)
     * @param args.options.limit - Maximum number of events to return. Defaults to 20, max 100.
     * @param args.options.start - Cursor specifying where to start for pagination. Use the cursor returned by the previous request when making the next request.
     * @returns A Promise that resolves to an array of events.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *    const eventType = "0x1::coin::Transfer";
     *    const {response: events, cursor} = await supra.events.getEventByType({ eventType: eventType });
     *    console.log(events);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Events
     */
    getEventsByType(args: {
        eventType: MoveFunctionId;
        options: {
            startHeight?: number;
            endHeight?: number;
            limit?: number;
            start?: number;
        };
    }): Promise<PaginatedResponse<Event[]>>;
}

interface FinalizedBlockHeader {
    header: BlockHeader;
    execution_statistics: {
        automated_txn_count?: number | null;
        automated_txn_gas_unit_price?: number | null;
        block_gas_unit_price_min?: number | null;
        block_gas_unit_price_max?: number | null;
        block_total_user_gas_used?: number | null;
        block_total_automated_gas_used?: number | null;
        user_txn_count?: number | null;
    } | null;
    transactions: TransactionResponse[] | null;
}

/**
 * The Block class provides methods for querying block information on the Supra network.
 * @group Block
 */
declare class Block {
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
    * @group Faucet
    */
    constructor(networkInformation: NetworkConfig);
    /**
     * Get the meta information of the most recently finalized and executed block.
     * @returns A Promise that resolves to a FinalizedBlockHeader object.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *    const accountAddress = "0x1";
     *    const block = await supra.block.getLatestBlock();
     *    console.log(block);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Block
     */
    getLatestBlock(): Promise<FinalizedBlockHeader>;
    /**
     * Get information about the block that has been finalized at the given height.
     * @param args.height - The height of the block to retrieve.
     * @param args.options.withFinalizedTransactions - Whether to include the transactions in the block.
     * @param args.options.type - The type of block to retrieve.
     * @returns A Promise that resolves to a FinalizedBlockHeader object.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *    const height = 1;
     *    const block = await supra.block.getBlockByHeight({ height: height });
     *    console.log(block);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Block
     */
    getBlockByHeight(args: {
        height: number;
        options?: {
            withFinalizedTransactions?: boolean;
            type?: "user" | "auto" | "meta";
        };
    }): Promise<FinalizedBlockHeader>;
    /**
     * Get the header and execution output statistics of the block with the given hash.
     * @param args.blockHash - The hash of the block to retrieve.
     * @returns A Promise that resolves to a FinalizedBlockHeader object.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *    const blockHash = "0x1";
     *    const block = await supra.block.getBlockByHash({ blockHash: blockHash });
     *    console.log(block);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Block
     */
    getBlockByHash(args: {
        blockHash: string;
    }): Promise<FinalizedBlockHeader>;
    /**
     * Get a list containing the hashes of the transactions that were finalized in the block with the given hash in the order that they were executed.
     * @param args.blockHash - The hash of the block to retrieve.
     * @param args.options.type - The type of block to retrieve.
     * @returns A Promise that resolves to a string array.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *    const blockHash = "0x1";
     *    const transactions = await supra.block.getTransactionsByBlockHash({ blockHash: blockHash });
     *    console.log(transactions);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Block
     */
    getTransactionsByBlockHash(args: {
        blockHash: string;
        options?: {
            type?: "user" | "auto" | "meta";
        };
    }): Promise<string[]>;
}

/**
 * The FungibleAsset class provides methods for interacting with the FungibleAsset on the Supra network.
 * @group FungibleAsset
 */
declare class FungibleAsset {
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
    * @group Faucet
    */
    constructor(networkInformation: NetworkConfig);
    /**
     * Get the metadata of a fungible asset.
     * @param args.assetAddress - The address of the fungible asset.
     * @returns A Promise that resolves to the metadata of the fungible asset.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *    const assetAddress = "0x1";
     *    const fungibleAssetMetadata = await supra.fungibleAsset.getFungibleAssetMetadata({ assetAddress: assetAddress });
     *    console.log(fungibleAssetMetadata);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group FungibleAsset
     */
    getFungibleAssetMetadata(args: {
        assetAddress: AccountAddressInput;
    }): Promise<CoinInfo>;
    /**
     * Transfer supra fungible asset from one account to another.
     * @param args.senderAccount - The account sending the SupraCoin.
     * @param args.receiverAccountAddress - The address of the account receiving the SupraCoin.
     * @param args.amount - The amount of SupraCoin to transfer.
     * @param args.optionalTransactionArgs - Optional transaction arguments.
     * @returns A Promise that resolves to a TransactionResponse object.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *    const receiverAccountAddress = "0x2";
     *    const amount = 100;
     *    const transactionResponse = await supra.fungibleAsset.transferSupraFungibleAsset({ senderAccount: senderAccount, receiverAccountAddress: receiverAccountAddress, amount: amount });
     *    console.log(transactionResponse);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group FungibleAsset
     */
    transferSupraFungibleAsset(args: {
        senderAccount: SupraAccount;
        receiverAccountAddress: AccountAddressInput;
        amount: number | bigint;
        optionalTransactionArgs?: OptionalTransactionArgs;
    }): Promise<TransactionResponse>;
    /**
     * Transfer a fungible asset from one account to another.
     * @param args.senderAccount - The account sending the coin.
     * @param args.receiverAccountAddress - The address of the account receiving the coin.
     * @param args.amount - The amount of the coin to transfer.
     * @param args.assetAddress - The address of the coin to transfer.
     * @param args.optionalTransactionArgs - Optional transaction arguments.
     * @returns A Promise that resolves to a TransactionResponse object.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *    const receiverAccountAddress = "0x2";
     *    const amount = 100;
     *    const assetAddress = "0x000000000000000000000000000000000000000000000000000000000000000a";
     *    const transactionResponse = await supra.fungibleAsset.transferFungibleAsset({ senderAccount: senderAccount, receiverAccountAddress: receiverAccountAddress, amount: amount, assetAddress: assetAddress });
     *    console.log(transactionResponse);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group FungibleAsset
     */
    transferFungibleAsset(args: {
        senderAccount: SupraAccount;
        receiverAccountAddress: AccountAddressInput;
        amount: number | bigint;
        assetAddress: AccountAddressInput;
        optionalTransactionArgs?: OptionalTransactionArgs;
    }): Promise<TransactionResponse>;
}

/**
 * The SupraClient class is the main entry point for interacting with the SupraClient sdk.
 * It takes a SupraConfig object as a parameter and use the NetworkConfig property to interact with the Supra rest api.
 * @group SupraClient
*/
declare class SupraClient {
    /**
     * SupraConfig is the configuration object for the SupraClient class. It contains the network property which can be either "mainnet" or "testnet".
     */
    readonly config: SupraConfig;
    /**
     * The networkInformation property is A NetworkConfig object that contains information about the network on which the Supra client is running.
     */
    readonly networkInformation: NetworkConfig;
    /**
     * Account instance provides methods for interacting with accounts related operations on the Supra network.
     */
    readonly account: Account;
    /**
     * Transaction instance provides methods for interacting with transactions related operations on the Supra network.
     */
    readonly transaction: Transaction;
    /**
     * Contract instance provides methods for interacting with contracts related operations on the Supra network.
     */
    readonly contract: Contract;
    /**
     * Faucet instance provides methods for interacting with faucets related operations on the Supra network.
     */
    readonly faucet: Faucet;
    /**
     * Methods instance provides general functions for interacting with the Supra network.
     */
    readonly methods: Methods;
    /**
     * Table instance provides methods for interacting with tables related operations on the Supra network.
     */
    readonly table: Table;
    /**
     * Coin instance provides methods for interacting with coin related operations on the Supra network.
     */
    readonly coin: Coin;
    /**
     * Events instance provides methods for interacting with events related operations on the Supra network.
     */
    readonly events: Events;
    /**
     * Block instance provides methods for interacting with block related operations on the Supra network.
     */
    readonly block: Block;
    /**
     * FungibleAsset instance provides methods for interacting with fungible asset related operations on the Supra network.
     */
    readonly fungibleAsset: FungibleAsset;
    /**
    * The constructor function takes a SupraConfig object as a parameter and assigns it to the config property.
    * @param config - A SupraConfig object that contains information about the network on which the Supra client is running.
    * @note - You don't need to pass the rpc url or chain id it will be set automatically.
    * @example
    * ```typescript
    * import { SupraClient,Network } from "supra-ts-sdk";
    *
    * const supra = new SupraClient({ network: Network.TESTNET });
    *
    * ```
    * @group SupraClient
    */
    constructor(config: SupraConfig);
    /**
     * Get Chain Id Of Supra Network
     * @returns Chain Id of network
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *    const chainId = await supra.getChainId();
     *    console.log(chainId);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group SupraClient
     */
    getChainId(): TxnBuilderTypes.ChainId;
    /**
   * Get current `median_gas_price`
   * @returns Current `median_gas_price`
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   *
   * const supra = new SupraClient({ network: Network.TESTNET });
   *
   * async function runExample() {
   *    const gasPrice = await supra.getGasPrice();
   *    console.log(gasPrice);
   * }
   *
   * runExample().catch(console.error);
   * ```
   * @group SupraClient
   */
    getGasPrice(): Promise<bigint>;
    /**
     * Get current `min_price_per_gas_unit`
     * @returns Current `min_price_per_gas_unit`
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *    const gasPrice = await supra.getMinGasUnitPrice();
     *    console.log(gasPrice);
     * }
     * runExample().catch(console.error);
     *
     * ```
     * @group SupraClient
     */
    getMinGasUnitPrice(): Promise<bigint>;
}
interface SupraClient extends Account, Transaction, Contract, Methods, Faucet, Table, Coin, Events, Block, FungibleAsset {
}

/**
 * SupraAPIErrorOptions is an interface that defines the properties of the SupraAPIError class.
 */
interface SupraAPIErrorOptions {
    status: number;
    statusText: string;
    url: string;
    data?: any;
    request: AxiosResponse | undefined;
}
/**
 * SupraAPIError is a custom error class that extends the built-in Error class. It is used to represent errors that occur when making requests to the Supra API.
 * The class has properties for the status code, status text, URL, and any additional data that may be returned by the API.
 * @group SupraAPIError
 */
declare class SupraAPIError extends Error {
    readonly status: number;
    readonly statusText: string;
    readonly url: string;
    readonly data?: any;
    readonly request: AxiosResponse;
    readonly major_status: string | undefined;
    constructor(args: SupraAPIErrorOptions);
}

/**
 * Standardize an address
 * @param address - The address to standardize
 * @returns The standardized address
 * @example
 * ```typescript
 * import { functions } from "supra-l1-sdk";
 *
 * const address = "1234...";
 * const standardizedAddress = functions.standardizeAddress(address);
 * console.log(standardizedAddress); // "0x1234..."
 * ```
 */
declare function standardizeAddress(address: AccountAddressInput): string;

declare const DEFAULT_CHAIN_ID = 6;
declare const MAX_RETRY_FOR_TRANSACTION_COMPLETION = 300;
declare const DELAY_BETWEEN_POOLING_REQUEST = 1000;
declare const DEFAULT_RECORDS_ITEMS_COUNT = 15;
declare const DEFAULT_MAX_GAS_UNITS: bigint;
declare const DEFAULT_GAS_PRICE: bigint;
declare const DEFAULT_TX_EXPIRATION_DURATION = 300;
declare const MILLISECONDS_PER_SECOND = 1000;
declare const SUPRA_FRAMEWORK_ADDRESS = "0x0000000000000000000000000000000000000000000000000000000000000001";
declare const SUPRA_COIN_TYPE = "0x1::supra_coin::SupraCoin";
declare const OBJECT_CORE = "0x1::object::ObjectCore";
declare const DEFAULT_ENABLE_SIMULATION = false;
declare const DEFAULT_WAIT_FOR_TX_COMPLETION = false;
declare const DEFAULT_MAX_GAS_FOR_SUPRA_TRANSFER_WHEN_RECEIVER_EXISTS = 10;
declare const DEFAULT_MAX_GAS_FOR_SUPRA_TRANSFER_WHEN_RECEIVER_NOT_EXISTS = 1020;
declare const RAW_TRANSACTION_SALT = "SUPRA::RawTransaction";
declare const RAW_TRANSACTION_WITH_DATA_SALT = "SUPRA::RawTransactionWithData";
declare const DEFAULT_RPC_VERSION = "v3";
declare const RPC_VERSION_V1 = "v1";
declare const RPC_VERSION_V2 = "v2";
declare const DEFAULT_TXN_TIMEOUT_SEC = 20;

export { Account, type AccountAddressInput, type AccountData, type Args, type AutoTransactionResponse, type AutomationRecordData, type AutomationRecordTransactionResponse, type AutomationRegistrationParamV1JSON, type AutomationRegistrationParams, type AutomationRegistrationParamsV1, type AutomationRegistrationParamsV2, type AutomationRegistrationPayloadJSON, type AutomationRegistrationPayloadResponse, type AutomationTransactionResponse, Block, type BlockHeader, type BlockMetadataTransactionResponse, Build, Coin, type CommittedTransactionResponse, Contract, type ContractsFromABI, type ConvertGenerics, DEFAULT_CHAIN_ID, DEFAULT_ENABLE_SIMULATION, DEFAULT_GAS_PRICE, DEFAULT_MAX_GAS_FOR_SUPRA_TRANSFER_WHEN_RECEIVER_EXISTS, DEFAULT_MAX_GAS_FOR_SUPRA_TRANSFER_WHEN_RECEIVER_NOT_EXISTS, DEFAULT_MAX_GAS_UNITS, DEFAULT_RECORDS_ITEMS_COUNT, DEFAULT_RPC_VERSION, DEFAULT_TXN_TIMEOUT_SEC, DEFAULT_TX_EXPIRATION_DURATION, DEFAULT_WAIT_FOR_TX_COMPLETION, DELAY_BETWEEN_POOLING_REQUEST, type DeepReadonly, type DkgTransactionOutput, type DkgTransactionPayload, type EmptyTransactionOutput, type EnableTransactionWaitAndSimulationArgs, type EntryArgs, type EntryFunctionJSON, type EntryFunctionPayload, type EntryFunctionPayloadJSON, type EntryFunctionPayloadResponse, type EntryFunctionsFromABI, Events, Faucet, type FaucetTransactionResponse, type FunctionTypeArgs, FungibleAsset, type GasPrice, type Headers, type InputViewFunctionData, type InputViewRawFunctionData, MAX_RETRY_FOR_TRANSACTION_COMPLETION, MILLISECONDS_PER_SECOND, type MapArgs, type MapTypeArgs, Methods, type MoveModules, type MoveToTS, type MoveTransactionOutput, type MoveTransactionPayload, type MultisigPayloadJSON, type MultisigPayloadResponse, type MultisigTransactionPayload, Network, type NetworkConfig, NetworkInfo, OBJECT_CORE, type OptionalTransactionArgs, type OptionalTransactionPayloadArgs, type OracleTransactionOutput, type OracleTransactionPayload, type PaginatedResponse, type PendingTransactionResponse, RAW_TRANSACTION_SALT, RAW_TRANSACTION_WITH_DATA_SALT, RPC_VERSION_V1, RPC_VERSION_V2, type RawTxnJSON, type ReturnTypes, SUPRA_COIN_TYPE, SUPRA_FRAMEWORK_ADDRESS, type ScriptArgumentJson, type ScriptPayloadJSON, type ScriptPayloadResponse, type SendTxnPayload, Serialized, Simulate, type StructFromABI, Submit, SupraAPIError, type SupraAPIErrorOptions, SupraClient, type SupraConfig, type SupraTransactionResponse, Table, type TableItemRequest, type TableKeyValueType, type TableKeyValueTypeHelper, Transaction, type TransactionOutput, type TransactionPayload, type TransactionPayloadJSON, type TransactionPayloadResponse, type TransactionQueryType, type TransactionResponse, TransactionStatus, TransactionType, type UserTransactionResponse, type ViewFunctionsFromABI, type WaitForTransactionOptions, standardizeAddress };
