import { BCS, HexString, SupraAccount, TxnBuilderTypes } from "supra-l1-sdk-core";
import type { NetworkConfig } from "../../utils/apiEndpoints";
import type { OptionalTransactionPayloadArgs, RawTxnJSON, SendTxnPayload, TransactionPayloadJSON } from "../../types/transactionManager/transactionBuild";
import { DEFAULT_GAS_PRICE, DEFAULT_MAX_GAS_UNITS, DEFAULT_TX_EXPIRATION_DURATION, MILLISECONDS_PER_SECOND, SUPRA_FRAMEWORK_ADDRESS } from "../../utils/constants";
import type { AccountAddressInput } from "../../types/account";
import { standardizeAddress } from "../../helper/account";
import type { MoveFunctionId, MoveInnerAuthenticator, MoveModule, SimpleEntryFunctionArgumentTypes, TypeArgument } from "../../types/move";
import { convertPayloadTypeArgsToMoveType, getFunctionParts, uint8ArrayToHexString } from "../../helper/general";
import { signTransactionInternal } from "../transaction";
import { fromUint8ArrayToJSArray, parseFunctionTypeArgs, parseScriptArgs } from "../../utils/functions";
import { getAccountModuleInternal } from "../account";
import { getFunctionABI } from "../../helper/abi";
import { DynamicTransactionSerializer } from "../../utils/serializer";
import type { TransactionResponse } from "../../types/transaction";
import { simulateSerializedTxnInternal, simulateTxnInternal } from "./txnSimulate";
import { submitMultiAgentTransactionInternal, submitSerializedRawTransactionAndSignatureInternal, submitSerializedRawTransactionInternal, submitSponsorTransactionInternal } from "./txnSubmit";
import type { EnableTransactionWaitAndSimulationArgs } from "../../types/transactionManager/transactionSubmit";
import sha3 from "js-sha3";


/**
 * Generate the serialized payload for a transaction
 */
export async function generateTransactionPayload(
    args: {
        function: MoveFunctionId,
        functionTypeArgs: Array<TypeArgument>,
        functionArgs: Array<Exclude<SimpleEntryFunctionArgumentTypes, Uint8Array>>,
        abi?: MoveModule | undefined
    },
    config: NetworkConfig
): Promise<{ typeArguments: TxnBuilderTypes.TypeTag[], functionArguments: Uint8Array[] }> {

    let { moduleAddress, moduleName, functionName } = getFunctionParts(args.function);

    if (!args.abi) {
        args.abi = (await getAccountModuleInternal({ accountAddress: moduleAddress!, moduleName: moduleName! }, config)).abi!;
    }

    let funcABI = await getFunctionABI(args.abi, moduleAddress!, moduleName!, functionName!);

    // Convert type arguments to move type arguments
    let serializedTypeArguments = convertPayloadTypeArgsToMoveType(funcABI, {
        function: args.function,
        typeArguments: args.functionTypeArgs,
        functionArguments: args.functionArgs
    });

    const serializer = new DynamicTransactionSerializer();

    const serializedArguments = serializer.prepareTransactionArgs(
        args.functionArgs,
        funcABI.params.slice(1) // exclude signer 
    );

    return {
        typeArguments: serializedTypeArguments ?? [],
        functionArguments: serializedArguments ?? [],
    }
}

export async function simpleInternal(args: {
    senderAddress: AccountAddressInput,
    senderSequenceNumber: bigint,
    function: MoveFunctionId,
    functionTypeArgs: Array<TypeArgument>,
    functionArgs: Array<Exclude<SimpleEntryFunctionArgumentTypes, Uint8Array>>,
    optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs,
    abi?: MoveModule
}, config: NetworkConfig): Promise<TxnBuilderTypes.RawTransaction> {
    let { functionArguments, typeArguments } = await generateTransactionPayload({
        function: args.function,
        functionTypeArgs: args.functionTypeArgs,
        functionArgs: args.functionArgs,
        abi: args.abi
    }, config);

    return rawTxnObjectInternal({
        senderAddress: args.senderAddress,
        senderSequenceNumber: args.senderSequenceNumber,
        function: args.function,
        functionTypeArgs: typeArguments as TxnBuilderTypes.TypeTag[],
        functionArgs: functionArguments,
        optionalTransactionPayloadArgs: args.optionalTransactionPayloadArgs ?? {}
    }, config)

}

