import { BCS, HexString, SupraAccount, TxnBuilderTypes, TypeTagParser } from "supra-l1-sdk-core";
import { SupraClient } from "../../../api/supraClient";
import { SupraAPIError, SupraNotFoundError } from "../../../errors/apiError";
import { SupraNetworkError } from "../../../errors/supraError";
import {
    SupraSimulationFailedError,
    SupraTransactionFailedError,
    SupraTransactionTimeoutError,
} from "../../../errors/transactionError";
import type { MoveModule } from "../../../types/move";
import { TransactionStatus } from "../../../types/transaction";
import type {
    EnableTransactionWaitAndSimulationArgs,
    NotReadBackTransactionResponse,
    SubmitTransactionResponse,
} from "../../../types/transactionManager/transactionSubmit";
import { stringifyWithBigInt } from "../../../utils/json";

/**
 * Outcomes of simulate, submit and wait, through every public submission path, with a stubbed `fetch` that
 * answers like a node.
 */

const RPC_URL = "http://node.test";
const HASH = "0x" + "5e".repeat(32);
const ZERO_SIGNATURE = "0x" + "0".repeat(128);
const SUPRA_ACCOUNT_TRANSFER = "0x1::supra_account::transfer";
const GAS = { maxGas: 5_000n, gasUnitPrice: 100n };

const COIN_ABI = {
    address: "0x1",
    name: "coin",
    friends: [],
    exposed_functions: [
        {
            name: "transfer",
            visibility: "public",
            is_entry: true,
            is_view: false,
            generic_type_params: [{ constraints: [] }],
            params: ["&signer", "address", "u64"],
            return: [],
        },
    ],
    structs: [],
} as const satisfies MoveModule;

type Answer = { status: number; body: unknown } | Error;

interface Node {
    simulate: () => Answer;
    submit: () => Answer;
    transaction: () => Answer;
}

interface RecordedRequest {
    method: string;
    path: string;
    body: string | undefined;
}

let node: Node;
let requests: RecordedRequest[];
const originalFetch = global.fetch;

function json(body: unknown, status = 200): Answer {
    return { status, body };
}

function moveTxn(status: TransactionStatus, vmStatus: string | null, gasUsed = 7) {
    return {
        hash: HASH,
        status,
        txn_type: "user",
        output: vmStatus === null ? null : { Move: { gas_used: gasUsed, events: [], vm_status: vmStatus } },
        block_header: null,
    };
}

const SUCCESS = moveTxn(TransactionStatus.Success, "Executed successfully");
const ABORT_VM_STATUS =
    "Move abort in 0x1::coin: EINSUFFICIENT_BALANCE(0x10006): Not enough coins to complete transaction";
const FAILED = moveTxn(TransactionStatus.Fail, ABORT_VM_STATUS);
const NOT_FOUND = json({ message: "Transaction not found" }, 404);

function respond(answer: Answer): Promise<Response> {
    if (answer instanceof Error) {
        return Promise.reject(answer);
    }
    return Promise.resolve(
        new Response(JSON.stringify(answer.body), {
            status: answer.status,
            headers: { "Content-Type": "application/json" },
        }),
    );
}

function stubFetch(): void {
    global.fetch = jest.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        const path = url.pathname.replace(/^\/rpc\/v3/, "");
        const method = init?.method ?? "GET";
        requests.push({ method, path, body: typeof init?.body === "string" ? init.body : undefined });

        if (method === "POST" && path === "/transactions/simulate") return respond(node.simulate());
        if (method === "POST" && path === "/transactions/submit") return respond(node.submit());
        if (method === "GET" && path.startsWith("/transactions/")) return respond(node.transaction());
        if (method === "GET" && /^\/accounts\/0x[0-9a-f]+$/.test(path)) {
            return respond(json({ sequence_number: 0, authentication_key: "0x" + "00".repeat(32) }));
        }
        return respond(json({ message: `unexpected ${method} ${path}` }, 500));
    }) as typeof fetch;
}

function submitRequests(): RecordedRequest[] {
    return requests.filter((request) => request.path === "/transactions/submit");
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    throw new Error("expected the promise to reject");
}

const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255 });

function rawTransfer(sender: SupraAccount) {
    return supra.transaction.build.rawTxnObject({
        senderAddress: sender.address(),
        senderSequenceNumber: 0n,
        function: SUPRA_ACCOUNT_TRANSFER,
        functionTypeArgs: [],
        functionArgs: [new SupraAccount().address().toUint8Array(), BCS.bcsSerializeUint64(1_000n)],
        optionalTransactionPayloadArgs: GAS,
    });
}

