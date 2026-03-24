import { TxnBuilderTypes } from "supra-l1-sdk-core";
import type { AccountAddressInput } from "./account";

/**
 * A structure representing a move with a name.
 */
export type MoveStructId = `${string}::${string}::${string}`;

/**
 * The move function containing its name. Same as MoveStructId since it reads weird to take a StructId for a Function.
 */
export type MoveFunctionId = MoveStructId;


/**
 * The bytecode for a Move script.
 */
export type MoveScriptBytecode = {
    bytecode: string;
    abi?: MoveFunction;
};

/**
 * A Move module containing an address.
 */
export type MoveModuleBytecode = {
    bytecode: string;
    abi?: MoveModule;
};

/**
 * A Move resource with a type and data.
 */
export type MoveResource<T = object> = {
    type: MoveStructId;
    data: T;
};

/**
 * A Move module
 */
export type MoveModule = {
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
export type MoveStruct = {
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
export type MoveStructField = {
    name: string;
    type: string;
};

/**
 * A string representation of a Move module, formatted as `module_name::function_name`.
 * Module names are case-sensitive.
 */
export type MoveModuleId = `${string}::${string}`;


/**
 * Specifies the visibility levels for move functions, controlling access permissions.
 */
// export enum MoveFunctionVisibility {
//     PRIVATE = "private",
//     PUBLIC = "public",
//     FRIEND = "friend",
// }

export type MoveFunctionVisibility = "private" | "public" | "friend";

/**
 * Abilities related to moving items within the system.
 */
// export enum MoveAbility {
//     STORE = "store",
//     DROP = "drop",
//     KEY = "key",
//     COPY = "copy",
// }

export type MoveAbility = "store" | "drop" | "key" | "copy";

/**
 * Move abilities associated with the generic type parameter of a function.
 */
export type MoveFunctionGenericTypeParam = {
    constraints: Array<MoveAbility>;
};

/**
 * Move function
 */
export type MoveFunction = {
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

export interface EventGuid {
    creation_number: string;
    account_address: string;
}

export interface MoveEvent {
    guid: EventGuid;
    sequence_number: string;
    type: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: Record<string, any> | any;
    // keep flexible — different events have different schemas
}


/**
 * An event emitted by a transaction.
 */
export interface Event {
    event: MoveEvent,
    block_height: number,
    transaction_hash: string
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
export type TypeArgument = TxnBuilderTypes.TypeTag | string;


/**
 * The union of all single account signatures, including Ed25519, and MultiEd25519 signatures.
 */
export type AccountSignature =
    | Ed25519Signature
    | MultiEd25519Signature;


/**
 * The union of all transaction authenticators.
 */
export type Authenticator = MoveTransactionAuthenticator | OracleAuthenticator | DkgAuthenticator | AutomationAuthenticator;

/**
 * The union of all move authenticators
 */
export type MoveInnerAuthenticator = Ed25519Signature | MultiEd25519Signature | MultiAgentSignature | FeePayerSignature | SingleSenderSignature;

/**
 * The authenticator for a move transaction
 */
export type MoveTransactionAuthenticator = {
    Move: Ed25519Signature | MultiEd25519Signature | MultiAgentSignature | FeePayerSignature | SingleSenderSignature
}

/**
 * The authenticator for an oracle transaction 
 */
export type OracleAuthenticator = {
    Oracle: {
        signer: string,
        /// Signature of the transaction by signer
        signature: string,
    }
}

/**
 * The authenticator for an Dkg transaction 
 */
export type DkgAuthenticator = {
    Dkg: {
        signer: string,
        /// Signature of the transaction by signer
        signature: string,
    }
}

/**
 * The structure for an Ed25519 signature in a transaction.
 */
export type Ed25519Signature = {
    Ed25519: {
        /**
         * The public key for the Ed25519 signature
         * */
        public_key: string;
        /**
         *  Signature associated with the public key
         * */
        signature: string;
    }
}


/**
 * The structure for a multi-signature transaction using Ed25519.
 */
export type MultiEd25519Signature = {
    MultiEd25519: {/**
     * The public keys for the Ed25519 signature
     */
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
    }
};

/**
 * The structure for a multi-agent signature in a transaction.
 */
export type MultiAgentSignature = {
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
    }
};

/**
 * The signature of the fee payer in a transaction.
 */
export type FeePayerSignature = {
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
    }
};

/**
 * The structure for a multi-signature transaction using Ed25519.
 */
export type SingleSenderSignature = {
    SingleSender: {
        public_key: { value: string; type: string };
        signature: { value: string; type: string };
    }
};

export type AutomationAuthenticator = {
    Automation: string;
}


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
export type MoveValue =
    | boolean
    | number
    | bigint
    | string
    | null // To support optional empty
    | undefined // To support optional empty
    | MoveStructId
    | object
    | Array<MoveValue>;

/**
 * Entry function arguments for building a raw transaction using remote ABI, supporting various data types including primitives and arrays.
 */
export type SimpleEntryFunctionArgumentTypes =
    | boolean
    | number
    | bigint
    | string
    | null // To support optional empty
    | undefined // To support optional empty
    | Uint8Array
    | ArrayBuffer
    | AccountAddressInput
    | Array<SimpleEntryFunctionArgumentTypes>;


export type SimpleEntryFunctionArgumentTypesRaw =
    | boolean
    | number // for u8, u16, u32
    | string // for u64, u128, u256 or string
    | object // for struct and option
    | Uint8Array
    | ArrayBuffer
    | Array<SimpleEntryFunctionArgumentTypes>;




