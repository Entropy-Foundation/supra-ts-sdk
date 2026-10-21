import { BCS, TxnBuilderTypes, type SupraAccount } from "supra-l1-sdk-core";
import sha3 from "js-sha3";
import { SupraMultisigNoProposalError, SupraMultisigPayloadError } from "../errors/multisigError";
import { SupraError } from "../errors/supraError";
import { addressToBytes, standardizeAddress } from "../helper/account";
import { uint8ArrayToHexString } from "../helper/general";
import { deriveMultisigAccountAddress } from "../helper/multisig";
import type { AccountAddressInput } from "../types/account";
import type {
    CreateMultisigAccountResponse,
    MultisigEntryFunctionPayload,
    MultisigProposal,
    MultisigSequenceNumbers,
} from "../types/multisig";
import type { MoveFunctionId } from "../types/move";
import type { OptionalTransactionArgs, SubmitTransactionResponse } from "../types/transactionManager/transactionSubmit";
import type { NetworkConfig } from "../utils/apiEndpoints";
import { DEFAULT_MULTISIG_TIMEOUT_DURATION_SECS, SUPRA_FRAMEWORK_ADDRESS } from "../utils/constants";
import { viewRawInternal } from "./methods";
import {
    buildEntryFunctionInternal,
    generateTransactionPayload,
    multisigProposalTxRawTxnObjectInternal,
    multisigRawTxnObjectInternal,
    rawTxnObjectInnerInternal,
    rawTxnObjectInternal,
} from "./transactionManager/txnBuild";
import { buildAndSubmitInternal } from "./transactionManager/txnSubmit";

const MULTISIG_MODULE = `${SUPRA_FRAMEWORK_ADDRESS}::multisig_account`;

function multisigFunction(name: string): MoveFunctionId {
    return `${MULTISIG_MODULE}::${name}` as MoveFunctionId;
}

/** An entry function of the multisig module for which the sender's SUPRA balance and the node's estimate decide gas. */
function submitMultisigEntry(
    args: {
        senderAccount: SupraAccount;
        function: MoveFunctionId;
        functionArgs: Uint8Array[];
        optionalTransactionArgs?: OptionalTransactionArgs | undefined;
        onSubmission?: Parameters<typeof buildAndSubmitInternal>[0]["onSubmission"];
    },
    config: NetworkConfig,
): Promise<SubmitTransactionResponse> {
    return buildAndSubmitInternal(
        {
            senderAccount: args.senderAccount,
            buildRawTxn: (senderSequenceNumber, optionalTransactionPayloadArgs) =>
                rawTxnObjectInternal(
                    {
                        senderAddress: args.senderAccount.address(),
                        senderSequenceNumber,
                        function: args.function,
                        functionTypeArgs: [],
                        functionArgs: args.functionArgs,
                        optionalTransactionPayloadArgs,
                    },
                    config,
                ),
            optionalTransactionArgs: args.optionalTransactionArgs,
            onSubmission: args.onSubmission,
        },
        config,
    );
}

function addressVectorBytes(addresses: AccountAddressInput[]): Uint8Array {
    const serializer = new BCS.Serializer();
    serializer.serializeU32AsUleb128(addresses.length);
    for (const address of addresses) {
        new TxnBuilderTypes.AccountAddress(addressToBytes(address)).serialize(serializer);
    }
    return serializer.getBytes();
}

/** The empty `vector<String>` and `vector<vector<u8>>` that `create_with_owners` takes as metadata. */
const EMPTY_VECTOR = new Uint8Array([0]);

