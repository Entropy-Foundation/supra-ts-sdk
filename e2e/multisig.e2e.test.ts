import type { MultisigEntryFunctionPayload, SubmitTransactionResponse, SupraAccount } from "../src/index";
import {
    SupraMultisigNoProposalError,
    SupraMultisigPayloadError,
    SupraSimulationFailedError,
    SupraSubmissionOutcomeUnknownError,
    TransactionStatus,
    deriveMultisigAccountAddress,
    standardizeAddress,
} from "../src/index";
import { createUnfundedAccount } from "./helpers/accounts";
import { describeE2E } from "./helpers/describe";
import { getE2EContext, type E2EContext } from "./helpers/env";
import { rawGet, rawPost, rawSupraBalance, rawWaitForCommit, sleep, type RawTransaction } from "./helpers/raw";

/**
 * The multisig helpers: creating an account, proposing with the payload stored on chain and with only its hash,
 * voting, executing, and removing a rejected proposal, with the default gas settings. Every test creates its own
 * accounts.
 */

const WAIT = { enableWaitForTransaction: true } as const;
const WAIT_ARGS = { enableTransactionWaitAndSimulationArgs: WAIT };

function committed(txn: SubmitTransactionResponse): RawTransaction {
    if (txn.status === "NotReadBack") {
        throw new Error(`Transaction ${txn.hash} was not read back`);
    }
    return txn as unknown as RawTransaction;
}

async function view<T extends unknown[] = unknown[]>(ctx: E2EContext, fn: string, args: unknown[]): Promise<T> {
    const response = await rawPost<{ result: T }>(ctx, "/rpc/v3/view", {
        function: fn,
        type_arguments: [],
        arguments: args,
    });
    if (response.status !== 200) {
        throw new Error(`view ${fn} returned HTTP ${response.status}: ${JSON.stringify(response.body)}`);
    }
    return response.body.result;
}

interface Setup {
    /** The proposer and executor; also an owner. */
    first: SupraAccount;
    /** The second owner, funded. */
    second: SupraAccount;
    /** The third owner's address; the account holds no SUPRA. */
    third: string;
    multisigAddress: string;
}

/**
 * Funds a new account from the faucet, asking again while the node answers `"TryLater"` (every faucet account is
 * busy, which happens when several suites share the localnet).
 */
async function fundedAccount(ctx: E2EContext): Promise<SupraAccount> {
    const account = createUnfundedAccount();
    const address = account.address().toString();
    const deadline = Date.now() + 200_000;
    while (Date.now() < deadline) {
        await rawGet(ctx, `/rpc/v3/wallet/faucet/${address}`);
        for (let attempt = 0; attempt < 20; attempt += 1) {
            if ((await rawSupraBalance(ctx, address).catch(() => 0n)) > 0n) {
                return account;
            }
            await sleep(500);
        }
    }
    throw new Error(`The faucet did not fund ${address}`);
}

