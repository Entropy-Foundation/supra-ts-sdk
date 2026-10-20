import { BCS, HexString, SupraAccount, TxnBuilderTypes, TypeTagParser } from "supra-l1-sdk-core";
import { SupraClient } from "../../../api/supraClient";
import { SupraAPIError } from "../../../errors/apiError";
import { SupraNetworkError, SupraTimeoutError } from "../../../errors/supraError";
import {
    SupraSubmissionOutcomeUnknownError,
    SupraTransactionFailedError,
    SupraTransactionTimeoutError,
} from "../../../errors/transactionError";
import { standardizeAddress } from "../../../helper/account";
import { TransactionStatus } from "../../../types/transaction";
import { sequenceNumberTrackerOf } from "../../sequenceNumber";
import { MockNode } from "./helpers/mockNode";
import { ClientClock, newClient, RECEIVER, transfer } from "./helpers/transfers";

/**
 * Submissions whose request times out, fails before the node answers, or is answered with a 5xx other than 503: the
 * SDK derives the transaction's hash before the request, reports it in `SupraSubmissionOutcomeUnknownError`, records
 * it for the sequence-number counter, and waits for it with `enableWaitForTransaction`.
 */

const RPC_URL = "http://node.test";
const SUPRA_ACCOUNT_TRANSFER = "0x1::supra_account::transfer";
const EXPIRATION = 4_000_000_000n;

const originalFetch = global.fetch;
let node: MockNode | undefined;

afterEach(() => {
    node?.stop();
    node = undefined;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
});

type Read = { status: number; body: unknown };

interface Stub {
    /** The answer to a submission: a response, `"timeout"` (no answer before the request's signal aborts) or an error. */
    submit: () => Read | "timeout" | Error;
    /** The answers to the reads by hash, in order; the last one repeats. */
    reads: Read[];
}

interface Recorded {
    method: string;
    path: string;
    body: string | undefined;
}

function json(body: unknown, status = 200): Read {
    return { status, body };
}

function moveTxn(hash: string, status: TransactionStatus, vmStatus = "Executed successfully") {
    return {
        hash,
        status,
        txn_type: "user",
        output: { Move: { gas_used: 7, events: [], vm_status: vmStatus } },
        block_header: null,
    };
}

function response(read: Read): Response {
    return new Response(JSON.stringify(read.body), {
        status: read.status,
        headers: { "Content-Type": "application/json" },
    });
}

/** A node answered from `stub`, with an account at sequence number 5. Every request is recorded in `requests`. */
function stubNode(stub: Stub): Recorded[] {
    const requests: Recorded[] = [];
    let readIndex = 0;
    global.fetch = jest.fn((input: string | URL | Request, init?: RequestInit) => {
        const path = new URL(String(input)).pathname.replace(/^\/rpc\/v3/, "");
        const method = init?.method ?? "GET";
        requests.push({ method, path, body: typeof init?.body === "string" ? init.body : undefined });
        if (method === "POST" && path === "/transactions/submit") {
            const answer = stub.submit();
            if (answer === "timeout") {
                return new Promise<Response>((_, reject) => {
                    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
                });
            }
            return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(response(answer));
        }
        if (method === "GET" && path.startsWith("/transactions/")) {
            const read = stub.reads[Math.min(readIndex, stub.reads.length - 1)] as Read;
            readIndex += 1;
            return Promise.resolve(response(read));
        }
        if (method === "GET" && /^\/accounts\/0x[0-9a-f]+$/.test(path)) {
            return Promise.resolve(response(json({ sequence_number: 5, authentication_key: "0x" + "00".repeat(32) })));
        }
        if (method === "GET" && path === "/block") {
            return Promise.resolve(
                response(
                    json({
                        header: {
                            height: 1,
                            timestamp: { microseconds_since_unix_epoch: Date.now() * 1000, utc_date_time: "" },
                        },
                        execution_statistics: null,
                    }),
                ),
            );
        }
        return Promise.resolve(response(json({ message: `unexpected ${method} ${path}` }, 500)));
    }) as typeof fetch;
    return requests;
}

const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255, verifyChainId: false, timeoutMs: 50 });

