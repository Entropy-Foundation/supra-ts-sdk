import { BCS, HexString, SupraAccount, TxnBuilderTypes } from "supra-l1-sdk-core";
import type { NetworkConfig } from "../../utils/apiEndpoints";
import type {
    AutomationTaskType,
    MultisigExecutionPayloadArgs,
    OptionalTransactionPayloadArgs,
    RawTxnJSON,
    SendTxnPayload,
    TransactionPayloadJSON,
} from "../../types/transactionManager/transactionBuild";
import {
    AutomationRegistrationParamsV2,
    AutomationRegistrationParamsV2Data,
    validateAutomationTaskType,
    validateU64,
} from "./automationRegistration";
import {
    DEFAULT_MAX_GAS_UNITS,
    DEFAULT_TX_EXPIRATION_DURATION,
    MAX_TX_EXPIRATION_DURATION,
    MILLISECONDS_PER_SECOND,
    SUPRA_FRAMEWORK_ADDRESS,
    TX_EXPIRATION_MARGIN_SECS,
} from "../../utils/constants";
import type { AccountAddressInput } from "../../types/account";
import { addressToBytes } from "../../helper/account";
import type {
    MoveFunctionId,
    MoveInnerAuthenticator,
    MoveModule,
    SimpleEntryFunctionArgumentTypes,
    TypeArgument,
} from "../../types/move";
import { convertPayloadTypeArgsToMoveType, getFunctionParts, uint8ArrayToHexString } from "../../helper/general";
import { signTransactionInternal } from "../transaction";
import { ed25519TransactionAuthenticator, withTransactionHash } from "./txnHash";
import { fromUint8ArrayToJSArray, parseFunctionTypeArgs, parseScriptArgs } from "../../utils/functions";
import { getAccountModuleInternal } from "../account";
import { getFunctionABI } from "../../helper/abi";
import { DynamicTransactionSerializer } from "../../utils/serializer";
import type { TransactionResponse } from "../../types/transaction";
import { simulateSerializedTxnInternal, simulateTxnInternal } from "./txnSimulate";
import {
    submitMultiAgentTransactionInternal,
    submitSerializedRawTransactionAndSignatureInternal,
    submitSerializedRawTransactionInternal,
    submitSponsorTransactionInternal,
} from "./txnSubmit";
import type {
    EnableTransactionWaitAndSimulationArgs,
    SubmitTransactionResponse,
} from "../../types/transactionManager/transactionSubmit";
import sha3 from "js-sha3";
import { resolveMaxGasInternal } from "./maxGas";
import { requireGasUnitPrice, withResolvedGasUnitPriceInternal } from "./gasPrice";
import type { SequenceNumberReservation } from "../sequenceNumber";

/**
 * Generate the serialized payload for a transaction
 */
export async function generateTransactionPayload(
    args: {
        function: MoveFunctionId;
        functionTypeArgs: Array<TypeArgument>;
        functionArgs: Array<SimpleEntryFunctionArgumentTypes>;
        abi?: MoveModule | undefined;
    },
    config: NetworkConfig,
): Promise<{ typeArguments: TxnBuilderTypes.TypeTag[]; functionArguments: Uint8Array[] }> {
    let { moduleAddress, moduleName, functionName } = getFunctionParts(args.function);

    const abi =
        args.abi ??
        (await getAccountModuleInternal({ accountAddress: moduleAddress!, moduleName: moduleName! }, config)).abi!;

    let funcABI = await getFunctionABI(abi, moduleAddress!, moduleName!, functionName!);

    // Convert type arguments to move type arguments
    let serializedTypeArguments = convertPayloadTypeArgsToMoveType(funcABI, {
        function: args.function,
        typeArguments: args.functionTypeArgs,
        functionArguments: args.functionArgs,
    });

    const serializer = new DynamicTransactionSerializer();

    // Entry functions take leading `&signer`/`signer` parameters that the VM fills from the
    // transaction signers, not from the caller. Every leading signer parameter is stripped;
    // functions without one keep all their argument types.
    const firstValueParam = funcABI.params.findIndex((param) => param !== "&signer" && param !== "signer");
    const paramTypes = funcABI.params.slice(firstValueParam === -1 ? funcABI.params.length : firstValueParam);

    const serializedArguments = serializer.prepareTransactionArgs(args.functionArgs, paramTypes);

    return {
        typeArguments: serializedTypeArguments ?? [],
        functionArguments: serializedArguments ?? [],
    };
}

