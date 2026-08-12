import type { MoveInnerAuthenticator } from "../move";

export interface OptionalTransactionPayloadArgs {
    maxGas?: bigint;
    gasUnitPrice?: bigint;
    txExpiryTime?: bigint;
}


export interface SendTxnPayload {
    Move: {
        raw_txn: RawTxnJSON;
        authenticator: MoveInnerAuthenticator;
    };
}


/**
 * JSON form of a raw transaction, as sent to the submit and simulate endpoints.
 *
 * The `u64` fields are typed `bigint | number` and the SDK always emits `bigint`:
 * these values are serialized to exact JSON number literals, so a value above
 * `Number.MAX_SAFE_INTEGER` reaches the RPC intact instead of being rounded.
 * `number` remains accepted for callers that build this object by hand.
 */
export interface RawTxnJSON {
    sender: string;
    sequence_number: bigint | number;
    payload: TransactionPayloadJSON;
    max_gas_amount: bigint | number;
    gas_unit_price: bigint | number;
    expiration_timestamp_secs: bigint | number;
    chain_id: number;
}


export type TransactionPayloadJSON =
    | EntryFunctionPayloadJSON
    | ScriptPayloadJSON
    | AutomationRegistrationPayloadJSON
    | MultisigPayloadJSON;


export interface EntryFunctionPayloadJSON {
    EntryFunction: EntryFunctionJSON;
}

export interface EntryFunctionJSON {
    module: {
        address: string;
        name: string;
    };
    function: string;
    ty_args: Array<FunctionTypeArgs>;
    args: Array<Array<number>>;
}

export interface MultisigPayloadJSON {
    Multisig: {
        multisig_address: string;
        transaction_payload?: EntryFunctionPayloadJSON;
    };
}

export interface FunctionTypeArgs {
    struct: {
        address: string;
        module: string;
        name: string;
        type_args: Array<FunctionTypeArgs>;
    };
}

export interface ScriptPayloadJSON {
    Script: {
        code: Array<number>;
        ty_args: Array<FunctionTypeArgs>;
        args: Array<ScriptArgumentJson>;
    };
}

export type ScriptArgumentJson =
    | { U8: number }
    | { U16: number }
    | { U32: number }
    // `u64`/`u128` are emitted as `bigint` so large script arguments are not
    // rounded on their way into the request body. See `RawTxnJSON`.
    | { U64: bigint | number }
    | { U128: bigint | number }
    | { U256: Array<number> }
    | { Address: string }
    | { U8Vector: Array<number> }
    | { Bool: boolean };


export interface AutomationRegistrationPayloadJSON {
    AutomationRegistration: AutomationRegistrationParamV1JSON;
}

export interface AutomationRegistrationParamV1JSON {
    V1: {
        automated_function: EntryFunctionJSON;
        // `u64` fields, emitted as `bigint`. See `RawTxnJSON`.
        max_gas_amount: bigint | number;
        gas_price_cap: bigint | number;
        automation_fee_cap_for_epoch: bigint | number;
        expiration_timestamp_secs: bigint | number;
        aux_data: Array<Array<number>>;
    };
}


