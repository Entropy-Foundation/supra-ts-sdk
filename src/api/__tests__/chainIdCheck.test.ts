import { BCS, SupraAccount, TxnBuilderTypes, TypeTagParser } from "supra-l1-sdk-core";
import { SupraClient } from "../supraClient";
import { Network } from "../../utils/apiEndpoints";
import { SupraChainIdMismatchError } from "../../errors/chainIdError";
import { SupraServiceUnavailableError } from "../../errors/apiError";
import { SupraError } from "../../errors/supraError";
import type { MoveModule } from "../../types/move";

/**
 * The chain ID check of signing, with a stubbed `fetch` that answers like a node.
 */

const RPC_URL = "http://node.test";
const NODE_CHAIN_ID = 255;
const OTHER_CHAIN_ID = 254;
const HASH = "0x" + "5e".repeat(32);
const SUPRA_ACCOUNT_TRANSFER = "0x1::supra_account::transfer";
const GAS = { maxGas: 5_000n, gasUnitPrice: 100n };
const SUCCESS = {
    hash: HASH,
    status: "Success",
    txn_type: "user",
    output: { Move: { gas_used: 7, events: [], vm_status: "Executed successfully" } },
    block_header: null,
};

const COIN_ABI = {
    address: "0x1",
    name: "coin",
    friends: [],
    exposed_functions: [
        {
            name: "transfer",
            visibility: "public",
            is_entry: true,
            is_view: false,
            generic_type_params: [{ constraints: [] }],
            params: ["&signer", "address", "u64"],
            return: [],
        },
    ],
    structs: [],
} as const satisfies MoveModule;

/** The balance views that the SUPRA fungible asset transfers call before building the transaction. */
function balanceViewAbi(name: "coin" | "primary_fungible_store"): MoveModule {
    return {
        address: "0x1",
        name,
        friends: [],
        exposed_functions: [
            {
                name: "balance",
                visibility: "public",
                is_entry: false,
                is_view: true,
                generic_type_params: [{ constraints: [] }],
                params: name === "coin" ? ["address"] : ["address", "0x1::object::Object<T0>"],
                return: ["u64"],
            },
        ],
        structs: [],
    };
}

interface RecordedRequest {
    method: string;
    path: string;
}

interface StubNode {
    /** Adds `x-supra-chain-id` to every response. */
    header: boolean;
    /** Answers of `GET /transactions/chain_id`, one per request; the node's chain ID once they are used up. */
    chainIdAnswers: Array<{ status: number; body: unknown }>;
}

let node: StubNode;
let requests: RecordedRequest[];
const originalFetch = global.fetch;

function stubFetch(): void {
    global.fetch = jest.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        const path = url.pathname.replace(/^\/rpc\/v3/, "");
        const method = init?.method ?? "GET";
        requests.push({ method, path });

        const respond = (body: unknown, status = 200) =>
            Promise.resolve(
                new Response(JSON.stringify(body), {
                    status,
                    headers: node.header ? { "x-supra-chain-id": String(NODE_CHAIN_ID) } : {},
                }),
            );

        if (method === "GET" && path === "/transactions/chain_id") {
            const answer = node.chainIdAnswers.shift();
            return answer === undefined ? respond(NODE_CHAIN_ID) : respond(answer.body, answer.status);
        }
        if (method === "GET" && /^\/accounts\/0x[0-9a-f]+$/.test(path)) {
            return respond({ sequence_number: 0, authentication_key: "0x" + "00".repeat(32) });
        }
        const viewModule = /^\/accounts\/0x0{63}1\/modules\/(coin|primary_fungible_store)$/.exec(path)?.[1];
        if (method === "GET" && viewModule !== undefined) {
            return respond({ bytecode: "0x", abi: balanceViewAbi(viewModule as "coin" | "primary_fungible_store") });
        }
        if (method === "POST" && path === "/view") return respond({ result: ["1000000000"] });
        if (method === "POST" && path === "/transactions/simulate") return respond(SUCCESS);
        if (method === "POST" && path === "/transactions/submit") return respond(HASH);
        if (method === "GET" && path.startsWith("/transactions/")) return respond(SUCCESS);
        return respond({ message: `unexpected ${method} ${path}` }, 500);
    }) as typeof fetch;
}