/**
 * Builds an entry function transaction from arguments serialized with the function's ABI. Without a `maxGas` on the
 * call or the client, the max gas is resolved by `resolveMaxGasInternal`: estimated by simulation when
 * `senderAccount` is given, else `DEFAULT_MAX_GAS_UNITS` at most what the sender's balance pays for.
 */
export async function simpleInternal(
    args: {
        senderAddress: AccountAddressInput;
        senderSequenceNumber: bigint;
        function: MoveFunctionId;
        functionTypeArgs: Array<TypeArgument>;
        functionArgs: Array<SimpleEntryFunctionArgumentTypes>;
        optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs;
        abi?: MoveModule;
        senderAccount?: SupraAccount;
        /** The reservation of `senderSequenceNumber`, when the number came from the client's counter. */
        reservation?: SequenceNumberReservation | undefined;
    },
    config: NetworkConfig,
): Promise<TxnBuilderTypes.RawTransaction> {
    let { functionArguments, typeArguments } = await generateTransactionPayload(
        {
            function: args.function,
            functionTypeArgs: args.functionTypeArgs,
            functionArgs: args.functionArgs,
            abi: args.abi,
        },
        config,
    );

    return await buildWithResolvedMaxGasInternal(
        {
            senderAddress: args.senderAddress,
            senderAccount: args.senderAccount,
            reservation: args.reservation,
            optionalTransactionPayloadArgs: args.optionalTransactionPayloadArgs,
            buildRawTxn: (optionalTransactionPayloadArgs) =>
                rawTxnObjectInternal(
                    {
                        senderAddress: args.senderAddress,
                        senderSequenceNumber: args.senderSequenceNumber,
                        function: args.function,
                        functionTypeArgs: typeArguments as TxnBuilderTypes.TypeTag[],
                        functionArgs: functionArguments,
                        optionalTransactionPayloadArgs,
                    },
                    config,
                ),
        },
        config,
    );
}

/**
 * Builds a transaction with `buildRawTxn` and the caller's settings, with the gas unit price (the call's, else the
 * client's, else the node's estimate) and the max gas that `resolveMaxGasInternal` resolves. The caller's
 * `optionalTransactionPayloadArgs` is copied, not modified.
 */
export async function buildWithResolvedMaxGasInternal(
    args: {
        senderAddress: AccountAddressInput;
        senderAccount?: SupraAccount | undefined;
        optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs | undefined;
        buildRawTxn: (optionalTransactionPayloadArgs: OptionalTransactionPayloadArgs) => TxnBuilderTypes.RawTransaction;
        /**
         * Builds the transaction that the max gas estimate simulates, when that is not the transaction that is sent
         * (`buildRawTxn`), for a transaction that the node simulates only in another form.
         */
        buildEstimateRawTxn?:
            | ((optionalTransactionPayloadArgs: OptionalTransactionPayloadArgs) => TxnBuilderTypes.RawTransaction)
            | undefined;
        /** The reservation of the transaction's sequence number, when the number came from the client's counter. */
        reservation?: SequenceNumberReservation | undefined;
    },
    config: NetworkConfig,
): Promise<TxnBuilderTypes.RawTransaction> {
    // The gas unit price is resolved once; the max gas estimate and the transaction use that value. A call that took
    // the account's lock has resolved it already, so no request is made here.
    const options = await withResolvedGasUnitPriceInternal(args.optionalTransactionPayloadArgs, config);
    const resolved = await resolveMaxGasInternal(
        {
            senderAddress: args.senderAddress,
            senderAccount: args.senderAccount,
            reservation: args.reservation,
            optionalTransactionPayloadArgs: options,
            buildRawTxn: (candidate) =>
                (args.buildEstimateRawTxn ?? args.buildRawTxn)({ ...options, maxGas: candidate }),
        },
        config,
    );
    const rawTxn = args.buildRawTxn({ ...options, maxGas: resolved.maxGas });
    // The estimate gave the reservation a lower number that has no submission of this client.
    return resolved.sequenceNumber === undefined ? rawTxn : withSequenceNumber(rawTxn, resolved.sequenceNumber);
}

/** `rawTxn` with another sequence number and the same sender, payload, max gas, gas unit price, expiry and chain ID. */
export function withSequenceNumber(
    rawTxn: TxnBuilderTypes.RawTransaction,
    sequenceNumber: bigint,
): TxnBuilderTypes.RawTransaction {
    return new TxnBuilderTypes.RawTransaction(
        rawTxn.sender,
        sequenceNumber,
        rawTxn.payload,
        rawTxn.max_gas_amount,
        rawTxn.gas_unit_price,
        rawTxn.expiration_timestamp_secs,
        rawTxn.chain_id,
    );
}

