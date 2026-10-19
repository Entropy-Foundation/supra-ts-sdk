import type { SupraAccount, TransactionResponse } from "../src/index";
import { BCS, HexString, TransactionStatus, TxnBuilderTypes } from "../src/index";
import { createFundedAccount, createUnfundedAccount } from "./helpers/accounts";
import { describeE2E } from "./helpers/describe";
import { getE2EContext, type E2EContext } from "./helpers/env";
import { rawGet, rawSupraBalance, rawWaitForCommit, type RawTransaction } from "./helpers/raw";
import { explicitGas, sendSupra } from "./helpers/transfers";

/**
 * `script { fun main(sender: &signer, amount: u64) }` that transfers `amount` Quants of SUPRA from the
 * sender to the sender's own address, compiled with the framework's `supra_account::transfer`.
 */
const SELF_TRANSFER_SCRIPT =
    "a11ceb0b060000000501000403040a050e0f071d29084620000000010002020300010304010002060c030001060c010503060c0503067369676e65720d73757072615f6163636f756e740a616464726573735f6f66087472616e736665720000000000000000000000000000000000000000000000000000000000000001000001060a000b0011000b01110102";

const SUPRA_ACCOUNT_TRANSFER =
    "0x0000000000000000000000000000000000000000000000000000000000000001::supra_account::transfer";

