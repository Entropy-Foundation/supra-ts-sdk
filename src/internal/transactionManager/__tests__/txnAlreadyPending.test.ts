import { BCS, HexString, SupraAccount } from "supra-l1-sdk-core";
import { SupraClient } from "../../../api/supraClient";
import { SupraAPIError } from "../../../errors/apiError";
import { SupraSubmissionOutcomeUnknownError } from "../../../errors/transactionError";
import { TransactionStatus } from "../../../types/transaction";
import type { SubmitTransactionResponse } from "../../../types/transactionManager/transactionSubmit";
import { POOLED_TRANSACTION_READ_TIMEOUT_MS } from "../txnSubmit";
import { MockNode, type MockNodeOptions } from "./helpers/mockNode";
import { RECEIVER, RPC_URL, newClient, transfer } from "./helpers/transfers";

/**
 * Submissions that the node refuses because its pool already holds the submitted transaction: the v12
 * `transaction <hash> is already pending`, after which a v12 node has forwarded the transaction again, and the v11.7
 * `Already scheduled digest=<hash>, ...`, which a v11.7 node gives also when its pool holds another transaction with
 * the number, and after which it does not forward the transaction (the SDK then reads the hash).
 */

const originalFetch = global.fetch;
let node: MockNode | undefined;

function start(options: MockNodeOptions = {}): MockNode {
    node?.stop();
    const started = new MockNode({ latencyMs: [1, 1], ...options });
    node = started;
    global.fetch = started.fetch;
    return started;
}

afterEach(() => {
    node?.stop();
    node = undefined;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
});

const GAS_UNIT_PRICE = 100_000n;
const MAX_GAS = 5_000n;
const GAS = { maxGas: MAX_GAS, gasUnitPrice: GAS_UNIT_PRICE };

const v12Message = (hash: string) => `Transaction validation failed: transaction ${hash.slice(2)} is already pending`;
const v11Message = (hash: string) =>
    `Transaction validation failed: Already scheduled digest=${hash.slice(2)}, sender=0x1, sequence_number=5`;

/** A transfer from `sender` with `sequenceNumber`, built with explicit gas and expiration, so that it signs the same. */
function transferTxn(
    supra: SupraClient,
    mock: MockNode,
    sender: SupraAccount,
    sequenceNumber: bigint,
    amount = 1_000n,
) {
    return supra.transaction.build.rawTxnObject({
        senderAddress: sender.address(),
        senderSequenceNumber: sequenceNumber,
        function: "0x1::supra_account::transfer",
        functionTypeArgs: [],
        functionArgs: [new HexString(RECEIVER).toUint8Array(), BCS.bcsSerializeUint64(amount)],
        optionalTransactionPayloadArgs: { ...GAS, txExpiryTime: BigInt(mock.blockSeconds() + 500) },
    });
}

/** The hashes of the settled submissions, or the names of their errors. */
async function settled(calls: Array<Promise<SubmitTransactionResponse>>): Promise<string[]> {
    return (await Promise.allSettled(calls)).map((result) =>
        result.status === "fulfilled" ? result.value.hash : (result.reason as Error).name,
    );
}

/** An answer to a read of a transaction by hash: a status and body, or no answer until the request is aborted. */
type ReadAnswer = { status: number; body: unknown } | "hang";

/**
 * Answers the next reads of a transaction by hash with `answers`, in order, and passes every other request to `mock`.
 * Returns the paths of the reads it answered.
 */
function answerReads(mock: MockNode, answers: ReadAnswer[]): string[] {
    const reads: string[] = [];
    global.fetch = ((input: string | URL | Request, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        const answer = /^\/rpc\/v3\/transactions\/0x[0-9a-f]{64}$/.test(path) ? answers.shift() : undefined;
        if (answer === undefined) {
            return mock.fetch(input, init);
        }
        reads.push(path);
        if (answer === "hang") {
            return new Promise<Response>((_, reject) => {
                init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
            });
        }
        return Promise.resolve(
            new Response(JSON.stringify(answer.body), {
                status: answer.status,
                headers: { "Content-Type": "application/json" },
            }),
        );
    }) as typeof fetch;
    return reads;
}