/** Returns `value` when it is an integer from 1 to `MAX_TX_EXPIRATION_DURATION`, and throws a `RangeError` otherwise. */
export function validateTxExpirySecs(value: number): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_TX_EXPIRATION_DURATION) {
        throw new RangeError(
            `txExpirySecs must be an integer from 1 to ${MAX_TX_EXPIRATION_DURATION}, got ${String(value)}`,
        );
    }
    return value;
}

/**
 * The expiration time of a transaction built without `txExpiryTime`: `SupraConfig.txExpirySecs` (default
 * `DEFAULT_TX_EXPIRATION_DURATION`) seconds after the client's clock in whole seconds (rounded down), at most
 * `MAX_TX_EXPIRATION_DURATION - TX_EXPIRATION_MARGIN_SECS` seconds after it.
 */
export function defaultTxExpiryTime(config: NetworkConfig): bigint {
    const secs = Math.min(
        config.txExpirySecs ?? DEFAULT_TX_EXPIRATION_DURATION,
        MAX_TX_EXPIRATION_DURATION - TX_EXPIRATION_MARGIN_SECS,
    );
    return BigInt(Math.floor(Date.now() / MILLISECONDS_PER_SECOND) + secs);
}

export function rawTxnObjectInnerInternal(
    args: {
        senderAddress: AccountAddressInput;
        senderSequenceNumber: bigint;
        payload: TxnBuilderTypes.TransactionPayload;
        optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs;
    },
    config: NetworkConfig,
): TxnBuilderTypes.RawTransaction {
    return new TxnBuilderTypes.RawTransaction(
        new TxnBuilderTypes.AccountAddress(addressToBytes(args.senderAddress)),
        args.senderSequenceNumber,
        args.payload,
        // The builders that make no request use `DEFAULT_MAX_GAS_UNITS`; the others pass a resolved `maxGas`.
        args.optionalTransactionPayloadArgs?.maxGas ?? config.maxGas ?? DEFAULT_MAX_GAS_UNITS,
        // The call's price, else the client's. The builders that make no request throw without one; the others pass
        // a price resolved with the node's estimate.
        requireGasUnitPrice(args.optionalTransactionPayloadArgs, config),
        args.optionalTransactionPayloadArgs?.txExpiryTime ?? defaultTxExpiryTime(config),
        new TxnBuilderTypes.ChainId(config.chainId),
    );
}

export function rawTxnObjectInternal(
    args: {
        senderAddress: AccountAddressInput;
        senderSequenceNumber: bigint;
        function: MoveFunctionId;
        functionTypeArgs: TxnBuilderTypes.TypeTag[];
        functionArgs: Uint8Array[];
        optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs;
    },
    config: NetworkConfig,
): TxnBuilderTypes.RawTransaction {
    let payload = new TxnBuilderTypes.TransactionPayloadEntryFunction(
        buildEntryFunctionInternal({
            function: args.function,
            functionTypeArgs: args.functionTypeArgs,
            functionArgs: args.functionArgs,
        }),
    );

    return rawTxnObjectInnerInternal(
        {
            senderAddress: args.senderAddress,
            senderSequenceNumber: args.senderSequenceNumber,
            payload: payload,
            optionalTransactionPayloadArgs: args.optionalTransactionPayloadArgs ?? {},
        },
        config,
    );
}

export function buildEntryFunctionInternal(args: {
    function: MoveFunctionId;
    functionTypeArgs: TxnBuilderTypes.TypeTag[];
    functionArgs: Uint8Array[];
}): TxnBuilderTypes.EntryFunction {
    let { moduleAddress, moduleName, functionName } = getFunctionParts(args.function);
    return new TxnBuilderTypes.EntryFunction(
        new TxnBuilderTypes.ModuleId(
            new TxnBuilderTypes.AccountAddress(addressToBytes(moduleAddress)),
            new TxnBuilderTypes.Identifier(moduleName),
        ),
        new TxnBuilderTypes.Identifier(functionName),
        args.functionTypeArgs,
        args.functionArgs,
    );
}

export async function signedTransactionInternal(
    args: {
        senderAccount: SupraAccount;
        rawTxn: TxnBuilderTypes.RawTransaction;
    },
    config: NetworkConfig,
): Promise<TxnBuilderTypes.SignedTransaction> {
    const signature = await signTransactionInternal({ senderAccount: args.senderAccount, rawTxn: args.rawTxn }, config);
    return new TxnBuilderTypes.SignedTransaction(
        args.rawTxn,
        new TxnBuilderTypes.AccountAuthenticatorEd25519(
            new TxnBuilderTypes.Ed25519PublicKey(args.senderAccount.pubKey().toUint8Array()),
            new TxnBuilderTypes.Ed25519Signature(signature.toUint8Array()),
        ),
    );
}