export async function createMultisigAccountInternal(
    args: {
        senderAccount: SupraAccount;
        additionalOwners?: AccountAddressInput[] | undefined;
        signaturesRequired: number | bigint;
        timeoutDurationSecs?: number | bigint | undefined;
        optionalTransactionArgs?: OptionalTransactionArgs | undefined;
    },
    config: NetworkConfig,
): Promise<CreateMultisigAccountResponse> {
    // The account's address comes from the creator's sequence number in the transaction that is sent, which the
    // simulation before submission can lower; `onSubmission` sees the number of the transaction that is sent.
    let sequenceNumber: bigint | undefined;
    const transaction = await submitMultisigEntry(
        {
            senderAccount: args.senderAccount,
            function: multisigFunction("create_with_owners"),
            functionArgs: [
                addressVectorBytes(args.additionalOwners ?? []),
                BCS.bcsSerializeUint64(args.signaturesRequired),
                EMPTY_VECTOR,
                EMPTY_VECTOR,
                BCS.bcsSerializeUint64(args.timeoutDurationSecs ?? DEFAULT_MULTISIG_TIMEOUT_DURATION_SECS),
            ],
            optionalTransactionArgs: args.optionalTransactionArgs,
            onSubmission: (rawTxn) => {
                sequenceNumber = BigInt(rawTxn.sequence_number);
            },
        },
        config,
    );
    if (sequenceNumber === undefined) {
        throw new SupraError("The creating transaction was submitted without a sequence number");
    }
    return {
        multisigAddress: deriveMultisigAccountAddress({
            creatorAddress: args.senderAccount.address(),
            sequenceNumber,
        }),
        transaction,
    };
}

/** The BCS bytes of the payload of a proposal, as `create_transaction` stores them and as an execution carries them. */
function proposalPayloadBytes(
    function_: MoveFunctionId,
    typeArguments: TxnBuilderTypes.TypeTag[],
    functionArguments: Uint8Array[],
): Uint8Array {
    return BCS.bcsToBytes(
        new TxnBuilderTypes.MultiSigTransactionPayload(
            buildEntryFunctionInternal({
                function: function_,
                functionTypeArgs: typeArguments,
                functionArgs: functionArguments,
            }),
        ),
    );
}

export async function proposeMultisigTransactionInternal(
    args: {
        senderAccount: SupraAccount;
        multisigAddress: AccountAddressInput;
        payload: MultisigEntryFunctionPayload;
        optionalTransactionArgs?: OptionalTransactionArgs | undefined;
    },
    config: NetworkConfig,
): Promise<SubmitTransactionResponse> {
    const encoded = await encodeProposalPayload(args.payload, config);
    return submitMultisigEntry(
        {
            senderAccount: args.senderAccount,
            function: multisigFunction("create_transaction"),
            functionArgs: [addressToBytes(args.multisigAddress), BCS.bcsSerializeBytes(encoded.bytes)],
            optionalTransactionArgs: args.optionalTransactionArgs,
        },
        config,
    );
}

export async function proposeMultisigTransactionWithHashInternal(
    args: {
        senderAccount: SupraAccount;
        multisigAddress: AccountAddressInput;
        payload: MultisigEntryFunctionPayload;
        optionalTransactionArgs?: OptionalTransactionArgs | undefined;
    },
    config: NetworkConfig,
): Promise<SubmitTransactionResponse> {
    const { typeArguments, functionArguments } = await encodeProposalPayload(args.payload, config);
    return buildAndSubmitInternal(
        {
            senderAccount: args.senderAccount,
            buildRawTxn: (senderSequenceNumber, optionalTransactionPayloadArgs) =>
                multisigProposalTxRawTxnObjectInternal(
                    {
                        senderAddress: args.senderAccount.address(),
                        senderSequenceNumber,
                        multisigAddress: args.multisigAddress,
                        function: args.payload.function,
                        functionTypeArgs: typeArguments,
                        functionArgs: functionArguments,
                        optionalTransactionPayloadArgs,
                    },
                    config,
                ),
            optionalTransactionArgs: args.optionalTransactionArgs,
        },
        config,
    );
}

export function voteMultisigTransactionInternal(
    args: {
        senderAccount: SupraAccount;
        multisigAddress: AccountAddressInput;
        sequenceNumber: number | bigint;
        approved: boolean;
        optionalTransactionArgs?: OptionalTransactionArgs | undefined;
    },
    config: NetworkConfig,
): Promise<SubmitTransactionResponse> {
    return submitMultisigEntry(
        {
            senderAccount: args.senderAccount,
            function: multisigFunction(args.approved ? "approve_transaction" : "reject_transaction"),
            functionArgs: [addressToBytes(args.multisigAddress), BCS.bcsSerializeUint64(args.sequenceNumber)],
            optionalTransactionArgs: args.optionalTransactionArgs,
        },
        config,
    );
}