/** Every public submission path, each submitting one transfer with the given options. */
const SUBMIT_PATHS: Array<
    [string, (options: EnableTransactionWaitAndSimulationArgs) => Promise<SubmitTransactionResponse>]
> = [
    [
        "transaction.submit.submitRawTransaction",
        (options) => {
            const sender = new SupraAccount();
            return supra.transaction.submit.submitRawTransaction({
                senderAccount: sender,
                rawTransaction: rawTransfer(sender),
                enableTransactionWaitAndSimulationArgs: options,
            });
        },
    ],
    [
        "transaction.submit.submitSerializedRawTransaction",
        (options) => {
            const sender = new SupraAccount();
            return supra.transaction.submit.submitSerializedRawTransaction({
                senderAccount: sender,
                serializedRawTransaction: rawTransfer(sender).toBytes(),
                enableTransactionWaitAndSimulationArgs: options,
            });
        },
    ],
    [
        "transaction.submit.submitSerializedRawTransactionAndSignature",
        (options) => {
            const sender = new SupraAccount();
            const rawTxn = rawTransfer(sender);
            return supra.transaction.submit.submitSerializedRawTransactionAndSignature({
                senderPubkey: sender.pubKey(),
                signature: supra.transaction.signTransaction({ senderAccount: sender, rawTxn }) as HexString,
                serializedRawTransaction: rawTxn.toBytes(),
                enableTransactionWaitAndSimulationArgs: options,
            });
        },
    ],
    [
        "transaction.submit.submitSponsorTransaction",
        (options) => {
            const { rawTxn, senderAuthenticator, feePayer, feePayerAuthenticator } = sponsored();
            return supra.transaction.submit.submitSponsorTransaction({
                feePayerAddress: feePayer.address().toString(),
                secondarySignersAccountAddress: [],
                rawTxn,
                senderAuthenticator,
                feePayerAuthenticator,
                secondarySignersAuthenticator: [],
                enableTransactionWaitAndSimulationArgs: options,
            });
        },
    ],
    [
        "transaction.submit.submitMultiAgentTransaction",
        (options) => {
            const { rawTxn, senderAuthenticator, secondary, secondaryAuthenticator } = multiAgent();
            return supra.transaction.submit.submitMultiAgentTransaction({
                secondarySignersAccountAddress: [secondary.address().toString()],
                rawTxn,
                senderAuthenticator,
                secondarySignersAuthenticator: [secondaryAuthenticator],
                enableTransactionWaitAndSimulationArgs: options,
            });
        },
    ],
    [
        "built transaction submitTransaction",
        (options) => {
            const sender = new SupraAccount();
            return rawTransfer(sender).submitTransaction({
                senderAccount: sender,
                enableTransactionWaitAndSimulationArgs: options,
            });
        },
    ],
    [
        "built transaction submitTransactionAndSignature",
        (options) => {
            const sender = new SupraAccount();
            const rawTxn = rawTransfer(sender);
            return rawTxn.submitTransactionAndSignature({
                senderPubkey: sender.pubKey(),
                signature: rawTxn.signTransaction(sender) as HexString,
                enableTransactionWaitAndSimulationArgs: options,
            });
        },
    ],
    [
        "built transaction submitSponsorTransaction",
        (options) => {
            const { rawTxn, senderAuthenticator, feePayer, feePayerAuthenticator } = sponsored();
            return rawTxn.submitSponsorTransaction({
                feePayerAddress: feePayer.address().toString(),
                secondarySignersAccountAddress: [],
                senderAuthenticator,
                feePayerAuthenticator,
                secondarySignersAuthenticator: [],
                enableTransactionWaitAndSimulationArgs: options,
            });
        },
    ],
    [
        "built transaction submitMultiAgentTransaction",
        (options) => {
            const sender = new SupraAccount();
            const secondary = new SupraAccount();
            const rawTxn = rawTransfer(sender);
            const payload = new TxnBuilderTypes.MultiAgentRawTransaction(rawTxn, [
                new TxnBuilderTypes.AccountAddress(secondary.address().toUint8Array()),
            ]);
            return rawTxn.submitMultiAgentTransaction({
                secondarySignersAccountAddress: [secondary.address().toString()],
                senderAuthenticator: authenticator(sender, payload),
                secondarySignersAuthenticator: [authenticator(secondary, payload)],
                enableTransactionWaitAndSimulationArgs: options,
            });
        },
    ],
    [
        "coin.transferSupraCoin",
        (options) =>
            supra.coin.transferSupraCoin({
                senderAccount: new SupraAccount(),
                receiverAccountAddress: new SupraAccount().address().toString(),
                amount: 1n,
                optionalTransactionArgs: {
                    optionalTransactionPayloadArgs: GAS,
                    enableTransactionWaitAndSimulationArgs: options,
                },
            }),
    ],
    [
        "coin.transferCoin",
        (options) =>
            supra.coin.transferCoin({
                senderAccount: new SupraAccount(),
                receiverAccountAddress: new SupraAccount().address().toString(),
                amount: 1n,
                coinType: "0x1::supra_coin::SupraCoin",
                optionalTransactionArgs: {
                    optionalTransactionPayloadArgs: GAS,
                    enableTransactionWaitAndSimulationArgs: options,
                },
            }),
    ],
    [
        "fungibleAsset.transferSupraFungibleAsset",
        (options) =>
            supra.fungibleAsset.transferSupraFungibleAsset({
                senderAccount: new SupraAccount(),
                receiverAccountAddress: new SupraAccount().address().toString(),
                amount: 1n,
                optionalTransactionArgs: {
                    optionalTransactionPayloadArgs: GAS,
                    enableTransactionWaitAndSimulationArgs: options,
                },
            }),
    ],
    [
        "fungibleAsset.transferFungibleAsset",
        (options) =>
            supra.fungibleAsset.transferFungibleAsset({
                senderAccount: new SupraAccount(),
                receiverAccountAddress: new SupraAccount().address().toString(),
                amount: 1n,
                assetAddress: "0x" + "0".repeat(63) + "a",
                optionalTransactionArgs: {
                    optionalTransactionPayloadArgs: GAS,
                    enableTransactionWaitAndSimulationArgs: options,
                },
            }),
    ],
    [
        "transaction.publishPackage",
        (options) =>
            supra.transaction.publishPackage({
                senderAccount: new SupraAccount(),
                packageMetadata: Uint8Array.from([1, 2, 3]),
                modulesCode: [Uint8Array.from([4, 5, 6])],
                optionalTransactionArgs: {
                    optionalTransactionPayloadArgs: GAS,
                    enableTransactionWaitAndSimulationArgs: options,
                },
            }),
    ],
    [
        "contract entry function from ABI",
        (options) =>
            supra.contract.fromABI([COIN_ABI] as const).contracts.coin.entry.transfer({
                functionArguments: [new SupraAccount(), new SupraAccount().address().toString(), 1n],
                typeArguments: [new TypeTagParser("0x1::supra_coin::SupraCoin").parseTypeTag()],
                optionalTransactionPayloadArgs: GAS,
                enableTransactionWaitAndSimulationArgs: options,
            }),
    ],
];