export function rawTxnObjectInnerInternal(
    args: {
        senderAddress: AccountAddressInput,
        senderSequenceNumber: bigint,
        payload: TxnBuilderTypes.TransactionPayload,
        optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs,
    },
    config: NetworkConfig
): TxnBuilderTypes.RawTransaction {
    let senderAddress = typeof args.senderAddress === "string" ? new HexString(args.senderAddress.toString()) : args.senderAddress;

    return new TxnBuilderTypes.RawTransaction(
        new TxnBuilderTypes.AccountAddress(senderAddress.toUint8Array()),
        args.senderSequenceNumber,
        args.payload,
        args.optionalTransactionPayloadArgs?.maxGas ?? config.maxGas ?? DEFAULT_MAX_GAS_UNITS,
        // If the user has not passed `gasUnitPrice` value then, we will use cached value of the
        // `min_gas_unit_price` assigned to `this.minGasUnitPrice` at the time of `SupraClient`
        // instantiation.
        args.optionalTransactionPayloadArgs?.gasUnitPrice ?? config.minGasUnitPrice ?? DEFAULT_GAS_PRICE,
        args.optionalTransactionPayloadArgs?.txExpiryTime ??
        BigInt(
            Math.ceil(Date.now() / MILLISECONDS_PER_SECOND) +
            DEFAULT_TX_EXPIRATION_DURATION,
        ),
        new TxnBuilderTypes.ChainId(config.chainId),
    );
}


export function rawTxnObjectInternal(
    args: {
        senderAddress: AccountAddressInput,
        senderSequenceNumber: bigint,
        function: MoveFunctionId,
        functionTypeArgs: TxnBuilderTypes.TypeTag[],
        functionArgs: Uint8Array[],
        optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs,
    },
    config: NetworkConfig
): TxnBuilderTypes.RawTransaction {

    let payload = new TxnBuilderTypes.TransactionPayloadEntryFunction(
        buildEntryFunctionInternal({
            function: args.function,
            functionTypeArgs: args.functionTypeArgs,
            functionArgs: args.functionArgs
        })
    );

    return rawTxnObjectInnerInternal({
        senderAddress: args.senderAddress,
        senderSequenceNumber: args.senderSequenceNumber,
        payload: payload,
        optionalTransactionPayloadArgs: args.optionalTransactionPayloadArgs ?? {},
    }, config);
}


export function buildEntryFunctionInternal(
    args: {
        function: MoveFunctionId,
        functionTypeArgs: TxnBuilderTypes.TypeTag[],
        functionArgs: Uint8Array[],
    }
): TxnBuilderTypes.EntryFunction {
    let { moduleAddress, moduleName, functionName } = getFunctionParts(args.function);
    return new TxnBuilderTypes.EntryFunction(
        new TxnBuilderTypes.ModuleId(
            new TxnBuilderTypes.AccountAddress(
                new HexString(standardizeAddress(moduleAddress)).toUint8Array(),
            ),
            new TxnBuilderTypes.Identifier(moduleName),
        ),
        new TxnBuilderTypes.Identifier(functionName),
        args.functionTypeArgs,
        args.functionArgs,
    );
}