export function executeRejectedMultisigTransactionInternal(
    args: {
        senderAccount: SupraAccount;
        multisigAddress: AccountAddressInput;
        optionalTransactionArgs?: OptionalTransactionArgs | undefined;
    },
    config: NetworkConfig,
): Promise<SubmitTransactionResponse> {
    return submitMultisigEntry(
        {
            senderAccount: args.senderAccount,
            function: multisigFunction("execute_rejected_transaction"),
            functionArgs: [addressToBytes(args.multisigAddress)],
            optionalTransactionArgs: args.optionalTransactionArgs,
        },
        config,
    );
}

export async function executeMultisigTransactionInternal(
    args: {
        senderAccount: SupraAccount;
        multisigAddress: AccountAddressInput;
        payload?: MultisigEntryFunctionPayload | undefined;
        optionalTransactionArgs?: OptionalTransactionArgs | undefined;
    },
    config: NetworkConfig,
): Promise<SubmitTransactionResponse> {
    const multisigAddress = standardizeAddress(args.multisigAddress);
    const { lastResolved, next } = await getMultisigSequenceNumbersInternal({ multisigAddress }, config);
    const sequenceNumber = lastResolved + 1n;
    if (sequenceNumber >= next) {
        throw new SupraMultisigNoProposalError({ multisigAddress });
    }
    const proposal = await getMultisigProposalInternal({ multisigAddress, sequenceNumber }, config);
    const given = args.payload === undefined ? undefined : await encodeProposalPayload(args.payload, config);

    let carried: typeof given;
    if (proposal.payload !== undefined) {
        // The payload is stored on chain: the execution carries none. A payload that the call gave is checked against
        // the stored one so that the call executes what it names.
        if (given !== undefined && `0x${uint8ArrayToHexString(given.bytes)}` !== proposal.payload.toLowerCase()) {
            throw new SupraMultisigPayloadError({ reason: "stored-mismatch", multisigAddress, sequenceNumber });
        }
        carried = undefined;
    } else {
        if (given === undefined) {
            throw new SupraMultisigPayloadError({ reason: "required", multisigAddress, sequenceNumber });
        }
        if (`0x${sha3.sha3_256(given.bytes)}` !== proposal.payloadHash?.toLowerCase()) {
            throw new SupraMultisigPayloadError({ reason: "hash-mismatch", multisigAddress, sequenceNumber });
        }
        carried = given;
    }

    const storedPayload = carried === undefined ? decodeStoredPayload(proposal.payload) : undefined;
    return buildAndSubmitInternal(
        {
            senderAccount: args.senderAccount,
            buildRawTxn: (senderSequenceNumber, optionalTransactionPayloadArgs) =>
                multisigRawTxnObjectInternal(
                    {
                        senderAddress: args.senderAccount.address(),
                        senderSequenceNumber,
                        multisigAddress,
                        optionalTransactionPayloadArgs,
                        ...(carried === undefined
                            ? {}
                            : {
                                  function: carried.function,
                                  functionTypeArgs: carried.typeArguments,
                                  functionArgs: carried.functionArguments,
                              }),
                    },
                    config,
                ),
            // The nodes of v11.7.0 and v12.0.0.rc6 do not simulate an execution without a payload (`MISSING_DATA`), so the max gas
            // estimate simulates the execution with the stored payload, which the node accepts as it is the stored
            // one.
            buildEstimateRawTxn:
                storedPayload === undefined
                    ? undefined
                    : (senderSequenceNumber, optionalTransactionPayloadArgs) =>
                          rawTxnObjectInnerInternal(
                              {
                                  senderAddress: args.senderAccount.address(),
                                  senderSequenceNumber,
                                  payload: new TxnBuilderTypes.TransactionPayloadMultisig(
                                      new TxnBuilderTypes.MultiSig(
                                          new TxnBuilderTypes.AccountAddress(addressToBytes(multisigAddress)),
                                          storedPayload,
                                      ),
                                  ),
                                  optionalTransactionPayloadArgs,
                              },
                              config,
                          ),
            optionalTransactionArgs: args.optionalTransactionArgs,
        },
        config,
    );
}

