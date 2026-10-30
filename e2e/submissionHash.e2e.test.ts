import type { MoveFunctionId, SupraAccount } from "../src/index";
import {
    BCS,
    HexString,
    SupraAPIError,
    SupraClient,
    SupraNetworkError,
    SupraSubmissionOutcomeUnknownError,
    SupraTimeoutError,
    SupraTransactionFailedError,
    TransactionStatus,
    TxnBuilderTypes,
    standardizeAddress,
} from "../src/index";
import { createFundedAccount, createUnfundedAccount, fundFromFaucet } from "./helpers/accounts";
import { describeE2E } from "./helpers/describe";
import { getE2EContext, type E2EContext } from "./helpers/env";
import { fixtureModuleFor, fixturePackageMetadata } from "./helpers/fixturePackage";
import { rawPost, rawWaitForCommit } from "./helpers/raw";

/**
 * The hash the SDK derives before it submits a transaction is the hash the node gives it, for every kind of
 * transaction the SDK submits. Each submission request reaches the node, and the node's answer is then withheld from
 * the SDK: the connection fails after the answer, the request is held until the client's request timeout, or a 502
 * replaces the answer. The SDK
 * throws `SupraSubmissionOutcomeUnknownError` with the derived hash, which must be the hash in the node's answer, and
 * the transaction must commit under it.
 */

/** `script { fun main(sender: &signer, amount: u64) }`: SUPRA from the sender to the sender. */
const SELF_TRANSFER_SCRIPT =
    "a11ceb0b060000000501000403040a050e0f071d29084620000000010002020300010304010002060c030001060c010503060c0503067369676e65720d73757072615f6163636f756e740a616464726573735f6f66087472616e736665720000000000000000000000000000000000000000000000000000000000000001000001060a000b0011000b01110102";

/** `script { fun main(first: &signer, second: &signer, amount: u64) }`: SUPRA from the first signer to the second. */
const TWO_SIGNER_SCRIPT =
    "a11ceb0b060000000501000403040a050e11071f29084820000000010002020300010304010003060c060c030001060c010503060c0503067369676e65720d73757072615f6163636f756e740a616464726573735f6f66087472616e736665720000000000000000000000000000000000000000000000000000000000000001000001060b000b0111000b02110102";

const SUPRA_ACCOUNT_TRANSFER = "0x1::supra_account::transfer" as MoveFunctionId;

/** The request timeout of the client used with `"timeout"`: longer than every other request of a submission. */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * How the node's answer to the submission is withheld: a failed connection, no answer until the request timeout, or
 * an HTTP 502 from a proxy in its place.
 */
type Withhold = "connection" | "timeout" | "gateway";

interface Outcome {
    /** The hash in the node's answer to the submission request. */
    nodeHash: string;
    /** What the SDK call returned or threw. */
    result: PromiseSettledResult<unknown>;
}

/**
 * Runs `submit` with `fetch` replaced for its first submission request: the request is sent to the node, whose answer
 * is read here, and the SDK sees a failed connection after the answer (`"connection"`), no answer until its request
 * timeout aborts the request (`"timeout"`), or an HTTP 502 after the answer (`"gateway"`). Every other request is sent
 * as it is.
 */
