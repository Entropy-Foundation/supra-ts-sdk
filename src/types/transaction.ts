import type { Authenticator, AutomationAuthenticator, MoveEvent, MoveFunctionId, MoveScriptBytecode, MoveTransactionAuthenticator } from "./move";

/**
 * The response for a transaction, which can be either pending or committed.
 */
export type TransactionResponse = PendingTransactionResponse | CommittedTransactionResponse;

/**
 * The response for a committed transaction, which can be one of several transaction types.
 */
export type CommittedTransactionResponse = UserTransactionResponse | AutomationTransactionResponse | BlockMetadataTransactionResponse | AutomationRecordTransactionResponse;


/**
 * The response for an auto transaction, which is a subset of a supra transaction response.
 */
export type AutoTransactionResponse = PendingTransactionResponse | AutomationTransactionResponse;


/**
 * The type of a transaction, which can be either user, auto, meta, or record.
 */
export enum TransactionType {
    User = "user",
    Auto = "automated",
    BlockMetadata = "block_metadata",
    AutomationRecord = "automation_record",
}

/**
 * The status of a transaction, which can be either success, fail, invalid, pending_after_execution, or pending.
 */
export enum TransactionStatus {
    // Execution succeeded.
    Success = "Success",
    // The transaction is valid but its execution failed due to running out of gas or a similar
    // runtime failure.
    Fail = "Fail",
    // The transaction is invalid, e.g. due to having an invalid signature.
    Invalid = "Invalid",
    // The transaction was executed after being ordered by the consensus, but it returned an error
    // code that indicates that it may succeed in a future execution (e.g. sequence number too high).
    PendingAfterExecution = "PendingAfterExecution",
    // Transaction is accepted by RPC, pending for execution.
    Pending = 'Pending',
}


/**
 * The payload for a transaction response, which can be an entry function, script, or multisig payload.
 */
export type TransactionPayloadResponse = EntryFunctionPayloadResponse | ScriptPayloadResponse | MultisigPayloadResponse | AutomationRegistrationPayloadResponse;

/**
 * The payload for an entry function, containing the type of the entry and the arguments.
 */
export interface EntryFunctionPayload {
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
export type EntryFunctionPayloadResponse = {
    type: "entry_function_payload";

} & EntryFunctionPayload;

/**
 * The payload for a script response, containing the type of the script.
 */
export type ScriptPayloadResponse = {
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
export type MultisigTransactionPayload = EntryFunctionPayloadResponse | AutomationRegistrationParams;

/**
 * The response payload for a multisig transaction, containing the type of the transaction.
 */
export type MultisigPayloadResponse = {
    type: "multisig_payload";
    multisig_address: string;
    transaction_payload?: MultisigTransactionPayload;
};

/**
 * Transaction parameters for automation registration
 */
export type AutomationRegistrationParams = AutomationRegistrationParamsV1 | AutomationRegistrationParamsV2;

/**
 *  Move transaction payload for automation registration
 */
export interface AutomationRegistrationPayloadResponse {
    type: "automation_registration_payload";
    V1?: AutomationRegistrationParamsV1;
    V2?: AutomationRegistrationParamsV2;
}


/**
 * Automation registration payload for version 1
 */
export interface AutomationRegistrationParamsV1 {
    automated_function: EntryFunctionPayload;
    expiration_timestamp_secs: number;
    max_gas_amount: number;
    gas_price_cap: number;
    automation_fee_cap: number;
    aux_data: any[]; // any additional data
}

/**
 * Automation registration payload for version 2
 */
export interface AutomationRegistrationParamsV2 {
    automated_function: EntryFunctionPayload,
    expiration_timestamp_secs: number,
    max_gas_amount: number,
    gas_price_cap: number,
    automation_fee_cap: number,
    aux_data: any[],
    task_type: "User" | "System",
    task_priority?: number,
}

export interface BlockHeader {
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

export interface Headers {
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
export type TransactionPayload = MoveTransactionPayload | DkgTransactionPayload | OracleTransactionPayload;

/**
 * The payload for a Move transaction, which contains the Move transaction payload.
 */
export interface MoveTransactionPayload {
    Move: TransactionPayloadResponse;
}

/**
 * The payload for a Dkg transaction, which contains the Dkg transaction payload.
 */
export interface DkgTransactionPayload {
    Dkg: any;
}

/**
 * The payload for an Oracle transaction, which contains the Oracle transaction payload.
 */
export interface OracleTransactionPayload {
    Oracle: any;
}

/**
 * The output for a Move transaction, which contains the gas used, events, and vm status.
 */
export interface MoveTransactionOutput {
    Move: {
        gas_used: number;
        events: MoveEvent[];
        vm_status: string;
    };
}


/**
 * The output for a Dkg transaction, which contains the status of the transaction.
 */
export interface DkgTransactionOutput {
    Dkg: TransactionStatus;
}

/**
 * The output for an Oracle transaction, which contains the status of the transaction.
 */
export interface OracleTransactionOutput {
    Oracle: TransactionStatus;
}

/**
 * The output for an empty transaction, which contains null.
 */
export interface EmptyTransactionOutput {
    Empty: null;
}


/**
 * The output for a transaction, which can be either Move, Dkg, Oracle, or Empty.
 */
export type TransactionOutput = MoveTransactionOutput | DkgTransactionOutput | OracleTransactionOutput | EmptyTransactionOutput


export interface SupraTransactionResponse {
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
export interface PendingTransactionResponse extends SupraTransactionResponse {
    txn_type: TransactionType;
    authenticator: Authenticator;
    status: TransactionStatus.Pending;
    block_header: null;
    output: null;
}


/**
 * The response for a user transaction, which is a subset of a supra transaction response.
 */
export interface UserTransactionResponse extends SupraTransactionResponse {
    txn_type: TransactionType.User;
    authenticator: MoveTransactionAuthenticator;
}

/**
 * The response for an automation transaction, which is a subset of a supra transaction response.
 */
export interface AutomationTransactionResponse extends SupraTransactionResponse {
    txn_type: TransactionType.Auto;
    authenticator: AutomationAuthenticator,
}

/**
 * The response for a block metadata transaction, which is a subset of a supra transaction response.
 */
export interface BlockMetadataTransactionResponse extends Pick<SupraTransactionResponse, "hash" | "block_header" | "output" | "status"> {
    txn_type: TransactionType.BlockMetadata;
}


/**
 * The response for an automation record transaction, which is a subset of a supra transaction response.
 */
export interface AutomationRecordTransactionResponse extends Pick<SupraTransactionResponse, "hash" | "block_header" | "output" | "status"> {
    txn_type: TransactionType.AutomationRecord;
    data: AutomationRecordData
}

/**
 * The data for an automation record transaction.
 */
export interface AutomationRecordData {
    /// Record index. It is unique in scope of the block.
    record_index: number,
    /// Cycle index for which automation bookkeeping is done.
    cycle_index: number,
    /// Height of the block in scope of which the record is executed.
    block_height: number,
    /// Action performed in scope of the bookkeeping record.
    action: {
        Process: any[]
    },
}

/**
 * The type of a transaction query, which can be either user, auto, meta, or record.
 */
export type TransactionQueryType = "user" | "auto" | "meta" | "record";


/**
 * Options for configuring the behavior of the waitForTransaction() function.
 */
export type WaitForTransactionOptions = {
    timeoutSecs?: number;
    checkSuccess?: boolean;
};