export function getTransactionPayloadJSONInternal(
    txPayload: TxnBuilderTypes.TransactionPayload,
): TransactionPayloadJSON {
    if (txPayload instanceof TxnBuilderTypes.TransactionPayloadEntryFunction) {
        return {
            EntryFunction: {
                module: {
                    address: txPayload.value.module_name.address.toHexString().toString(),
                    name: txPayload.value.module_name.name.value,
                },
                function: txPayload.value.function_name.value,
                ty_args: parseFunctionTypeArgs(txPayload.value.ty_args),
                args: fromUint8ArrayToJSArray(txPayload.value.args),
            },
        };
    } else if (txPayload instanceof TxnBuilderTypes.TransactionPayloadScript) {
        return {
            Script: {
                code: Array.from(txPayload.value.code),
                ty_args: parseFunctionTypeArgs(txPayload.value.ty_args),
                args: parseScriptArgs(txPayload.value.args),
            },
        };
    } else if (txPayload instanceof TxnBuilderTypes.TransactionPayloadAutomationRegistration) {
        if (txPayload.value instanceof TxnBuilderTypes.AutomationRegistrationParamsV1) {
            return {
                AutomationRegistration: {
                    V1: {
                        automated_function: {
                            module: {
                                address: txPayload.value.value.automated_function.module_name.address
                                    .toHexString()
                                    .toString(),
                                name: txPayload.value.value.automated_function.module_name.name.value,
                            },
                            function: txPayload.value.value.automated_function.function_name.value,
                            ty_args: parseFunctionTypeArgs(txPayload.value.value.automated_function.ty_args),
                            args: fromUint8ArrayToJSArray(txPayload.value.value.automated_function.args),
                        },
                        max_gas_amount: txPayload.value.value.max_gas_amount,
                        gas_price_cap: txPayload.value.value.gas_price_cap,
                        automation_fee_cap_for_epoch: txPayload.value.value.automation_fee_cap_for_epoch,
                        expiration_timestamp_secs: txPayload.value.value.expiration_timestamp_secs,
                        aux_data: fromUint8ArrayToJSArray(txPayload.value.value.aux_data),
                    },
                },
            };
        } else if (txPayload.value instanceof AutomationRegistrationParamsV2) {
            const params = txPayload.value.value;
            return {
                AutomationRegistration: {
                    V2: {
                        automated_function: {
                            module: {
                                address: params.automated_function.module_name.address.toHexString().toString(),
                                name: params.automated_function.module_name.name.value,
                            },
                            function: params.automated_function.function_name.value,
                            ty_args: parseFunctionTypeArgs(params.automated_function.ty_args),
                            args: fromUint8ArrayToJSArray(params.automated_function.args),
                        },
                        max_gas_amount: params.max_gas_amount,
                        gas_price_cap: params.gas_price_cap,
                        automation_fee_cap_for_epoch: params.automation_fee_cap_for_epoch,
                        expiration_timestamp_secs: params.expiration_timestamp_secs,
                        aux_data: fromUint8ArrayToJSArray(params.aux_data),
                        task_type: params.task_type,
                        priority_value: params.priority_value ?? null,
                    },
                },
            };
        } else {
            throw new Error("Unknown variant of `AutomationRegistrationParams`");
        }
    } else if (txPayload instanceof TxnBuilderTypes.TransactionPayloadMultisig) {
        let multisig_address = txPayload.value.multisig_address.toHexString().toString();
        let payload = txPayload.value.transaction_payload?.transaction_payload;

        // An execution of a proposal whose payload is stored on chain carries no payload.
        if (!payload) {
            return { Multisig: { multisig_address } };
        }

        return {
            Multisig: {
                multisig_address,
                transaction_payload: {
                    EntryFunction: {
                        module: {
                            address: payload.module_name.address.toHexString().toString(),
                            name: payload.module_name.name.value,
                        },
                        function: payload.function_name.value,
                        ty_args: parseFunctionTypeArgs(payload.ty_args),
                        args: fromUint8ArrayToJSArray(payload.args),
                    },
                },
            },
        };
    } else {
        throw new Error("Unknown variant of `TransactionPayload`");
    }
}

/**
 * The `u64` fields are passed through as `bigint` rather than coerced with
 * `Number()`. `post` serializes them to exact JSON number literals, so the body
 * on the wire always matches the BCS transaction that was signed — a `Number()`
 * round trip would round anything above `Number.MAX_SAFE_INTEGER` and invalidate
 * the signature.
 */