/** A `fetch` that fails the test if it is called. */
function forbidFetch(): jest.Mock {
    const mock = jest.fn(() => {
        throw new Error("no request is expected");
    });
    global.fetch = mock as unknown as typeof fetch;
    return mock;
}

function chainIdRequests(): RecordedRequest[] {
    return requests.filter((request) => request.path === "/transactions/chain_id");
}

/** Submissions and simulations; the balance views of the SUPRA fungible asset transfers are not counted. */
function transactionPostRequests(): RecordedRequest[] {
    return requests.filter((request) => request.method === "POST" && request.path !== "/view");
}

function client(chainId: number, extra: { verifyChainId?: boolean } = {}): SupraClient {
    return new SupraClient({ rpcUrl: RPC_URL, chainId, ...extra });
}

function rawTransfer(supra: SupraClient, sender: SupraAccount) {
    return supra.transaction.build.rawTxnObject({
        senderAddress: sender.address(),
        senderSequenceNumber: 0n,
        function: SUPRA_ACCOUNT_TRANSFER,
        functionTypeArgs: [],
        functionArgs: [new SupraAccount().address().toUint8Array(), BCS.bcsSerializeUint64(1_000n)],
        optionalTransactionPayloadArgs: GAS,
    });
}

function feePayerPayload(supra: SupraClient, sender: SupraAccount) {
    return new TxnBuilderTypes.FeePayerRawTransaction(
        rawTransfer(supra, sender),
        [],
        new TxnBuilderTypes.AccountAddress(new SupraAccount().address().toUint8Array()),
    );
}

function multiAgentPayload(supra: SupraClient, sender: SupraAccount) {
    return new TxnBuilderTypes.MultiAgentRawTransaction(rawTransfer(supra, sender), [
        new TxnBuilderTypes.AccountAddress(new SupraAccount().address().toUint8Array()),
    ]);
}

type SigningPath = [string, (supra: SupraClient, sender: SupraAccount) => Promise<unknown>];

