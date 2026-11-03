import { SupraAccount } from "supra-l1-sdk-core";
import { SupraClient } from "../../api/supraClient";
import { SupraAPIError } from "../../errors/apiError";
import { SupraError } from "../../errors/supraError";
import type { MoveModule } from "../../types/move";
import type { OptionalTransactionPayloadArgs } from "../../types/transactionManager/transactionBuild";

/**
 * The node's maximum time to live (`GET /transactions/parameters`) as the bound of expiration times, with a stubbed
 * `fetch` that answers like a node.
 */

const RPC_URL = "http://node.test";
const NOW_SECONDS = 1_000_000;
const GAS = { maxGas: 5_000n, gasUnitPrice: 100n };

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

interface StubNode {
    /** The answers of `GET /transactions/parameters`, one per request; the last one repeats. */
    parameters: Array<{ status: number; body: unknown }>;
    /** The timestamp of the latest block, in milliseconds since the Unix epoch. */
    blockMs: number;
}

let node: StubNode;
let paths: string[];
const originalFetch = global.fetch;

function maximum(seconds: number): { status: number; body: unknown } {
    return { status: 200, body: { max_transaction_time_to_live_seconds: seconds } };
}

beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(NOW_SECONDS * 1_000);
    node = { parameters: [maximum(600)], blockMs: NOW_SECONDS * 1_000 };
    paths = [];
    global.fetch = jest.fn((input: string | URL | Request) => {
        const path = new URL(String(input)).pathname.replace(/^\/rpc\/v3/, "");
        paths.push(path);
        const answer = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
        if (path === "/transactions/parameters") {
            const next = node.parameters.length > 1 ? node.parameters.shift() : node.parameters[0];
            return answer(next?.body, next?.status);
        }
        if (path === "/transactions/chain_id") {
            return answer(255);
        }
        if (path === "/block") {
            return answer({
                header: {
                    author: "0x00",
                    hash: "0x00",
                    height: 1,
                    parent: "0x00",
                    timestamp: { microseconds_since_unix_epoch: node.blockMs * 1_000, utc_date_time: "" },
                    view: { epoch_id: { chain_id: 255, epoch: 1 }, round: 1 },
                },
                execution_statistics: null,
            });
        }
        return answer({ message: `unexpected ${path}` }, 500);
    }) as typeof fetch;
});

afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
});

function client(extra: { txExpirySecs?: number; verifyChainId?: boolean } = {}): SupraClient {
    return new SupraClient({ rpcUrl: RPC_URL, chainId: 255, ...extra });
}

function parameterReads(): number {
    return paths.filter((path) => path === "/transactions/parameters").length;
}

/** A transaction with the call's settings; `maxGas` and `gasUnitPrice` are set, so the build reads only the parameters. */
function build(supra: SupraClient, options: OptionalTransactionPayloadArgs = {}) {
    return supra.transaction.build.simple({
        senderAddress: new SupraAccount().address(),
        senderSequenceNumber: 0n,
        function: "0x1::coin::transfer",
        functionTypeArgs: ["0x1::supra_coin::SupraCoin"],
        functionArgs: [new SupraAccount().address(), 1n],
        abi: COIN_ABI,
        optionalTransactionPayloadArgs: { ...GAS, ...options },
    });
}

/** A transaction that expires `secs` after the client's clock, built without a request. */
function expiringIn(supra: SupraClient, secs: number) {
    return supra.transaction.build.rawTxnObject({
        senderAddress: new SupraAccount().address(),
        senderSequenceNumber: 0n,
        function: "0x1::supra_account::transfer",
        functionTypeArgs: [],
        functionArgs: [],
        optionalTransactionPayloadArgs: { ...GAS, txExpiryTime: BigInt(NOW_SECONDS + secs) },
    });
}

/** A transaction built without a request and without `txExpiryTime`. */
function offlineBuild(supra: SupraClient) {
    return supra.transaction.build.rawTxnObject({
        senderAddress: new SupraAccount().address(),
        senderSequenceNumber: 0n,
        function: "0x1::supra_account::transfer",
        functionTypeArgs: [],
        functionArgs: [],
        optionalTransactionPayloadArgs: GAS,
    });
}