export function getRawTxnJSONInternal(rawTxn: TxnBuilderTypes.RawTransaction): RawTxnJSON {
    return {
        sender: rawTxn.sender.toHexString().toString(),
        sequence_number: rawTxn.sequence_number,
        payload: getTransactionPayloadJSONInternal(rawTxn.payload),
        max_gas_amount: rawTxn.max_gas_amount,
        gas_unit_price: rawTxn.gas_unit_price,
        expiration_timestamp_secs: rawTxn.expiration_timestamp_secs,
        chain_id: rawTxn.chain_id.value,
    };
}

/**
 * Signs `rawTxn` with `senderAccount` and returns the JSON form of the signed transaction, the body of a submission.
 * The hash of the signed transaction is recorded on the returned object (`withTransactionHash`).
 */
export async function sendTxnPayloadInternal(
    args: {
        senderAccount: SupraAccount;
        rawTxn: TxnBuilderTypes.RawTransaction;
    },
    config: NetworkConfig,
): Promise<SendTxnPayload> {
    let signature = await signTransactionInternal(
        {
            senderAccount: args.senderAccount,
            rawTxn: args.rawTxn,
        },
        config,
    );

    const publicKey = args.senderAccount.pubKey();
    return withTransactionHash(
        {
            Move: {
                raw_txn: getRawTxnJSONInternal(args.rawTxn),
                authenticator: {
                    Ed25519: {
                        public_key: publicKey.toString(),
                        signature: signature.toString(),
                    },
                },
            },
        },
        args.rawTxn,
        ed25519TransactionAuthenticator(publicKey.toUint8Array(), signature.toUint8Array()),
    );
}

export function scriptRawTxnObjectInternal(
    args: {
        senderAddress: AccountAddressInput;
        senderSequenceNumber: bigint;
        scriptCode: Uint8Array;
        scriptTypeArgs: TxnBuilderTypes.TypeTag[];
        scriptArgs: TxnBuilderTypes.TransactionArgument[];
        optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs;
    },
    config: NetworkConfig,
): TxnBuilderTypes.RawTransaction {
    let payload = new TxnBuilderTypes.TransactionPayloadScript(
        new TxnBuilderTypes.Script(args.scriptCode, args.scriptTypeArgs, args.scriptArgs),
    );

    return rawTxnObjectInnerInternal(
        {
            senderAddress: args.senderAddress,
            senderSequenceNumber: args.senderSequenceNumber,
            payload: payload,
            optionalTransactionPayloadArgs: args.optionalTransactionPayloadArgs ?? {},
        },
        config,
    );
}

/**
 * Builds an automation registration. The registration parameters are version 2 (`RegistrationParamsV2`) when
 * `automationTaskType` or `automationPriority` is given, with task type `User` when only the priority is given, and
 * version 1 otherwise.
 */
export function automationRegistrationRawTxnObjectInternal(
    args: {
        senderAddress: AccountAddressInput;
        senderSequenceNumber: bigint;
        function: MoveFunctionId;
        functionTypeArgs: TxnBuilderTypes.TypeTag[];
        functionArgs: Uint8Array[];
        automationMaxGasAmount: bigint;
        automationGasPriceCap: bigint;
        automationFeeCapForEpoch: bigint;
        automationExpirationTimestampSecs: bigint;
        automationAuxData: Uint8Array[];
        automationTaskType?: AutomationTaskType;
        automationPriority?: bigint;
        optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs;
    },
    config: NetworkConfig,
): TxnBuilderTypes.RawTransaction {
    const automatedFunction = buildEntryFunctionInternal({
        function: args.function,
        functionTypeArgs: args.functionTypeArgs,
        functionArgs: args.functionArgs,
    });
    const params =
        args.automationTaskType === undefined && args.automationPriority === undefined
            ? new TxnBuilderTypes.AutomationRegistrationParamsV1(
                  new TxnBuilderTypes.AutomationRegistrationParamsV1Data(
                      automatedFunction,
                      args.automationMaxGasAmount,
                      args.automationGasPriceCap,
                      args.automationFeeCapForEpoch,
                      args.automationExpirationTimestampSecs,
                      args.automationAuxData,
                  ),
              )
            : new AutomationRegistrationParamsV2(
                  new AutomationRegistrationParamsV2Data(
                      automatedFunction,
                      args.automationMaxGasAmount,
                      args.automationGasPriceCap,
                      args.automationFeeCapForEpoch,
                      args.automationExpirationTimestampSecs,
                      args.automationAuxData,
                      validateAutomationTaskType(args.automationTaskType ?? "User"),
                      args.automationPriority === undefined
                          ? undefined
                          : validateU64(args.automationPriority, "automationPriority"),
                  ),
              );
    let payload = new TxnBuilderTypes.TransactionPayloadAutomationRegistration(params);
    return rawTxnObjectInnerInternal(
        {
            senderAddress: args.senderAddress,
            senderSequenceNumber: args.senderSequenceNumber,
            payload: payload,
            optionalTransactionPayloadArgs: args.optionalTransactionPayloadArgs ?? {},
        },
        config,
    );
}

