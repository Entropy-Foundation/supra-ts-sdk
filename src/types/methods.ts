// Portions of this file are derived from @aptos-labs/ts-sdk (https://github.com/aptos-labs/aptos-ts-sdk),
// Copyright © Aptos Foundation, licensed under the Apache License, Version 2.0. See NOTICE.
import type { MoveFunctionId, MoveModule, SimpleEntryFunctionArgumentTypes, SimpleEntryFunctionArgumentTypesRaw, TypeArgument } from "./move";


/**
 * The data needed to generate a View Function payload.
 */
export type InputViewFunctionData = {
    function: MoveFunctionId;
    typeArguments?: Array<TypeArgument>;
    functionArguments?: Array<SimpleEntryFunctionArgumentTypes>;
    abi?: MoveModule
};


/**
 * The data needed to generate a View Function payload.
 */
export type InputViewRawFunctionData = {
    function: string;
    typeArguments?: Array<string>;
    functionArguments?: Array<SimpleEntryFunctionArgumentTypesRaw>;
};