describe("the default expiration time of a transaction", () => {
    it("is the default 60 s after the client's clock when the node's maximum is 600 s", async () => {
        const rawTxn = await build(client());

        expect(rawTxn.expiration_timestamp_secs).toBe(BigInt(NOW_SECONDS + 60));
    });

    it("stays 5 s below a node maximum that is below the old 600 s", async () => {
        node.parameters = [maximum(30)];

        const rawTxn = await build(client());

        expect(rawTxn.expiration_timestamp_secs).toBe(BigInt(NOW_SECONDS + 25));
    });

    it("uses txExpirySecs up to 5 s below a node maximum that is below 600 s", async () => {
        node.parameters = [maximum(300)];

        const rawTxn = await build(client({ txExpirySecs: 300 }));

        expect(rawTxn.expiration_timestamp_secs).toBe(BigInt(NOW_SECONDS + 295));
    });

    it("allows a txExpirySecs above 600 s when the node's maximum is above 600 s", async () => {
        node.parameters = [maximum(1_200)];

        expect((await build(client({ txExpirySecs: 900 }))).expiration_timestamp_secs).toBe(BigInt(NOW_SECONDS + 900));
        expect((await build(client({ txExpirySecs: 1_200 }))).expiration_timestamp_secs).toBe(
            BigInt(NOW_SECONDS + 1_195),
        );
    });

    it("is refused for a txExpirySecs above the node's maximum", async () => {
        node.parameters = [maximum(300)];

        await expect(build(client({ txExpirySecs: 301 }))).rejects.toThrow(RangeError);
        await expect(build(client({ txExpirySecs: 301 }))).rejects.toThrow(/301.*300/);
    });

    it("is at least 1 s after the client's clock", async () => {
        node.parameters = [maximum(3)];

        expect((await build(client())).expiration_timestamp_secs).toBe(BigInt(NOW_SECONDS + 1));
    });
});

describe("an expiration time above the node's maximum", () => {
    it("is refused before signing, with the node's value in the message", async () => {
        node.parameters = [maximum(300)];
        const supra = client();
        const sender = new SupraAccount();
        const signBuffer = jest.spyOn(sender, "signBuffer");

        const error: unknown = await supra.transaction
            .signTransaction({ senderAccount: sender, rawTxn: expiringIn(supra, 306) })
            .catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(RangeError);
        expect((error as RangeError).message).toContain("the node's maximum of 300 seconds");
        expect((error as RangeError).message).toContain("read from GET /rpc/v3/transactions/parameters");
        expect(signBuffer).not.toHaveBeenCalled();
    });

    it("is allowed 5 s of slack beyond the node's maximum, so that a time set from the node's clock is not refused", async () => {
        node.parameters = [maximum(300)];
        const supra = client();

        await expect(
            supra.transaction.signTransaction({ senderAccount: new SupraAccount(), rawTxn: expiringIn(supra, 305) }),
        ).resolves.toBeDefined();
        await expect(
            supra.transaction.signTransaction({ senderAccount: new SupraAccount(), rawTxn: expiringIn(supra, 306) }),
        ).rejects.toThrow(RangeError);
    });

    it("is measured from the chain time the client has read when that is ahead of its clock", async () => {
        node.parameters = [maximum(300)];
        const supra = client();
        // The node's latest block is 100 s ahead of the client's clock.
        node.blockMs = (NOW_SECONDS + 100) * 1_000;
        await supra.getLatestBlock();

        await expect(
            supra.transaction.signTransaction({ senderAccount: new SupraAccount(), rawTxn: expiringIn(supra, 400) }),
        ).resolves.toBeDefined();
        await expect(
            supra.transaction.signTransaction({ senderAccount: new SupraAccount(), rawTxn: expiringIn(supra, 420) }),
        ).rejects.toThrow(RangeError);
    });

    it("is signed when it is within the node's maximum, which can be above 600 s", async () => {
        node.parameters = [maximum(1_200)];
        const supra = client();
        const sender = new SupraAccount();

        await expect(
            supra.transaction.signTransaction({ senderAccount: sender, rawTxn: expiringIn(supra, 1_200) }),
        ).resolves.toBeDefined();
        await expect(
            supra.transaction.signTransaction({ senderAccount: sender, rawTxn: expiringIn(supra, 1_206) }),
        ).rejects.toThrow(RangeError);
    });

    it("is refused with a node maximum of 600 s above 600 s", async () => {
        const supra = client();

        await expect(
            supra.transaction.signTransaction({ senderAccount: new SupraAccount(), rawTxn: expiringIn(supra, 606) }),
        ).rejects.toThrow(RangeError);
    });

    it("is not checked, and no request is sent, when signing with verifyChainId false", async () => {
        const supra = client({ verifyChainId: false });

        await expect(
            supra.transaction.signTransaction({ senderAccount: new SupraAccount(), rawTxn: expiringIn(supra, 5_000) }),
        ).resolves.toBeDefined();
        expect(paths).toEqual([]);
    });
});