export function multisigRawTxnObjectInternal(
    args: {
        senderAddress: AccountAddressInput;
        senderSequenceNumber: bigint;
        multisigAddress: AccountAddressInput;
        optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs;
    } & MultisigExecutionPayloadArgs,
    config: NetworkConfig,
): TxnBuilderTypes.RawTransaction {
    let transactionPayload: TxnBuilderTypes.MultiSigTransactionPayload | undefined;
    if (args.function !== undefined) {
        transactionPayload = new TxnBuilderTypes.MultiSigTransactionPayload(
            buildEntryFunctionInternal({
                function: args.function,
                functionTypeArgs: args.functionTypeArgs,
                functionArgs: args.functionArgs,
            }),
        );
    } else if (args.functionTypeArgs !== undefined || args.functionArgs !== undefined) {
        throw new TypeError("functionTypeArgs and functionArgs are given without a function");
    }
    let payload = new TxnBuilderTypes.TransactionPayloadMultisig(
        new TxnBuilderTypes.MultiSig(
            new TxnBuilderTypes.AccountAddress(addressToBytes(args.multisigAddress)),
            transactionPayload,
        ),
    );
    return rawTxnObjectInnerInternal(
        {
            senderAddress: args.senderAddress,
            senderSequenceNumber: args.senderSequenceNumber,
            payload: payload,
            optionalTransactionPayloadArgs: args.optionalTransactionPayloadArgs ?? {},
        },
        config,
    );
}

export function multisigProposalTxRawTxnObjectInternal(
    args: {
        senderAddress: AccountAddressInput;
        senderSequenceNumber: bigint;
        multisigAddress: AccountAddressInput;
        function: MoveFunctionId;
        functionTypeArgs: TxnBuilderTypes.TypeTag[];
        functionArgs: Uint8Array[];
        optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs;
    },
    config: NetworkConfig,
): TxnBuilderTypes.RawTransaction {
    let multisigPayload = new TxnBuilderTypes.MultiSigTransactionPayload(
        buildEntryFunctionInternal({
            function: args.function,
            functionTypeArgs: args.functionTypeArgs,
            functionArgs: args.functionArgs,
        }),
    );
    let multisigPayloadHash = new HexString(sha3.sha3_256(BCS.bcsToBytes(multisigPayload)));

    return rawTxnObjectInternal(
        {
            senderAddress: args.senderAddress,
            senderSequenceNumber: args.senderSequenceNumber,
            function: `${SUPRA_FRAMEWORK_ADDRESS}::multisig_account::create_transaction_with_hash`,
            functionTypeArgs: [],
            functionArgs: [
                BCS.bcsToBytes(new TxnBuilderTypes.AccountAddress(addressToBytes(args.multisigAddress))),
                BCS.bcsSerializeBytes(multisigPayloadHash.toUint8Array()),
            ],
            optionalTransactionPayloadArgs: args.optionalTransactionPayloadArgs ?? {},
        },
        config,
    );
}

/**
 * A `RawTransaction` bound to the client's network configuration. The `Build` methods return it; it serializes the
 * transaction and signs it, which checks the chain ID first.
 */
export class ExtendedRawTransaction extends TxnBuilderTypes.RawTransaction {
    constructor(
        private config: NetworkConfig, // pass whatever you need
        ...args: ConstructorParameters<typeof TxnBuilderTypes.RawTransaction>
    ) {
        super(...args);
    }

    /**
     * Serialize the transaction to bytes
     * @returns bytes
     */
    toBytes(): Uint8Array {
        return BCS.bcsToBytes(this);
    }

    /**
     * Serialize the transaction to hex string
     * @returns hex string
     */
    toHexString(): HexString {
        return new HexString(uint8ArrayToHexString(BCS.bcsToBytes(this)));
    }