function authenticator(
    account: SupraAccount,
    payload: TxnBuilderTypes.MultiAgentRawTransaction | TxnBuilderTypes.FeePayerRawTransaction,
) {
    return supra.transaction.signTransaction({
        senderAccount: account,
        rawTxn: payload,
    }) as TxnBuilderTypes.AccountAuthenticatorEd25519;
}

function sponsored() {
    const sender = new SupraAccount();
    const feePayer = new SupraAccount();
    const rawTxn = rawTransfer(sender);
    const payload = new TxnBuilderTypes.FeePayerRawTransaction(
        rawTxn,
        [],
        new TxnBuilderTypes.AccountAddress(feePayer.address().toUint8Array()),
    );
    return {
        rawTxn,
        feePayer,
        senderAuthenticator: authenticator(sender, payload),
        feePayerAuthenticator: authenticator(feePayer, payload),
    };
}

function multiAgent() {
    const sender = new SupraAccount();
    const secondary = new SupraAccount();
    const rawTxn = rawTransfer(sender);
    const payload = new TxnBuilderTypes.MultiAgentRawTransaction(rawTxn, [
        new TxnBuilderTypes.AccountAddress(secondary.address().toUint8Array()),
    ]);
    return {
        rawTxn,
        secondary,
        senderAuthenticator: authenticator(sender, payload),
        secondaryAuthenticator: authenticator(secondary, payload),
    };
}

