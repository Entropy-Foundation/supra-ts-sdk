import type { MoveFunctionId, SupraAccount, SubmitTransactionResponse } from "../src/index";
import { BCS, SupraAPIError, SupraClient, TransactionStatus } from "../src/index";
import { createFundedAccount, createUnfundedAccount } from "./helpers/accounts";
import { describeE2E, nodeGeneration } from "./helpers/describe";
import { getE2EContext, type E2EContext } from "./helpers/env";
import { rawSupraBalance, rawWaitForCommit } from "./helpers/raw";

/**
 * The same signed transaction submitted again while the first submission is pending: the node refuses the copy (v12
 * `transaction <hash> is already pending`, v11.7 `Already scheduled digest=<hash>, ...`), and the SDK returns the
 * transaction's hash for every submission. The transaction commits once. A helper call whose number came from the
 * client's counter and whose transaction is the same as another client's pending one keeps that number taken and sends
 * its transaction with the next number.
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

    /** A transfer of `amount` from `sender` to `receiver`, signed once. */
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
        return () =>
            ctx.supra.transaction.submit.submitSerializedRawTransactionAndSignature({
                senderPubkey: sender.pubKey(),
                signature,
                serializedRawTransaction,
            });
    }

    /**
     * Checks that every call returned the same hash, that the node refused at least one copy naming that hash, and
     * that the transaction committed once: the sender's sequence number moved by one and the receiver holds `AMOUNT`.
     */
    async function expectOneCommit(
        outcome: Awaited<ReturnType<typeof recordingSubmissions>>,
        sender: SupraAccount,
        receiver: SupraAccount,
        sequenceNumberBefore: bigint,
    ): Promise<void> {
        const rejected = outcome.results.filter((result) => result.status === "rejected");
        expect(rejected.map((result) => (result as PromiseRejectedResult).reason as unknown)).toEqual([]);
        const hashes = outcome.results.map(
            (result) => (result as PromiseFulfilledResult<SubmitTransactionResponse>).value.hash,
        );
        const hash = hashes[0] as string;
        expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
        expect(hashes).toEqual(Array(hashes.length).fill(hash));

        expect(outcome.answers.filter((answer) => answer.status === 200)).toHaveLength(1);
        const refusals = outcome.answers.filter((answer) => answer.status !== 200);
        expect(refusals.length).toBeGreaterThan(0);
        for (const refusal of refusals) {
            expect(refusal.status).toBe(400);
            expect((refusal.body as { message: string }).message).toMatch(duplicateMessage(hash));
        }

        const committed = await rawWaitForCommit(ctx, hash);
        expect(committed.status).toBe(TransactionStatus.Success);
        expect(await sequenceNumberOf(sender)).toBe(sequenceNumberBefore + 1n);
        expect(await rawSupraBalance(ctx, receiver.address().toString())).toBe(AMOUNT);
    }

    test("two submissions one after the other return the same hash, and the transaction commits once", async () => {
        const sender = await createFundedAccount(ctx);
        const receiver = createUnfundedAccount();
        const before = await sequenceNumberOf(sender);
        const submit = await signedTransfer(sender, receiver);

        const outcome = await recordingSubmissions(() => {
            const first = submit();
            return [first, first.then(() => submit())];
        });

        expect(outcome.answers).toHaveLength(2);
        await expectOneCommit(outcome, sender, receiver, before);
    });

    test("five concurrent submissions return the same hash, and the transaction commits once", async () => {
        const sender = await createFundedAccount(ctx);
        const receiver = createUnfundedAccount();
        const before = await sequenceNumberOf(sender);
        const submit = await signedTransfer(sender, receiver);

        const outcome = await recordingSubmissions(() => Array.from({ length: 5 }, () => submit()));

        expect(outcome.answers).toHaveLength(5);
        await expectOneCommit(outcome, sender, receiver, before);
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
        expect(outcome.answers.map((answer) => answer.status)).toEqual([400, 200]);
        expect((outcome.answers[0]?.body as { message: string }).message).toMatch(duplicateMessage(pending.hash));
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
        // A v11.7 node names the refused transaction, not the pending one; a v12 node names the sequence number.
        expect(error.message).toMatch(
            nodeGeneration() === "v11"
                ? /^Transaction validation failed: Already scheduled digest=[0-9a-f]{64}, sender=/
                : /^Transaction validation failed: a transaction with sequence number \d+ is already pending for this account/,
        );
        expect(error.message).not.toContain(first.hash.replace(/^0x/, ""));
        const committed = await rawWaitForCommit(ctx, first.hash);
        expect(committed.status).toBe(TransactionStatus.Success);
        expect(await sequenceNumberOf(sender)).toBe(before + 1n);
        expect(await rawSupraBalance(ctx, receiver.address().toString())).toBe(AMOUNT);
    });
});
