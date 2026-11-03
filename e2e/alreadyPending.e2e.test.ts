import type { MoveFunctionId, SupraAccount, SubmitTransactionResponse } from "../src/index";
import { BCS, SupraAPIError, SupraClient, SupraSubmissionOutcomeUnknownError, TransactionStatus } from "../src/index";
import { createFundedAccount, createUnfundedAccount } from "./helpers/accounts";
import { describeE2E, nodeGeneration } from "./helpers/describe";
import { getE2EContext, type E2EContext } from "./helpers/env";
import { rawSupraBalance, rawWaitForCommit } from "./helpers/raw";

/**
 * The same signed transaction submitted again while the first submission is pending: the node refuses the copy (v12
 * `transaction <hash> is already pending`, v11.7 `Already scheduled digest=<hash>, ...`). On v12 the SDK returns the
 * transaction's hash for every submission; on v11.7, whose node does not forward the copy, a copy that finds the
 * transaction pending is an unknown outcome (`SupraSubmissionOutcomeUnknownError` with the hash, or a wait for it).
 * The transaction commits once. A helper call whose number came from the client's counter and whose transaction is
 * the same as another client's pending one keeps that number taken and sends its transaction with the next number.
 *
 * A copy can reach the node after the first submission has committed; the node then refuses it as a number below the
 * account's. The tests accept that outcome and check that the transaction commits once either way.
 */

const SUPRA_ACCOUNT_TRANSFER = "0x1::supra_account::transfer" as MoveFunctionId;
const AMOUNT = 1_000n;

/** A submission request's answer as the node gave it. */
interface SubmitAnswer {
    status: number;
    body: unknown;
}

/**
 * Runs `submit` with `fetch` wrapped so that the node's answers to submission requests are recorded, and returns them
 * with the settled results of the calls.
 */
async function recordingSubmissions(
    submit: () => Array<Promise<SubmitTransactionResponse>>,
): Promise<{ results: Array<PromiseSettledResult<SubmitTransactionResponse>>; answers: SubmitAnswer[] }> {
    const realFetch = global.fetch;
    const answers: SubmitAnswer[] = [];
    global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const response = await realFetch(input, init);
        const isSubmit =
            (init?.method ?? "GET") === "POST" && new URL(String(input)).pathname.endsWith("/transactions/submit");
        if (isSubmit) {
            const text = await response.clone().text();
            let body: unknown;
            try {
                body = JSON.parse(text) as unknown;
            } catch {
                body = text;
            }
            answers.push({ status: response.status, body });
        }
        return response;
    }) as typeof fetch;
    try {
        return { results: await Promise.allSettled(submit()), answers };
    } finally {
        global.fetch = realFetch;
    }
}

/** The message the node gives for a copy of a pending transaction, naming `hash` as it writes it. */
function duplicateMessage(hash: string): RegExp {
    const digits = hash.replace(/^0x/, "");
    return nodeGeneration() === "v11"
        ? new RegExp(`^Transaction validation failed: Already scheduled digest=${digits}, sender=`)
        : new RegExp(`^Transaction validation failed: transaction ${digits} is already pending$`);
}

