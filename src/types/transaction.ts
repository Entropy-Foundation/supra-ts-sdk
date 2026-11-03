// Portions of this file are derived from @aptos-labs/ts-sdk (https://github.com/aptos-labs/aptos-ts-sdk),
// Copyright © Aptos Foundation, licensed under the Apache License, Version 2.0. See NOTICE.
import type {
    Authenticator,
    AutomationAuthenticator,
    MoveEvent,
    MoveFunctionId,
    MoveModule,
    MoveResource,
    MoveScriptBytecode,
    MoveTransactionAuthenticator,
    MoveValue,
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
 *
 * Preview: the `Remove` variant wraps an API added in `supra_node_v12.0.0`, which may change until that release
 * reaches Testnet (`@beta` on `Remove` and on its `kind`).
 */
export type AutomationRecordAction =
    | { Process: number[] }
    | {
          /**
           * The removal of one task. Sent by nodes from v12 onwards.
           *
           * Preview: wraps an API added in `supra_node_v12.0.0`, which may change until that release reaches Testnet.
           * @beta
           */
          Remove: {
              task_index: number;
              /**
               * Why the task is removed, which determines the refund its owner receives.
               *
               * - `"Error"`: the task failed at runtime (an undecodable payload or predicate, a failed predicate, or a
               *   gas amount no transaction can carry). The owner receives a partial refund.
               * - `"ConfigUpdate"`: the gas config of a new epoch rules out the task's transaction (its gas amount is
               *   above the per-transaction gas cap, or its gas price cap is below the minimum gas price). A user
               *   task's owner receives the remaining fee of the current cycle and the deposit in full; a system task
               *   pays no fees and is refunded nothing. Recorded for both Move and EVM tasks.
               * - `"PreExecutionLimit"`: a limit of the gas schedule or of the VM (transaction size, intrinsic gas,
               *   dependency count or size, type size, or the minimum gas of a `#[randomness]` entry function) stopped
               *   the task's transaction before its entry function ran. A user task's owner receives the same
               *   partial refund as for `"Error"`; a system task is refunded nothing. Recorded for Move tasks only.
               *
               * Preview: wraps an API added in `supra_node_v12.0.0`, which may change until that release reaches Testnet.
               * @beta
               */
              kind: "Error" | "ConfigUpdate" | "PreExecutionLimit";
              reason: string;
          };
      };

/**
 * The response for a settlement transaction, returned by nodes from v12 onwards. A settlement transaction
 * applies cross-VM settlements. It has no `header`, `payload` or `authenticator`.
 *
 * Preview: wraps an API added in `supra_node_v12.0.0`, which may change until that release reaches Testnet.
 * @beta
 */
export interface SettlementTransactionResponse extends SystemTransactionResponseFields {
    txn_type: TransactionType.Settlement;
    data: SettlementData;
}

/**
 * What a settlement transaction applied, discriminated by the VM that applied it.
 *
 * Preview: wraps an API added in `supra_node_v12.0.0`, which may change until that release reaches Testnet.
 * @beta
 */
export type SettlementData = SettlementApplierSummary | SettlementCreditSummary;

/**
 * The settlements a Move settlement transaction applied.
 *
 * Preview: wraps an API added in `supra_node_v12.0.0`, which may change until that release reaches Testnet.
 * @beta
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
 *
 * Preview: wraps an API added in `supra_node_v12.0.0`, which may change until that release reaches Testnet.
 * @beta
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
 *
 * Preview: wraps an API added in `supra_node_v12.0.0`, which may change until that release reaches Testnet.
 * @beta
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
 * A proof that a transaction is included in the node's transaction accumulator, computed against the latest
 * transactions inclusion certificate the node holds. Sent by the `/rpc/v4` transaction routes when the request asks
 * for it.
 *
 * Preview: wraps an API added in `supra_node_v12.0.0`, which may change until that release reaches Testnet.
 * @beta
 */
export interface TransactionInclusionProof {
    /** The accumulator proof. `siblings` are ordered from the bottom level to the root. */
    proof: { siblings: string[] };
    /** The hash of the leaf node, hex encoded. */
    leaf_hash_value: string;
    /** The Merkle root the proof verifies against, hex encoded. */
    merkle_root_hash_value: string;
    /** The leaf index in the accumulator tree. */
    leaf_index: number;
    /** The root of the events tree, when available. */
    events_tree_merkle_root_hash_value?: string | null;
    /** The hashes of the events tree leaves, when available. */
    events_leaves_hash_values?: string[] | null;
    /** The height of the certificate that holds `merkle_root_hash_value`. */
    certified_at_height: number;
}

/**
 * A transaction as `/rpc/v4` returns it: the shape of {@link TransactionResponse} with the events' `hash` and, when
 * the request asked for a proof, `inclusion_proof`.
 *
 * Preview: wraps an API added in `supra_node_v12.0.0`, which may change until that release reaches Testnet.
 * @beta
 */
export type TransactionResponseV4 = TransactionResponse & {
    /** Present on committed transactions of requests with `include_proof`; `null` when no certificate covers it yet. */
    inclusion_proof?: TransactionInclusionProof | null;
};

/**
 * The result of looking up one hash with `getTransactionsByHashes`.
 *
 * Preview: wraps an API added in `supra_node_v12.0.0`, which may change until that release reaches Testnet.
 * @beta
 */
export interface TransactionByHashesEntry {
    /** The requested hash in lower case, as the SDK sends it. */
    hash: string;
    /**
     * The transaction, or `null` when no transaction of the requested `type` has the hash. A hash the node does not
     * know does not fail the request.
     */
    transaction: TransactionResponseV4 | null;
}

/**
 * The response of `getTransactionsByHashes`: `transactions` answers a prefix of the requested hashes, in request
 * order, and `omitted` lists the rest, so the two together hold one element per requested hash.
 *
 * Preview: wraps an API added in `supra_node_v12.0.0`, which may change until that release reaches Testnet.
 * @beta
 */
export interface TransactionsByHashesResponse {
    /** One entry per answered position, in request order. The first requested hash is always answered. */
    transactions: TransactionByHashesEntry[];
    /**
     * The requested hashes that were not answered, in request order, repeats included: the first position whose entry
     * did not fit the node's response size bound or whose lookup failed, and every position after it. Empty when
     * every hash was answered. Request them again.
     */
    omitted: string[];
}

/**
 * A change that a simulated transaction would make to one Move state key, in the Aptos API's `WriteSetChange`
 * representation. A written resource group is one `write_resource` per member, each with the group's
 * `state_key_hash`; a deleted resource group is one `delete_resource` whose `resource` is the group's own tag.
 *
 * Preview: wraps an API added in `supra_node_v12.0.0`, which may change until that release reaches Testnet.
 * @beta
 */
export type WriteSetChange =
    | { type: "write_resource"; address: string; state_key_hash: string; data: MoveResource }
    | { type: "delete_resource"; address: string; state_key_hash: string; resource: string }
    | {
          type: "write_module";
          address: string;
          state_key_hash: string;
          data: { bytecode: string; abi?: MoveModule | null };
      }
    | { type: "delete_module"; address: string; state_key_hash: string; module: string }
    | {
          type: "write_table_item";
          state_key_hash: string;
          /** The table handle, hex encoded. */
          handle: string;
          /** The BCS bytes of the item's key, hex encoded. */
          key: string;
          /** The BCS bytes of the item's value, hex encoded. */
          value: string;
          /** The decoded key and value; absent for a table the node's table-info index has no entry for. */
          data?: { key: MoveValue; key_type: string; value: MoveValue; value_type: string } | null;
      }
    | {
          type: "delete_table_item";
          state_key_hash: string;
          handle: string;
          key: string;
          /** The decoded key; absent for a table the node's table-info index has no entry for. */
          data?: { key: MoveValue; key_type: string } | null;
      };

/**
 * What a state key holds: the `kind` of an {@link OmittedStateKey}.
 * @beta
 */
export type StateKeyKind = "resource" | "resource_group" | "module" | "table_item";

/**
 * A state key that a simulated transaction writes and whose changes the response leaves out to stay within the
 * node's size bound.
 *
 * Preview: wraps an API added in `supra_node_v12.0.0`, which may change until that release reaches Testnet.
 * @beta
 */
export interface OmittedStateKey {
    /** The hash of the state key, hex encoded. */
    state_key_hash: string;
    /** The account the resource, resource group or module is stored under; `null` for a table item. */
    address: string | null;
    kind: StateKeyKind;
    /**
     * The struct tag of a resource or resource group, the ID of a module, or the hex-encoded handle of a table
     * item's table.
     */
    tag: string;
}

/**
 * The number of state keys of each kind left out of a simulation's reported changes.
 * @beta
 */
export interface OmittedStateKeyCounts {
    resource: number;
    resource_group: number;
    module: number;
    table_item: number;
}

/**
 * The state-change fields that `POST /rpc/v4/transactions/simulate` adds to a simulated transaction. A node whose
 * `/rpc/v4` route answers as `/rpc/v3` does (Mainnet and Testnet nodes of `supra_node_v11.7.x`) sends none of them,
 * so each is optional here.
 *
 * Preview: wraps an API added in `supra_node_v12.0.0`, which may change until that release reaches Testnet.
 * @beta
 */
export interface SimulationStateChanges {
    /**
     * The height of the last block the node had executed when it took the snapshot the simulation ran against, or
     * `null` when it had executed none.
     */
    state_height?: number | null;
    /** The changes the transaction would make to Move state, in priority order (the signers' resources first). */
    changes?: WriteSetChange[];
    /**
     * The value each state key in `changes` held before the transaction, keyed by `state_key_hash`: the `write_*`
     * changes that would write it, or `null` when the key held no value.
     */
    prior_values?: Record<string, WriteSetChange[] | null>;
    /** The state keys left out of `changes` and `prior_values`, in priority order, at most the node's listing bound. */
    omitted?: OmittedStateKey[];
    /** The number of state keys of each kind left out, including any beyond those `omitted` lists. */
    omitted_counts?: OmittedStateKeyCounts;
    /** `true` exactly when a state key was left out. */
    changes_truncated?: boolean;
}

/**
 * A simulated transaction with the changes it would make to Move state. The state-change fields are absent when the
 * node does not report them; see {@link SimulationStateChanges}.
 *
 * Preview: wraps an API added in `supra_node_v12.0.0`, which may change until that release reaches Testnet.
 * @beta
 */
export type TransactionSimulationV4 = TransactionResponse & SimulationStateChanges;

/**
 * The side of the chain an address belongs to: `"move"` for SupraMVM, `"evm"` for SupraEVM.
 * @beta
 */
export type SettlementDomain = "move" | "evm";

/**
 * Which end of a cross-VM crossing an address is.
 * @beta
 */
export type SettlementRole = "sender" | "recipient";

/**
 * Where in its lifecycle a crossing was when a stage was recorded.
 * @beta
 */
export type SettlementStage =
    "recorded" | "initiated_on_evm" | "credited_on_evm" | "applied_on_move" | "skipped" | "cleared";

/**
 * One end of a cross-VM crossing.
 * @beta
 */
export interface SettlementParty {
    domain: SettlementDomain;
    /** The address, `0x`-prefixed. */
    address: string;
}

/**
 * One stage of one crossing, as the block that produced it stated it.
 * @beta
 */
export interface SettlementStageEntry {
    stage: SettlementStage;
    /** The block this stage happened in. */
    block_height: number;
    /** The transaction that produced it, as unprefixed hexadecimal. */
    transaction_hash: string;
    /**
     * SupraMVM's outcome code where the stage has one; `null` or absent means the stage carries no outcome. `0`
     * moved the value; `1` the escrow holds less than asked; `2` the recipient's primary SUPRA store is frozen; `4`
     * the escrow is not initialized; `6` the recipient may not be paid out to; `7` the sender is not a usable
     * SupraEVM address. `1`, `2`, `4` and `6` on an `applied_on_move` stage come with a `refund`.
     */
    status?: number | null;
    /** The value this stage concerns, in quants. */
    amount: number;
    sender?: SettlementParty | null;
    recipient?: SettlementParty | null;
    /** The record a returned credit's value was returned in, for a credit that was refunded. */
    refund?: string | null;
}

/**
 * A crossing that is recorded and waiting to be applied.
 * @beta
 */
export interface PendingSettlement {
    sender: SettlementParty;
    recipient: SettlementParty;
    /** The value the crossing moves, in quants. */
    amount: number;
    /** The block whose execution recorded it. */
    recorded_at_height: number;
}

/**
 * The lifecycle of one cross-VM crossing, as of the height the node had executed to.
 *
 * Preview: wraps an API added in `supra_node_v12.0.0`, which may change until that release reaches Testnet.
 * @beta
 */
export interface Settlement {
    /** The crossing's identity, `0x`-prefixed. */
    settlement_id: string;
    /** The height the node had executed to when it answered. */
    as_of_height: number;
    /** Present while the crossing is waiting to be applied. */
    pending?: PendingSettlement | null;
    /** Every stage the node holds, oldest first. */
    stages: SettlementStageEntry[];
}

/**
 * A page of the crossings one address is party to, oldest first. `cursor` is `undefined` when there are no more
 * crossings; a page can be empty and still carry a cursor.
 *
 * Preview: wraps an API added in `supra_node_v12.0.0`, which may change until that release reaches Testnet.
 * @beta
 */
export interface SettlementsPage {
    /** The crossings of this page. */
    response: Settlement[];
    /** The cursor of the next page, or `undefined` when there are no more results. */
    cursor?: string | undefined;
    /** The height of the oldest block the node holds (`x-supra-oldest-block`), or `undefined` when it sends none. */
    oldestBlock?: number | undefined;
}

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