describe("reading the node's maximum", () => {
    it("happens once per client, and concurrent builds share the request", async () => {
        const first = client();

        await Promise.all([build(first), build(first)]);
        await build(first);
        await first.transaction.signTransaction({
            senderAccount: new SupraAccount(),
            rawTxn: expiringIn(first, 60),
        });
        await build(client());

        expect(parameterReads()).toBe(2);
    });

    it("is not repeated for a build whose call sets the expiration time and needs no other request", async () => {
        await build(client(), { txExpiryTime: BigInt(NOW_SECONDS + 100) });

        expect(paths).toEqual([]);
    });

    it("throws the error of a failed read, with no fallback, and the next call reads again", async () => {
        node.parameters = [{ status: 500, body: { message: "Internal Server Error" } }, maximum(300)];
        const supra = client();

        const error: unknown = await build(supra).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(SupraAPIError);
        expect((await build(supra)).expiration_timestamp_secs).toBe(BigInt(NOW_SECONDS + 60));
        expect(parameterReads()).toBe(2);
    });

    it("stops a signature before signing when the read fails", async () => {
        node.parameters = [{ status: 500, body: { message: "Internal Server Error" } }];
        const supra = client();
        const sender = new SupraAccount();
        const signBuffer = jest.spyOn(sender, "signBuffer");

        await expect(
            supra.transaction.signTransaction({ senderAccount: sender, rawTxn: expiringIn(supra, 60) }),
        ).rejects.toBeInstanceOf(SupraAPIError);
        expect(signBuffer).not.toHaveBeenCalled();
    });

    it.each([{}, { max_transaction_time_to_live_seconds: -1 }, { max_transaction_time_to_live_seconds: "600" }, 600])(
        "throws SupraError for the answer %j",
        async (body) => {
            node.parameters = [{ status: 200, body }];

            await expect(build(client())).rejects.toBeInstanceOf(SupraError);
        },
    );
});

describe("getTransactionParameters", () => {
    it("returns the node's value and the client uses it from then on", async () => {
        node.parameters = [maximum(300), maximum(900)];
        const supra = client();

        await expect(supra.getTransactionParameters()).resolves.toEqual({ max_transaction_time_to_live_seconds: 300 });
        await expect(supra.getTransactionParameters()).resolves.toEqual({ max_transaction_time_to_live_seconds: 900 });
        expect((await build(supra, {})).expiration_timestamp_secs).toBe(BigInt(NOW_SECONDS + 60));
        await expect(
            supra.transaction.signTransaction({ senderAccount: new SupraAccount(), rawTxn: expiringIn(supra, 900) }),
        ).resolves.toBeDefined();
        expect(parameterReads()).toBe(2);
    });
});

describe("builders that send no request", () => {
    it("use the assumed maximum of 600 s when the client has not read the node's", () => {
        const supra = client({ txExpirySecs: 600 });

        const rawTxn = supra.transaction.build.rawTxnObject({
            senderAddress: new SupraAccount().address(),
            senderSequenceNumber: 0n,
            function: "0x1::supra_account::transfer",
            functionTypeArgs: [],
            functionArgs: [],
            optionalTransactionPayloadArgs: GAS,
        });

        expect(rawTxn.expiration_timestamp_secs).toBe(BigInt(NOW_SECONDS + 595));
        expect(paths).toEqual([]);
    });

    it("use the maximum the client has read", async () => {
        node.parameters = [maximum(300)];
        const supra = client({ txExpirySecs: 300 });
        await supra.getTransactionParameters();

        expect(offlineBuild(supra).expiration_timestamp_secs).toBe(BigInt(NOW_SECONDS + 295));
    });

    it("throw a RangeError for a txExpirySecs above the assumed maximum, naming getTransactionParameters()", () => {
        const supra = client({ txExpirySecs: 601 });

        expect(() => offlineBuild(supra)).toThrow(RangeError);
        expect(() => offlineBuild(supra)).toThrow(/601.*assumed maximum of 600.*getTransactionParameters\(\)/);
        expect(paths).toEqual([]);
    });

    it("throw a RangeError for a txExpirySecs above the maximum the client has read, saying it was read", async () => {
        node.parameters = [maximum(300)];
        const supra = client({ txExpirySecs: 400 });
        await supra.getTransactionParameters();

        expect(() => offlineBuild(supra)).toThrow(/400.*the node's maximum of 300 seconds.*read from/);
    });

    it("accept a txExpirySecs above 600 once the client has read a larger maximum", async () => {
        node.parameters = [maximum(1_200)];
        const supra = client({ txExpirySecs: 900 });
        await supra.getTransactionParameters();

        expect(offlineBuild(supra).expiration_timestamp_secs).toBe(BigInt(NOW_SECONDS + 900));
    });
});