    /**
     * Create a signed transaction
     * @param senderAccount - Sender KeyPair
     * @returns `SignedTransaction`
     * @throws `SupraChainIdMismatchError` before signing when the client's or the transaction's chain ID is not the
     * node's (see `SupraConfig.verifyChainId`)
     */
    signedTransaction(senderAccount: SupraAccount): Promise<TxnBuilderTypes.SignedTransaction> {
        return signedTransactionInternal(
            {
                senderAccount,
                rawTxn: this,
            },
            this.config,
        );
    }

    /**
     * Create a send transaction payload
     * @param senderAccount - Sender KeyPair
     * @returns `SendTxnPayload`
     * @throws `SupraChainIdMismatchError` before signing when the client's or the transaction's chain ID is not the
     * node's (see `SupraConfig.verifyChainId`)
     */
    sendTxnPayload(senderAccount: SupraAccount): Promise<SendTxnPayload> {
        return sendTxnPayloadInternal(
            {
                senderAccount,
                rawTxn: this,
            },
            this.config,
        );
    }

    /**
     * Simulate the transaction
     * @param senderAccountOrAuthenticator - Sender KeyPair or MoveInnerAuthenticator
     * @returns `TransactionResponse` of the simulation, whose status is `Success`
     * @throws `SupraSimulationFailedError` when the simulated status is not `Success`
     * @throws `SupraGasUnitPriceBelowMinimumError` instead when the status is `Invalid` because the gas unit price is
     * below the node's minimum; the `SupraSimulationFailedError` is its `cause`
     * @throws `SupraChainIdMismatchError` before signing with a `SupraAccount` when the client's or the transaction's
     * chain ID is not the node's (see `SupraConfig.verifyChainId`)
     */
    async simulate(senderAccountOrAuthenticator: SupraAccount | MoveInnerAuthenticator): Promise<TransactionResponse> {
        if (senderAccountOrAuthenticator instanceof SupraAccount) {
            return simulateTxnInternal(
                {
                    sendTxPayload: await sendTxnPayloadInternal(
                        {
                            senderAccount: senderAccountOrAuthenticator,
                            rawTxn: this,
                        },
                        this.config,
                    ),
                },
                this.config,
            );
        }

        return simulateSerializedTxnInternal(
            {
                txAuthenticator: senderAccountOrAuthenticator,
                serializedRawTransaction: BCS.bcsToBytes(this),
            },
            this.config,
        );
    }

    /**
     * Submit the transaction
     * @param args.senderAccount - Sender KeyPair
     * @returns `SubmitTransactionResponse`; `Submit` describes the statuses and errors of a submission
     * @throws `SupraChainIdMismatchError` before signing when the client's or the transaction's chain ID is not the
     * node's (see `SupraConfig.verifyChainId`)
     * @throws `SupraGasUnitPriceBelowMinimumError` when the node refuses the submission or an enabled simulation
     * because the gas unit price is below its minimum (see `Submit`)
     * @throws `SupraSubmissionOutcomeUnknownError` when the outcome of the submission request is unknown (see `Submit`)
     */
    submitTransaction(args: {
        senderAccount: SupraAccount;
        enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs;
    }): Promise<SubmitTransactionResponse> {
        return submitSerializedRawTransactionInternal(
            {
                senderAccount: args.senderAccount,
                serializedRawTransaction: BCS.bcsToBytes(this),
                enableTransactionWaitAndSimulationArgs: args.enableTransactionWaitAndSimulationArgs ?? {},
            },
            this.config,
        );
    }

    /**
     * Submit the transaction with signature
     * @param args.senderPubkey - Sender ed25519 pubkey
     * @param args.signature - Ed25519 signature
     * @returns `SubmitTransactionResponse`; `Submit` describes the statuses and errors of a submission
     * @throws `SupraGasUnitPriceBelowMinimumError` when the node refuses the submission or an enabled simulation
     * because the gas unit price is below its minimum (see `Submit`)
     * @throws `SupraSubmissionOutcomeUnknownError` when the outcome of the submission request is unknown (see `Submit`)
     * @throws `RangeError` before submitting when `senderPubkey` or `signature` is not hex digits in pairs after its
     * `0x` prefix
     */
    submitTransactionAndSignature(args: {
        senderPubkey: HexString;
        signature: HexString;
        enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs;
    }): Promise<SubmitTransactionResponse> {
        return submitSerializedRawTransactionAndSignatureInternal(
            {
                serializedRawTransaction: BCS.bcsToBytes(this),
                senderPubkey: args.senderPubkey,
                signature: args.signature,
                enableTransactionWaitAndSimulationArgs: args.enableTransactionWaitAndSimulationArgs ?? {},
            },
            this.config,
        );
    }