/** Every public path that signs with a `SupraAccount`. */
const SIGNING_PATHS: SigningPath[] = [
    [
        "transaction.signTransaction (raw transaction)",
        (supra, sender) =>
            supra.transaction.signTransaction({ senderAccount: sender, rawTxn: rawTransfer(supra, sender) }),
    ],
    [
        "transaction.signTransaction (multi-agent transaction)",
        (supra, sender) =>
            supra.transaction.signTransaction({ senderAccount: sender, rawTxn: multiAgentPayload(supra, sender) }),
    ],
    [
        "transaction.signTransaction (fee-payer transaction)",
        (supra, sender) =>
            supra.transaction.signTransaction({ senderAccount: sender, rawTxn: feePayerPayload(supra, sender) }),
    ],
    [
        "transaction.build.signedTransaction",
        (supra, sender) =>
            supra.transaction.build.signedTransaction({ senderAccount: sender, rawTxn: rawTransfer(supra, sender) }),
    ],
    [
        "transaction.build.sendTxnPayload",
        (supra, sender) =>
            supra.transaction.build.sendTxnPayload({ senderAccount: sender, rawTxn: rawTransfer(supra, sender) }),
    ],
    ["built transaction signTransaction", (supra, sender) => rawTransfer(supra, sender).signTransaction(sender)],
    ["built transaction signedTransaction", (supra, sender) => rawTransfer(supra, sender).signedTransaction(sender)],
    ["built transaction sendTxnPayload", (supra, sender) => rawTransfer(supra, sender).sendTxnPayload(sender)],
    ["built transaction simulate", (supra, sender) => rawTransfer(supra, sender).simulate(sender)],
    [
        "built transaction submitTransaction",
        (supra, sender) => rawTransfer(supra, sender).submitTransaction({ senderAccount: sender }),
    ],
    [
        "transaction.submit.submitRawTransaction",
        (supra, sender) =>
            supra.transaction.submit.submitRawTransaction({
                senderAccount: sender,
                rawTransaction: rawTransfer(supra, sender),
            }),
    ],
    [
        "transaction.submit.submitSerializedRawTransaction",
        (supra, sender) =>
            supra.transaction.submit.submitSerializedRawTransaction({
                senderAccount: sender,
                serializedRawTransaction: rawTransfer(supra, sender).toBytes(),
            }),
    ],
    [
        "coin.transferSupraCoin",
        (supra, sender) =>
            supra.coin.transferSupraCoin({
                senderAccount: sender,
                receiverAccountAddress: new SupraAccount().address().toString(),
                amount: 1n,
                optionalTransactionArgs: { optionalTransactionPayloadArgs: GAS },
            }),
    ],
    [
        "coin.transferCoin",
        (supra, sender) =>
            supra.coin.transferCoin({
                senderAccount: sender,
                receiverAccountAddress: new SupraAccount().address().toString(),
                amount: 1n,
                coinType: "0x1::supra_coin::SupraCoin",
                optionalTransactionArgs: { optionalTransactionPayloadArgs: GAS },
            }),
    ],
    [
        "fungibleAsset.transferSupraFungibleAsset",
        (supra, sender) =>
            supra.fungibleAsset.transferSupraFungibleAsset({
                senderAccount: sender,
                receiverAccountAddress: new SupraAccount().address().toString(),
                amount: 1n,
                optionalTransactionArgs: { optionalTransactionPayloadArgs: GAS },
            }),
    ],
    [
        "fungibleAsset.transferFungibleAsset",
        (supra, sender) =>
            supra.fungibleAsset.transferFungibleAsset({
                senderAccount: sender,
                receiverAccountAddress: new SupraAccount().address().toString(),
                amount: 1n,
                assetAddress: "0x" + "0".repeat(63) + "a",
                optionalTransactionArgs: { optionalTransactionPayloadArgs: GAS },
            }),
    ],
    [
        "transaction.publishPackage",
        (supra, sender) =>
            supra.transaction.publishPackage({
                senderAccount: sender,
                packageMetadata: Uint8Array.from([1, 2, 3]),
                modulesCode: [Uint8Array.from([4, 5, 6])],
                optionalTransactionArgs: { optionalTransactionPayloadArgs: GAS },
            }),
    ],
    [
        "contract entry function from ABI",
        (supra, sender) =>
            supra.contract.fromABI([COIN_ABI] as const).contracts.coin.entry.transfer({
                functionArguments: [sender, new SupraAccount().address().toString(), 1n],
                typeArguments: [new TypeTagParser("0x1::supra_coin::SupraCoin").parseTypeTag()],
                optionalTransactionPayloadArgs: GAS,
            }),
    ],
];

/** The signing paths that need no request besides the chain ID: building and signing only. */
const OFFLINE_SIGNING_PATHS = SIGNING_PATHS.slice(0, 8);

