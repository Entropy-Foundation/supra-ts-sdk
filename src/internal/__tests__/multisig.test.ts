import { BCS, SupraAccount, TxnBuilderTypes } from "supra-l1-sdk-core";
import sha3 from "js-sha3";
import type { MoveModule } from "../../types/move";
import type { MultisigEntryFunctionPayload } from "../../types/multisig";
import type { NetworkConfig } from "../../utils/apiEndpoints";
import { deriveMultisigAccountAddress } from "../../helper/multisig";
import { standardizeAddress } from "../../helper/account";
import { SupraMultisigNoProposalError, SupraMultisigPayloadError } from "../../errors/multisigError";

jest.mock("../transactionManager/txnSubmit", () => ({
    buildAndSubmitInternal: jest.fn(),
}));
jest.mock("../methods", () => ({
    viewRawInternal: jest.fn(),
}));

import {
    createMultisigAccountInternal,
    executeMultisigTransactionInternal,
    executeRejectedMultisigTransactionInternal,
    getMultisigProposalInternal,
    getNextMultisigProposalInternal,
    proposeMultisigTransactionInternal,
    proposeMultisigTransactionWithHashInternal,
    voteMultisigTransactionInternal,
} from "../multisig";
import { buildAndSubmitInternal } from "../transactionManager/txnSubmit";
import { viewRawInternal } from "../methods";
import { getTransactionPayloadJSONInternal } from "../transactionManager/txnBuild";

const mockSubmit = buildAndSubmitInternal as jest.MockedFunction<typeof buildAndSubmitInternal>;
const mockView = viewRawInternal as jest.MockedFunction<typeof viewRawInternal>;

const config: NetworkConfig = {
    name: "custom",
    chainId: 255,
    rpcUrl: "http://localhost:1",
    maxGas: 1000n,
    gasUnitPrice: 100n,
};
const sender = new SupraAccount();
const MULTISIG = `0x${"0".repeat(60)}abcd`;
const RECEIVER = `0x${"0".repeat(63)}2`;

const TRANSFER_ABI: MoveModule = {
    address: "0x1",
    name: "supra_account",
    friends: [],
    exposed_functions: [
        {
            name: "transfer",
            visibility: "public",
            is_entry: true,
            is_view: false,
            generic_type_params: [],
            params: ["&signer", "address", "u64"],
            return: [],
        },
    ],
    structs: [],
};

function transfer(amount: bigint): MultisigEntryFunctionPayload {
    return { function: "0x1::supra_account::transfer", functionArgs: [RECEIVER, amount], abi: TRANSFER_ABI };
}

/** The BCS bytes of the proposal payload of `transfer(amount)`. */
function transferPayloadBytes(amount: bigint): Uint8Array {
    return BCS.bcsToBytes(
        new TxnBuilderTypes.MultiSigTransactionPayload(
            new TxnBuilderTypes.EntryFunction(
                TxnBuilderTypes.ModuleId.fromStr("0x1::supra_account"),
                new TxnBuilderTypes.Identifier("transfer"),
                [],
                [
                    new TxnBuilderTypes.AccountAddress(standardizeAddressBytes(RECEIVER)).address,
                    BCS.bcsSerializeUint64(amount),
                ],
            ),
        ),
    );
}

function standardizeAddressBytes(address: string): Uint8Array {
    return new Uint8Array(Buffer.from(standardizeAddress(address).slice(2), "hex"));
}

const hex = (bytes: Uint8Array) => `0x${Buffer.from(bytes).toString("hex")}`;

/** What the mocked submission was asked to build, with sequence number 5 and the config's gas settings. */
function builtTransaction(call = 0): TxnBuilderTypes.RawTransaction {
    const args = mockSubmit.mock.calls[call]![0];
    return args.buildRawTxn(5n, { maxGas: 1000n, gasUnitPrice: 100n });
}