    /**
     * Submit the sponsor transaction
     * @param args.feePayerAddress - Fee payer address
     * @param args.secondarySignersAccountAddress - Secondary signers address
     * @param args.senderAuthenticator - Sender authenticator
     * @param args.feePayerAuthenticator - Fee payer authenticator
     * @param args.secondarySignersAuthenticator - Secondary signers authenticator
     * @returns `SubmitTransactionResponse`; `Submit` describes the statuses and errors of a submission
     * @throws `SupraGasUnitPriceBelowMinimumError` when the node refuses the submission or an enabled simulation
     * because the gas unit price is below its minimum (see `Submit`)
     * @throws `SupraSubmissionOutcomeUnknownError` when the outcome of the submission request is unknown (see `Submit`)
     * @throws `RangeError` before submitting when the fee payer address or a secondary signer address is not 1 to 64
     * hex digits after an optional `0x` or `0X`
     */
    submitSponsorTransaction(args: {
        feePayerAddress: AccountAddressInput;
        secondarySignersAccountAddress: Array<string>;
        senderAuthenticator: TxnBuilderTypes.AccountAuthenticatorEd25519;
        feePayerAuthenticator: TxnBuilderTypes.AccountAuthenticatorEd25519;
        secondarySignersAuthenticator: Array<TxnBuilderTypes.AccountAuthenticatorEd25519>;
        enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs;
    }): Promise<SubmitTransactionResponse> {
        return submitSponsorTransactionInternal(
            {
                feePayerAddress: args.feePayerAddress,
                secondarySignersAccountAddress: args.secondarySignersAccountAddress,
                senderAuthenticator: args.senderAuthenticator,
                feePayerAuthenticator: args.feePayerAuthenticator,
                secondarySignersAuthenticator: args.secondarySignersAuthenticator,
                rawTxn: this,
                enableTransactionWaitAndSimulationArgs: args.enableTransactionWaitAndSimulationArgs ?? {},
            },
            this.config,
        );
    }

    /**
     * Submit the multi agent transaction
     * @param args.secondarySignersAccountAddress - Secondary signers address
     * @param args.senderAuthenticator - Sender authenticator
     * @param args.secondarySignersAuthenticator - Secondary signers authenticator
     * @returns `SubmitTransactionResponse`; `Submit` describes the statuses and errors of a submission
     * @throws `SupraGasUnitPriceBelowMinimumError` when the node refuses the submission or an enabled simulation
     * because the gas unit price is below its minimum (see `Submit`)
     * @throws `SupraSubmissionOutcomeUnknownError` when the outcome of the submission request is unknown (see `Submit`)
     * @throws `RangeError` before submitting when a secondary signer address is not 1 to 64 hex digits after an optional
     * `0x` or `0X`
     */
    submitMultiAgentTransaction(args: {
        secondarySignersAccountAddress: Array<string>;
        senderAuthenticator: TxnBuilderTypes.AccountAuthenticatorEd25519;
        secondarySignersAuthenticator: Array<TxnBuilderTypes.AccountAuthenticatorEd25519>;
        enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs;
    }): Promise<SubmitTransactionResponse> {
        return submitMultiAgentTransactionInternal(
            {
                secondarySignersAccountAddress: args.secondarySignersAccountAddress,
                senderAuthenticator: args.senderAuthenticator,
                secondarySignersAuthenticator: args.secondarySignersAuthenticator,
                rawTxn: this,
                enableTransactionWaitAndSimulationArgs: args.enableTransactionWaitAndSimulationArgs ?? {},
            },
            this.config,
        );
    }

    /**
     * Sign the transaction
     * @param senderAccount - Sender account
     * @returns A promise of the ed25519 signature in `HexString`
     * @throws `SupraChainIdMismatchError` before signing when the client's or the transaction's chain ID is not the
     * node's (see `SupraConfig.verifyChainId`)
     */
    signTransaction(senderAccount: SupraAccount): Promise<HexString> {
        return signTransactionInternal(
            {
                senderAccount: senderAccount,
                rawTxn: this,
            },
            this.config,
        );
    }
}

export function extendedRawTransaction(
    args: { rawTxn: TxnBuilderTypes.RawTransaction },
    config: NetworkConfig,
): ExtendedRawTransaction {
    return new ExtendedRawTransaction(
        config,
        args.rawTxn.sender,
        args.rawTxn.sequence_number,
        args.rawTxn.payload,
        args.rawTxn.max_gas_amount,
        args.rawTxn.gas_unit_price,
        args.rawTxn.expiration_timestamp_secs,
        args.rawTxn.chain_id,
    );
}
