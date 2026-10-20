import type { HexString, SupraAccount } from "../src/index";
import { BCS, Network, SupraChainIdMismatchError, SupraClient, TransactionStatus, TxnBuilderTypes } from "../src/index";
import { createFundedAccount, createUnfundedAccount } from "./helpers/accounts";
import { describeE2E } from "./helpers/describe";
import { getE2EContext, type E2EContext } from "./helpers/env";
import { rawGet } from "./helpers/raw";
import { explicitGas } from "./helpers/transfers";

const SUPRA_ACCOUNT_TRANSFER =
    "0x0000000000000000000000000000000000000000000000000000000000000001::supra_account::transfer";

/** `test` when `SUPRA_E2E_PUBLIC_READS=1`, which allows read-only requests to the public Devnet RPC node. */
const testPublicRead: jest.It = process.env["SUPRA_E2E_PUBLIC_READS"] === "1" ? test : test.skip;

interface SentRequest {
    method: string;
    url: string;
}

describeE2E("chain ID check", () => {
    let ctx: E2EContext;
    let fetchSpy: jest.SpiedFunction<typeof fetch> | undefined;

    beforeAll(async () => {
        ctx = await getE2EContext();
    });

    afterEach(() => {
        fetchSpy?.mockRestore();
        fetchSpy = undefined;
    });

    /** Records the requests sent from here on; they still reach the node. */
    function recordRequests(): SentRequest[] {
        const sent: SentRequest[] = [];
        const original = globalThis.fetch;
        fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
            const url = input instanceof Request ? input.url : String(input);
            sent.push({ method: init?.method ?? "GET", url });
            return original(input, init);
        });
        return sent;
    }

    function requestsTo(sent: SentRequest[], path: string): SentRequest[] {
        return sent.filter((request) => new URL(request.url).pathname.endsWith(path));
    }

    function otherChainId(): number {
        return ctx.chainId === 254 ? 253 : 254;
    }

    function transfer(
        client: SupraClient,
        sender: SupraAccount,
        sequenceNumber: bigint,
        gas: { maxGas: bigint; gasUnitPrice: bigint },
    ) {
        return client.transaction.build.rawTxnObject({
            senderAddress: sender.address(),
            senderSequenceNumber: sequenceNumber,
            function: SUPRA_ACCOUNT_TRANSFER,
            functionTypeArgs: [],
            functionArgs: [createUnfundedAccount().address().toUint8Array(), BCS.bcsSerializeUint64(1_000n)],
            optionalTransactionPayloadArgs: gas,
        });
    }

    test("a client configured with another chain ID throws before signing and submits nothing", async () => {
        const sender = await createFundedAccount(ctx);
        const gas = await explicitGas(ctx);
        const wrong = new SupraClient({ rpcUrl: ctx.rpcUrl, chainId: otherChainId() });
        const sent = recordRequests();

        const transferError: unknown = await wrong.coin
            .transferSupraCoin({
                senderAccount: sender,
                receiverAccountAddress: createUnfundedAccount().address().toString(),
                amount: 1_000n,
                optionalTransactionArgs: {
                    optionalTransactionPayloadArgs: gas,
                    enableTransactionWaitAndSimulationArgs: { enableTransactionSimulation: true },
                },
            })
            .catch((error: unknown) => error);
        expect(transferError).toBeInstanceOf(SupraChainIdMismatchError);
        expect(transferError).toMatchObject({ configuredChainId: otherChainId(), nodeChainId: ctx.chainId });

        const rawTxn = transfer(wrong, sender, 0n, gas);
        await expect(rawTxn.submitTransaction({ senderAccount: sender })).rejects.toBeInstanceOf(
            SupraChainIdMismatchError,
        );
        await expect(wrong.transaction.signTransaction({ senderAccount: sender, rawTxn })).rejects.toBeInstanceOf(
            SupraChainIdMismatchError,
        );
        await expect(rawTxn.simulate(sender)).rejects.toBeInstanceOf(SupraChainIdMismatchError);

        expect(requestsTo(sent, "/transactions/submit")).toHaveLength(0);
        expect(requestsTo(sent, "/transactions/simulate")).toHaveLength(0);
        const account = await rawGet<{ sequence_number: number | string }>(
            ctx,
            `/rpc/v3/accounts/${sender.address().toString()}`,
        );
        expect(String(account.body.sequence_number)).toBe("0");
    });

    test("a transaction built for another chain is not signed by a client of this node", async () => {
        const sender = createUnfundedAccount();
        const gas = await explicitGas(ctx);
        const other = new SupraClient({ rpcUrl: ctx.rpcUrl, chainId: otherChainId(), verifyChainId: false });
        const rawTxn = transfer(other, sender, 0n, gas);

        const error: unknown = await ctx.supra.transaction
            .signTransaction({ senderAccount: sender, rawTxn })
            .catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(SupraChainIdMismatchError);
        expect(error).toMatchObject({
            configuredChainId: ctx.chainId,
            nodeChainId: ctx.chainId,
            transactionChainId: otherChainId(),
        });
    });

    test("a new client reads the chain ID once before its first signature and sends transfers", async () => {
        const sender = await createFundedAccount(ctx);
        const gas = await explicitGas(ctx);
        const client = new SupraClient({ rpcUrl: ctx.rpcUrl, chainId: ctx.chainId });
        const sent = recordRequests();

        const first = await transfer(client, sender, 0n, gas).submitTransaction({
            senderAccount: sender,
            enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true },
        });
        const second = await transfer(client, sender, 1n, gas).submitTransaction({
            senderAccount: sender,
            enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true },
        });

        expect(first.status).toBe(TransactionStatus.Success);
        expect(second.status).toBe(TransactionStatus.Success);
        expect(requestsTo(sent, "/transactions/chain_id")).toHaveLength(1);
        expect(requestsTo(sent, "/transactions/submit")).toHaveLength(2);
    });

    test("a client takes the chain ID from the header of an earlier response", async () => {
        const sender = await createFundedAccount(ctx);
        const gas = await explicitGas(ctx);
        const client = new SupraClient({ rpcUrl: ctx.rpcUrl, chainId: ctx.chainId });
        const sent = recordRequests();

        const txn = await client.coin.transferSupraCoin({
            senderAccount: sender,
            receiverAccountAddress: createUnfundedAccount().address().toString(),
            amount: 1_000n,
            optionalTransactionArgs: {
                optionalTransactionPayloadArgs: gas,
                enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true },
            },
        });

        expect(txn.status).toBe(TransactionStatus.Success);
        expect(requestsTo(sent, "/transactions/chain_id")).toHaveLength(0);
    });

    test("getChainId of a new client returns the node's chain ID", async () => {
        const client = new SupraClient({ rpcUrl: ctx.rpcUrl, chainId: ctx.chainId });
        expect((await client.getChainId()).value).toBe(ctx.chainId);
    });

    test("with verifyChainId false a client builds and signs for its configured chain ID without a request", async () => {
        const sender = createUnfundedAccount();
        const offline = new SupraClient({ rpcUrl: ctx.rpcUrl, chainId: otherChainId(), verifyChainId: false });
        const sent = recordRequests();

        const rawTxn = transfer(offline, sender, 0n, { maxGas: 5_000n, gasUnitPrice: 100n });
        const signature = (await offline.transaction.signTransaction({ senderAccount: sender, rawTxn })) as HexString;
        const signed = await rawTxn.signedTransaction(sender);
        const payload = await offline.transaction.build.sendTxnPayload({ senderAccount: sender, rawTxn });
        const sponsored = (await offline.transaction.signTransaction({
            senderAccount: sender,
            rawTxn: new TxnBuilderTypes.FeePayerRawTransaction(
                rawTxn,
                [],
                new TxnBuilderTypes.AccountAddress(createUnfundedAccount().address().toUint8Array()),
            ),
        })) as TxnBuilderTypes.AccountAuthenticatorEd25519;

        expect(signature.toUint8Array()).toHaveLength(64);
        expect(signed.raw_txn.chain_id.value).toBe(otherChainId());
        expect(payload.Move.raw_txn.chain_id).toBe(otherChainId());
        expect(sponsored.signature.value).toHaveLength(64);
        expect((await offline.getChainId()).value).toBe(otherChainId());
        expect(sent).toHaveLength(0);
    });

    testPublicRead("getChainId of a Network.DEVNET client returns Devnet's chain ID 50 with one request", async () => {
        const devnet = new SupraClient({ network: Network.DEVNET });
        const sent = recordRequests();

        expect((await devnet.getChainId()).value).toBe(50);
        expect(sent).toEqual([{ method: "GET", url: "https://rpc-devnet.supra.com/rpc/v3/transactions/chain_id" }]);
    });
});
