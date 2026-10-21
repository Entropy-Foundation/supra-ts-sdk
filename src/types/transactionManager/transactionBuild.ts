import type { TxnBuilderTypes } from "supra-l1-sdk-core";
import type { MoveFunctionId, MoveInnerAuthenticator } from "../move";

/**
 * The payload of a multisig execution: the entry function in `function`, `functionTypeArgs` and `functionArgs` (for a
 * proposal that stores only the payload's hash), or none of the three (for a proposal whose payload is stored on
 * chain by `create_transaction`).
 */
export type MultisigExecutionPayloadArgs =
    | {
          function: MoveFunctionId;
          functionTypeArgs: TxnBuilderTypes.TypeTag[];
          functionArgs: Uint8Array[];
      }
    | { function?: undefined; functionTypeArgs?: undefined; functionArgs?: undefined };

/**
 * Per-transaction settings. Each one that is set replaces the client's setting for this transaction. The SDK does not
 * modify the object.
 *
 * - `maxGas`: max gas of the transaction, in gas units. When absent, the client's `maxGas` applies; when that is absent
 *   too, the max gas is estimated (see `estimateMaxGas`).
 * - `gasUnitPrice`: gas unit price, in quants, used as given. Default the client's `gasUnitPrice`, else the node's
 *   estimate, `max(median gas price, minimum gas price)` of `GET /rpc/v3/transactions/estimate_gas_price`, read for each
 *   transaction. In the helpers that submit, the read starts when the call is made and is awaited in the call's turn
 *   for the sender's account (SUPRA fungible asset transfers check the sender's balances first, before the account is
 *   requested); `transaction.build.simple` awaits it before it builds. The max gas estimate uses the same price. A price below the node's minimum is refused by the node with
 *   `SupraGasUnitPriceBelowMinimumError` (its `cause` is the original error); the SDK does not change it. A failed read
 *   of the estimate throws its error and nothing is submitted.
 * - `txExpiryTime`: expiration time of the transaction, in seconds since the Unix epoch, used as given. Default the
 *   client's `txExpirySecs` (default `DEFAULT_TX_EXPIRATION_DURATION`, 60) seconds after the client's clock in whole
 *   seconds when the transaction is built, at most 595 seconds after it (`MAX_TX_EXPIRATION_DURATION -
 *   TX_EXPIRATION_MARGIN_SECS`).
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
 * simulation reports the sequence number as too new, and the account and the latest block are read. When every number
 * from the sender's sequence number on the chain up to the transaction's has a record of a transaction this client
 * submitted that can still commit (see `SupraConfig`), the transaction is simulated with the chain's number and
 * submitted with its own. Otherwise a helper that took the number from the client's counter builds and signs the
 * transaction again with the lowest number that has no record, without giving up its place in the order of the
 * calls, and a call with an explicit `sequenceNumber` throws the `SupraSimulationFailedError`. A failed read of the
 * account is thrown and nothing is submitted. A transaction that depends on an
 * earlier one that has not committed (for example one that uses a resource the earlier one creates) fails its estimate
 * and throws `SupraSimulationFailedError`; set `maxGas` for such a transaction.
 *
 * A helper call without `maxGas` holds the sender's account while its max gas is estimated, and the calls of the same
 * client from that account wait; a call with `maxGas` waits only until the calls ahead of it have been submitted or
 * have failed (see `SupraConfig`).
 *
 * `transaction.build.simple` has no signing account to simulate with: its max gas is `DEFAULT_MAX_GAS_UNITS`, at most
 * the number of gas units the sender's balance pays for. The builders that make no request (`rawTxnObject`,
 * `scriptRawTxnObject`, `automationRegistrationRawTxnObject`, `multisigRawTxnObject` and
 * `multisigProposalTxRawTxnObject`) use `DEFAULT_MAX_GAS_UNITS` (20,000 units). The node requires the sender's SUPRA
 * balance to cover `max gas × gas unit price` at validation: 20,000 units at a gas unit price of 100,000 quants need
 * 20 SUPRA (2,000,000,000 quants). A sender with less must set `maxGas`.
 *
 * The gas unit price is not estimated by the builders that make no request: without a `gasUnitPrice` on the call or
 * the client they throw a `RangeError` before building.
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
     * the helper uses it as given and does not wait for the other calls of the account; the client's counter records
     * the submitted transaction like its own and does not hand out its number while the transaction can commit. When
     * it is absent, the helper takes the next number of the client's counter. The builders of `transaction.build`
     * take `senderSequenceNumber` and ignore this field.
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

/**
 * JSON form of a multisig execution. `transaction_payload` is absent when the proposal's payload is stored on chain
 * (`create_transaction`) and the execution carries none.
 */
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