describe("transaction outcomes", () => {
    beforeEach(() => {
        requests = [];
        node = {
            simulate: () => json(SUCCESS),
            submit: () => json(HASH),
            transaction: () => json(SUCCESS),
        };
        stubFetch();
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    describe.each(SUBMIT_PATHS)("%s", (_name, submit) => {
        it("throws SupraTransactionFailedError with the hash, status and vm_status when the transaction fails", async () => {
            node.transaction = () => json(FAILED);

            const error = await rejection(submit({ enableWaitForTransaction: true }));

            expect(error).toBeInstanceOf(SupraTransactionFailedError);
            const failed = error as SupraTransactionFailedError;
            expect(failed.hash).toBe(HASH);
            expect(failed.status).toBe(TransactionStatus.Fail);
            expect(failed.vm_status).toBe(ABORT_VM_STATUS);
            expect(failed.major_status).toBe("ABORTED");
            expect(failed.sub_status).toBe(0x10006);
            expect(submitRequests()).toHaveLength(1);
        });

        it("returns the transaction when it succeeds", async () => {
            const result = await submit({ enableWaitForTransaction: true });
            expect(result.status).toBe(TransactionStatus.Success);
        });

        it("sends no submit request when the simulation fails validation", async () => {
            node.simulate = () =>
                json(
                    moveTxn(
                        TransactionStatus.PendingAfterExecution,
                        "Status Code: SENDING_ACCOUNT_DOES_NOT_EXIST, Type Validation",
                        0,
                    ),
                );

            const error = await rejection(
                submit({ enableTransactionSimulation: true, enableWaitForTransaction: true }),
            );

            expect(error).toBeInstanceOf(SupraSimulationFailedError);
            expect((error as SupraSimulationFailedError).major_status).toBe("SENDING_ACCOUNT_DOES_NOT_EXIST");
            expect(submitRequests()).toHaveLength(0);
        });

        it("returns the hash when the read after an accepted submission fails", async () => {
            node.transaction = () => new TypeError("fetch failed");

            const result = await submit({});

            expect(result).toMatchObject({ hash: HASH, status: "NotReadBack" });
            expect((result as NotReadBackTransactionResponse).readError).toBeInstanceOf(SupraNetworkError);
            expect(submitRequests()).toHaveLength(1);
        });
    });

    describe("submit with wait", () => {
        function submitTransfer(options: EnableTransactionWaitAndSimulationArgs, client = supra) {
            const sender = new SupraAccount();
            return client.transaction.submit.submitRawTransaction({
                senderAccount: sender,
                rawTransaction: rawTransfer(sender),
                enableTransactionWaitAndSimulationArgs: options,
            });
        }

        it("throws for an Invalid transaction", async () => {
            node.transaction = () =>
                json(moveTxn(TransactionStatus.Invalid, "Status Code: INVALID_SIGNATURE, Type Validation"));

            const error = (await rejection(
                submitTransfer({ enableWaitForTransaction: true }),
            )) as SupraTransactionFailedError;

            expect(error).toBeInstanceOf(SupraTransactionFailedError);
            expect(error.status).toBe(TransactionStatus.Invalid);
            expect(error.hash).toBe(HASH);
        });

        it("throws OUT_OF_GAS for a transaction that ran out of gas", async () => {
            node.transaction = () => json(moveTxn(TransactionStatus.Fail, "Out of gas"));

            const error = (await rejection(
                submitTransfer({ enableWaitForTransaction: true }),
            )) as SupraTransactionFailedError;

            expect(error.major_status).toBe("OUT_OF_GAS");
            expect(error.vm_status).toBe("Out of gas");
        });

        it("returns a failed transaction when checkSuccess is false", async () => {
            node.transaction = () => json(FAILED);

            const result = await submitTransfer({ enableWaitForTransaction: true, checkSuccess: false });

            expect(result.status).toBe(TransactionStatus.Fail);
        });

        it("keeps waiting through 404 and PendingAfterExecution", async () => {
            const answers: Answer[] = [
                NOT_FOUND,
                json(moveTxn(TransactionStatus.Pending, null)),
                json(moveTxn(TransactionStatus.PendingAfterExecution, null)),
                json(SUCCESS),
            ];
            node.transaction = () => answers.shift() ?? json(SUCCESS);

            const result = await submitTransfer({ enableWaitForTransaction: true });

            expect(result.status).toBe(TransactionStatus.Success);
            expect(answers).toHaveLength(0);
        });

        it("throws SupraTransactionTimeoutError with the hash after waitTimeoutMs", async () => {
            node.transaction = () => json(moveTxn(TransactionStatus.Pending, null));

            const error = (await rejection(
                submitTransfer({ enableWaitForTransaction: true, waitTimeoutMs: 30 }),
            )) as SupraTransactionTimeoutError;

            expect(error).toBeInstanceOf(SupraTransactionTimeoutError);
            expect(error.hash).toBe(HASH);
            expect(error.timeoutMs).toBe(30);
            expect(error.lastStatus).toBe(TransactionStatus.Pending);
        });

        it("throws SupraTransactionTimeoutError with the hash when every read fails", async () => {
            node.transaction = () => NOT_FOUND;

            const error = (await rejection(
                submitTransfer({ enableWaitForTransaction: true, waitTimeoutMs: 30 }),
            )) as SupraTransactionTimeoutError;

            expect(error).toBeInstanceOf(SupraTransactionTimeoutError);
            expect(error.hash).toBe(HASH);
            expect(error.lastStatus).toBeUndefined();
            expect(error.cause).toBeInstanceOf(SupraNotFoundError);
        });

        it("uses waitTimeoutMs of the client configuration", async () => {
            node.transaction = () => json(moveTxn(TransactionStatus.Pending, null));
            const client = new SupraClient({ rpcUrl: RPC_URL, chainId: 255, waitTimeoutMs: 40 });

            const error = (await rejection(
                submitTransfer({ enableWaitForTransaction: true }, client),
            )) as SupraTransactionTimeoutError;

            expect(error.timeoutMs).toBe(40);
        });

        it("rejects an invalid waitTimeoutMs before any request", async () => {
            await expect(submitTransfer({ enableWaitForTransaction: true, waitTimeoutMs: -1 })).rejects.toBeInstanceOf(
                RangeError,
            );
            expect(requests).toHaveLength(0);
        });
    });

    describe("submit without wait", () => {
        function submitTransfer() {
            const sender = new SupraAccount();
            return supra.transaction.submit.submitRawTransaction({
                senderAccount: sender,
                rawTransaction: rawTransfer(sender),
            });
        }

        it("returns the transaction the node reports after the submission", async () => {
            node.transaction = () => json(moveTxn(TransactionStatus.Pending, null));

            const result = await submitTransfer();

            expect(result.hash).toBe(HASH);
            expect(result.status).toBe(TransactionStatus.Pending);
        });

        it("returns a failed transaction without throwing", async () => {
            node.transaction = () => json(FAILED);

            await expect(submitTransfer()).resolves.toMatchObject({ hash: HASH, status: TransactionStatus.Fail });
        });

        it.each([
            ["a 404", NOT_FOUND, SupraNotFoundError],
            ["a 429", json({ message: "Too many requests" }, 429), SupraAPIError],
            ["a connection failure", new TypeError("fetch failed"), SupraNetworkError],
        ])("returns the hash when the read fails with %s", async (_name, answer, errorClass) => {
            node.transaction = () => answer;

            const result = await submitTransfer();

            expect(result.status).toBe("NotReadBack");
            expect(result.hash).toBe(HASH);
            expect((result as NotReadBackTransactionResponse).readError).toBeInstanceOf(errorClass);
        });

        it("throws without a hash when the node rejects the submission", async () => {
            node.submit = () =>
                json({ message: "General err: MoveTransactionValidationFailed(0x1, 0, SEQUENCE_NUMBER_TOO_OLD)" }, 400);

            const error = (await rejection(submitTransfer())) as SupraAPIError;

            expect(error).toBeInstanceOf(SupraAPIError);
            expect(error.major_status).toBe("SEQUENCE_NUMBER_TOO_OLD");
            expect(
                requests.filter((request) => request.method === "GET" && request.path.startsWith("/transactions/")),
            ).toHaveLength(0);
        });
    });

    describe("simulate", () => {
        function payload() {
            const sender = new SupraAccount();
            return rawTransfer(sender).sendTxnPayload(sender);
        }

        it.each([
            [TransactionStatus.Fail, ABORT_VM_STATUS, "ABORTED"],
            [
                TransactionStatus.PendingAfterExecution,
                "Status Code: SENDING_ACCOUNT_DOES_NOT_EXIST, Type Validation",
                "SENDING_ACCOUNT_DOES_NOT_EXIST",
            ],
            [
                TransactionStatus.PendingAfterExecution,
                "Status Code: SEQUENCE_NUMBER_TOO_NEW, Type Validation",
                "SEQUENCE_NUMBER_TOO_NEW",
            ],
            [TransactionStatus.Invalid, "Status Code: INVALID_SIGNATURE, Type Validation", "INVALID_SIGNATURE"],
        ])("throws SupraSimulationFailedError for %s (%s)", async (status, vmStatus, majorStatus) => {
            const simulated = moveTxn(status, vmStatus, 0);
            node.simulate = () => json(simulated);

            const error = (await rejection(
                supra.transaction.simulate.simple({ sendTxPayload: payload() }),
            )) as SupraSimulationFailedError;

            expect(error).toBeInstanceOf(SupraSimulationFailedError);
            expect(error).not.toBeInstanceOf(SupraAPIError);
            expect(error.status).toBe(status);
            expect(error.vm_status).toBe(vmStatus);
            expect(error.major_status).toBe(majorStatus);
            expect(error.transaction).toEqual(simulated);
            expect(error.message).toContain(vmStatus);
        });

        it("returns a successful simulation", async () => {
            await expect(supra.transaction.simulate.simple({ sendTxPayload: payload() })).resolves.toEqual(SUCCESS);
        });

        it("throws for a failed simulation of a built transaction and of a serialized transaction", async () => {
            node.simulate = () => json(moveTxn(TransactionStatus.Fail, "Out of gas"));
            const sender = new SupraAccount();
            const rawTxn = rawTransfer(sender);

            await expect(rawTxn.simulate(sender)).rejects.toBeInstanceOf(SupraSimulationFailedError);
            await expect(
                supra.transaction.simulate.serialized({
                    txAuthenticator: rawTxn.sendTxnPayload(sender).Move.authenticator,
                    serializedRawTransaction: rawTxn.toBytes(),
                }),
            ).rejects.toBeInstanceOf(SupraSimulationFailedError);
        });

        it("sends zero signatures and leaves the caller's payload unchanged", async () => {
            const sendTxPayload = payload();
            const before = stringifyWithBigInt(sendTxPayload);

            await supra.transaction.simulate.simple({ sendTxPayload });

            expect(stringifyWithBigInt(sendTxPayload)).toBe(before);
            const sent = JSON.parse(requests[0]?.body ?? "{}") as {
                Move: { authenticator: { Ed25519: { signature: string } } };
            };
            expect(sent.Move.authenticator.Ed25519.signature).toBe(ZERO_SIGNATURE);
        });

        it.each([
            ["a failed status", () => json(moveTxn(TransactionStatus.Fail, ABORT_VM_STATUS))],
            ["an HTTP error", () => json({ message: "Not Found" }, 404)],
            ["a connection failure", () => new TypeError("fetch failed")],
        ])("leaves the caller's payload byte-identical after %s", async (_name, answer) => {
            node.simulate = answer;
            const sendTxPayload = payload();
            const before = stringifyWithBigInt(sendTxPayload);

            await expect(supra.transaction.simulate.simple({ sendTxPayload })).rejects.toBeDefined();

            expect(stringifyWithBigInt(sendTxPayload)).toBe(before);
            expect(
                "Ed25519" in sendTxPayload.Move.authenticator && sendTxPayload.Move.authenticator.Ed25519.signature,
            ).not.toBe(ZERO_SIGNATURE);
        });

        it("leaves a fee payer payload unchanged", async () => {
            const { senderAuthenticator, feePayer, feePayerAuthenticator } = sponsored();
            node.simulate = () => new TypeError("fetch failed");
            const sendTxPayload = {
                Move: {
                    raw_txn: rawTransfer(new SupraAccount()).sendTxnPayload(new SupraAccount()).Move.raw_txn,
                    authenticator: {
                        FeePayer: {
                            sender: {
                                Ed25519: {
                                    public_key: HexString.fromUint8Array(senderAuthenticator.public_key.value).hex(),
                                    signature: HexString.fromUint8Array(senderAuthenticator.signature.value).hex(),
                                },
                            },
                            secondary_signer_addresses: [],
                            secondary_signers: [],
                            fee_payer_address: feePayer.address().toString(),
                            fee_payer_signer: {
                                Ed25519: {
                                    public_key: HexString.fromUint8Array(feePayerAuthenticator.public_key.value).hex(),
                                    signature: HexString.fromUint8Array(feePayerAuthenticator.signature.value).hex(),
                                },
                            },
                        },
                    },
                },
            };
            const before = stringifyWithBigInt(sendTxPayload);

            await expect(supra.transaction.simulate.simple({ sendTxPayload })).rejects.toBeInstanceOf(
                SupraNetworkError,
            );

            expect(stringifyWithBigInt(sendTxPayload)).toBe(before);
        });
    });
});