export function signedTransactionInternal(
    args: {
        senderAccount: SupraAccount,
        rawTxn: TxnBuilderTypes.RawTransaction,
    }
): TxnBuilderTypes.SignedTransaction {
    return new TxnBuilderTypes.SignedTransaction(
        args.rawTxn,
        new TxnBuilderTypes.AccountAuthenticatorEd25519(
            new TxnBuilderTypes.Ed25519PublicKey(
                args.senderAccount.pubKey().toUint8Array(),
            ),
            new TxnBuilderTypes.Ed25519Signature(
                (signTransactionInternal({ senderAccount: args.senderAccount, rawTxn: args.rawTxn }) as HexString).toUint8Array(),
            ),
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
                    address: txPayload.value.module_name.address
                        .toHexString()
                        .toString(),
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
    } else if (
        txPayload instanceof
        TxnBuilderTypes.TransactionPayloadAutomationRegistration
    ) {
        if (
            txPayload.value instanceof
            TxnBuilderTypes.AutomationRegistrationParamsV1
        ) {
            return {
                AutomationRegistration: {
                    V1: {
                        automated_function: {
                            module: {
                                address:
                                    txPayload.value.value.automated_function.module_name.address
                                        .toHexString()
                                        .toString(),
                                name: txPayload.value.value.automated_function.module_name
                                    .name.value,
                            },
                            function:
                                txPayload.value.value.automated_function.function_name.value,
                            ty_args: parseFunctionTypeArgs(
                                txPayload.value.value.automated_function.ty_args,
                            ),
                            args: fromUint8ArrayToJSArray(
                                txPayload.value.value.automated_function.args,
                            ),
                        },
                        max_gas_amount: Number(txPayload.value.value.max_gas_amount),
                        gas_price_cap: Number(txPayload.value.value.gas_price_cap),
                        automation_fee_cap_for_epoch: Number(
                            txPayload.value.value.automation_fee_cap_for_epoch,
                        ),
                        expiration_timestamp_secs: Number(
                            txPayload.value.value.expiration_timestamp_secs,
                        ),
                        aux_data: fromUint8ArrayToJSArray(txPayload.value.value.aux_data),
                    },
                },
            };
        } else {
            throw new Error("Unknown variant of `AutomationRegistrationParams`");
        }
    } else if (
        txPayload instanceof TxnBuilderTypes.TransactionPayloadMultisig
    ) {
        let multisig_address = txPayload.value.multisig_address
            .toHexString()
            .toString();
        let payload = txPayload.value.transaction_payload?.transaction_payload;

        if (!payload) {
            throw new Error("Multisig payload is missing");
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


export function getRawTxnJSONInternal(rawTxn: TxnBuilderTypes.RawTransaction): RawTxnJSON {
    return {
        sender: rawTxn.sender.toHexString().toString(),
        sequence_number: Number(rawTxn.sequence_number),
        payload: getTransactionPayloadJSONInternal(rawTxn.payload),
        max_gas_amount: Number(rawTxn.max_gas_amount),
        gas_unit_price: Number(rawTxn.gas_unit_price),
        expiration_timestamp_secs: Number(rawTxn.expiration_timestamp_secs),
        chain_id: rawTxn.chain_id.value,
    };
}


export function sendTxnPayloadInternal(
    args: {
        senderAccount: SupraAccount,
        rawTxn: TxnBuilderTypes.RawTransaction,
    }
): SendTxnPayload {
    let signature = signTransactionInternal({
        senderAccount: args.senderAccount,
        rawTxn: args.rawTxn
    }) as HexString;


    return {
        Move: {
            raw_txn: getRawTxnJSONInternal(args.rawTxn),
            authenticator: {
                Ed25519: {
                    public_key: args.senderAccount.pubKey().toString(),
                    signature: signature.toString(),
                },
            },
        },
    };
}

export function scriptRawTxnObjectInternal(
    args: {
        senderAddress: AccountAddressInput,
        senderSequenceNumber: bigint,
        scriptCode: Uint8Array,
        scriptTypeArgs: TxnBuilderTypes.TypeTag[],
        scriptArgs: TxnBuilderTypes.TransactionArgument[],
        optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs,
    },
    config: NetworkConfig
): TxnBuilderTypes.RawTransaction {
    let payload = new TxnBuilderTypes.TransactionPayloadScript(
        new TxnBuilderTypes.Script(args.scriptCode, args.scriptTypeArgs, args.scriptArgs),
    );

    return rawTxnObjectInnerInternal({
        senderAddress: args.senderAddress,
        senderSequenceNumber: args.senderSequenceNumber,
        payload: payload,
        optionalTransactionPayloadArgs: args.optionalTransactionPayloadArgs ?? {},
    }, config);

}


export function automationRegistrationRawTxnObjectInternal(
    args: {
        senderAddress: AccountAddressInput,
        senderSequenceNumber: bigint,
        function: MoveFunctionId,
        functionTypeArgs: TxnBuilderTypes.TypeTag[],
        functionArgs: Uint8Array[],
        automationMaxGasAmount: bigint,
        automationGasPriceCap: bigint,
        automationFeeCapForEpoch: bigint,
        automationExpirationTimestampSecs: bigint,
        automationAuxData: Uint8Array[],
        optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs,
    },
    config: NetworkConfig
): TxnBuilderTypes.RawTransaction {

    let payload = new TxnBuilderTypes.TransactionPayloadAutomationRegistration(
        new TxnBuilderTypes.AutomationRegistrationParamsV1(
            new TxnBuilderTypes.AutomationRegistrationParamsV1Data(
                buildEntryFunctionInternal({
                    function: args.function,
                    functionTypeArgs: args.functionTypeArgs,
                    functionArgs: args.functionArgs
                }),
                args.automationMaxGasAmount,
                args.automationGasPriceCap,
                args.automationFeeCapForEpoch,
                args.automationExpirationTimestampSecs,
                args.automationAuxData,
            ),
        ),
    );
    return rawTxnObjectInnerInternal({
        senderAddress: args.senderAddress,
        senderSequenceNumber: args.senderSequenceNumber,
        payload: payload,
        optionalTransactionPayloadArgs: args.optionalTransactionPayloadArgs ?? {},
    }, config);

}


export function multisigRawTxnObjectInternal(
    args: {
        senderAddress: AccountAddressInput,
        senderSequenceNumber: bigint,
        multisigAddress: AccountAddressInput,
        function: MoveFunctionId,
        functionTypeArgs: TxnBuilderTypes.TypeTag[],
        functionArgs: Uint8Array[],
        optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs,
    },
    config: NetworkConfig
): TxnBuilderTypes.RawTransaction {
    let multisigAddress = typeof args.multisigAddress === "string" ? new HexString(args.multisigAddress.toString()) : args.multisigAddress;

    let payload = new TxnBuilderTypes.TransactionPayloadMultisig(
        new TxnBuilderTypes.MultiSig(
            TxnBuilderTypes.AccountAddress.fromHex(multisigAddress),
            new TxnBuilderTypes.MultiSigTransactionPayload(
                buildEntryFunctionInternal({
                    function: args.function,
                    functionTypeArgs: args.functionTypeArgs,
                    functionArgs: args.functionArgs
                })
            ),
        ),
    );
    return rawTxnObjectInnerInternal(
        {
            senderAddress: args.senderAddress,
            senderSequenceNumber: args.senderSequenceNumber,
            payload: payload,
            optionalTransactionPayloadArgs: args.optionalTransactionPayloadArgs ?? {},
        }, config);

}


export function multisigProposalTxRawTxnObjectInternal(
    args: {
        senderAddress: AccountAddressInput,
        senderSequenceNumber: bigint,
        multisigAddress: AccountAddressInput,
        function: MoveFunctionId,
        functionTypeArgs: TxnBuilderTypes.TypeTag[],
        functionArgs: Uint8Array[],
        optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs,
    },
    config: NetworkConfig
): TxnBuilderTypes.RawTransaction {
    let multisigAddress = typeof args.multisigAddress === "string" ? new HexString(args.multisigAddress.toString()) : args.multisigAddress;

    let multisigPayload = new TxnBuilderTypes.MultiSigTransactionPayload(
        buildEntryFunctionInternal({
            function: args.function,
            functionTypeArgs: args.functionTypeArgs,
            functionArgs: args.functionArgs
        })
    );
    let multisigPayloadHash = new HexString(
        sha3.sha3_256(BCS.bcsToBytes(multisigPayload)),
    );

    return rawTxnObjectInternal(
        {
            senderAddress: args.senderAddress,
            senderSequenceNumber: args.senderSequenceNumber,
            function: `${SUPRA_FRAMEWORK_ADDRESS}::multisig_account::create_transaction_with_hash`,
            functionTypeArgs: [],
            functionArgs: [
                BCS.bcsToBytes(TxnBuilderTypes.AccountAddress.fromHex(multisigAddress)),
                BCS.bcsSerializeBytes(multisigPayloadHash.toUint8Array()),
            ],
            optionalTransactionPayloadArgs: args.optionalTransactionPayloadArgs ?? {},
        }, config
    );
}


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
     * @param args.senderAccount - Sender KeyPair
     * @returns `SignedTransaction`
     */
    signedTransaction(senderAccount: SupraAccount): TxnBuilderTypes.SignedTransaction {
        return signedTransactionInternal({
            senderAccount,
            rawTxn: this
        })
    }

    /**
     * Create a send transaction payload
     * @param args.senderAccount - Sender KeyPair
     * @returns `SendTxnPayload`
     */
    sendTxnPayload(senderAccount: SupraAccount): SendTxnPayload {
        return sendTxnPayloadInternal({
            senderAccount,
            rawTxn: this
        })
    }

    /**
     * Simulate the transaction
     * @param args.senderAccountOrAuthenticator - Sender KeyPair or MoveInnerAuthenticator
     * @returns `TransactionResponse`
     */
    simulate(senderAccountOrAuthenticator: SupraAccount | MoveInnerAuthenticator): Promise<TransactionResponse> {

        if (senderAccountOrAuthenticator instanceof SupraAccount) {
            return simulateTxnInternal({
                sendTxPayload: sendTxnPayloadInternal({
                    senderAccount: senderAccountOrAuthenticator,
                    rawTxn: this
                })
            }, this.config)
        }

        return simulateSerializedTxnInternal({
            txAuthenticator: senderAccountOrAuthenticator,
            serializedRawTransaction: BCS.bcsToBytes(this)
        }, this.config)

    }

    /**
     * Submit the transaction
     * @param args.senderAccount - Sender KeyPair
     * @returns `TransactionResponse`
     */
    submitTransaction(args: {
        senderAccount: SupraAccount,
        enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs,
    }): Promise<TransactionResponse> {
        return submitSerializedRawTransactionInternal({
            senderAccount: args.senderAccount,
            serializedRawTransaction: BCS.bcsToBytes(this),
            enableTransactionWaitAndSimulationArgs: args.enableTransactionWaitAndSimulationArgs ?? {}
        }, this.config)
    }

    /**
     * Submit the transaction with signature
     * @param args.senderPubkey - Sender ed25519 pubkey
     * @param args.signature - Ed25519 signature
     * @returns `TransactionResponse`
     */
    submitTransactionAndSignature(args: {
        senderPubkey: HexString,
        signature: HexString,
        enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs,
    }): Promise<TransactionResponse> {
        return submitSerializedRawTransactionAndSignatureInternal({
            serializedRawTransaction: BCS.bcsToBytes(this),
            senderPubkey: args.senderPubkey,
            signature: args.signature,
            enableTransactionWaitAndSimulationArgs: args.enableTransactionWaitAndSimulationArgs ?? {}
        }, this.config)
    }

    /**
     * Submit the sponsor transaction
     * @param args.feePayerAddress - Fee payer address
     * @param args.secondarySignersAccountAddress - Secondary signers address
     * @param args.senderAuthenticator - Sender authenticator
     * @param args.feePayerAuthenticator - Fee payer authenticator
     * @param args.secondarySignersAuthenticator - Secondary signers authenticator
     * @returns `TransactionResponse`
     */
    submitSponsorTransaction(
        args: {
            feePayerAddress: AccountAddressInput,
            secondarySignersAccountAddress: Array<string>,
            senderAuthenticator: TxnBuilderTypes.AccountAuthenticatorEd25519,
            feePayerAuthenticator: TxnBuilderTypes.AccountAuthenticatorEd25519,
            secondarySignersAuthenticator: Array<TxnBuilderTypes.AccountAuthenticatorEd25519>,
            enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs,
        }
    ): Promise<TransactionResponse> {
        return submitSponsorTransactionInternal({
            feePayerAddress: args.feePayerAddress,
            secondarySignersAccountAddress: args.secondarySignersAccountAddress,
            senderAuthenticator: args.senderAuthenticator,
            feePayerAuthenticator: args.feePayerAuthenticator,
            secondarySignersAuthenticator: args.secondarySignersAuthenticator,
            rawTxn: this,
            enableTransactionWaitAndSimulationArgs: args.enableTransactionWaitAndSimulationArgs ?? {}
        }, this.config)
    }

    /**
     * Submit the multi agent transaction
     * @param args.secondarySignersAccountAddress - Secondary signers address
     * @param args.senderAuthenticator - Sender authenticator
     * @param args.secondarySignersAuthenticator - Secondary signers authenticator
     * @returns `TransactionResponse`
     */
    submitMultiAgentTransaction(
        args: {
            secondarySignersAccountAddress: Array<string>,
            senderAuthenticator: TxnBuilderTypes.AccountAuthenticatorEd25519,
            secondarySignersAuthenticator: Array<TxnBuilderTypes.AccountAuthenticatorEd25519>,
            enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs,
        }
    ): Promise<TransactionResponse> {
        return submitMultiAgentTransactionInternal({
            secondarySignersAccountAddress: args.secondarySignersAccountAddress,
            senderAuthenticator: args.senderAuthenticator,
            secondarySignersAuthenticator: args.secondarySignersAuthenticator,
            rawTxn: this,
            enableTransactionWaitAndSimulationArgs: args.enableTransactionWaitAndSimulationArgs ?? {}
        }, this.config)
    }

    /**
     * Sign the transaction
     * @param senderAccount - Sender account
     * @returns ed25519 signature in `HexString` or signer authenticator
     */
    signTransaction(senderAccount: SupraAccount): HexString | TxnBuilderTypes.AccountAuthenticatorEd25519 {
        return signTransactionInternal({
            senderAccount: senderAccount,
            rawTxn: this
        })
    }
}

export function extendedRawTransaction(args: { rawTxn: TxnBuilderTypes.RawTransaction }, config: NetworkConfig): ExtendedRawTransaction {
    return new ExtendedRawTransaction(
        config,
        args.rawTxn.sender,
        args.rawTxn.sequence_number,
        args.rawTxn.payload,
        args.rawTxn.max_gas_amount,
        args.rawTxn.gas_unit_price,
        args.rawTxn.expiration_timestamp_secs,
        args.rawTxn.chain_id,
    )
}