describeE2E("multisig helpers", () => {
    let ctx: E2EContext;
    // Funded once for the file: the faucet is shared with other suites. Every test makes its own multisig account.
    let first: SupraAccount;
    let second: SupraAccount;

    beforeAll(async () => {
        ctx = await getE2EContext();
        first = await fundedAccount(ctx);
        second = await fundedAccount(ctx);
    });

    /** A 2-of-3 multisig account with funds, made with `createMultisigAccount` and its default settings. */
    async function setup(): Promise<Setup> {
        const third = createUnfundedAccount().address().toString();
        const created = await ctx.supra.multisig.createMultisigAccount({
            senderAccount: first,
            additionalOwners: [second.address(), third],
            signaturesRequired: 2,
            optionalTransactionArgs: WAIT_ARGS,
        });
        expect(created.transaction.status).toBe(TransactionStatus.Success);
        const funded = await ctx.supra.coin.transferSupraCoin({
            senderAccount: first,
            receiverAccountAddress: created.multisigAddress,
            amount: 1_000_000_000n,
            optionalTransactionArgs: WAIT_ARGS,
        });
        expect(funded.status).toBe(TransactionStatus.Success);
        return { first, second, third, multisigAddress: created.multisigAddress };
    }

    function transfer(receiver: string, amount: bigint): MultisigEntryFunctionPayload {
        return { function: "0x1::supra_account::transfer", functionArgs: [receiver, amount] };
    }

    test("createMultisigAccount returns the address at which the account exists", async () => {
        const second = createUnfundedAccount().address().toString();
        const sequenceNumber = BigInt(
            (await ctx.supra.account.getAccountInfo({ accountAddress: first.address() })).sequence_number,
        );

        const created = await ctx.supra.multisig.createMultisigAccount({
            senderAccount: first,
            additionalOwners: [second],
            signaturesRequired: 2,
            timeoutDurationSecs: 600,
            optionalTransactionArgs: WAIT_ARGS,
        });

        expect(created.transaction.status).toBe(TransactionStatus.Success);
        expect(created.multisigAddress).toBe(
            deriveMultisigAccountAddress({ creatorAddress: first.address(), sequenceNumber }),
        );
        const [exists] = await view<[boolean]>(ctx, "0x1::multisig_account::account_exists", [created.multisigAddress]);
        expect(exists).toBe(true);
        const [owners] = await view<[string[]]>(ctx, "0x1::multisig_account::owners", [created.multisigAddress]);
        expect(new Set(owners.map((owner) => standardizeAddress(owner)))).toStrictEqual(
            new Set([standardizeAddress(first.address()), standardizeAddress(second)]),
        );
        expect(await view(ctx, "0x1::multisig_account::num_signatures_required", [created.multisigAddress])).toEqual([
            "2",
        ]);
        expect(await view(ctx, "0x1::multisig_account::timeout_duration", [created.multisigAddress])).toEqual(["600"]);
        const gasUsed = BigInt(committed(created.transaction).output?.Move?.gas_used ?? 0);
        expect(gasUsed).toBeGreaterThan(0n);
    });

    test("createMultisigAccount without waiting returns the address at which the account is created", async () => {
        const created = await ctx.supra.multisig.createMultisigAccount({
            senderAccount: first,
            additionalOwners: [createUnfundedAccount().address()],
            signaturesRequired: 1,
        });
        await rawWaitForCommit(ctx, created.transaction.hash);
        const [exists] = await view<[boolean]>(ctx, "0x1::multisig_account::account_exists", [created.multisigAddress]);
        expect(exists).toBe(true);
    });

    test("a proposal made with the payload stored on chain is executed by the SDK without a payload", async () => {
        const { multisigAddress } = await setup();
        const receiver = createUnfundedAccount().address().toString();

        const proposed = await ctx.supra.multisig.proposeMultisigTransaction({
            senderAccount: first,
            multisigAddress,
            payload: transfer(receiver, 4_321n),
            optionalTransactionArgs: WAIT_ARGS,
        });
        expect(proposed.status).toBe(TransactionStatus.Success);
        expect(await ctx.supra.multisig.getMultisigSequenceNumbers({ multisigAddress })).toEqual({
            lastResolved: 0n,
            next: 2n,
        });
        const proposal = await ctx.supra.multisig.getNextMultisigProposal({ multisigAddress });
        expect(proposal?.sequenceNumber).toBe(1n);
        expect(proposal?.payload).toMatch(/^0x/);
        expect(proposal?.payloadHash).toBeUndefined();
        expect(proposal?.votes).toEqual([{ owner: standardizeAddress(first.address()), approved: true }]);

        await ctx.supra.multisig.approveMultisigTransaction({
            senderAccount: second,
            multisigAddress,
            sequenceNumber: 1,
            optionalTransactionArgs: WAIT_ARGS,
        });
        expect(
            (await ctx.supra.multisig.getMultisigProposal({ multisigAddress, sequenceNumber: 1 })).votes,
        ).toHaveLength(2);

        const executed = await ctx.supra.multisig.executeMultisigTransaction({
            senderAccount: first,
            multisigAddress,
            optionalTransactionArgs: WAIT_ARGS,
        });

        expect(executed.status).toBe(TransactionStatus.Success);
        const payload = committed(executed).payload as { Move: { type: string; multisig_address: string } };
        expect(payload.Move.type).toBe("multisig_payload");
        expect(await rawSupraBalance(ctx, receiver)).toBe(4_321n);
        expect(await ctx.supra.multisig.getNextMultisigProposal({ multisigAddress })).toBeUndefined();
        await expect(
            ctx.supra.multisig.executeMultisigTransaction({ senderAccount: first, multisigAddress }),
        ).rejects.toBeInstanceOf(SupraMultisigNoProposalError);
    });

    test("a stored-payload proposal is executed with the payload given, when it matches", async () => {
        const { multisigAddress } = await setup();
        const receiver = createUnfundedAccount().address().toString();
        await ctx.supra.multisig.proposeMultisigTransaction({
            senderAccount: first,
            multisigAddress,
            payload: transfer(receiver, 777n),
            optionalTransactionArgs: WAIT_ARGS,
        });
        await ctx.supra.multisig.approveMultisigTransaction({
            senderAccount: second,
            multisigAddress,
            sequenceNumber: 1n,
            optionalTransactionArgs: WAIT_ARGS,
        });

        const wrong = ctx.supra.multisig.executeMultisigTransaction({
            senderAccount: first,
            multisigAddress,
            payload: transfer(receiver, 778n),
        });
        await expect(wrong).rejects.toMatchObject({ name: "SupraMultisigPayloadError", reason: "stored-mismatch" });

        const executed = await ctx.supra.multisig.executeMultisigTransaction({
            senderAccount: first,
            multisigAddress,
            payload: transfer(receiver, 777n),
            optionalTransactionArgs: WAIT_ARGS,
        });
        expect(executed.status).toBe(TransactionStatus.Success);
        expect(await rawSupraBalance(ctx, receiver)).toBe(777n);
    });

    test("a proposal made with only the payload's hash is executed with its payload", async () => {
        const { multisigAddress } = await setup();
        const receiver = createUnfundedAccount().address().toString();
        const payload = transfer(receiver, 1_234n);
        await ctx.supra.multisig.proposeMultisigTransactionWithHash({
            senderAccount: first,
            multisigAddress,
            payload,
            optionalTransactionArgs: WAIT_ARGS,
        });
        const proposal = await ctx.supra.multisig.getMultisigProposal({ multisigAddress, sequenceNumber: 1 });
        expect(proposal.payload).toBeUndefined();
        expect(proposal.payloadHash).toMatch(/^0x[0-9a-f]{64}$/);
        await ctx.supra.multisig.approveMultisigTransaction({
            senderAccount: second,
            multisigAddress,
            sequenceNumber: 1,
            optionalTransactionArgs: WAIT_ARGS,
        });

        const missing = ctx.supra.multisig.executeMultisigTransaction({ senderAccount: first, multisigAddress });
        await expect(missing).rejects.toBeInstanceOf(SupraMultisigPayloadError);
        await expect(missing).rejects.toMatchObject({ reason: "required", sequenceNumber: 1n });
        const other = ctx.supra.multisig.executeMultisigTransaction({
            senderAccount: first,
            multisigAddress,
            payload: transfer(receiver, 1_235n),
        });
        await expect(other).rejects.toMatchObject({ reason: "hash-mismatch" });
        expect(await rawSupraBalance(ctx, receiver).catch(() => 0n)).toBe(0n);

        const executed = await ctx.supra.multisig.executeMultisigTransaction({
            senderAccount: first,
            multisigAddress,
            payload,
            optionalTransactionArgs: WAIT_ARGS,
        });
        expect(executed.status).toBe(TransactionStatus.Success);
        expect(await rawSupraBalance(ctx, receiver)).toBe(1_234n);
    });

    test("a rejected proposal is removed with executeRejectedMultisigTransaction and the queue moves on", async () => {
        const { multisigAddress } = await setup();
        const receiver = createUnfundedAccount().address().toString();
        await ctx.supra.multisig.proposeMultisigTransaction({
            senderAccount: first,
            multisigAddress,
            payload: transfer(receiver, 11n),
            optionalTransactionArgs: WAIT_ARGS,
        });
        await ctx.supra.multisig.proposeMultisigTransaction({
            senderAccount: first,
            multisigAddress,
            payload: transfer(receiver, 22n),
            optionalTransactionArgs: WAIT_ARGS,
        });

        await ctx.supra.multisig.rejectMultisigTransaction({
            senderAccount: first,
            multisigAddress,
            sequenceNumber: 1,
            optionalTransactionArgs: WAIT_ARGS,
        });
        await ctx.supra.multisig.rejectMultisigTransaction({
            senderAccount: second,
            multisigAddress,
            sequenceNumber: 1,
            optionalTransactionArgs: WAIT_ARGS,
        });
        const votes = (await ctx.supra.multisig.getMultisigProposal({ multisigAddress, sequenceNumber: 1 })).votes;
        expect(votes.every((vote) => !vote.approved)).toBe(true);
        expect(votes).toHaveLength(2);

        const removed = await ctx.supra.multisig.executeRejectedMultisigTransaction({
            senderAccount: first,
            multisigAddress,
            optionalTransactionArgs: WAIT_ARGS,
        });
        expect(removed.status).toBe(TransactionStatus.Success);
        expect(await ctx.supra.multisig.getMultisigSequenceNumbers({ multisigAddress })).toEqual({
            lastResolved: 1n,
            next: 3n,
        });
        expect((await ctx.supra.multisig.getNextMultisigProposal({ multisigAddress }))?.sequenceNumber).toBe(2n);

        await ctx.supra.multisig.approveMultisigTransaction({
            senderAccount: second,
            multisigAddress,
            sequenceNumber: 2,
            optionalTransactionArgs: WAIT_ARGS,
        });
        const executed = await ctx.supra.multisig.executeMultisigTransaction({
            senderAccount: first,
            multisigAddress,
            optionalTransactionArgs: WAIT_ARGS,
        });
        expect(executed.status).toBe(TransactionStatus.Success);
        expect(await rawSupraBalance(ctx, receiver)).toBe(22n);
    });

    test("the lifecycle sent without waiting, with pipelined calls, ends with the proposal executed", async () => {
        const { multisigAddress } = await setup();
        const receiver = createUnfundedAccount().address().toString();
        const proposed = await ctx.supra.multisig.proposeMultisigTransaction({
            senderAccount: first,
            multisigAddress,
            payload: transfer(receiver, 55n),
        });
        await rawWaitForCommit(ctx, proposed.hash);
        const approved = await ctx.supra.multisig.approveMultisigTransaction({
            senderAccount: second,
            multisigAddress,
            sequenceNumber: 1,
        });
        await rawWaitForCommit(ctx, approved.hash);
        const executed = await ctx.supra.multisig.executeMultisigTransaction({ senderAccount: first, multisigAddress });
        await rawWaitForCommit(ctx, executed.hash);
        expect(await rawSupraBalance(ctx, receiver)).toBe(55n);
    });

    /** A proposal that stores its payload, with the approvals it needs. */
    async function approvedStoredProposal(amount: bigint): Promise<string> {
        const { multisigAddress } = await setup();
        await ctx.supra.multisig.proposeMultisigTransaction({
            senderAccount: first,
            multisigAddress,
            payload: transfer(createUnfundedAccount().address().toString(), amount),
            optionalTransactionArgs: WAIT_ARGS,
        });
        await ctx.supra.multisig.approveMultisigTransaction({
            senderAccount: second,
            multisigAddress,
            sequenceNumber: 1,
            optionalTransactionArgs: WAIT_ARGS,
        });
        return multisigAddress;
    }

    test("the default max gas of an execution without a payload is estimated by simulation", async () => {
        const multisigAddress = await approvedStoredProposal(99n);

        const executed = await ctx.supra.multisig.executeMultisigTransaction({
            senderAccount: first,
            multisigAddress,
            optionalTransactionArgs: WAIT_ARGS,
        });

        expect(executed.status).toBe(TransactionStatus.Success);
        const maxGas = BigInt(committed(executed).header?.max_gas_amount ?? 0);
        const gasUsed = BigInt(committed(executed).output?.Move?.gas_used ?? 0);
        // The estimate is the gas of the simulation times 1.5 (at least 1,500); without one the max gas is 20,000.
        expect(maxGas).toBeLessThan(20_000n);
        expect(maxGas).toBeGreaterThanOrEqual(gasUsed);
    });

    test("enableTransactionSimulation on an execution without a payload throws a simulation failure", async () => {
        const multisigAddress = await approvedStoredProposal(98n);
        const options = {
            optionalTransactionPayloadArgs: { maxGas: 20_000n },
            enableTransactionWaitAndSimulationArgs: { ...WAIT, enableTransactionSimulation: true },
        };
        const execute = () =>
            ctx.supra.multisig.executeMultisigTransaction({
                senderAccount: first,
                multisigAddress,
                optionalTransactionArgs: options,
            });

        // The nodes of v11.7.0 and v12.0.0.rc6 do not simulate a multisig execution that carries no payload
        // (`MISSING_DATA`); the transaction is not submitted, so the call can be repeated without the simulation.
        await expect(execute()).rejects.toBeInstanceOf(SupraSimulationFailedError);
        const executed = await ctx.supra.multisig.executeMultisigTransaction({
            senderAccount: first,
            multisigAddress,
            optionalTransactionArgs: WAIT_ARGS,
        });
        expect(executed.status).toBe(TransactionStatus.Success);
    });

    test("the hash derived for an execution without a payload is the hash the node gives it", async () => {
        const { multisigAddress } = await setup();
        const receiver = createUnfundedAccount().address().toString();
        await ctx.supra.multisig.proposeMultisigTransaction({
            senderAccount: first,
            multisigAddress,
            payload: transfer(receiver, 31n),
            optionalTransactionArgs: WAIT_ARGS,
        });
        await ctx.supra.multisig.approveMultisigTransaction({
            senderAccount: second,
            multisigAddress,
            sequenceNumber: 1,
            optionalTransactionArgs: WAIT_ARGS,
        });
        const gasUnitPrice = await ctx.supra.getEstimatedGasUnitPrice();
        const rawTxn = ctx.supra.transaction.build.multisigRawTxnObject({
            senderAddress: first.address(),
            senderSequenceNumber: BigInt(
                (await ctx.supra.account.getAccountInfo({ accountAddress: first.address() })).sequence_number,
            ),
            multisigAddress,
            optionalTransactionPayloadArgs: { maxGas: 20_000n, gasUnitPrice },
        });
        const derived = ctx.supra.transaction.deriveTransactionHash({
            signedTransaction: await rawTxn.signedTransaction(first),
        });

        const submitted = await rawTxn.submitTransaction({ senderAccount: first });

        expect(submitted.hash.replace(/^0x/, "")).toBe(derived.replace(/^0x/, ""));
        const final = await rawWaitForCommit(ctx, submitted.hash);
        expect(final.status).toBe(TransactionStatus.Success);
        expect(await rawSupraBalance(ctx, receiver)).toBe(31n);
    });

    /**
     * Runs `submit` with `fetch` replaced for its first submission request: the request reaches the node and the SDK
     * sees a failed connection after the node's answer. Returns the hash in the node's answer and what the call threw.
     */
    async function withDroppedAnswer(submit: () => Promise<unknown>): Promise<{ nodeHash: string; error: unknown }> {
        const realFetch = global.fetch;
        let nodeAnswer: Promise<string> | undefined;
        global.fetch = ((input: string | URL | Request, init?: RequestInit) => {
            const isSubmit =
                (init?.method ?? "GET") === "POST" && new URL(String(input)).pathname.endsWith("/transactions/submit");
            if (!isSubmit || nodeAnswer !== undefined) {
                return realFetch(input, init);
            }
            nodeAnswer = realFetch(input, init).then(async (response) => (await response.json()) as string);
            return nodeAnswer.then(() => Promise.reject(new TypeError("fetch failed")));
        }) as typeof fetch;
        let error: unknown;
        try {
            await submit();
        } catch (caught) {
            error = caught;
        } finally {
            global.fetch = realFetch;
        }
        if (nodeAnswer === undefined) {
            throw new Error("The call made no submission request");
        }
        return { nodeHash: await nodeAnswer, error };
    }

    test("the hashes derived by the helpers are the nodes' for an account creation and an execution", async () => {
        const { multisigAddress } = await setup();

        const creator = second;
        const creation = await withDroppedAnswer(() =>
            ctx.supra.multisig.createMultisigAccount({
                senderAccount: creator,
                additionalOwners: [createUnfundedAccount().address()],
                signaturesRequired: 2,
            }),
        );
        const creationError = creation.error as SupraSubmissionOutcomeUnknownError;
        expect(creationError).toBeInstanceOf(SupraSubmissionOutcomeUnknownError);
        expect(creationError.hash).toBe(creation.nodeHash.toLowerCase());
        await rawWaitForCommit(ctx, creationError.hash);
        // The error carries what the address derives from.
        const derivedAddress = deriveMultisigAccountAddress({
            creatorAddress: creationError.sender,
            sequenceNumber: creationError.sequenceNumber,
        });
        const [exists] = await view<[boolean]>(ctx, "0x1::multisig_account::account_exists", [derivedAddress]);
        expect(exists).toBe(true);

        const receiver = createUnfundedAccount().address().toString();
        await ctx.supra.multisig.proposeMultisigTransaction({
            senderAccount: first,
            multisigAddress,
            payload: transfer(receiver, 17n),
            optionalTransactionArgs: WAIT_ARGS,
        });
        await ctx.supra.multisig.approveMultisigTransaction({
            senderAccount: second,
            multisigAddress,
            sequenceNumber: 1,
            optionalTransactionArgs: WAIT_ARGS,
        });
        const execution = await withDroppedAnswer(() =>
            ctx.supra.multisig.executeMultisigTransaction({ senderAccount: first, multisigAddress }),
        );
        const executionError = execution.error as SupraSubmissionOutcomeUnknownError;
        expect(executionError).toBeInstanceOf(SupraSubmissionOutcomeUnknownError);
        expect(executionError.hash).toBe(execution.nodeHash.toLowerCase());
        const final = await rawWaitForCommit(ctx, executionError.hash);
        expect(final.status).toBe(TransactionStatus.Success);
    });
});