function rawTransfer(sender: SupraAccount) {
    return supra.transaction.build.rawTxnObject({
        senderAddress: sender.address(),
        senderSequenceNumber: 7n,
        function: SUPRA_ACCOUNT_TRANSFER,
        functionTypeArgs: [],
        functionArgs: [new SupraAccount().address().toUint8Array(), BCS.bcsSerializeUint64(1_000n)],
        optionalTransactionPayloadArgs: { maxGas: 5_000n, gasUnitPrice: 100n, txExpiryTime: EXPIRATION },
    });
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    throw new Error("expected the promise to reject");
}

/**
 * The hash of the transaction a submission request carried, rebuilt from its JSON body: an entry function without
 * struct type arguments without type arguments of their own, signed with one Ed25519 key.
 */
function hashOfSubmittedBody(body: string): string {
    const { raw_txn: raw, authenticator } = (
        JSON.parse(body) as {
            Move: {
                raw_txn: {
                    sender: string;
                    sequence_number: number;
                    payload: {
                        EntryFunction: {
                            module: { address: string; name: string };
                            function: string;
                            ty_args: unknown[];
                            args: number[][];
                        };
                    };
                    max_gas_amount: number;
                    gas_unit_price: number;
                    expiration_timestamp_secs: number;
                    chain_id: number;
                };
                authenticator: { Ed25519: { public_key: string; signature: string } };
            };
        }
    ).Move;
    const entry = raw.payload.EntryFunction;
    const typeArguments = entry.ty_args.map((typeArgument) => {
        const { address, module, name, type_args } = (
            typeArgument as { struct: { address: string; module: string; name: string; type_args: unknown[] } }
        ).struct;
        expect(type_args).toEqual([]);
        return new TypeTagParser(`${address}::${module}::${name}`).parseTypeTag();
    });
    const rawTxn = new TxnBuilderTypes.RawTransaction(
        TxnBuilderTypes.AccountAddress.fromHex(raw.sender),
        BigInt(raw.sequence_number),
        new TxnBuilderTypes.TransactionPayloadEntryFunction(
            new TxnBuilderTypes.EntryFunction(
                new TxnBuilderTypes.ModuleId(
                    TxnBuilderTypes.AccountAddress.fromHex(entry.module.address),
                    new TxnBuilderTypes.Identifier(entry.module.name),
                ),
                new TxnBuilderTypes.Identifier(entry.function),
                typeArguments,
                entry.args.map((arg) => Uint8Array.from(arg)),
            ),
        ),
        BigInt(raw.max_gas_amount),
        BigInt(raw.gas_unit_price),
        BigInt(raw.expiration_timestamp_secs),
        new TxnBuilderTypes.ChainId(raw.chain_id),
    );
    return supra.transaction.deriveTransactionHash({
        signedTransaction: new TxnBuilderTypes.SignedTransaction(
            rawTxn,
            new TxnBuilderTypes.TransactionAuthenticatorEd25519(
                new TxnBuilderTypes.Ed25519PublicKey(new HexString(authenticator.Ed25519.public_key).toUint8Array()),
                new TxnBuilderTypes.Ed25519Signature(new HexString(authenticator.Ed25519.signature).toUint8Array()),
            ),
        ),
    });
}

/** The submission failures after which the node may have accepted the transaction, and the class of each `cause`. */
const MAY_HAVE_ACCEPTED: Array<[string, () => Read | "timeout" | Error, abstract new (...args: never[]) => Error]> = [
    ["times out", () => "timeout", SupraTimeoutError],
    ["fails to connect", () => new TypeError("fetch failed"), SupraNetworkError],
    ["is answered with a 500", () => json({ message: "Internal Server Error" }, 500), SupraAPIError],
    ["is answered with a 502", () => json({ message: "Bad Gateway" }, 502), SupraAPIError],
];

