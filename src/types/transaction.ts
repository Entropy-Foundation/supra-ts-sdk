// Portions of this file are derived from @aptos-labs/ts-sdk (https://github.com/aptos-labs/aptos-ts-sdk),
// Copyright © Aptos Foundation, licensed under the Apache License, Version 2.0. See NOTICE.
import type {
    Authenticator,
    AutomationAuthenticator,
    MoveEvent,
    MoveFunctionId,
    MoveScriptBytecode,
    MoveTransactionAuthenticator,
} from "./move";

/**
 * The response for a transaction, which can be either pending or committed.
 */
export type TransactionResponse = PendingTransactionResponse | CommittedTransactionResponse;

/**
 * The response for a committed transaction, discriminated by `txn_type`.
 *
 * Only the user and automated variants carry `header`, `payload` and `authenticator`. Narrow on `txn_type`
 * (or check `"header" in txn`) before reading them:
 *
 * ```typescript
 * import { TransactionType, type CommittedTransactionResponse } from "supra-ts-sdk";
 *
 * function printSender(txn: CommittedTransactionResponse): void {
 *     if (txn.txn_type === TransactionType.User || txn.txn_type === TransactionType.Auto) {
 *         console.log(txn.header.sender.Move);
 *     }
 * }
 * ```
 */
export type CommittedTransactionResponse =
    | UserTransactionResponse
    | AutomationTransactionResponse
    | BlockMetadataTransactionResponse
    | AutomationRecordTransactionResponse
    | SettlementTransactionResponse;

/**
 * The response for an auto transaction, which is a subset of a supra transaction response.
 */
export type AutoTransactionResponse = PendingTransactionResponse | AutomationTransactionResponse;

/**
 * The value of `txn_type` in a transaction response.
 *
 * `Settlement` is returned by nodes from v12 onwards. Nodes before v12 never return it.
 */
export enum TransactionType {
    User = "user",
    Auto = "automated",
    BlockMetadata = "block_metadata",
    AutomationRecord = "automation_record",
    Settlement = "settlement",
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
    Pending = "Pending",
}

/**
 * The payload for a transaction response, which can be an entry function, script, or multisig payload.
 */
export type TransactionPayloadResponse =
    | EntryFunctionPayloadResponse
    | ScriptPayloadResponse
    | MultisigPayloadResponse
    | AutomationRegistrationPayloadResponse;

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    type: "script_payload";
    code: MoveScriptBytecode;
    /**
     * Type arguments of the function
     */
    type_arguments: Array<string>;
    /**
     * Arguments of the function
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    aux_data: any[];
}

/**
 * Automation registration payload for version 2. `task_type` is in lower case, as the node writes it; the
 * registration takes `AutomationTaskType` (`"User"` or `"System"`).
 */
export interface AutomationRegistrationParamsV2 {
    automated_function: EntryFunctionPayload;
    expiration_timestamp_secs: number;
    max_gas_amount: number;
    gas_price_cap: number;
    automation_fee_cap: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    aux_data: any[];
    task_type: "user" | "system";
    /** The priority given at registration; `null` when the registry assigned it. */
    task_priority: number | null;
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Dkg: any;
}

/**
 * The payload for an Oracle transaction, which contains the Oracle transaction payload.
 */
export interface OracleTransactionPayload {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
 * The output of a transaction that produced no output. The node sends the string `"Empty"`.
 */
export type EmptyTransactionOutput = "Empty";

/**
 * The output for an EVM transaction. The inner value is one of `Success`, `Revert`, `Halt` or `Error`.
 */
export interface EvmTransactionOutput {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Evm: Record<string, any>;
}

/**
 * The output for a transaction, which can be Move, Dkg, Oracle, Evm, or Empty.
 */
export type TransactionOutput =
    | MoveTransactionOutput
    | DkgTransactionOutput
    | OracleTransactionOutput
    | EvmTransactionOutput
    | EmptyTransactionOutput;

/**
 * The fields of a user or automated transaction response.
 */
export interface SupraTransactionResponse {
    authenticator: Authenticator;