function entryOf(rawTxn: TxnBuilderTypes.RawTransaction): TxnBuilderTypes.EntryFunction {
    expect(rawTxn.payload).toBeInstanceOf(TxnBuilderTypes.TransactionPayloadEntryFunction);
    return (rawTxn.payload as TxnBuilderTypes.TransactionPayloadEntryFunction).value;
}

function functionOf(entry: TxnBuilderTypes.EntryFunction): string {
    return `${entry.module_name.address.toHexString().toString()}::${entry.module_name.name.value}::${entry.function_name.value}`;
}

const ONE = `0x${"0".repeat(63)}1`;

beforeEach(() => {
    mockSubmit.mockReset();
    mockSubmit.mockResolvedValue({ hash: "0x1", status: "NotReadBack", readError: undefined });
    mockView.mockReset();
});

describe("createMultisigAccountInternal", () => {
    test("calls create_with_owners with the owners, the threshold, no metadata and the default timeout", async () => {
        const owner = `0x${"0".repeat(63)}7`;
        mockSubmit.mockImplementation(async (args) => {
            args.onSubmission?.({ sequence_number: 9n } as never);
            return { hash: "0x1", status: "NotReadBack", readError: undefined };
        });

        const result = await createMultisigAccountInternal(
            { senderAccount: sender, additionalOwners: [owner], signaturesRequired: 2 },
            config,
        );

        const entry = entryOf(builtTransaction());
        expect(functionOf(entry)).toBe(`${ONE}::multisig_account::create_with_owners`);
        expect(entry.args.map(hex)).toEqual([
            `0x01${"0".repeat(63)}7`,
            hex(BCS.bcsSerializeUint64(2n)),
            "0x00",
            "0x00",
            hex(BCS.bcsSerializeUint64(604_800n)),
        ]);
        expect(result.multisigAddress).toBe(
            deriveMultisigAccountAddress({ creatorAddress: sender.address(), sequenceNumber: 9n }),
        );
    });

    test("uses the timeout of the call and no additional owners by default", async () => {
        mockSubmit.mockImplementation(async (args) => {
            args.onSubmission?.({ sequence_number: 0n } as never);
            return { hash: "0x1", status: "NotReadBack", readError: undefined };
        });
        await createMultisigAccountInternal(
            { senderAccount: sender, signaturesRequired: 1n, timeoutDurationSecs: 300 },
            config,
        );
        const entry = entryOf(builtTransaction());
        expect(entry.args.map(hex)).toEqual([
            "0x00",
            hex(BCS.bcsSerializeUint64(1n)),
            "0x00",
            "0x00",
            hex(BCS.bcsSerializeUint64(300n)),
        ]);
    });

    test("fails when the submission made no sequence number known", async () => {
        await expect(
            createMultisigAccountInternal({ senderAccount: sender, signaturesRequired: 1 }, config),
        ).rejects.toThrow("without a sequence number");
    });
});

describe("proposals", () => {
    test("proposeMultisigTransaction stores the payload with create_transaction", async () => {
        await proposeMultisigTransactionInternal(
            { senderAccount: sender, multisigAddress: MULTISIG, payload: transfer(500n) },
            config,
        );
        const entry = entryOf(builtTransaction());
        expect(functionOf(entry)).toBe(`${ONE}::multisig_account::create_transaction`);
        expect(entry.args.map(hex)).toEqual([
            hex(standardizeAddressBytes(MULTISIG)),
            hex(BCS.bcsSerializeBytes(transferPayloadBytes(500n))),
        ]);
    });

    test("proposeMultisigTransactionWithHash stores the SHA3-256 hash with create_transaction_with_hash", async () => {
        await proposeMultisigTransactionWithHashInternal(
            { senderAccount: sender, multisigAddress: MULTISIG, payload: transfer(500n) },
            config,
        );
        const entry = entryOf(builtTransaction());
        expect(functionOf(entry)).toBe(`${ONE}::multisig_account::create_transaction_with_hash`);
        const hash = Buffer.from(sha3.sha3_256(transferPayloadBytes(500n)), "hex");
        expect(entry.args.map(hex)).toEqual([
            hex(standardizeAddressBytes(MULTISIG)),
            hex(BCS.bcsSerializeBytes(new Uint8Array(hash))),
        ]);
    });
});