describe("the same signed transaction submitted again to a v12 node", () => {
    it("returns the hash both times, and the transaction commits once", async () => {
        const mock = start();
        const supra = newClient();
        const sender = new SupraAccount();
        const txn = transferTxn(supra, mock, sender, 5n);

        const first = await txn.submitTransaction({ senderAccount: sender });
        const second = await txn.submitTransaction({ senderAccount: sender });

        const hash = mock.submissionHash(5);
        expect(first).toMatchObject({ hash, status: TransactionStatus.Pending });
        expect(second).toMatchObject({ hash, status: TransactionStatus.Pending });
        expect(mock.submissions.map((submission) => submission.status)).toEqual([200, 400]);
        // One read-back per call, and no other read.
        expect(mock.counts["transaction"]).toBe(2);
        mock.tick();
        expect([...mock.committed]).toEqual([[hash, 5]]);
    });

    it("returns the hash to each of concurrent submissions", async () => {
        const mock = start();
        const supra = newClient();
        const sender = new SupraAccount();
        const txn = transferTxn(supra, mock, sender, 5n);
        const signature = await supra.transaction.signTransaction({ senderAccount: sender, rawTxn: txn });

        const hashes = await settled(
            Array.from({ length: 4 }, () =>
                txn.submitTransactionAndSignature({ senderPubkey: sender.pubKey(), signature }),
            ),
        );

        expect(hashes).toEqual(Array(4).fill(mock.submissionHash(5)));
        expect(mock.submissions.map((submission) => submission.status)).toEqual([200, 400, 400, 400]);
    });

    it("keeps the number taken: the client's next helper call takes the number after it", async () => {
        const mock = start();
        const sender = new SupraAccount();
        // Another client submits the transaction first; this client's counter has no record of it. Both clients
        // submit the same raw transaction, so that they sign the same bytes.
        const rawTxn = transferTxn(newClient(), mock, sender, 5n);
        await rawTxn.submitTransaction({ senderAccount: sender });
        const supra = newClient();

        const duplicate = await supra.transaction.submit.submitRawTransaction({
            senderAccount: sender,
            rawTransaction: rawTxn,
        });
        const next = await transfer(supra, sender, GAS);

        expect(duplicate.hash).toBe(mock.submissionHash(5));
        expect(next.hash).toBe(mock.submissionHash(6));
        expect(mock.submitted).toEqual([5, 5, 6]);
        expect(mock.submissions.map((submission) => submission.status)).toEqual([200, 400, 200]);
    });

    it("returns the hash of a helper call with sequenceNumber whose transaction is pending", async () => {
        const mock = start();
        const supra = newClient();
        const sender = new SupraAccount();
        const call = { ...GAS, txExpiryTime: BigInt(mock.blockSeconds() + 500) };

        const first = await transfer(supra, sender, { ...call, sequenceNumber: 5n });
        const second = await transfer(supra, sender, { ...call, sequenceNumber: 5n });

        expect(first.hash).toBe(mock.submissionHash(5));
        expect(second.hash).toBe(first.hash);
        expect(mock.submissions.map((submission) => submission.status)).toEqual([200, 400]);
    });
});