async function withheldSubmission(withhold: Withhold, submit: () => Promise<unknown>): Promise<Outcome> {
    const realFetch = global.fetch;
    let nodeAnswer: Promise<string> | undefined;
    global.fetch = ((input: string | URL | Request, init?: RequestInit) => {
        const isSubmit =
            (init?.method ?? "GET") === "POST" && new URL(String(input)).pathname.endsWith("/transactions/submit");
        if (!isSubmit || nodeAnswer !== undefined) {
            return realFetch(input, init);
        }
        const { signal, ...rest } = init ?? {};
        nodeAnswer = realFetch(input, rest).then(async (response) => {
            const body = (await response.json()) as unknown;
            if (!response.ok || typeof body !== "string") {
                throw new Error(
                    `The node answered the submission with HTTP ${response.status}: ${JSON.stringify(body)}`,
                );
            }
            return body;
        });
        if (withhold === "connection") {
            return nodeAnswer.then(() => Promise.reject(new TypeError("fetch failed")));
        }
        if (withhold === "gateway") {
            return nodeAnswer.then(
                () =>
                    new Response(JSON.stringify({ message: "Bad Gateway" }), {
                        status: 502,
                        headers: { "Content-Type": "application/json" },
                    }),
            );
        }
        return new Promise<Response>((_, reject) => {
            signal?.addEventListener("abort", () => reject(signal.reason));
        });
    }) as typeof fetch;
    let result: PromiseSettledResult<unknown>;
    try {
        result = await submit().then(
            (value) => ({ status: "fulfilled", value }) as const,
            (reason: unknown) => ({ status: "rejected", reason }) as const,
        );
    } finally {
        global.fetch = realFetch;
    }
    if (nodeAnswer === undefined) {
        throw new Error("The call made no submission request");
    }
    return { nodeHash: await nodeAnswer, result };
}

/**
 * Checks that the call threw `SupraSubmissionOutcomeUnknownError` whose derived hash is the node's, and that the
 * transaction commits under that hash with `Success`. Returns the hash.
 */