/** The message the node gives for a number below the account's: the transaction with that number has committed. */
const BELOW_ACCOUNT_MESSAGE =
    /^Transaction validation failed: (?:sequence number \d+ is below the account's next sequence number \d+|.* has sequence number \d+ but the expected sequence number is \d+)/;

/** The message of a refusal of the submission. */
function messageOf(answer: SubmitAnswer): string {
    return (answer.body as { message: string }).message;
}

describeE2E("the same signed transaction submitted again while it is pending", () => {
    let ctx: E2EContext;
    let gasUnitPrice: bigint;

    beforeAll(async () => {
        ctx = await getE2EContext();
        gasUnitPrice = await ctx.supra.getMinGasUnitPrice();
    });

    async function sequenceNumberOf(account: SupraAccount): Promise<bigint> {
        return BigInt((await ctx.supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number);
    }

    /** A transfer of `amount` from `sender` to `receiver`, signed once, and its submission with `wait`. */
    async function signedTransfer(sender: SupraAccount, receiver: SupraAccount, amount = AMOUNT) {
        const rawTxn = ctx.supra.transaction.build.rawTxnObject({
            senderAddress: sender.address(),
            senderSequenceNumber: await sequenceNumberOf(sender),
            function: SUPRA_ACCOUNT_TRANSFER,
            functionTypeArgs: [],
            functionArgs: [receiver.address().toUint8Array(), BCS.bcsSerializeUint64(amount)],
            optionalTransactionPayloadArgs: { maxGas: 5_000n, gasUnitPrice },
        });
        const signature = await ctx.supra.transaction.signTransaction({ senderAccount: sender, rawTxn });
        const serializedRawTransaction = BCS.bcsToBytes(rawTxn);
        return (wait = false) =>
            ctx.supra.transaction.submit.submitSerializedRawTransactionAndSignature({
                senderPubkey: sender.pubKey(),
                signature,
                serializedRawTransaction,
                enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: wait, waitTimeoutMs: 120_000 },
            });
    }

    /**
     * Checks the outcome of submissions of one signed transaction, and that it committed once: the sender's sequence
     * number moved by one and the receiver holds `AMOUNT`.
     *
     * The node accepted one submission and refused every other one as a copy of a pending transaction naming its hash,
     * or as a number below the account's (the copy arrived after the commit). Each call returned the hash, or threw:
     * on v11.7, `SupraSubmissionOutcomeUnknownError` with the hash for a copy refused while the transaction was
     * pending; and `SupraAPIError` for a copy refused after the commit.
     */
    async function expectOneCommit(
        outcome: Awaited<ReturnType<typeof recordingSubmissions>>,
        sender: SupraAccount,
        receiver: SupraAccount,
        sequenceNumberBefore: bigint,
    ): Promise<string> {
        const accepted = outcome.answers.filter((answer) => answer.status === 200);
        expect(accepted).toHaveLength(1);
        const hash = (accepted[0] as SubmitAnswer).body as string;
        expect(hash).toMatch(/^0x[0-9a-fA-F]{64}$/);
        const lowerHash = hash.toLowerCase();
        for (const refusal of outcome.answers.filter((answer) => answer.status !== 200)) {
            expect(refusal.status).toBe(400);
            const message = messageOf(refusal);
            if (!BELOW_ACCOUNT_MESSAGE.test(message)) {
                expect(message).toMatch(duplicateMessage(lowerHash));
            }
        }

        for (const result of outcome.results) {
            if (result.status === "fulfilled") {
                expect(result.value.hash).toBe(lowerHash);
                continue;
            }
            const error: unknown = result.reason;
            if (error instanceof SupraSubmissionOutcomeUnknownError) {
                expect(nodeGeneration()).toBe("v11");
                expect(error.hash).toBe(lowerHash);
                expect(error.cause).toBeInstanceOf(SupraAPIError);
                expect((error.cause as SupraAPIError).message).toMatch(duplicateMessage(lowerHash));
            } else {
                expect(error).toBeInstanceOf(SupraAPIError);
                expect((error as SupraAPIError).message).toMatch(BELOW_ACCOUNT_MESSAGE);
            }
        }

        const committed = await rawWaitForCommit(ctx, lowerHash);
        expect(committed.status).toBe(TransactionStatus.Success);
        expect(await sequenceNumberOf(sender)).toBe(sequenceNumberBefore + 1n);
        expect(await rawSupraBalance(ctx, receiver.address().toString())).toBe(AMOUNT);
        return lowerHash;
    }

    test("a copy submitted right after the first submission is answered, and the transaction commits once", async () => {
        const sender = await createFundedAccount(ctx);
        const receiver = createUnfundedAccount();
        const before = await sequenceNumberOf(sender);
        const submit = await signedTransfer(sender, receiver);

        const outcome = await recordingSubmissions(() => {
            const first = submit();
            return [first, first.then(() => submit())];
        });

        expect(outcome.answers).toHaveLength(2);
        expect(outcome.results[0]?.status).toBe("fulfilled");
        await expectOneCommit(outcome, sender, receiver, before);
    });

    test("five concurrent submissions, without a wait and with one, and the transaction commits once", async () => {
        for (const wait of [false, true]) {
            const sender = await createFundedAccount(ctx);
            const receiver = createUnfundedAccount();
            const before = await sequenceNumberOf(sender);
            const submit = await signedTransfer(sender, receiver);

            const outcome = await recordingSubmissions(() => Array.from({ length: 5 }, () => submit(wait)));

            expect(outcome.answers).toHaveLength(5);
            const hash = await expectOneCommit(outcome, sender, receiver, before);
            if (wait) {
                // A wait for the hash returns the committed transaction, whatever the answer to the submission.
                for (const result of outcome.results) {
                    if (result.status === "fulfilled") {
                        expect(result.value).toMatchObject({ hash, status: TransactionStatus.Success });
                    } else {
                        expect(result.reason).toBeInstanceOf(SupraAPIError);
                    }
                }
            }
        }
    });

    test("a helper call that builds the same transaction as another client's pending one sends its own with the next number", async () => {
        const sender = await createFundedAccount(ctx);
        const receiver = createUnfundedAccount();
        const before = await sequenceNumberOf(sender);
        const transfer = (client: SupraClient, txExpiryTime: bigint) =>
            client.coin.transferSupraCoin({
                senderAccount: sender,
                receiverAccountAddress: receiver.address(),
                amount: AMOUNT,
                optionalTransactionArgs: {
                    optionalTransactionPayloadArgs: { maxGas: 5_000n, gasUnitPrice, txExpiryTime },
                },
            });
        const txExpiryTime = BigInt(Math.floor(Date.now() / 1000) + 120);
        const pending = await transfer(new SupraClient({ rpcUrl: ctx.rpcUrl, chainId: ctx.chainId }), txExpiryTime);

        const outcome = await recordingSubmissions(() => [
            transfer(new SupraClient({ rpcUrl: ctx.rpcUrl, chainId: ctx.chainId }), txExpiryTime),
        ]);

        const result = outcome.results[0] as PromiseSettledResult<SubmitTransactionResponse>;
        expect(result.status).toBe("fulfilled");
        const own = (result as PromiseFulfilledResult<SubmitTransactionResponse>).value.hash;
        expect(own).not.toBe(pending.hash);
        // The copy of the pending transaction was refused and the helper's transaction sent with the next number; or
        // the pending transaction had committed and the helper read the next number from the chain.
        const statuses = outcome.answers.map((answer) => answer.status);
        if (statuses.length === 2) {
            expect(statuses).toEqual([400, 200]);
            expect(messageOf(outcome.answers[0] as SubmitAnswer)).toMatch(duplicateMessage(pending.hash));
        } else {
            expect(statuses).toEqual([200]);
        }
        for (const hash of [pending.hash, own]) {
            expect((await rawWaitForCommit(ctx, hash)).status).toBe(TransactionStatus.Success);
        }
        expect(await sequenceNumberOf(sender)).toBe(before + 2n);
        expect(await rawSupraBalance(ctx, receiver.address().toString())).toBe(2n * AMOUNT);
    });

    test("another transaction with the same sequence number is still refused", async () => {
        const sender = await createFundedAccount(ctx);
        const receiver = createUnfundedAccount();
        const before = await sequenceNumberOf(sender);
        const submitFirst = await signedTransfer(sender, receiver);
        const submitOther = await signedTransfer(sender, receiver, AMOUNT + 1n);

        const first = await submitFirst();
        const outcome = await recordingSubmissions(() => [submitOther()]);

        const result = outcome.results[0] as PromiseSettledResult<SubmitTransactionResponse>;
        expect(result.status).toBe("rejected");
        const error = (result as PromiseRejectedResult).reason as SupraAPIError;
        expect(error).toBeInstanceOf(SupraAPIError);
        expect(error.status).toBe(400);
        // A v11.7 node names the refused transaction, not the pending one; a v12 node names the sequence number. After
        // the first transaction has committed, both refuse the number as below the account's.
        if (!BELOW_ACCOUNT_MESSAGE.test(error.message)) {
            expect(error.message).toMatch(
                nodeGeneration() === "v11"
                    ? /^Transaction validation failed: Already scheduled digest=[0-9a-f]{64}, sender=/
                    : /^Transaction validation failed: a transaction with sequence number \d+ is already pending for this account/,
            );
        }
        expect(error.message).not.toContain(first.hash.replace(/^0x/, ""));
        const committed = await rawWaitForCommit(ctx, first.hash);
        expect(committed.status).toBe(TransactionStatus.Success);
        expect(await sequenceNumberOf(sender)).toBe(before + 1n);
        expect(await rawSupraBalance(ctx, receiver.address().toString())).toBe(AMOUNT);
    });
});