describe("a submission whose outcome is unknown", () => {
    it.each(MAY_HAVE_ACCEPTED)(
        "that %s throws SupraSubmissionOutcomeUnknownError with the derived hash",
        async (_name, submit, causeClass) => {
            const requests = stubNode({ submit, reads: [json({ message: "Not Found" }, 404)] });
            const sender = new SupraAccount();
            const rawTxn = rawTransfer(sender);
            const derived = supra.transaction.deriveTransactionHash({
                signedTransaction: await rawTxn.signedTransaction(sender),
            });

            const error = (await rejection(
                rawTxn.submitTransaction({ senderAccount: sender }),
            )) as SupraSubmissionOutcomeUnknownError;

            expect(error).toBeInstanceOf(SupraSubmissionOutcomeUnknownError);
            expect(error).not.toBeInstanceOf(SupraTransactionTimeoutError);
            expect(error).not.toBeInstanceOf(SupraAPIError);
            expect(error.name).toBe("SupraSubmissionOutcomeUnknownError");
            expect(error.hash).toBe(derived);
            expect(error.sender).toBe(sender.address().toString());
            expect(error.sequenceNumber).toBe(7n);
            expect(error.expirationTimestampSecs).toBe(EXPIRATION);
            expect(error.cause).toBeInstanceOf(causeClass);
            expect(error.waitError).toBeUndefined();
            expect(error.message).toContain(derived);
            expect(error.message).toContain("may have accepted");
            expect(error.message).toContain("before resending");
            expect(JSON.parse(JSON.stringify(error))).toEqual({
                name: "SupraSubmissionOutcomeUnknownError",
                message: error.message,
                hash: derived,
                sender: sender.address().toString(),
                sequenceNumber: "7",
                expirationTimestampSecs: EXPIRATION.toString(),
            });
            // Without a wait, the transaction is not read.
            expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
                "POST /transactions/submit",
            ]);
        },
    );

    it.each(MAY_HAVE_ACCEPTED)(
        "that %s, with enableWaitForTransaction, resolves to the transaction committed under the derived hash",
        async (_name, submit) => {
            const sender = new SupraAccount();
            const rawTxn = rawTransfer(sender);
            const derived = supra.transaction.deriveTransactionHash({
                signedTransaction: await rawTxn.signedTransaction(sender),
            });
            const requests = stubNode({
                submit,
                reads: [json({ message: "Not Found" }, 404), json(moveTxn(derived, TransactionStatus.Success))],
            });

            const committed = await rawTxn.submitTransaction({
                senderAccount: sender,
                enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true, waitTimeoutMs: 10_000 },
            });

            expect(committed).toMatchObject({ hash: derived, status: TransactionStatus.Success });
            const reads = requests.filter((request) => request.method === "GET");
            expect(reads.every((request) => request.path === `/transactions/${derived}`)).toBe(true);
        },
    );

    it("is derived from the transaction a signature made elsewhere signs", async () => {
        stubNode({ submit: () => new TypeError("fetch failed"), reads: [json({ message: "Not Found" }, 404)] });
        const sender = new SupraAccount();
        const rawTxn = rawTransfer(sender);
        const signed = await rawTxn.signedTransaction(sender);

        const error = (await rejection(
            rawTxn.submitTransactionAndSignature({
                senderPubkey: sender.pubKey(),
                signature: await rawTxn.signTransaction(sender),
            }),
        )) as SupraSubmissionOutcomeUnknownError;

        expect(error).toBeInstanceOf(SupraSubmissionOutcomeUnknownError);
        expect(error.hash).toBe(supra.transaction.deriveTransactionHash({ signedTransaction: signed }));
    });

    it("with enableWaitForTransaction, resolves to the transaction committed under the derived hash", async () => {
        const sender = new SupraAccount();
        const rawTxn = rawTransfer(sender);
        const derived = supra.transaction.deriveTransactionHash({
            signedTransaction: await rawTxn.signedTransaction(sender),
        });
        const requests = stubNode({
            submit: () => "timeout",
            reads: [
                json({ message: "Not Found" }, 404),
                json(moveTxn(derived, TransactionStatus.Pending)),
                json(moveTxn(derived, TransactionStatus.Success)),
            ],
        });

        const committed = await rawTxn.submitTransaction({
            senderAccount: sender,
            enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true, waitTimeoutMs: 10_000 },
        });

        expect(committed).toMatchObject({ hash: derived, status: TransactionStatus.Success });
        const reads = requests.filter((request) => request.method === "GET");
        expect(reads.length).toBe(3);
        expect(reads.every((request) => request.path === `/transactions/${derived}`)).toBe(true);
    });

    it("with enableWaitForTransaction, throws SupraTransactionFailedError for a committed failure", async () => {
        const sender = new SupraAccount();
        const rawTxn = rawTransfer(sender);
        const derived = supra.transaction.deriveTransactionHash({
            signedTransaction: await rawTxn.signedTransaction(sender),
        });
        stubNode({
            submit: () => new TypeError("fetch failed"),
            reads: [json(moveTxn(derived, TransactionStatus.Fail, "Out of gas"))],
        });

        const error = (await rejection(
            rawTxn.submitTransaction({
                senderAccount: sender,
                enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true },
            }),
        )) as SupraTransactionFailedError;

        expect(error).toBeInstanceOf(SupraTransactionFailedError);
        expect(error.hash).toBe(derived);
        // checkSuccess: false returns the failed transaction, as after an answered submission.
        await expect(
            rawTxn.submitTransaction({
                senderAccount: sender,
                enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true, checkSuccess: false },
            }),
        ).resolves.toMatchObject({ hash: derived, status: TransactionStatus.Fail });
    });

    it.each(MAY_HAVE_ACCEPTED)(
        "that %s, with enableWaitForTransaction, throws SupraSubmissionOutcomeUnknownError when the wait ends without a final status",
        async (_name, submit, causeClass) => {
            stubNode({ submit, reads: [json({ message: "Not Found" }, 404)] });
            const sender = new SupraAccount();
            const rawTxn = rawTransfer(sender);

            const error = (await rejection(
                rawTxn.submitTransaction({
                    senderAccount: sender,
                    enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true, waitTimeoutMs: 300 },
                }),
            )) as SupraSubmissionOutcomeUnknownError;

            expect(error).toBeInstanceOf(SupraSubmissionOutcomeUnknownError);
            expect(error.cause).toBeInstanceOf(causeClass);
            expect(error.waitError).toBeInstanceOf(SupraTransactionTimeoutError);
            expect(error.waitError?.hash).toBe(error.hash);
            expect(error.waitError?.timeoutMs).toBe(300);
            expect(error.message).toContain("no final status after a wait of 300 ms");
        },
    );
});