describeE2E("transactions", () => {
    let ctx: E2EContext;
    let sender: SupraAccount;

    beforeAll(async () => {
        ctx = await getE2EContext();
        sender = await createFundedAccount(ctx);
    });

    async function nextSequenceNumber(account: SupraAccount): Promise<bigint> {
        return BigInt((await ctx.supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number);
    }

    test("build, simulate, submit and wait for an entry function transaction", async () => {
        const receiver = createUnfundedAccount().address().toString();
        const receiverAddress = new HexString(receiver);
        const gas = await explicitGas(ctx);

        const rawTxn = ctx.supra.transaction.build.rawTxnObject({
            senderAddress: sender.address(),
            senderSequenceNumber: await nextSequenceNumber(sender),
            function: SUPRA_ACCOUNT_TRANSFER,
            functionTypeArgs: [],
            functionArgs: [receiverAddress.toUint8Array(), BCS.bcsSerializeUint64(5_000n)],
            optionalTransactionPayloadArgs: gas,
        });

        const simulated = await rawTxn.simulate(sender);
        expect(simulated.status).toBe(TransactionStatus.Success);
        // A simulation changes no state.
        expect(await rawSupraBalance(ctx, receiver)).toBe(0n);

        const submitted = await rawTxn.submitTransaction({
            senderAccount: sender,
            enableTransactionWaitAndSimulationArgs: {
                enableTransactionSimulation: true,
                enableWaitForTransaction: true,
            },
        });
        expect(submitted.status).toBe(TransactionStatus.Success);
        expect(await rawSupraBalance(ctx, receiver)).toBe(5_000n);
    });

    test("deriveTransactionHash of the signed transaction is the hash the node reports", async () => {
        const rawTxn = ctx.supra.transaction.build.rawTxnObject({
            senderAddress: sender.address(),
            senderSequenceNumber: await nextSequenceNumber(sender),
            function: SUPRA_ACCOUNT_TRANSFER,
            functionTypeArgs: [],
            functionArgs: [createUnfundedAccount().address().toUint8Array(), BCS.bcsSerializeUint64(1_000n)],
            optionalTransactionPayloadArgs: await explicitGas(ctx),
        });
        const derived = ctx.supra.transaction.deriveTransactionHash({
            signedTransaction: await rawTxn.signedTransaction(sender),
        });

        const submitted = await rawTxn.submitTransaction({ senderAccount: sender });
        expect(submitted.hash.replace(/^0x/, "")).toBe(derived.replace(/^0x/, ""));
        await rawWaitForCommit(ctx, submitted.hash);
    });

    test("a signature produced by signTransaction is accepted by the node", async () => {
        const rawTxn = ctx.supra.transaction.build.rawTxnObject({
            senderAddress: sender.address(),
            senderSequenceNumber: await nextSequenceNumber(sender),
            function: SUPRA_ACCOUNT_TRANSFER,
            functionTypeArgs: [],
            functionArgs: [createUnfundedAccount().address().toUint8Array(), BCS.bcsSerializeUint64(1_001n)],
            optionalTransactionPayloadArgs: await explicitGas(ctx),
        });
        const signature = (await ctx.supra.transaction.signTransaction({ senderAccount: sender, rawTxn })) as HexString;

        const submitted = await rawTxn.submitTransactionAndSignature({
            senderPubkey: sender.pubKey(),
            signature,
            enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true },
        });
        expect(submitted.status).toBe(TransactionStatus.Success);
    });

    test("a script transaction runs the script", async () => {
        const rawTxn = ctx.supra.transaction.build.scriptRawTxnObject({
            senderAddress: sender.address(),
            senderSequenceNumber: await nextSequenceNumber(sender),
            scriptCode: new HexString(SELF_TRANSFER_SCRIPT).toUint8Array(),
            scriptTypeArgs: [],
            scriptArgs: [new TxnBuilderTypes.TransactionArgumentU64(1_000n)],
            optionalTransactionPayloadArgs: await explicitGas(ctx),
        });

        const submitted = await rawTxn.submitTransaction({
            senderAccount: sender,
            enableTransactionWaitAndSimulationArgs: {
                enableTransactionSimulation: true,
                enableWaitForTransaction: true,
            },
        });

        expect(submitted.status).toBe(TransactionStatus.Success);
        expect("payload" in submitted && submitted.payload).toMatchObject({ Move: { type: "script_payload" } });
    });

    test("a fee payer pays the gas of a sponsored transaction", async () => {
        const feePayer = await createFundedAccount(ctx);
        const sponsored = await createFundedAccount(ctx);
        const receiver = createUnfundedAccount().address().toString();
        const gas = await explicitGas(ctx);
        const feePayerBefore = await rawSupraBalance(ctx, feePayer.address().toString());
        const sponsoredBefore = await rawSupraBalance(ctx, sponsored.address().toString());

        const rawTxn = ctx.supra.transaction.build.rawTxnObject({
            senderAddress: sponsored.address(),
            senderSequenceNumber: await nextSequenceNumber(sponsored),
            function: SUPRA_ACCOUNT_TRANSFER,
            functionTypeArgs: [],
            functionArgs: [new HexString(receiver).toUint8Array(), BCS.bcsSerializeUint64(3_000n)],
            optionalTransactionPayloadArgs: gas,
        });
        const payload = new TxnBuilderTypes.FeePayerRawTransaction(
            rawTxn,
            [],
            new TxnBuilderTypes.AccountAddress(feePayer.address().toUint8Array()),
        );
        const senderAuthenticator = (await ctx.supra.transaction.signTransaction({
            senderAccount: sponsored,
            rawTxn: payload,
        })) as TxnBuilderTypes.AccountAuthenticatorEd25519;
        const feePayerAuthenticator = (await ctx.supra.transaction.signTransaction({
            senderAccount: feePayer,
            rawTxn: payload,
        })) as TxnBuilderTypes.AccountAuthenticatorEd25519;

        const submitted = await ctx.supra.transaction.submit.submitSponsorTransaction({
            feePayerAddress: feePayer.address().toString(),
            secondarySignersAccountAddress: [],
            rawTxn,
            senderAuthenticator,
            feePayerAuthenticator,
            secondarySignersAuthenticator: [],
            enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true },
        });

        expect(submitted.status).toBe(TransactionStatus.Success);
        expect(await rawSupraBalance(ctx, receiver)).toBe(3_000n);
        expect(await rawSupraBalance(ctx, sponsored.address().toString())).toBe(sponsoredBefore - 3_000n);
        expect(await rawSupraBalance(ctx, feePayer.address().toString())).toBeLessThan(feePayerBefore);
    });

    test("getTransactionByHash returns the committed transaction with its sender and payload", async () => {
        const committed = await sendSupra(ctx, sender, createUnfundedAccount().address().toString(), 1_100n);

        const txn = await ctx.supra.transaction.getTransactionByHash({ transactionHash: committed.hash });

        expect(txn.hash).toBe(committed.hash);
        expect(txn.status).toBe(TransactionStatus.Success);
        expect("header" in txn && txn.header.sender.Move).toBe(sender.address().toString());
    });

    test("isPendingTransaction is false for a committed transaction", async () => {
        const committed = await sendSupra(ctx, sender, createUnfundedAccount().address().toString(), 1_101n);
        await expect(ctx.supra.transaction.isPendingTransaction({ transactionHash: committed.hash })).resolves.toBe(
            false,
        );
    });

    test("waitForTransaction returns once the transaction is committed", async () => {
        const rawTxn = ctx.supra.transaction.build.rawTxnObject({
            senderAddress: sender.address(),
            senderSequenceNumber: await nextSequenceNumber(sender),
            function: SUPRA_ACCOUNT_TRANSFER,
            functionTypeArgs: [],
            functionArgs: [createUnfundedAccount().address().toUint8Array(), BCS.bcsSerializeUint64(1_102n)],
            optionalTransactionPayloadArgs: await explicitGas(ctx),
        });
        const submitted = await rawTxn.submitTransaction({ senderAccount: sender });

        const committed: TransactionResponse = await ctx.supra.transaction.waitForTransaction({
            transactionHash: submitted.hash,
        });

        expect(committed.hash).toBe(submitted.hash);
        expect(committed.status).toBe(TransactionStatus.Success);
    });

    test("getTransactionByHash rejects for a hash the node does not know", async () => {
        await expect(
            ctx.supra.transaction.getTransactionByHash({ transactionHash: `0x${"ab".repeat(32)}` }),
        ).rejects.toThrow();
        const response = await rawGet(ctx, `/rpc/v3/transactions/0x${"ab".repeat(32)}`);
        expect(response.status).toBeGreaterThanOrEqual(400);
    });
});