describe("votes and removal", () => {
    test.each([
        [true, "approve_transaction"],
        [false, "reject_transaction"],
    ])("approved=%s calls %s", async (approved, name) => {
        await voteMultisigTransactionInternal(
            { senderAccount: sender, multisigAddress: MULTISIG, sequenceNumber: 3, approved },
            config,
        );
        const entry = entryOf(builtTransaction());
        expect(functionOf(entry)).toBe(`${ONE}::multisig_account::${name}`);
        expect(entry.args.map(hex)).toEqual([hex(standardizeAddressBytes(MULTISIG)), hex(BCS.bcsSerializeUint64(3n))]);
    });

    test("executeRejectedMultisigTransaction calls execute_rejected_transaction", async () => {
        await executeRejectedMultisigTransactionInternal({ senderAccount: sender, multisigAddress: MULTISIG }, config);
        const entry = entryOf(builtTransaction());
        expect(functionOf(entry)).toBe(`${ONE}::multisig_account::execute_rejected_transaction`);
        expect(entry.args.map(hex)).toEqual([hex(standardizeAddressBytes(MULTISIG))]);
    });
});

/** Answers the views of `executeMultisigTransactionInternal` for a queue whose next proposal is number 4. */
function queueWith(proposal: { payload?: string; payload_hash?: string }): void {
    mockView.mockImplementation((async (args: { function: string }) => {
        if (args.function.endsWith("::last_resolved_sequence_number")) return ["3"];
        if (args.function.endsWith("::next_sequence_number")) return ["5"];
        if (args.function.endsWith("::get_transaction")) {
            return [
                {
                    payload: { vec: proposal.payload === undefined ? [] : [proposal.payload] },
                    payload_hash: { vec: proposal.payload_hash === undefined ? [] : [proposal.payload_hash] },
                    votes: { data: [{ key: "0x7", value: true }] },
                    creator: "0x7",
                    creation_time_secs: "1700000000",
                },
            ];
        }
        throw new Error(`unexpected view ${args.function}`);
    }) as never);
}