describe("a submission the node refuses", () => {
    it.each([
        ["400", json({ message: "Transaction validation failed: invalid signature" }, 400)],
        ["503", json({ message: "Service Unavailable" }, 503)],
    ])("throws the SupraAPIError of a %s", async (status, answer) => {
        stubNode({ submit: () => answer, reads: [json({ message: "Not Found" }, 404)] });
        const sender = new SupraAccount();

        const error = await rejection(rawTransfer(sender).submitTransaction({ senderAccount: sender }));

        expect(error).toBeInstanceOf(SupraAPIError);
        expect(error).not.toBeInstanceOf(SupraSubmissionOutcomeUnknownError);
        expect((error as SupraAPIError).status).toBe(Number(status));
    });
});

describe("the counter's record of a submission without an answer", () => {
    function counterTransfer(client: SupraClient, sender: SupraAccount) {
        return client.coin.transferSupraCoin({
            senderAccount: sender,
            receiverAccountAddress: RECEIVER,
            amount: 1_000n,
            optionalTransactionArgs: { optionalTransactionPayloadArgs: { maxGas: 5_000n } },
        });
    }

    it("keeps the derived hash, and an Invalid read of that hash drops it", async () => {
        const client = new SupraClient({ rpcUrl: RPC_URL, chainId: 255, verifyChainId: false });
        const sender = new SupraAccount();
        const address = standardizeAddress(sender.address().toString());
        let submissions = 0;
        const requests = stubNode({
            submit: () => (++submissions === 1 ? new TypeError("fetch failed") : json("0x" + "ab".repeat(32))),
            reads: [json(moveTxn("0x00", TransactionStatus.Invalid))],
        });

        const error = (await rejection(counterTransfer(client, sender))) as SupraSubmissionOutcomeUnknownError;
        expect(error).toBeInstanceOf(SupraSubmissionOutcomeUnknownError);
        expect(error.sequenceNumber).toBe(5n);
        const tracker = sequenceNumberTrackerOf(client.networkInformation);
        expect(tracker.recorded(address).get(5n)?.hash).toBe(error.hash);

        await client.transaction.getTransactionByHash({ transactionHash: error.hash });
        expect(tracker.recorded(address).has(5n)).toBe(false);

        // The number of the discarded transaction is handed out again.
        await counterTransfer(client, sender);
        const submitted = requests.filter((request) => request.path === "/transactions/submit");
        expect(submitted).toHaveLength(2);
        const sequenceNumbers = submitted.map(
            (request) =>
                (JSON.parse(request.body as string) as { Move: { raw_txn: { sequence_number: number } } }).Move.raw_txn
                    .sequence_number,
        );
        expect(sequenceNumbers).toEqual([5, 5]);
    });

    it.each(MAY_HAVE_ACCEPTED)(
        "for a submission that %s, keeps the hash of the submitted transaction, the one the error reports",
        async (_name, submit) => {
            const client = new SupraClient({ rpcUrl: RPC_URL, chainId: 255, verifyChainId: false, timeoutMs: 50 });
            const sender = new SupraAccount();
            const requests = stubNode({ submit, reads: [json({ message: "Not Found" }, 404)] });

            const error = (await rejection(counterTransfer(client, sender))) as SupraSubmissionOutcomeUnknownError;

            expect(error).toBeInstanceOf(SupraSubmissionOutcomeUnknownError);
            const body = requests.find((request) => request.path === "/transactions/submit")?.body as string;
            const record = sequenceNumberTrackerOf(client.networkInformation)
                .recorded(standardizeAddress(sender.address().toString()))
                .get(5n);
            expect(record?.hash).toBe(hashOfSubmittedBody(body));
            expect(error.hash).toBe(record?.hash);
        },
    );

    it.each([
        ["400", json({ message: "Transaction validation failed: invalid signature" }, 400)],
        ["503", json({ message: "Service Unavailable" }, 503)],
    ])("records nothing for a %s refusal", async (_status, answer) => {
        const client = new SupraClient({ rpcUrl: RPC_URL, chainId: 255, verifyChainId: false });
        const sender = new SupraAccount();
        stubNode({ submit: () => answer, reads: [json({ message: "Not Found" }, 404)] });

        await expect(counterTransfer(client, sender)).rejects.toBeInstanceOf(SupraAPIError);

        expect(
            sequenceNumberTrackerOf(client.networkInformation).recorded(standardizeAddress(sender.address().toString()))
                .size,
        ).toBe(0);
    });
});