async function expectDerivedHash(ctx: E2EContext, outcome: Outcome, withhold: Withhold): Promise<string> {
    expect(outcome.result.status).toBe("rejected");
    const error = (outcome.result as PromiseRejectedResult).reason as SupraSubmissionOutcomeUnknownError;
    expect(error).toBeInstanceOf(SupraSubmissionOutcomeUnknownError);
    const causeClass = { connection: SupraNetworkError, timeout: SupraTimeoutError, gateway: SupraAPIError }[withhold];
    expect(error.cause).toBeInstanceOf(causeClass);
    expect(error.hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(error.hash).toBe(outcome.nodeHash.toLowerCase());
    const committed = await ctx.supra.transaction.waitForTransaction({
        transactionHash: error.hash,
        options: { timeoutMs: 180_000 },
    });
    expect(committed.status).toBe(TransactionStatus.Success);
    expect(committed.hash).toBe(error.hash);
    return error.hash;
}

describeE2E("the transaction hash derived before submitting", () => {
    let ctx: E2EContext;
    let gasUnitPrice: bigint;

    beforeAll(async () => {
        ctx = await getE2EContext();
        gasUnitPrice = await ctx.supra.getMinGasUnitPrice();
    });

    async function sequenceNumberOf(account: SupraAccount): Promise<bigint> {
        return BigInt((await ctx.supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number);
    }

    async function transferRawTxn(sender: SupraAccount, client: SupraClient = ctx.supra) {
        return client.transaction.build.rawTxnObject({
            senderAddress: sender.address(),
            senderSequenceNumber: await sequenceNumberOf(sender),
            function: SUPRA_ACCOUNT_TRANSFER,
            functionTypeArgs: [],
            functionArgs: [createUnfundedAccount().address().toUint8Array(), BCS.bcsSerializeUint64(1_000n)],
            optionalTransactionPayloadArgs: { maxGas: 5_000n, gasUnitPrice },
        });
    }

    test("an entry function sent by a transfer helper", async () => {
        const sender = await createFundedAccount(ctx);
        const outcome = await withheldSubmission("connection", () =>
            ctx.supra.coin.transferSupraCoin({
                senderAccount: sender,
                receiverAccountAddress: createUnfundedAccount().address(),
                amount: 1_000n,
            }),
        );
        await expectDerivedHash(ctx, outcome, "connection");
    });

    test("an entry function whose submission request times out", async () => {
        const client = new SupraClient({ rpcUrl: ctx.rpcUrl, chainId: ctx.chainId, timeoutMs: REQUEST_TIMEOUT_MS });
        const sender = await createFundedAccount(ctx);
        const rawTxn = await transferRawTxn(sender, client);
        const outcome = await withheldSubmission("timeout", () => rawTxn.submitTransaction({ senderAccount: sender }));
        await expectDerivedHash(ctx, outcome, "timeout");
    });

    test("an entry function whose submission is answered with a 502", async () => {
        const sender = await createFundedAccount(ctx);
        const rawTxn = await transferRawTxn(sender);
        const outcome = await withheldSubmission("gateway", () => rawTxn.submitTransaction({ senderAccount: sender }));
        await expectDerivedHash(ctx, outcome, "gateway");
    });

    test("with enableWaitForTransaction, a submission without an answer resolves to the committed transaction", async () => {
        const client = new SupraClient({ rpcUrl: ctx.rpcUrl, chainId: ctx.chainId, timeoutMs: REQUEST_TIMEOUT_MS });
        const sender = await createFundedAccount(ctx);
        const rawTxn = await transferRawTxn(sender, client);
        const outcome = await withheldSubmission("timeout", () =>
            rawTxn.submitTransaction({
                senderAccount: sender,
                enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true, waitTimeoutMs: 180_000 },
            }),
        );
        expect(outcome.result.status).toBe("fulfilled");
        const committed = (outcome.result as PromiseFulfilledResult<{ hash: string; status: string }>).value;
        expect(committed.status).toBe(TransactionStatus.Success);
        expect(committed.hash).toBe(outcome.nodeHash.toLowerCase());
    });

    test("an entry function signed elsewhere", async () => {
        const sender = await createFundedAccount(ctx);
        const rawTxn = await transferRawTxn(sender);
        const signature = await ctx.supra.transaction.signTransaction({ senderAccount: sender, rawTxn });
        const outcome = await withheldSubmission("connection", () =>
            rawTxn.submitTransactionAndSignature({ senderPubkey: sender.pubKey(), signature }),
        );
        await expectDerivedHash(ctx, outcome, "connection");
    });

    test("a script", async () => {
        const sender = await createFundedAccount(ctx);
        const rawTxn = ctx.supra.transaction.build.scriptRawTxnObject({
            senderAddress: sender.address(),
            senderSequenceNumber: await sequenceNumberOf(sender),
            scriptCode: new HexString(SELF_TRANSFER_SCRIPT).toUint8Array(),
            scriptTypeArgs: [],
            scriptArgs: [new TxnBuilderTypes.TransactionArgumentU64(1_000n)],
            optionalTransactionPayloadArgs: { maxGas: 5_000n, gasUnitPrice },
        });
        const outcome = await withheldSubmission("connection", () =>
            rawTxn.submitTransaction({ senderAccount: sender }),
        );
        await expectDerivedHash(ctx, outcome, "connection");
    });

    test("a multi-agent script", async () => {
        const sender = await createFundedAccount(ctx);
        const second = await createFundedAccount(ctx);
        const rawTxn = ctx.supra.transaction.build.scriptRawTxnObject({
            senderAddress: sender.address(),
            senderSequenceNumber: await sequenceNumberOf(sender),
            scriptCode: new HexString(TWO_SIGNER_SCRIPT).toUint8Array(),
            scriptTypeArgs: [],
            scriptArgs: [new TxnBuilderTypes.TransactionArgumentU64(2_500n)],
            optionalTransactionPayloadArgs: { maxGas: 5_000n, gasUnitPrice },
        });
        const target = new TxnBuilderTypes.MultiAgentRawTransaction(rawTxn, [
            new TxnBuilderTypes.AccountAddress(second.address().toUint8Array()),
        ]);
        const [senderAuthenticator, secondAuthenticator] = await Promise.all(
            [sender, second].map(
                async (account) =>
                    (await ctx.supra.transaction.signTransaction({
                        senderAccount: account,
                        rawTxn: target,
                    })) as TxnBuilderTypes.AccountAuthenticatorEd25519,
            ),
        );
        const outcome = await withheldSubmission("connection", () =>
            rawTxn.submitMultiAgentTransaction({
                secondarySignersAccountAddress: [second.address().toString()],
                senderAuthenticator: senderAuthenticator as TxnBuilderTypes.AccountAuthenticatorEd25519,
                secondarySignersAuthenticator: [secondAuthenticator as TxnBuilderTypes.AccountAuthenticatorEd25519],
            }),
        );
        await expectDerivedHash(ctx, outcome, "connection");
    });

    test("a fee payer transaction", async () => {
        const sender = await createFundedAccount(ctx);
        const feePayer = await createFundedAccount(ctx);
        const rawTxn = await transferRawTxn(sender);
        const target = new TxnBuilderTypes.FeePayerRawTransaction(
            rawTxn,
            [],
            new TxnBuilderTypes.AccountAddress(feePayer.address().toUint8Array()),
        );
        const [senderAuthenticator, feePayerAuthenticator] = await Promise.all(
            [sender, feePayer].map(
                async (account) =>
                    (await ctx.supra.transaction.signTransaction({
                        senderAccount: account,
                        rawTxn: target,
                    })) as TxnBuilderTypes.AccountAuthenticatorEd25519,
            ),
        );
        const outcome = await withheldSubmission("connection", () =>
            rawTxn.submitSponsorTransaction({
                feePayerAddress: feePayer.address().toString(),
                secondarySignersAccountAddress: [],
                senderAuthenticator: senderAuthenticator as TxnBuilderTypes.AccountAuthenticatorEd25519,
                feePayerAuthenticator: feePayerAuthenticator as TxnBuilderTypes.AccountAuthenticatorEd25519,
                secondarySignersAuthenticator: [],
            }),
        );
        await expectDerivedHash(ctx, outcome, "connection");
    });

    test("multisig: a proposal with its payload, a proposal by hash, and an execution", async () => {
        const owner = await createFundedAccount(ctx);
        const view = await rawPost<{ result: string[] }>(ctx, "/rpc/v3/view", {
            function: "0x1::multisig_account::get_next_multisig_account_address",
            type_arguments: [],
            arguments: [owner.address().toString()],
        });
        const multisigAddress = view.body.result[0] as string;
        const empty = new Uint8Array([0]);
        const create = ctx.supra.transaction.build.rawTxnObject({
            senderAddress: owner.address(),
            senderSequenceNumber: await sequenceNumberOf(owner),
            function: "0x1::multisig_account::create" as MoveFunctionId,
            functionTypeArgs: [],
            functionArgs: [BCS.bcsSerializeUint64(1n), empty, empty, BCS.bcsSerializeUint64(3_600n)],
            optionalTransactionPayloadArgs: { maxGas: 20_000n, gasUnitPrice },
        });
        const created = await create.submitTransaction({
            senderAccount: owner,
            enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true },
        });
        expect(created.status).toBe(TransactionStatus.Success);
        await fundFromFaucet(ctx, multisigAddress);

        const receiver = createUnfundedAccount().address();
        const transferArgs = [receiver.toUint8Array(), BCS.bcsSerializeUint64(4_321n)];
        const proposed = new TxnBuilderTypes.MultiSigTransactionPayload(
            new TxnBuilderTypes.EntryFunction(
                TxnBuilderTypes.ModuleId.fromStr("0x1::supra_account"),
                new TxnBuilderTypes.Identifier("transfer"),
                [],
                transferArgs,
            ),
        );
        const withPayload = ctx.supra.transaction.build.rawTxnObject({
            senderAddress: owner.address(),
            senderSequenceNumber: await sequenceNumberOf(owner),
            function: "0x1::multisig_account::create_transaction" as MoveFunctionId,
            functionTypeArgs: [],
            functionArgs: [
                // The node renders an address without its leading zeros.
                new HexString(standardizeAddress(multisigAddress)).toUint8Array(),
                BCS.bcsSerializeBytes(BCS.bcsToBytes(proposed)),
            ],
            optionalTransactionPayloadArgs: { maxGas: 20_000n, gasUnitPrice },
        });
        await expectDerivedHash(
            ctx,
            await withheldSubmission("connection", () => withPayload.submitTransaction({ senderAccount: owner })),
            "connection",
        );

        const byHash = ctx.supra.transaction.build.multisigProposalTxRawTxnObject({
            senderAddress: owner.address(),
            senderSequenceNumber: await sequenceNumberOf(owner),
            multisigAddress,
            function: SUPRA_ACCOUNT_TRANSFER,
            functionTypeArgs: [],
            functionArgs: transferArgs,
            optionalTransactionPayloadArgs: { maxGas: 20_000n, gasUnitPrice },
        });
        await expectDerivedHash(
            ctx,
            await withheldSubmission("connection", () => byHash.submitTransaction({ senderAccount: owner })),
            "connection",
        );

        // The first proposal needs one approval, its proposer's, and is executed with its payload.
        const execute = ctx.supra.transaction.build.multisigRawTxnObject({
            senderAddress: owner.address(),
            senderSequenceNumber: await sequenceNumberOf(owner),
            multisigAddress,
            function: SUPRA_ACCOUNT_TRANSFER,
            functionTypeArgs: [],
            functionArgs: transferArgs,
            optionalTransactionPayloadArgs: { maxGas: 20_000n, gasUnitPrice },
        });
        await expectDerivedHash(
            ctx,
            await withheldSubmission("connection", () => execute.submitTransaction({ senderAccount: owner })),
            "connection",
        );
    });

    test("an automation registration", async () => {
        const sender = await createFundedAccount(ctx);
        const registration = async () =>
            ctx.supra.transaction.build.automationRegistrationRawTxnObject({
                senderAddress: sender.address(),
                senderSequenceNumber: await sequenceNumberOf(sender),
                function: SUPRA_ACCOUNT_TRANSFER,
                functionTypeArgs: [],
                functionArgs: [createUnfundedAccount().address().toUint8Array(), BCS.bcsSerializeUint64(1_000n)],
                automationMaxGasAmount: 500n,
                automationGasPriceCap: 200_000n,
                automationFeeCapForEpoch: 1_000_000_000n,
                automationExpirationTimestampSecs: BigInt(Math.floor(Date.now() / 1000) + 2 * 60 * 60),
                automationAuxData: [],
                optionalTransactionPayloadArgs: { maxGas: 20_000n, gasUnitPrice },
            });
        const rawTxn = await registration();
        const outcome = await withheldSubmission("connection", () =>
            rawTxn.submitTransaction({ senderAccount: sender }),
        );
        try {
            await expectDerivedHash(ctx, outcome, "connection");
        } catch (error) {
            // The hash was checked before the wait. A registration that executes between two automation cycles
            // aborts; it is sent once more with a new sequence number.
            if (
                !(error instanceof SupraTransactionFailedError) ||
                !error.message.includes("ECYCLE_TRANSITION_IN_PROGRESS")
            ) {
                throw error;
            }
            const retried = await (
                await registration()
            ).submitTransaction({
                senderAccount: sender,
                enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true },
            });
            expect(retried.status).toBe(TransactionStatus.Success);
        }
    });

    test("a module publish", async () => {
        const publisher = await createFundedAccount(ctx);
        const outcome = await withheldSubmission("connection", () =>
            ctx.supra.transaction.publishPackage({
                senderAccount: publisher,
                packageMetadata: fixturePackageMetadata(),
                modulesCode: [fixtureModuleFor(publisher.address().toString())],
            }),
        );
        await expectDerivedHash(ctx, outcome, "connection");
    });

    test("the hash in the node's answer of an answered submission is the derived hash", async () => {
        const sender = await createFundedAccount(ctx);
        const rawTxn = await transferRawTxn(sender);
        const derived = ctx.supra.transaction.deriveTransactionHash({
            signedTransaction: await rawTxn.signedTransaction(sender),
        });
        const submitted = await rawTxn.submitTransaction({ senderAccount: sender });
        expect(submitted.hash.toLowerCase()).toBe(derived);
        await rawWaitForCommit(ctx, submitted.hash);
    });
});