/** The payload that a proposal stores, or `undefined` when it stores none or its bytes are not a payload. */
function decodeStoredPayload(stored: string | undefined): TxnBuilderTypes.MultiSigTransactionPayload | undefined {
    if (stored === undefined) {
        return undefined;
    }
    try {
        return TxnBuilderTypes.MultiSigTransactionPayload.deserialize(
            new BCS.Deserializer(new Uint8Array(Buffer.from(stored.replace(/^0x/, ""), "hex"))),
        );
    } catch {
        return undefined;
    }
}

interface EncodedProposalPayload {
    function: MoveFunctionId;
    typeArguments: TxnBuilderTypes.TypeTag[];
    functionArguments: Uint8Array[];
    /** The BCS bytes of the payload as a proposal stores them. */
    bytes: Uint8Array;
}

async function encodeProposalPayload(
    payload: MultisigEntryFunctionPayload,
    config: NetworkConfig,
): Promise<EncodedProposalPayload> {
    const { typeArguments, functionArguments } = await generateTransactionPayload(
        {
            function: payload.function,
            functionTypeArgs: payload.functionTypeArgs ?? [],
            functionArgs: payload.functionArgs,
            abi: payload.abi,
        },
        config,
    );
    return {
        function: payload.function,
        typeArguments,
        functionArguments,
        bytes: proposalPayloadBytes(payload.function, typeArguments, functionArguments),
    };
}

export async function getMultisigSequenceNumbersInternal(
    args: { multisigAddress: AccountAddressInput },
    config: NetworkConfig,
): Promise<MultisigSequenceNumbers> {
    const functionArguments = [standardizeAddress(args.multisigAddress)];
    const [[lastResolved], [next]] = await Promise.all([
        viewRawInternal<[string]>(
            { function: multisigFunction("last_resolved_sequence_number"), functionArguments },
            config,
        ),
        viewRawInternal<[string]>({ function: multisigFunction("next_sequence_number"), functionArguments }, config),
    ]);
    return { lastResolved: BigInt(lastResolved), next: BigInt(next) };
}

interface RawMultisigTransaction {
    payload: { vec: string[] };
    payload_hash: { vec: string[] };
    votes: { data: Array<{ key: string; value: boolean }> };
    creator: string;
    creation_time_secs: string;
}

export async function getMultisigProposalInternal(
    args: { multisigAddress: AccountAddressInput; sequenceNumber: number | bigint },
    config: NetworkConfig,
): Promise<MultisigProposal> {
    const [raw] = await viewRawInternal<[RawMultisigTransaction]>(
        {
            function: multisigFunction("get_transaction"),
            functionArguments: [standardizeAddress(args.multisigAddress), BigInt(args.sequenceNumber).toString()],
        },
        config,
    );
    return {
        sequenceNumber: BigInt(args.sequenceNumber),
        payload: raw.payload.vec[0],
        payloadHash: raw.payload_hash.vec[0],
        votes: raw.votes.data.map((vote) => ({ owner: standardizeAddress(vote.key), approved: vote.value })),
        creator: standardizeAddress(raw.creator),
        creationTimeSecs: BigInt(raw.creation_time_secs),
    };
}

/** The next proposal to execute or remove, or `undefined` when the multisig account's queue is empty. */
export async function getNextMultisigProposalInternal(
    args: { multisigAddress: AccountAddressInput },
    config: NetworkConfig,
): Promise<MultisigProposal | undefined> {
    const { lastResolved, next } = await getMultisigSequenceNumbersInternal(args, config);
    const sequenceNumber = lastResolved + 1n;
    if (sequenceNumber >= next) {
        return undefined;
    }
    return getMultisigProposalInternal({ multisigAddress: args.multisigAddress, sequenceNumber }, config);
}
