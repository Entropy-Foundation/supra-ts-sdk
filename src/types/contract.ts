import type { SupraAccount, TxnBuilderTypes } from "supra-l1-sdk-core";
import type { MoveFunction, MoveFunctionGenericTypeParam, MoveModule } from "./move";
import type { TransactionResponse } from "./transaction";
import type { AccountAddressInput } from "./account";
import type { OptionalTransactionPayloadArgs } from "./transactionManager/transactionBuild";
import type { EnableTransactionWaitAndSimulationArgs } from "./transactionManager/transactionSubmit";

export type MoveModules = DeepReadonly<MoveModule[]>;

export type MoveToTS<T extends string> =
    // ----------------------------
    // Numeric types
    // ----------------------------
    T extends "u8" | "u16" | "u32" | "i8" | "i16" | "i32" ? number :
    T extends "u64" | "u128" | "u256" | "i64" | "i128" | "i256" ? bigint :

    // ----------------------------
    // Boolean
    // ----------------------------
    T extends "bool" ? boolean :

    // ----------------------------
    // String
    // ----------------------------
    T extends "signer" | "&signer" ? SupraAccount :

    // ----------------------------
    // Address / signer
    // ----------------------------
    T extends "address" ? AccountAddressInput :

    // ----------------------------
    // vector<u8>
    // ----------------------------
    T extends "vector<u8>" ? string | Uint8Array | ArrayBuffer | any[] :

    // ----------------------------
    // Objects (e.g., 0x1::object::Object)
    // ----------------------------
    T extends `0x1::object::Object<${infer U}>` ? AccountAddressInput :

    // ----------------------------
    // Option<u8> special case
    // ----------------------------
    T extends "0x1::option::Option<u8>" ? string | number | null :

    // ----------------------------
    // General Option<T>
    // ----------------------------
    T extends `0x1::option::Option<${infer U}>` ? MoveToTS<U> | null :

    // ----------------------------
    // General Vector<T>
    // ----------------------------
    T extends `vector<${infer U}>` ? MoveToTS<U>[] :

    // ----------------------------
    // Standard Move string
    // ----------------------------
    T extends `0x1::string::String` ? string :

    // ----------------------------
    // Structs (e.g., 0x1::coin::CoinStore)
    // ----------------------------
    T extends `${infer CA}::${infer MN}::${infer S}` ? `${CA}::${MN}::${S}` :

    // ----------------------------
    // Fallback
    // ----------------------------
    any;

export type ReturnTypes<F extends DeepReadonly<MoveFunction>> =
    F['return'] extends readonly [...infer R]
    ? { [K in keyof R]: MoveToTS<R[K] & string> }
    : void;


export type MapArgs<ARGUMENTS extends readonly string[] | undefined> =
    ARGUMENTS extends readonly [...infer R]
    ? { [K in keyof R]: MoveToTS<R[K] & string> }
    : [];


export type MapTypeArgs<TYPE_ARGUMENTS extends readonly any[] | undefined> =
    TYPE_ARGUMENTS extends readonly [...infer TRest,]
    ? { [K in keyof TRest]: string | TxnBuilderTypes.TypeTag }
    : [];


export type Args<FUNCTION extends { typeArguments?: readonly any[] | undefined, functionArguments?: readonly string[] | undefined }> = {
    functionArguments: MapArgs<FUNCTION['functionArguments']>;
    typeArguments: MapTypeArgs<FUNCTION['typeArguments']>;
};


// Dynamic type that maps all `is_view` functions to callable functions
export type ViewFunctionsFromABI<CONTRACT extends DeepReadonly<MoveModule>> = {
    [FUNCTION in CONTRACT['exposed_functions'][number]as FUNCTION['is_view'] extends true
    ? FUNCTION['name']
    : never]: (args: Args<{ functionArguments: FUNCTION['params'], typeArguments: ConvertGenerics<FUNCTION['generic_type_params']> }>) => Promise<ReturnTypes<FUNCTION>>;
};

export type EntryArgs<FUNCTION extends { typeArguments?: readonly any[] | undefined, functionArguments?: readonly string[] | undefined, optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs, enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs }> = {
    functionArguments: MapArgs<FUNCTION['functionArguments']>;
    typeArguments: MapTypeArgs<FUNCTION['typeArguments']>;
    optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs,
    enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs
};


export type EntryFunctionsFromABI<CONTRACT extends DeepReadonly<MoveModule>> = {
    [FUNCTION in CONTRACT['exposed_functions'][number]as FUNCTION['is_entry'] extends true
    ? FUNCTION['name']
    : never]: (args: EntryArgs<{ functionArguments: FUNCTION['params'], typeArguments: ConvertGenerics<FUNCTION['generic_type_params']>, optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs, enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs }>) => Promise<TransactionResponse>;
};


export type StructFromABI<T extends DeepReadonly<MoveModule>> = {
    [F in T['structs'][number]as F["name"]]: () => { [Field in F['fields'][number]as Field['name']]: Field['type'] };
}


export type ContractsFromABI<CONTRACTS extends DeepReadonly<MoveModule[]>> = {
    [CONTRACT in CONTRACTS[number]as CONTRACT['name']]: {
        view: ViewFunctionsFromABI<CONTRACT>;
        entry: EntryFunctionsFromABI<CONTRACT>;
    };
};

export type DeepReadonly<T> = Readonly<{
    [K in keyof T]:
    // Is it a primitive? Then make it readonly
    T[K] extends (number | string | symbol) ? Readonly<T[K]>
    // Is it an array of items? Then make the array readonly and the item as well
    : T[K] extends Array<infer A> ? Readonly<Array<DeepReadonly<A>>>
    // It is some other object, make it readonly as well
    : DeepReadonly<T[K]>;
}>


export type ConvertGenerics<
    T extends readonly any[],
    Counter extends any[] = []
> = T extends readonly [any, ...infer Rest]
    ? readonly [`T${Counter['length']}`, ...ConvertGenerics<Rest, [...Counter, any]>]
    : readonly [];