describe("chain ID check before signing", () => {
    let signBuffer: jest.SpiedFunction<SupraAccount["signBuffer"]>;

    beforeEach(() => {
        requests = [];
        node = { header: false, chainIdAnswers: [] };
        stubFetch();
        signBuffer = jest.spyOn(SupraAccount.prototype, "signBuffer");
    });

    afterEach(() => {
        global.fetch = originalFetch;
        signBuffer.mockRestore();
    });

    describe.each(SIGNING_PATHS)("%s", (_name, sign) => {
        it("throws SupraChainIdMismatchError before signing when the configured chain ID is not the node's", async () => {
            const error: unknown = await sign(client(OTHER_CHAIN_ID), new SupraAccount()).catch(
                (caught: unknown) => caught,
            );

            expect(error).toBeInstanceOf(SupraChainIdMismatchError);
            expect(error).toBeInstanceOf(SupraError);
            expect(error).toMatchObject({
                configuredChainId: OTHER_CHAIN_ID,
                nodeChainId: NODE_CHAIN_ID,
                transactionChainId: undefined,
            });
            expect(signBuffer).not.toHaveBeenCalled();
            expect(transactionPostRequests()).toHaveLength(0);
        });

        it("signs when the configured chain ID is the node's", async () => {
            await sign(client(NODE_CHAIN_ID), new SupraAccount());

            expect(signBuffer).toHaveBeenCalled();
            expect(chainIdRequests()).toHaveLength(1);
        });
    });

    describe.each(OFFLINE_SIGNING_PATHS)("%s with verifyChainId false", (_name, sign) => {
        it("signs for the configured chain ID without any request", async () => {
            const fetchMock = forbidFetch();

            await sign(client(OTHER_CHAIN_ID, { verifyChainId: false }), new SupraAccount());

            expect(signBuffer).toHaveBeenCalled();
            expect(fetchMock).not.toHaveBeenCalled();
        });
    });

    it("throws when the transaction was built for another chain than the node's", async () => {
        const sender = new SupraAccount();
        const rawTxn = rawTransfer(client(OTHER_CHAIN_ID, { verifyChainId: false }), sender);

        const error: unknown = await client(NODE_CHAIN_ID)
            .transaction.signTransaction({
                senderAccount: sender,
                rawTxn: feePayerPayload(client(OTHER_CHAIN_ID, { verifyChainId: false }), sender),
            })
            .catch((caught: unknown) => caught);
        const rawError: unknown = await client(NODE_CHAIN_ID)
            .transaction.signTransaction({ senderAccount: sender, rawTxn })
            .catch((caught: unknown) => caught);

        for (const caught of [error, rawError]) {
            expect(caught).toBeInstanceOf(SupraChainIdMismatchError);
            expect(caught).toMatchObject({
                configuredChainId: NODE_CHAIN_ID,
                nodeChainId: NODE_CHAIN_ID,
                transactionChainId: OTHER_CHAIN_ID,
                message: `The transaction's chain ID ${OTHER_CHAIN_ID} does not match the node's chain ID ${NODE_CHAIN_ID}`,
            });
        }
        expect(signBuffer).not.toHaveBeenCalled();
    });

    it("sends one chain ID request for concurrent first signatures", async () => {
        const supra = client(NODE_CHAIN_ID);
        const sender = new SupraAccount();

        await Promise.all(
            Array.from({ length: 5 }, () =>
                supra.transaction.signTransaction({ senderAccount: sender, rawTxn: rawTransfer(supra, sender) }),
            ),
        );
        await supra.transaction.signTransaction({ senderAccount: sender, rawTxn: rawTransfer(supra, sender) });

        expect(chainIdRequests()).toHaveLength(1);
        expect(signBuffer).toHaveBeenCalledTimes(6);
    });

    it("rejects concurrent first signatures together when the configured chain ID is not the node's", async () => {
        const supra = client(OTHER_CHAIN_ID);
        const sender = new SupraAccount();

        const results = await Promise.allSettled(
            Array.from({ length: 3 }, () =>
                supra.transaction.signTransaction({ senderAccount: sender, rawTxn: rawTransfer(supra, sender) }),
            ),
        );

        expect(results.map((result) => result.status)).toEqual(["rejected", "rejected", "rejected"]);
        expect(chainIdRequests()).toHaveLength(1);
        expect(signBuffer).not.toHaveBeenCalled();
    });

    it("takes the chain ID from the x-supra-chain-id header of an earlier response", async () => {
        node.header = true;
        const supra = client(NODE_CHAIN_ID);
        const sender = new SupraAccount();

        await supra.coin.transferSupraCoin({
            senderAccount: sender,
            receiverAccountAddress: new SupraAccount().address().toString(),
            amount: 1n,
            optionalTransactionArgs: { optionalTransactionPayloadArgs: GAS },
        });

        expect(chainIdRequests()).toHaveLength(0);
        expect(signBuffer).toHaveBeenCalled();
        expect((await supra.getChainId()).value).toBe(NODE_CHAIN_ID);
        expect(chainIdRequests()).toHaveLength(0);
    });

    it("throws on a mismatch learnt from the header without a chain ID request", async () => {
        node.header = true;
        const supra = client(OTHER_CHAIN_ID);
        const sender = new SupraAccount();
        await supra.account.getAccountInfo({ accountAddress: sender.address() });

        await expect(
            supra.transaction.signTransaction({ senderAccount: sender, rawTxn: rawTransfer(supra, sender) }),
        ).rejects.toBeInstanceOf(SupraChainIdMismatchError);
        expect(chainIdRequests()).toHaveLength(0);
    });

    it("sends a new chain ID request after a failed one", async () => {
        node.chainIdAnswers = [{ status: 503, body: { message: "Service Unavailable" } }];
        const supra = client(NODE_CHAIN_ID);
        const sender = new SupraAccount();

        await expect(
            supra.transaction.signTransaction({ senderAccount: sender, rawTxn: rawTransfer(supra, sender) }),
        ).rejects.toBeInstanceOf(SupraServiceUnavailableError);
        expect(signBuffer).not.toHaveBeenCalled();

        await supra.transaction.signTransaction({ senderAccount: sender, rawTxn: rawTransfer(supra, sender) });
        expect(chainIdRequests()).toHaveLength(2);
        expect(signBuffer).toHaveBeenCalledTimes(1);
    });

    it("throws when the node's chain ID is not a chain ID", async () => {
        node.chainIdAnswers = [{ status: 200, body: "255x" }];
        const supra = client(NODE_CHAIN_ID);
        const sender = new SupraAccount();

        await expect(
            supra.transaction.signTransaction({ senderAccount: sender, rawTxn: rawTransfer(supra, sender) }),
        ).rejects.toThrow("not a chain ID");
        expect(signBuffer).not.toHaveBeenCalled();
    });

    it("keeps the node's chain ID per client", async () => {
        const first = client(NODE_CHAIN_ID);
        const second = client(NODE_CHAIN_ID);

        await first.getChainId();
        await first.getChainId();
        await second.getChainId();

        expect(chainIdRequests()).toHaveLength(2);
    });

    it("uses the chain ID of a predefined network for the check", async () => {
        const testnet = new SupraClient({ network: Network.TESTNET });
        const sender = new SupraAccount();

        const error: unknown = await testnet.transaction
            .signTransaction({ senderAccount: sender, rawTxn: rawTransfer(testnet, sender) })
            .catch((caught: unknown) => caught);

        expect(error).toMatchObject({ configuredChainId: 6, nodeChainId: NODE_CHAIN_ID });
        expect(requests).toEqual([{ method: "GET", path: "/transactions/chain_id" }]);
    });

    it("signs offline for a predefined network with verifyChainId false", async () => {
        const fetchMock = forbidFetch();
        const mainnet = new SupraClient({ network: Network.MAINNET, verifyChainId: false });
        const sender = new SupraAccount();

        const signed = await mainnet.transaction.build.signedTransaction({
            senderAccount: sender,
            rawTxn: rawTransfer(mainnet, sender),
        });

        expect(signed.raw_txn.chain_id.value).toBe(8);
        expect((await mainnet.getChainId()).value).toBe(8);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe("chain ID configuration", () => {
    it.each([256, -1, 1.5, Number.NaN])("rejects chainId %p", (chainId) => {
        expect(() => new SupraClient({ rpcUrl: RPC_URL, chainId })).toThrow(RangeError);
    });

    it.each([0, 255])("accepts chainId %p", (chainId) => {
        expect(new SupraClient({ rpcUrl: RPC_URL, chainId }).networkInformation.chainId).toBe(chainId);
    });

    it("rejects a verifyChainId that is not a boolean", () => {
        expect(
            () => new SupraClient({ rpcUrl: RPC_URL, chainId: 1, verifyChainId: "no" as unknown as boolean }),
        ).toThrow(TypeError);
    });

    it("leaves verifyChainId out of the network information when it is not set", () => {
        expect("verifyChainId" in new SupraClient({ network: Network.TESTNET }).networkInformation).toBe(false);
        expect(
            new SupraClient({ network: Network.TESTNET, verifyChainId: false }).networkInformation.verifyChainId,
        ).toBe(false);
    });

    it("sends no request from the constructor", () => {
        const fetchMock = jest.fn();
        global.fetch = fetchMock as unknown as typeof fetch;
        try {
            new SupraClient({ rpcUrl: RPC_URL, chainId: 1 });
            new SupraClient({ network: Network.DEVNET });
        } finally {
            global.fetch = originalFetch;
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
