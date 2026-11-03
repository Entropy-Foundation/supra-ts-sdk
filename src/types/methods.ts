// Portions of this file are derived from @aptos-labs/ts-sdk (https://github.com/aptos-labs/aptos-ts-sdk),
// Copyright © Aptos Foundation, licensed under the Apache License, Version 2.0. See NOTICE.
import type {
    MoveFunctionId,
    MoveModule,
    MoveValue,
    SimpleEntryFunctionArgumentTypes,
    SimpleEntryFunctionArgumentTypesRaw,
    TypeArgument,
} from "./move";

/**
 * The data needed to generate a View Function payload.
 */
export type InputViewFunctionData = {
    function: MoveFunctionId;
    typeArguments?: Array<TypeArgument>;
    functionArguments?: Array<SimpleEntryFunctionArgumentTypes>;
    abi?: MoveModule;
};

/**
 * The data needed to generate a View Function payload.
 */
export type InputViewRawFunctionData = {
    function: string;
    typeArguments?: Array<string>;
    functionArguments?: Array<SimpleEntryFunctionArgumentTypesRaw>;
};

/**
 * Why one view function of a batch produced no result: the HTTP status and the message that `POST /rpc/v4/view`
 * answers with for the same request against the same state. A function that is not executed because the batch's
 * gas budget is spent has status `400`.
 *
 * Preview: wraps an API added in `supra_node_v12.0.0`, which may change until that release reaches Testnet.
 * @beta
 */
export interface ViewBatchError {
    status: number;
    message: string;
}

/**
 * The outcome of one view function of a batch: `result` holds the function's return values converted to TypeScript
 * values, or `error` says why the function produced none. Exactly one of the two is present.
 *
 * Preview: wraps an API added in `supra_node_v12.0.0`, which may change until that release reaches Testnet.
 * @beta
 */
export type ViewBatchEntry<T extends Array<MoveValue> = Array<MoveValue>> =
    | { result: T; error?: undefined }
    | { error: ViewBatchError; result?: undefined };

/**
 * The response of `viewBatch`.
 *
 * Preview: wraps an API added in `supra_node_v12.0.0`, which may change until that release reaches Testnet.
 * @beta
 */
export interface ViewBatchResponse<T extends Array<MoveValue> = Array<MoveValue>> {
    /**
     * The height of the last block the node had executed in the snapshot that every element was executed against,
     * or `null` when the node had executed no block.
     */
    state_height?: number | null;
    /** One entry per requested view function, in request order. */
    results: Array<ViewBatchEntry<T>>;
}