describeE2E("transaction feeds", () => {
    let ctx: E2EContext;
    let sender: SupraAccount;
    const sent: RawTransaction[] = [];

    beforeAll(async () => {
        ctx = await getE2EContext();
        sender = await createFundedAccount(ctx);
        for (let i = 0; i < 3; i++) {
            sent.push(await sendSupra(ctx, sender, createUnfundedAccount().address().toString(), 1_000n + BigInt(i)));
        }
    });

    test("getAccountTransactions pages through the account's transactions by sequence number", async () => {
        const seen: string[] = [];
        for (let start = 0; start < sent.length; start++) {
            const { response } = await ctx.supra.account.getAccountTransactions({
                accountAddress: sender.address(),
                options: { count: 1, ascending: true, start: String(start) },
            });
            expect(response).toHaveLength(1);
            seen.push(...response.map((txn) => txn.hash));
        }
        expect(seen).toEqual(sent.map((txn) => txn.hash));
    });

    test("getAccountTransactions returns the newest transaction first when descending", async () => {
        const { response } = await ctx.supra.account.getAccountTransactions({
            accountAddress: sender.address(),
            options: { count: 1, ascending: false },
        });
        expect(response[0]?.hash).toBe(sent[sent.length - 1]?.hash);
    });

    test("getAccountTransactions returns every transaction of the account in one page", async () => {
        const { response } = await ctx.supra.account.getAccountTransactions({
            accountAddress: sender.address(),
            options: { count: 100, ascending: true },
        });
        expect(response.map((txn) => txn.hash)).toEqual(sent.map((txn) => txn.hash));
    });

    test("getAccountResources pages through the resources by following the cursor", async () => {
        const all = await ctx.supra.account.getAccountResources({ accountAddress: sender.address() });
        const seen: string[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < all.response.length + 2; page++) {
            const result = await ctx.supra.account.getAccountResources({
                accountAddress: sender.address(),
                options: { count: 1, ...(cursor !== undefined ? { start: cursor } : {}) },
            });
            seen.push(...result.response.map((resource) => resource.type));
            if (result.cursor === undefined) {
                break;
            }
            cursor = result.cursor;
        }
        expect(seen).toEqual(all.response.map((resource) => resource.type));
    });

    test("getAccountModules returns no cursor on the last page", async () => {
        let cursor: string | undefined;
        let pages = 0;
        do {
            const result = await ctx.supra.account.getAccountModules({
                accountAddress: "0x1",
                options: { count: 40, ...(cursor !== undefined ? { start: cursor } : {}) },
            });
            cursor = result.cursor;
            pages++;
        } while (cursor !== undefined && pages < 20);
        expect(cursor).toBeUndefined();
        expect(pages).toBeGreaterThan(1);
    });
});