describe("the same signed transaction submitted again to a v11.7 node", () => {
    it("throws SupraSubmissionOutcomeUnknownError while the node's pool holds it, and keeps its number taken", async () => {
        const mock = start({ duplicateMessages: "v11" });
        const sender = new SupraAccount();
        const rawTxn = transferTxn(newClient(), mock, sender, 5n);
        await rawTxn.submitTransaction({ senderAccount: sender });
        const supra = newClient();

        const error = await supra.transaction.submit
            .submitRawTransaction({ senderAccount: sender, rawTransaction: rawTxn })
            .catch((e: unknown) => e);
        const next = await transfer(supra, sender, GAS);

        expect(error).toBeInstanceOf(SupraSubmissionOutcomeUnknownError);
        expect((error as SupraSubmissionOutcomeUnknownError).hash).toBe(mock.submissionHash(5));
        const cause = (error as SupraSubmissionOutcomeUnknownError).cause;
        expect(cause).toBeInstanceOf(SupraAPIError);
        expect((cause as SupraAPIError).message).toMatch(/Already scheduled/);
        expect(next.hash).toBe(mock.submissionHash(6));
        // The read-back of the first submission, the read after the refusal and the read-back of the next call.
        expect(mock.counts["transaction"]).toBe(3);
        mock.tick();
        expect([...mock.committed.values()]).toEqual([5, 6]);
    });

    it("returns the hash when the read shows the transaction committed", async () => {
        const mock = start({ duplicateMessages: "v11" });
        const supra = newClient();
        const sender = new SupraAccount();
        const txn = transferTxn(supra, mock, sender, 5n);
        await txn.submitTransaction({ senderAccount: sender });
        mock.tick();
        mock.refuseNext.set(5, { status: 400, message: v11Message });

        const again = await txn.submitTransaction({ senderAccount: sender });

        expect(again).toMatchObject({ hash: mock.submissionHash(5), status: TransactionStatus.Success });
        expect(mock.committed.size).toBe(1);
    });

    it("throws the refusal when the read returns Invalid", async () => {
        const mock = start({ duplicateMessages: "v11" });
        const supra = newClient();
        const sender = new SupraAccount();
        const txn = transferTxn(supra, mock, sender, 5n);
        await txn.submitTransaction({ senderAccount: sender });
        mock.drop(5, "Invalid");
        mock.refuseNext.set(5, { status: 400, message: v11Message });

        const error = await txn.submitTransaction({ senderAccount: sender }).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(SupraAPIError);
        expect((error as SupraAPIError).message).toMatch(/Already scheduled/);
        // The read-back of the first submission and the read after the refusal.
        expect(mock.counts["transaction"]).toBe(2);
    });

    it.each([
        ["a 500", [{ status: 500, body: { message: "Internal Server Error" } }] as ReadAnswer[], {}],
        [
            "a 503, which is not retried under the client's retry policy",
            [
                { status: 503, body: { message: "Service Unavailable" } },
                { status: 503, body: { message: "Service Unavailable" } },
            ] as ReadAnswer[],
            { retry: { attempts: 3, maxDelayMs: 10 } },
        ],
        ["a timeout", ["hang"] as ReadAnswer[], { timeoutMs: 300 }],
    ])(
        "throws SupraSubmissionOutcomeUnknownError when the read fails with %s",
        async (_name, answers, clientConfig) => {
            const mock = start({ duplicateMessages: "v11" });
            const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255, ...clientConfig });
            const sender = new SupraAccount();
            const txn = transferTxn(supra, mock, sender, 5n);
            await txn.submitTransaction({ senderAccount: sender });
            const reads = answerReads(mock, answers);

            const error = await txn.submitTransaction({ senderAccount: sender }).catch((e: unknown) => e);

            expect(error).toBeInstanceOf(SupraSubmissionOutcomeUnknownError);
            expect((error as SupraSubmissionOutcomeUnknownError).hash).toBe(mock.submissionHash(5));
            expect(reads).toHaveLength(1);
        },
    );

    it(`reads the transaction with a timeout of at most ${POOLED_TRANSACTION_READ_TIMEOUT_MS} ms`, async () => {
        const mock = start({ duplicateMessages: "v11" });
        const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255, timeoutMs: 60_000 });
        const sender = new SupraAccount();
        const txn = transferTxn(supra, mock, sender, 5n);
        await txn.submitTransaction({ senderAccount: sender });
        const timeouts = jest.spyOn(AbortSignal, "timeout");

        await txn.submitTransaction({ senderAccount: sender }).catch((e: unknown) => e);

        // The submission with the client's timeout, then the read with the bound.
        expect(timeouts.mock.calls.map(([ms]) => ms)).toEqual([60_000, POOLED_TRANSACTION_READ_TIMEOUT_MS]);
    });
});