describe("executeMultisigTransactionInternal", () => {
    test("sends no payload for a proposal that stores its payload", async () => {
        queueWith({ payload: hex(transferPayloadBytes(500n)) });

        await executeMultisigTransactionInternal({ senderAccount: sender, multisigAddress: MULTISIG }, config);

        const rawTxn = builtTransaction();
        expect(rawTxn.payload).toBeInstanceOf(TxnBuilderTypes.TransactionPayloadMultisig);
        const json = getTransactionPayloadJSONInternal(rawTxn.payload);
        expect(json).toEqual({ Multisig: { multisig_address: standardizeAddress(MULTISIG) } });
        expect("transaction_payload" in (json as { Multisig: object }).Multisig).toBe(false);
    });

    test("estimates the max gas with the stored payload carried, for a proposal that stores its payload", async () => {
        queueWith({ payload: hex(transferPayloadBytes(500n)) });
        await executeMultisigTransactionInternal({ senderAccount: sender, multisigAddress: MULTISIG }, config);

        const estimate = mockSubmit.mock.calls[0]![0].buildEstimateRawTxn!(5n, { maxGas: 7n, gasUnitPrice: 100n });
        expect(estimate.max_gas_amount).toBe(7n);
        const stored = (estimate.payload as TxnBuilderTypes.TransactionPayloadMultisig).value.transaction_payload;
        expect(stored && hex(BCS.bcsToBytes(stored))).toBe(hex(transferPayloadBytes(500n)));
    });

    test("estimates the max gas with the transaction that is sent, for a proposal that stores a hash", async () => {
        queueWith({ payload_hash: `0x${sha3.sha3_256(transferPayloadBytes(500n))}` });
        await executeMultisigTransactionInternal(
            { senderAccount: sender, multisigAddress: MULTISIG, payload: transfer(500n) },
            config,
        );
        expect(mockSubmit.mock.calls[0]![0].buildEstimateRawTxn).toBeUndefined();
    });

    test("sends the payload given when it equals the stored one, so that the node checks the match", async () => {
        queueWith({ payload: hex(transferPayloadBytes(500n)) });
        await executeMultisigTransactionInternal(
            { senderAccount: sender, multisigAddress: MULTISIG, payload: transfer(500n) },
            config,
        );
        const rawTxn = builtTransaction();
        const multisig = (rawTxn.payload as TxnBuilderTypes.TransactionPayloadMultisig).value;
        expect(multisig.transaction_payload && hex(BCS.bcsToBytes(multisig.transaction_payload))).toBe(
            hex(transferPayloadBytes(500n)),
        );
        expect(mockSubmit.mock.calls[0]![0].buildEstimateRawTxn).toBeUndefined();
    });

    describe("a stored payload that cannot be decoded", () => {
        const noGasConfig: NetworkConfig = { name: "custom", chainId: 255, rpcUrl: "http://localhost:1" };
        const stored = hex(transferPayloadBytes(500n));
        const cases: Array<[string, string]> = [
            ["has another variant", `0x01${stored.slice(4)}`],
            ["has trailing bytes", `${stored}00`],
            ["is not BCS", "0x01"],
            ["is not hex", "0xzz"],
        ];

        test.each(cases)(
            "is refused before a sequence number is reserved when the payload %s",
            async (_name, bytes) => {
                queueWith({ payload: bytes });
                for (const options of [
                    undefined,
                    { enableTransactionWaitAndSimulationArgs: { enableTransactionSimulation: true } },
                    {
                        optionalTransactionPayloadArgs: { maxGas: 5_000n },
                        enableTransactionWaitAndSimulationArgs: { enableTransactionSimulation: true },
                    },
                ]) {
                    const error = await executeMultisigTransactionInternal(
                        { senderAccount: sender, multisigAddress: MULTISIG, optionalTransactionArgs: options },
                        noGasConfig,
                    ).catch((caught: unknown) => caught);
                    expect(error).toBeInstanceOf(SupraMultisigPayloadError);
                    expect(error).toMatchObject({ reason: "stored-undecodable", sequenceNumber: 4n });
                }
                expect(mockSubmit).not.toHaveBeenCalled();
            },
        );

        test("is sent without a simulation form when the call gives a max gas and no simulation", async () => {
            queueWith({ payload: "0x01" });
            await executeMultisigTransactionInternal(
                {
                    senderAccount: sender,
                    multisigAddress: MULTISIG,
                    optionalTransactionArgs: { optionalTransactionPayloadArgs: { maxGas: 5_000n } },
                },
                noGasConfig,
            );
            expect(mockSubmit).toHaveBeenCalledTimes(1);
            expect(mockSubmit.mock.calls[0]![0].buildEstimateRawTxn).toBeUndefined();
        });

        test("is sent when the call turns the estimate off and enables no simulation", async () => {
            queueWith({ payload: "0x01" });
            await executeMultisigTransactionInternal(
                {
                    senderAccount: sender,
                    multisigAddress: MULTISIG,
                    optionalTransactionArgs: { optionalTransactionPayloadArgs: { estimateMaxGas: false } },
                },
                noGasConfig,
            );
            expect(mockSubmit).toHaveBeenCalledTimes(1);
        });

        test("is decoded without Buffer", async () => {
            queueWith({ payload: stored });
            const original = globalThis.Buffer;
            // @ts-expect-error The browsers have no Buffer.
            globalThis.Buffer = undefined;
            try {
                await executeMultisigTransactionInternal({ senderAccount: sender, multisigAddress: MULTISIG }, config);
            } finally {
                globalThis.Buffer = original;
            }
            expect(mockSubmit.mock.calls[0]![0].buildEstimateRawTxn).toBeDefined();
        });
    });

    test("refuses a payload that is not the stored one", async () => {
        queueWith({ payload: hex(transferPayloadBytes(500n)) });
        const error = await executeMultisigTransactionInternal(
            { senderAccount: sender, multisigAddress: MULTISIG, payload: transfer(501n) },
            config,
        ).catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(SupraMultisigPayloadError);
        expect(error).toMatchObject({ reason: "stored-mismatch", sequenceNumber: 4n });
        expect(mockSubmit).not.toHaveBeenCalled();
    });

    test("sends the payload given for a proposal that stores its hash", async () => {
        queueWith({ payload_hash: `0x${sha3.sha3_256(transferPayloadBytes(500n))}` });

        await executeMultisigTransactionInternal(
            { senderAccount: sender, multisigAddress: MULTISIG, payload: transfer(500n) },
            config,
        );

        const json = getTransactionPayloadJSONInternal(builtTransaction().payload);
        expect(json).toMatchObject({
            Multisig: {
                multisig_address: standardizeAddress(MULTISIG),
                transaction_payload: { EntryFunction: { function: "transfer" } },
            },
        });
    });

    test("refuses, before submitting, a hash-only proposal without a payload", async () => {
        queueWith({ payload_hash: `0x${sha3.sha3_256(transferPayloadBytes(500n))}` });
        const error = await executeMultisigTransactionInternal(
            { senderAccount: sender, multisigAddress: MULTISIG },
            config,
        ).catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(SupraMultisigPayloadError);
        expect(error).toMatchObject({ reason: "required", multisigAddress: standardizeAddress(MULTISIG) });
        expect(mockSubmit).not.toHaveBeenCalled();
    });

    test("refuses, before submitting, a payload whose hash is not the stored one", async () => {
        queueWith({ payload_hash: `0x${sha3.sha3_256(transferPayloadBytes(500n))}` });
        const error = await executeMultisigTransactionInternal(
            { senderAccount: sender, multisigAddress: MULTISIG, payload: transfer(501n) },
            config,
        ).catch((caught: unknown) => caught);
        expect(error).toMatchObject({ name: "SupraMultisigPayloadError", reason: "hash-mismatch" });
        expect(mockSubmit).not.toHaveBeenCalled();
    });

    test("throws when the queue is empty", async () => {
        mockView.mockImplementation((async (args: { function: string }) =>
            args.function.endsWith("::last_resolved_sequence_number") ? ["4"] : ["5"]) as never);
        await expect(
            executeMultisigTransactionInternal({ senderAccount: sender, multisigAddress: MULTISIG }, config),
        ).rejects.toBeInstanceOf(SupraMultisigNoProposalError);
        expect(mockSubmit).not.toHaveBeenCalled();
    });
});