describe("a transaction signed again before its submission", () => {
    it("reports the hash of the transaction signed again", async () => {
        const mock = new MockNode();
        node = mock;
        const clock = new ClientClock();
        const supraClient = newClient();
        const sender = new SupraAccount();
        const later = () => BigInt(mock.blockSeconds() + 500);
        const options = { maxGas: 5_000n, simulate: true };
        // The fourth submission request fails before the node answers.
        let submissions = 0;
        let failedBody: string | undefined;
        global.fetch = ((input: string | URL | Request, init?: RequestInit) => {
            if (new URL(String(input)).pathname.endsWith("/transactions/submit") && ++submissions === 4) {
                failedBody = String(init?.body);
                return Promise.reject(new TypeError("fetch failed"));
            }
            return mock.fetch(input, init);
        }) as typeof fetch;

        await transfer(supraClient, sender, { ...options, txExpiryTime: later() });
        await transfer(supraClient, sender, options);
        await transfer(supraClient, sender, { ...options, txExpiryTime: later() });
        // 6 expires on the chain, so the next transfer takes 8, is simulated at 8 and signed again with 6.
        clock.offsetMs += 60_000;
        clock.monotonicOffsetMs += 60_000;
        mock.advance(61_000);

        const error = (await rejection(
            transfer(supraClient, sender, { ...options, txExpiryTime: later() }),
        )) as SupraSubmissionOutcomeUnknownError;

        expect(mock.log.filter((line) => line.startsWith("SIMULATE"))).toContain(
            "SIMULATE 8 (chain 5) -> PendingAfterExecution",
        );
        expect(error).toBeInstanceOf(SupraSubmissionOutcomeUnknownError);
        expect(error.sequenceNumber).toBe(6n);
        expect(failedBody).toBeDefined();
        expect(error.hash).toBe(hashOfSubmittedBody(failedBody as string));
    });
});