    /**
     * The block that finalized the transaction. `null` for a pending transaction, and `null` or absent for a
     * transaction returned as part of a block.
     */
    block_header?: BlockHeader | null;

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
 * The response for a pending transaction. Only user transactions are pending.
 */
export interface PendingTransactionResponse extends SupraTransactionResponse {
    txn_type: TransactionType.User;
    authenticator: Authenticator;
    status: TransactionStatus.Pending;
    block_header?: null;
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
    authenticator: AutomationAuthenticator;
    /**
     * The predicate that gated the task's execution. Absent or `null` when the task ran unconditionally.
     * Nodes before v12 do not send this field.
     */
    predicate?: AutomationPredicateInfo | null;
}

/**
 * The predicate of an automation task. The only variant is an EVM contract call, whose `address` is
 * called with `input` and must return `true` for the task to run.
 */
export interface AutomationPredicateInfo {
    type: "evm";
    kind: "contract_call";
    address: string;
    input: string;
}

/**
 * The fields shared by the transaction responses that carry no `header`, `payload` or `authenticator`.
 */
export interface SystemTransactionResponseFields {
    hash: string;
    /**
     * The block that finalized the transaction. `null` or absent for a transaction returned as part of a block.
     */
    block_header?: BlockHeader | null;
    output: TransactionOutput;
    status: TransactionStatus;
}

/**
 * The response for a block metadata transaction. It has no `header`, `payload` or `authenticator`.
 */
export interface BlockMetadataTransactionResponse extends SystemTransactionResponseFields {
    txn_type: TransactionType.BlockMetadata;
}

/**
 * The response for an automation record transaction. It has no `header`, `payload` or `authenticator`.
 */
export interface AutomationRecordTransactionResponse extends SystemTransactionResponseFields {
    txn_type: TransactionType.AutomationRecord;
    data: AutomationRecordData;
}

/**
 * The data for an automation record transaction.
 */
export interface AutomationRecordData {
    /// Record index. It is unique in scope of the block.
    record_index: number;
    /// Cycle index for which automation bookkeeping is done.
    cycle_index: number;
    /// Height of the block in scope of which the record is executed.
    block_height: number;
    /// Action performed in scope of the bookkeeping record.
    action: AutomationRecordAction;
}

/**
 * The action of an automation record: the task indexes processed in the cycle, or the removal of one task.
 * `Remove` is sent by nodes from v12 onwards.
 */
export type AutomationRecordAction =
    | { Process: number[] }
    | {
          Remove: {
              task_index: number;
              /** Why the task is removed, which determines the refund its owner receives. */
              kind: "Error" | "GasConfigUpdate";
              reason: string;
          };
      };

/**
 * The response for a settlement transaction, returned by nodes from v12 onwards. A settlement transaction
 * applies cross-VM settlements. It has no `header`, `payload` or `authenticator`.
 */
export interface SettlementTransactionResponse extends SystemTransactionResponseFields {
    txn_type: TransactionType.Settlement;
    data: SettlementData;
}

/**
 * What a settlement transaction applied, discriminated by the VM that applied it.
 */
export type SettlementData = SettlementApplierSummary | SettlementCreditSummary;

/**
 * The settlements a Move settlement transaction applied.
 */
export interface SettlementApplierSummary {
    vm: "move";
    /**
     * The credits from the EVM to Move that the transaction was given: first those it applied, then those it
     * skipped.
     */
    inbound: AppliedInboundSettlement[];
    /** The Move settlement records the transaction cleared, `0x`-prefixed, in ascending settlement id. */
    cleared: string[];
    /** The block whose destroyed value the transaction retired from escrow. */
    burn_block_height: number;
    /** The value retired, in quants. */
    burn_amount: number;
}

/**
 * One credit from the EVM to Move that a Move settlement transaction resolved.
 */
export interface AppliedInboundSettlement {
    /** The settlement this credit settles, `0x`-prefixed. */
    settlement_id: string;
    /**
     * The outcome code: `0` paid; `1` the escrow holds less than the credit; `2` the recipient's primary SUPRA
     * store is frozen; `4` the escrow is not initialized; `6` the recipient may not receive settlements; `7` the
     * sender is not a usable EVM address. `1`, `2`, `4` and `6` come with a `refund`.
     */
    status: number;
    /** The settlement in which the value was returned to the EVM sender, `0x`-prefixed. */
    refund?: string | null;
}

/**
 * One credit an EVM settlement transaction paid.
 */
export interface SettlementCreditSummary {
    vm: "evm";
    /** The settlement this credit settles, `0x`-prefixed. */
    settlement_id: string;
    /** The account credited, `0x`-prefixed. */
    recipient: string;
    /** The value credited, in wei, as a decimal string. */
    amount_wei: string;
    /** The block whose execution recorded the settlement. */
    recorded_at_height: number;
}

/**
 * The `type` filter of the transaction queries.
 *
 * `"settlement"` is accepted by nodes from v12 onwards on `getTransactionByHash`, `getBlockByHeight`,
 * `getTransactionsByBlockHash` and `getAccountCoinTransactions`. Nodes before v12 reject it with HTTP 400.
 */
export type TransactionQueryType = "user" | "auto" | "meta" | "record" | "settlement";

/**
 * Options for configuring the behavior of the waitForTransaction() function.
 */
export type WaitForTransactionOptions = {
    /**
     * The longest time to wait for a final status, in seconds.
     * @deprecated Use `timeoutMs`, which takes precedence when both are set.
     */
    timeoutSecs?: number;
    /**
     * The longest time to wait for a final status, in milliseconds. Default `waitTimeoutMs` of `SupraConfig`, else
     * 60000.
     */
    timeoutMs?: number;
    /** Throw `SupraTransactionFailedError` for a final status other than `Success`. Default true. */
    checkSuccess?: boolean;
};