describe("reads", () => {
    test("getMultisigProposalInternal parses the node's proposal", async () => {
        queueWith({ payload_hash: "0xabcd" });
        const proposal = await getMultisigProposalInternal({ multisigAddress: MULTISIG, sequenceNumber: 4 }, config);
        expect(proposal).toEqual({
            sequenceNumber: 4n,
            payload: undefined,
            payloadHash: "0xabcd",
            votes: [{ owner: standardizeAddress("0x7"), approved: true }],
            creator: standardizeAddress("0x7"),
            creationTimeSecs: 1_700_000_000n,
        });
        const call = mockView.mock.calls.find((c) => c[0].function.endsWith("::get_transaction"));
        expect(call?.[0].functionArguments).toEqual([standardizeAddress(MULTISIG), "4"]);
    });

    test("getNextMultisigProposalInternal reads the proposal after the last resolved one", async () => {
        queueWith({ payload: "0x00" });
        const proposal = await getNextMultisigProposalInternal({ multisigAddress: MULTISIG }, config);
        expect(proposal?.sequenceNumber).toBe(4n);
    });

    test("getNextMultisigProposalInternal is undefined for an empty queue", async () => {
        mockView.mockImplementation((async (args: { function: string }) =>
            args.function.endsWith("::last_resolved_sequence_number") ? ["0"] : ["1"]) as never);
        expect(await getNextMultisigProposalInternal({ multisigAddress: MULTISIG }, config)).toBeUndefined();
    });
});
