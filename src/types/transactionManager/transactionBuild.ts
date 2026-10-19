import type { MoveInnerAuthenticator } from "../move";

/**
 * Per-transaction settings. Each one that is set replaces the client's setting for this transaction. The SDK does not
 * modify the object.
 *
 * - `maxGas`: max gas of the transaction, in gas units. When absent, the client's `maxGas` applies; when that is absent
 *   too, the max gas is estimated (see `estimateMaxGas`).
 * - `gasUnitPrice`: gas unit price, in quants. Default the client's `minGasUnitPrice`, else `DEFAULT_GAS_PRICE`.
 * - `txExpiryTime`: expiration time of the transaction, in seconds since the Unix epoch. Default 300 seconds after the
 *   transaction is built.
 * - `estimateMaxGas`: when no `maxGas` is set, estimate it (`true`) or use `DEFAULT_MAX_GAS_UNITS` (`false`). Default
 *   the client's `estimateMaxGas`, else `true`.
 *
 * The node accepts a transaction only when the sender's balance pays for `max gas × gas unit price`; the sender is
 * charged for the gas used. An estimate is made by the methods that build and submit a transaction with a signing
 * account: the coin and fungible asset transfers, `publishPackage` and contract entry calls. They read the sender's
 * SUPRA balance and simulate the transaction with a max gas of the largest number of gas units that balance pays for at
 * the gas unit price, at most `MAX_GAS_UNITS_PER_TRANSACTION`. The max gas is then
 * `ceil(gas used × DEFAULT_MAX_GAS_ESTIMATE_MULTIPLIER)` (or the client's `maxGasEstimateMultiplier`), at least
 * `MIN_ESTIMATED_MAX_GAS_UNITS`, and at most the number of units the balance pays for.
 *
 * - When the simulation's status is not `Success` (an abort, `OUT_OF_GAS`, `PendingAfterExecution`, `Invalid`),
 *   `SupraSimulationFailedError` is thrown and nothing is submitted.
 * - When the balance read fails, or the simulation fails for a reason that is not a simulation result (a request
 *   error, a response without `gas_used`), the max gas is `DEFAULT_MAX_GAS_UNITS`, at most the number of units the
 *   balance pays for when that is known.
 *
 * The simulation runs against committed state. When an earlier transaction of the sender has not committed, the
 * simulation reports the sequence number as too new; the transaction is then simulated with the sender's sequence
 * number on the chain, and submitted with its own. A transaction that depends on an earlier one that has not committed
 * (for example one that uses a resource the earlier one creates) fails its estimate and throws
 * `SupraSimulationFailedError`; set `maxGas` for such a transaction.
 *
 * `transaction.build.simple` has no signing account to simulate with: its max gas is `DEFAULT_MAX_GAS_UNITS`, at most
 * the number of gas units the sender's balance pays for. The builders that make no request (`rawTxnObject`,
 * `scriptRawTxnObject`, `automationRegistrationRawTxnObject`, `multisigRawTxnObject` and
 * `multisigProposalTxRawTxnObject`) use `DEFAULT_MAX_GAS_UNITS` (20,000 units). The node requires the sender's SUPRA
 * balance to cover `max gas × gas unit price` at validation: at the default gas unit price of 100,000 quants, 20,000
 * units need 20 SUPRA (2,000,000,000 quants). A sender with less must set `maxGas`.
 */
export interface OptionalTransactionPayloadArgs {
    maxGas?: bigint;
    gasUnitPrice?: bigint;
    txExpiryTime?: bigint;
    estimateMaxGas?: boolean;
    /**
     * The sequence number of the transaction. Used by the helpers that build and submit the transaction
     * (`transferSupraCoin`, `transferCoin`, `transferSupraFungibleAsset`, `transferFungibleAsset`,
     * `migrateCoinToFungibleStore`, `publishPackage` and the entry functions of `Contract.fromABI`). When it is set,
     * the helper uses it as given and does not use or change the client's counter. When it is absent, the helper takes
     * the next number of the client's counter. The builders of `transaction.build` take `senderSequenceNumber` and
     * ignore this field.
     */
    sequenceNumber?: bigint | number;
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

/** A type argument in the JSON form of a transaction payload. */
export type FunctionTypeArgs =
    | "bool"
    | "u8"
    | "u16"
    | "u32"
    | "u64"
    | "u128"
    | "u256"
    | "address"
    | "signer"
    | { vector: FunctionTypeArgs }
    | {
          struct: {
              address: string;
              module: string;
              name: string;
              type_args: Array<FunctionTypeArgs>;
          };
      };

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


