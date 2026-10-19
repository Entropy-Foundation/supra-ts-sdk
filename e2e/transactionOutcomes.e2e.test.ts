import type { SupraAccount } from "../src/index";
import {
    BCS,
    MoveVmError,
    SupraSimulationFailedError,
    SupraTransactionFailedError,
    TransactionStatus,
} from "../src/index";
import { createFundedAccount, createUnfundedAccount } from "./helpers/accounts";
import { describeE2E } from "./helpers/describe";
import { getE2EContext, type E2EContext } from "./helpers/env";
import { rawGet, type RawTransaction } from "./helpers/raw";
import { explicitGas } from "./helpers/transfers";

const SUPRA_ACCOUNT_TRANSFER =
    "0x0000000000000000000000000000000000000000000000000000000000000001::supra_account::transfer";

/** The error a promise rejects with; fails the test when the promise resolves. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    throw new Error("expected the promise to reject");
}

describeE2E("transaction outcomes", () => {
    let ctx: E2EContext;
    let sender: SupraAccount;

    beforeAll(async () => {
        ctx = await getE2EContext();
        sender = await createFundedAccount(ctx);
    });

    async function nextSequenceNumber(account: SupraAccount): Promise<bigint> {
        return BigInt((await ctx.supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number);
    }

    async function transfer(
        account: SupraAccount,
        amount: bigint,
        options: { sequenceNumber?: bigint; maxGas?: bigint } = {},
    ) {
        const gas = await explicitGas(ctx);
        return ctx.supra.transaction.build.rawTxnObject({
            senderAddress: account.address(),
            senderSequenceNumber: options.sequenceNumber ?? (await nextSequenceNumber(account)),
            function: SUPRA_ACCOUNT_TRANSFER,
            functionTypeArgs: [],
            functionArgs: [createUnfundedAccount().address().toUint8Array(), BCS.bcsSerializeUint64(amount)],
            optionalTransactionPayloadArgs: {
                ...gas,
                ...(options.maxGas !== undefined ? { maxGas: options.maxGas } : {}),
            },
        });
    }

    /** Counts the requests to the submit endpoint while `run` runs. */
    async function countSubmitRequests(run: () => Promise<unknown>): Promise<number> {
        const originalFetch = globalThis.fetch;
        let submits = 0;
        globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
            const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            if (url.includes("/transactions/submit")) {
                submits++;
            }
            return originalFetch(input, init);
        };
        try {
            await run();
        } finally {
            globalThis.fetch = originalFetch;
        }
        return submits;
    }

    test("an aborting entry function submitted with wait throws with the hash, status and vm_status", async () => {
        const before = await nextSequenceNumber(sender);
        const rawTxn = await transfer(sender, 10n ** 18n, { sequenceNumber: before });

        const error = await rejection(
            rawTxn.submitTransaction({
                senderAccount: sender,
                enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true },
            }),
        );

        expect(error).toBeInstanceOf(SupraTransactionFailedError);
        const failed = error as SupraTransactionFailedError;
        expect(failed.hash).toMatch(/^0x[0-9a-f]{64}$/);
        expect(failed.status).toBe(TransactionStatus.Fail);
        expect(failed.vm_status).toContain("Move abort in 0x1::coin: EINSUFFICIENT_BALANCE(0x10006)");
        expect(failed.major_status).toBe(MoveVmError.ABORTED);
        expect(failed.sub_status).toBe(0x10006);
        expect(failed.transaction.hash).toBe(failed.hash);
        // A failed transaction is committed: the node reports it and the sequence number advanced.
        const committed = await rawGet<RawTransaction>(ctx, `/rpc/v3/transactions/${failed.hash}`);
        expect(committed.body.status).toBe("Fail");
        expect(await nextSequenceNumber(sender)).toBe(before + 1n);
    });

    test("an out-of-gas transaction submitted with wait throws OUT_OF_GAS", async () => {
        // A transfer to a new account creates it, which costs far more than 20 gas units.
        const rawTxn = await transfer(sender, 1_000n, { maxGas: 20n });

        const error = (await rejection(
            rawTxn.submitTransaction({
                senderAccount: sender,
                enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true },
            }),
        )) as SupraTransactionFailedError;

        expect(error).toBeInstanceOf(SupraTransactionFailedError);
        expect(error.status).toBe(TransactionStatus.Fail);
        expect(error.vm_status).toContain("Out of gas");
        expect(error.major_status).toBe(MoveVmError.OUT_OF_GAS);
    });

    test("checkSuccess false returns the failed transaction", async () => {
        const rawTxn = await transfer(sender, 10n ** 18n);

        const result = await rawTxn.submitTransaction({
            senderAccount: sender,
            enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true, checkSuccess: false },
        });

        expect(result.status).toBe(TransactionStatus.Fail);
    });

    test("a simulation from an account that does not exist throws", async () => {
        const account = createUnfundedAccount();
        const rawTxn = await transfer(account, 1n, { sequenceNumber: 0n });

        const error = (await rejection(rawTxn.simulate(account))) as SupraSimulationFailedError;

        expect(error).toBeInstanceOf(SupraSimulationFailedError);
        expect(error.status).toBe(TransactionStatus.PendingAfterExecution);
        expect(error.major_status).toBe(MoveVmError.SENDING_ACCOUNT_DOES_NOT_EXIST);
        expect(error.vm_status).toContain("SENDING_ACCOUNT_DOES_NOT_EXIST");
    });

    test("with enableTransactionSimulation a failed simulation sends no submit request", async () => {
        const account = createUnfundedAccount();
        const rawTxn = await transfer(account, 1n, { sequenceNumber: 0n });
        let error: unknown;

        const submits = await countSubmitRequests(async () => {
            error = await rejection(
                rawTxn.submitTransaction({
                    senderAccount: account,
                    enableTransactionWaitAndSimulationArgs: {
                        enableTransactionSimulation: true,
                        enableWaitForTransaction: true,
                    },
                }),
            );
        });

        expect(error).toBeInstanceOf(SupraSimulationFailedError);
        expect((error as SupraSimulationFailedError).major_status).toBe(MoveVmError.SENDING_ACCOUNT_DOES_NOT_EXIST);
        expect(submits).toBe(0);
    });

    test("the coin transfer helper with enableTransactionSimulation sends no submit request when the simulation fails", async () => {
        let error: unknown;

        const submits = await countSubmitRequests(async () => {
            error = await rejection(
                ctx.supra.coin.transferSupraCoin({
                    senderAccount: sender,
                    receiverAccountAddress: createUnfundedAccount().address().toString(),
                    amount: 10n ** 18n,
                    optionalTransactionArgs: {
                        optionalTransactionPayloadArgs: await explicitGas(ctx),
                        enableTransactionWaitAndSimulationArgs: {
                            enableTransactionSimulation: true,
                            enableWaitForTransaction: true,
                        },
                    },
                }),
            );
        });

        expect(error).toBeInstanceOf(SupraSimulationFailedError);
        expect((error as SupraSimulationFailedError).major_status).toBe(MoveVmError.ABORTED);
        expect(submits).toBe(0);
    });

    test("a simulation with a sequence number ahead of the account throws SEQUENCE_NUMBER_TOO_NEW", async () => {
        const rawTxn = await transfer(sender, 1n, { sequenceNumber: (await nextSequenceNumber(sender)) + 5n });

        const error = (await rejection(rawTxn.simulate(sender))) as SupraSimulationFailedError;

        expect(error).toBeInstanceOf(SupraSimulationFailedError);
        expect(error.status).toBe(TransactionStatus.PendingAfterExecution);
        expect(error.major_status).toBe(MoveVmError.SEQUENCE_NUMBER_TOO_NEW);
    });

    test("a failed simulation leaves the caller's payload unchanged", async () => {
        const account = createUnfundedAccount();
        const rawTxn = await transfer(account, 1n, { sequenceNumber: 0n });
        const sendTxPayload = await rawTxn.sendTxnPayload(account);
        const before = JSON.stringify(sendTxPayload, (_key, value: unknown) =>
            typeof value === "bigint" ? value.toString() : value,
        );

        await expect(ctx.supra.transaction.simulate.simple({ sendTxPayload })).rejects.toBeInstanceOf(
            SupraSimulationFailedError,
        );

        expect(
            JSON.stringify(sendTxPayload, (_key, value: unknown) =>
                typeof value === "bigint" ? value.toString() : value,
            ),
        ).toBe(before);
    });
});
