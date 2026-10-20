import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { SupraAccount } from "../src/index";
import {
    BCS,
    isMoveVmError,
    MoveVmError,
    SupraAPIError,
    SupraClient,
    SupraNetworkError,
    SupraNotFoundError,
    SupraSimulationFailedError,
    SupraTimeoutError,
} from "../src/index";
import { createFundedAccount, createUnfundedAccount } from "./helpers/accounts";
import { describeE2E } from "./helpers/describe";
import { getE2EContext, type E2EContext } from "./helpers/env";
import { rawWaitForCommit } from "./helpers/raw";
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

describeE2E("errors", () => {
    let ctx: E2EContext;
    let sender: SupraAccount;

    beforeAll(async () => {
        ctx = await getE2EContext();
        sender = await createFundedAccount(ctx);
    });

    async function transfer(account: SupraAccount, sequenceNumber: bigint, amount: bigint) {
        return ctx.supra.transaction.build.rawTxnObject({
            senderAddress: account.address(),
            senderSequenceNumber: sequenceNumber,
            function: SUPRA_ACCOUNT_TRANSFER,
            functionTypeArgs: [],
            functionArgs: [createUnfundedAccount().address().toUint8Array(), BCS.bcsSerializeUint64(amount)],
            optionalTransactionPayloadArgs: await explicitGas(ctx),
        });
    }

    async function nextSequenceNumber(account: SupraAccount): Promise<bigint> {
        return BigInt((await ctx.supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number);
    }

    test("a stale sequence number is reported with the node's status name in the message", async () => {
        const rawTxn = await transfer(sender, await nextSequenceNumber(sender), 1_000n);
        const submitted = await rawTxn.submitTransaction({ senderAccount: sender });
        await rawWaitForCommit(ctx, submitted.hash);

        const error = await rejection(rawTxn.submitTransaction({ senderAccount: sender }));

        expect(error).toBeInstanceOf(SupraAPIError);
        const apiError = error as SupraAPIError;
        expect(apiError.status).toBe(400);
        expect(apiError.message).toContain("SEQUENCE_NUMBER_TOO_OLD");
        expect(apiError.major_status).toBe("SEQUENCE_NUMBER_TOO_OLD");
        expect(isMoveVmError(apiError.major_status)).toBe(true);
        expect(apiError.statusText).toBe("Bad Request");
        expect(apiError.data).toMatchObject({ message: apiError.message });
    });

    test("a transaction from an account that cannot pay the fee is reported with the node's status name", async () => {
        const account = await createFundedAccount(ctx);
        const rawTxn = ctx.supra.transaction.build.rawTxnObject({
            senderAddress: account.address(),
            senderSequenceNumber: 0n,
            function: SUPRA_ACCOUNT_TRANSFER,
            functionTypeArgs: [],
            functionArgs: [createUnfundedAccount().address().toUint8Array(), BCS.bcsSerializeUint64(1n)],
            optionalTransactionPayloadArgs: { maxGas: 2_000_000n, gasUnitPrice: await ctx.supra.getMinGasUnitPrice() },
        });

        const error = (await rejection(rawTxn.submitTransaction({ senderAccount: account }))) as SupraAPIError;

        expect(error.major_status).toBe(MoveVmError.INSUFFICIENT_BALANCE_FOR_TRANSACTION_FEE);
        expect(error.message).toContain("INSUFFICIENT_BALANCE_FOR_TRANSACTION_FEE");
    });

    test("a transaction from an account that does not exist is reported with the node's status name", async () => {
        const account = createUnfundedAccount();
        const rawTxn = await transfer(account, 0n, 1n);

        const error = (await rejection(rawTxn.submitTransaction({ senderAccount: account }))) as SupraAPIError;

        expect(error.major_status).toBe(MoveVmError.SENDING_ACCOUNT_DOES_NOT_EXIST);
    });

    test("a simulated abort reports ABORTED, the abort code and the abort reason", async () => {
        const rawTxn = await transfer(sender, await nextSequenceNumber(sender), 10n ** 18n);

        const error = (await rejection(rawTxn.simulate(sender))) as SupraSimulationFailedError;

        expect(error).toBeInstanceOf(SupraSimulationFailedError);
        expect(error.message).toContain("Move abort in 0x1::coin: EINSUFFICIENT_BALANCE(0x10006)");
        expect(error.major_status).toBe(MoveVmError.ABORTED);
        expect(error.sub_status).toBe(0x10006);
    });

    test("a failing view function populates the VM status", async () => {
        const error = (await rejection(
            ctx.supra.methods.viewRaw({
                function: "0x1::coin::balance",
                typeArguments: ["0x1::module_that_does_not_exist::Coin"],
                functionArguments: [sender.address().toString()],
            }),
        )) as SupraAPIError;

        expect(error).toBeInstanceOf(SupraAPIError);
        expect(error.message).toContain("Failed to execute view function: LINKER_ERROR");
        expect(error.major_status).toBe(MoveVmError.LINKER_ERROR);
    });

    test("a view function that fails at runtime populates the VM status", async () => {
        const error = (await rejection(
            ctx.supra.methods.viewRaw({
                function: "0x1::coin::decimals",
                typeArguments: ["0x1::string::String"],
                functionArguments: [],
            }),
        )) as SupraAPIError;

        expect(error.major_status).toBe(MoveVmError.MISSING_DATA);
        expect(error.sub_status).toBeUndefined();
    });

    test("a view call to a missing module is an API error without a VM status", async () => {
        const error = (await rejection(
            ctx.supra.methods.viewRaw({ function: "0x1::module_that_does_not_exist::f", functionArguments: [] }),
        )) as SupraAPIError;

        expect(error).toBeInstanceOf(SupraAPIError);
        expect(error.message).toContain("can't be found");
        expect(error.major_status).toBeUndefined();
    });

    test("a resource the account does not hold is a SupraNotFoundError", async () => {
        const error = await rejection(
            ctx.supra.account.getAccountResource({
                accountAddress: sender.address(),
                resourceType: "0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>",
            }),
        );

        expect(error).toBeInstanceOf(SupraNotFoundError);
        expect((error as SupraNotFoundError).status).toBe(404);
        expect((error as SupraNotFoundError).message).toContain("Information not available");
    });

    describe("request timeout and network failure", () => {
        let silent: Server;
        let silentUrl: string;

        beforeAll(async () => {
            // A server that accepts connections and never answers.
            silent = createServer(() => undefined);
            await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
            silentUrl = `http://127.0.0.1:${(silent.address() as AddressInfo).port}`;
        });

        afterAll(async () => {
            silent.closeAllConnections();
            await new Promise<void>((resolve) => silent.close(() => resolve()));
        });

        test("a request that exceeds timeoutMs raises SupraTimeoutError", async () => {
            const client = new SupraClient({ rpcUrl: silentUrl, chainId: ctx.chainId, timeoutMs: 200 });

            const error = await rejection(client.getGasPrice());

            expect(error).toBeInstanceOf(SupraTimeoutError);
            expect((error as SupraTimeoutError).timeoutMs).toBe(200);
            expect((error as SupraTimeoutError).cause).toBeDefined();
        });

        test("a POST that exceeds timeoutMs raises SupraTimeoutError", async () => {
            const client = new SupraClient({ rpcUrl: silentUrl, chainId: ctx.chainId, timeoutMs: 200 });

            const error = await rejection(
                client.methods.viewRaw({ function: "0x1::coin::decimals", typeArguments: [], functionArguments: [] }),
            );

            expect(error).toBeInstanceOf(SupraTimeoutError);
        });

        test("a very small timeoutMs makes a request to the node raise SupraTimeoutError", async () => {
            const client = new SupraClient({ rpcUrl: ctx.rpcUrl, chainId: ctx.chainId, timeoutMs: 1 });

            // A localnet can answer within one millisecond; the request is repeated until one is cut off.
            let error: unknown;
            for (let attempt = 0; attempt < 50 && error === undefined; attempt++) {
                error = await client.getGasPrice().then(
                    () => undefined,
                    (e: unknown) => e,
                );
            }

            expect(error).toBeInstanceOf(SupraTimeoutError);
        });

        test("a refused connection raises SupraNetworkError with the cause", async () => {
            const closed = createServer();
            await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
            const port = (closed.address() as AddressInfo).port;
            await new Promise<void>((resolve) => closed.close(() => resolve()));
            const client = new SupraClient({ rpcUrl: `http://127.0.0.1:${port}`, chainId: ctx.chainId });

            const error = await rejection(client.getGasPrice());

            expect(error).toBeInstanceOf(SupraNetworkError);
            expect((error as SupraNetworkError).cause).toBeDefined();
        });

        test("a client with retries enabled gives up on a refused connection with SupraNetworkError", async () => {
            const closed = createServer();
            await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
            const port = (closed.address() as AddressInfo).port;
            await new Promise<void>((resolve) => closed.close(() => resolve()));
            const client = new SupraClient({
                rpcUrl: `http://127.0.0.1:${port}`,
                chainId: ctx.chainId,
                retry: { attempts: 2, maxDelayMs: 50 },
            });

            await expect(client.getGasPrice()).rejects.toBeInstanceOf(SupraNetworkError);
        });
    });

    test("a client with retries enabled reads from the node as usual", async () => {
        const client = new SupraClient({
            rpcUrl: ctx.rpcUrl,
            chainId: ctx.chainId,
            timeoutMs: 20_000,
            retry: { attempts: 2 },
        });

        expect(await client.getGasPrice()).toBeGreaterThan(0n);
    });
});