describe.each([
    ["v12", "v12" as const],
    ["v11.7", "v11" as const],
])("the same signed transaction submitted again to a %s node", (_name, duplicateMessages) => {
    it("waits for the transaction with enableWaitForTransaction", async () => {
        const mock = start({ duplicateMessages });
        const supra = newClient();
        const sender = new SupraAccount();
        const txn = transferTxn(supra, mock, sender, 5n);
        await txn.submitTransaction({ senderAccount: sender });

        const waiting = txn.submitTransaction({
            senderAccount: sender,
            enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true, waitTimeoutMs: 5_000 },
        });
        setTimeout(() => mock.tick(), 100);

        expect(await waiting).toMatchObject({ hash: mock.submissionHash(5), status: TransactionStatus.Success });
        expect(mock.committed.size).toBe(1);
    });

    it("keeps the number of a pending transaction that another call built the same, and sends a helper call's transaction with the next number", async () => {
        const mock = start({ duplicateMessages });
        const sender = new SupraAccount();
        const call = { ...GAS, txExpiryTime: BigInt(mock.blockSeconds() + 500) };
        // Another client sends the same transfer first, with the same number.
        const pending = await transfer(newClient(), sender, call);
        const supra = newClient();

        const result = await transfer(supra, sender, call);
        const next = await transfer(supra, sender, call);

        expect(pending.hash).toBe(mock.submissionHash(5));
        expect(result.hash).toBe(mock.submissionHash(6));
        expect(next.hash).toBe(mock.submissionHash(7));
        expect(mock.submitted).toEqual([5, 5, 6, 7]);
        expect(mock.submissions.map((submission) => submission.status)).toEqual([200, 400, 200, 200]);
        // The refusal of 5 made the client read the chain again before the next number.
        expect(mock.counts["account"]).toBe(3);
        mock.tick();
        expect([...mock.committed.values()]).toEqual([5, 6, 7]);
    });
});

describe("a refusal that does not show the submitted transaction pending", () => {
    it.each([
        ["v12, naming another transaction", "v12" as const],
        ["v11.7, naming the submitted transaction while another one holds the number", "v11" as const],
    ])("is thrown for a signed transaction whose number another transaction holds (%s)", async (_name, messages) => {
        const mock = start({ duplicateMessages: messages });
        const supra = newClient();
        const sender = new SupraAccount();
        await transferTxn(supra, mock, sender, 5n).submitTransaction({ senderAccount: sender });

        const error = await transferTxn(supra, mock, sender, 5n, 2_000n)
            .submitTransaction({ senderAccount: sender })
            .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(SupraAPIError);
        expect((error as SupraAPIError).message).toMatch(
            messages === "v12" ? /a transaction with sequence number 5 is already pending/ : /Already scheduled/,
        );
        mock.tick();
        expect([...mock.committed.values()]).toEqual([5]);
    });

    it.each([
        ["v12, naming another hash", () => v12Message("0x" + "6f".repeat(32)), 0],
        ["v11.7, naming another hash", () => v11Message("0x" + "6f".repeat(32)), 0],
        ["v11.7, naming the call's own transaction, which the node does not hold", () => v11Message, 1],
    ])(
        "makes a helper read the chain and send its transaction once more (%s)",
        async (_name, message: () => string | ((hash: string) => string), reads: number) => {
            const mock = start();
            const supra = newClient();
            const sender = new SupraAccount();
            mock.refuseNext.set(5, { status: 400, message: message() });

            const result = await transfer(supra, sender, GAS);

            expect(result.hash).toBe(mock.submissionHash(5));
            expect(mock.submissions.map((submission) => submission.status)).toEqual([400, 200]);
            expect(mock.counts["account"]).toBe(2);
            // The reads of the refused transaction's hash (404), and the read-back of the accepted one.
            expect(mock.counts["transaction"]).toBe(reads + 1);
        },
    );
});
