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


export interface RawTxnJSON {
    sender: string;
    sequence_number: number;
    payload: TransactionPayloadJSON;
    max_gas_amount: number;
    gas_unit_price: number;
    expiration_timestamp_secs: number;
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
    | { U64: number }
    | { U128: number }
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
        max_gas_amount: number;
        gas_price_cap: number;
        automation_fee_cap_for_epoch: number;
        expiration_timestamp_secs: number;
        aux_data: Array<Array<number>>;
    };
}


