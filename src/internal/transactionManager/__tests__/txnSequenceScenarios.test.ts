import { HexString, SupraAccount } from "supra-l1-sdk-core";
import { SupraAccountQueueFullError, SupraAPIError } from "../../../errors/apiError";
import { SupraSimulationFailedError } from "../../../errors/transactionError";
import { MockNode, u64Mark, type MockNodeOptions } from "./helpers/mockNode";
import { MAX_TX_EXPIRATION_DURATION, TX_EXPIRATION_MARGIN_SECS } from "../../../utils/constants";
import { ClientClock, newClient, transfer, type TransferOptions } from "./helpers/transfers";

/**
 * Helper calls of one client from one account against a node answered from memory (`MockNode`), with block timestamps
 * and transactions that expire. The counter keeps the number of every transaction this client submitted until the
 * chain's number passes it, a block read from the node reaches its expiration time, or a read shows it `Invalid`.
 */

const originalFetch = global.fetch;
let node: MockNode | undefined;

function start(options: MockNodeOptions = {}): MockNode {
    node?.stop();
    const started = new MockNode(options);
    node = started;
    global.fetch = started.fetch;
    return started;
}

afterEach(() => {
    node?.stop();
    node = undefined;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
});

/** An expiration time 500 seconds after the node's latest block. */
const later = (mock: MockNode) => BigInt(mock.blockSeconds() + 500);

/** The sequence numbers of the accepted submissions, in order of arrival. */
const acceptedNumbers = (mock: MockNode) =>
    mock.submissions.filter((submission) => submission.status === 200).map((submission) => submission.sequenceNumber);

/** The settled outcomes of `calls`, as "fulfilled" or the name of the error. */
async function outcomes(calls: Array<Promise<unknown>>): Promise<string[]> {
    return (await Promise.allSettled(calls)).map((result) =>
        result.status === "fulfilled" ? "fulfilled" : (result.reason as Error).name,
    );
}

describe("request counts", () => {
    beforeEach(() => {
        // The mock node does not verify signatures; a fixed signature keeps the runs fast.
        jest.spyOn(SupraAccount.prototype, "signBuffer").mockReturnValue(new HexString("00".repeat(64)));
    });

    const cases: Array<[string, TransferOptions]> = [
        ["the estimated max gas", {}],
        ["the estimated max gas and the simulation before submission", { simulate: true }],
        ["an explicit max gas", { maxGas: 5_000n }],
        ["an explicit max gas and the simulation before submission", { maxGas: 5_000n, simulate: true }],
    ];

    it.each(cases)("of a first call, a call behind it and Promise.all of five, with %s", async (_name, options) => {
        const first = start();
        let supra = newClient();
        let sender = new SupraAccount();
        await transfer(supra, sender, options);
        const single = { ...first.counts };
        for (const kind of Object.keys(first.counts)) {
            first.counts[kind] = 0;
        }
        await transfer(supra, sender, options);
        const behind = Object.fromEntries(Object.entries(first.counts).filter(([, count]) => count > 0));

        const all = start();
        supra = newClient();
        sender = new SupraAccount();
        await Promise.all(Array.from({ length: 5 }, () => transfer(supra, sender, options)));

        const estimate = options.maxGas === undefined;
        const simulate = options.simulate === true;
        // Every call that sets no gas unit price reads the node's estimate once: the read starts before the call
        // requests the account's lock and is awaited inside it, before building. The first call reads the
        // account and the latest block, the chain ID before signing, the balance and one simulation for an estimate,
        // one simulation before submission, and the transaction after submission.
        expect(single).toEqual({
            estimate_gas_price: 1,
            account: 1,
            block: 1,
            chain_id: 1,
            ...(estimate ? { view: 1 } : {}),
            ...(estimate || simulate ? { simulate: (estimate ? 1 : 0) + (simulate ? 1 : 0) } : {}),
            submit: 1,
            transaction: 1,
        });
        // Behind a pending transaction, each simulation reports the number as too new and is made again at the
        // chain's number after a read of the account and the latest block.
        const checks = (estimate ? 1 : 0) + (simulate ? 1 : 0);
        expect(behind).toEqual({
            estimate_gas_price: 1,
            ...(checks > 0 ? { account: checks, block: checks } : {}),
            ...(estimate ? { view: 1 } : {}),
            ...(checks > 0 ? { simulate: 2 * checks } : {}),
            submit: 1,
            transaction: 1,
        });
        expect(all.counts).toEqual({
            estimate_gas_price: 5,
            account: 1 + 4 * checks,
            block: 1 + 4 * checks,
            chain_id: 1,
            ...(estimate ? { view: 5 } : {}),
            ...(estimate || simulate ? { simulate: 5 * checks + 4 * checks } : {}),
            submit: 5,
            transaction: 5,
        });
        expect(all.pooled()).toEqual([5, 6, 7, 8, 9]);
    });
});

describe("transfers whose transactions the node drops or never receives", () => {
    it("submits the other two of three with an explicit max gas when the middle one has an invalid receiver", async () => {
        const mock = start({ blockMs: 300 });
        const supra = newClient();
        const sender = new SupraAccount();
        const invalid = supra.coin.transferSupraCoin({
            senderAccount: sender,
            receiverAccountAddress: "0xzz",
            amount: 1n,
            optionalTransactionArgs: { optionalTransactionPayloadArgs: { maxGas: 5_000n } },
        });

        const results = await outcomes([
            transfer(supra, sender, { maxGas: 5_000n }),
            invalid,
            transfer(supra, sender, { maxGas: 5_000n }),
        ]);

        // The receiver is refused before the call takes a number.
        expect(results).toEqual(["fulfilled", "Error", "fulfilled"]);
        expect(mock.submitted).toEqual([5, 6]);
    });

    it("fills the number of an expired transaction while the one below it is pending", async () => {
        const mock = start();
        const clock = new ClientClock();
        const supra = newClient();
        const sender = new SupraAccount();
        await transfer(supra, sender, { txExpiryTime: later(mock) });
        await transfer(supra, sender);

        clock.advance(mock, 61_000);
        expect(mock.pooled()).toEqual([5]);
        await transfer(supra, sender);

        expect(mock.submitted).toEqual([5, 6, 6]);
        mock.tick();
        expect(mock.chain).toBe(7);
    });

    it("gives the number of a transaction that a read shows Invalid to one of two calls in flight", async () => {
        const mock = start({ latencyMs: [30, 0] });
        const supra = newClient();
        const sender = new SupraAccount();
        await transfer(supra, sender);
        mock.drop(5, "Invalid");

        const calls = Promise.all([transfer(supra, sender), transfer(supra, sender)]);
        await new Promise((resolve) => setTimeout(resolve, 10));
        const read = await supra.getTransactionByHash({ transactionHash: mock.submissionHash(5) });
        await calls;

        expect(read.status).toBe("Invalid");
        // No number was submitted twice while it was pending.
        expect(mock.submissions.every((submission) => submission.status === 200)).toBe(true);
        expect(mock.pooled()).toEqual([5, 6]);
        mock.tick();
        expect(mock.chain).toBe(7);
    });

    it("waits behind an unknown outcome that the node never accepted, then fills its number once it has expired", async () => {
        const mock = start();
        const clock = new ClientClock();
        const supra = newClient();
        const sender = new SupraAccount();
        mock.refuseNext.set(6, { status: 500, message: "Internal error" });

        const results = await outcomes([
            transfer(supra, sender, { txExpiryTime: later(mock) }),
            transfer(supra, sender),
            transfer(supra, sender, { txExpiryTime: later(mock) }),
            transfer(supra, sender, { txExpiryTime: later(mock) }),
        ]);
        expect(results).toEqual(["fulfilled", "SupraAPIError", "fulfilled", "fulfilled"]);
        // 7 and 8 wait in the node behind 6; nothing commits after 5.
        mock.tick();
        expect(mock.chain).toBe(6);
        expect(mock.pooled()).toEqual([7, 8]);

        // A call before 6 has expired takes 9.
        await transfer(supra, sender, { txExpiryTime: later(mock) });
        expect(mock.pooled()).toEqual([7, 8, 9]);

        clock.advance(mock, 61_000);
        await transfer(supra, sender);

        expect(acceptedNumbers(mock)).toEqual([5, 7, 8, 9, 6]);
        mock.tick();
        expect(mock.chain).toBe(10);
    });

    it("with an explicit max gas, fills the number of an unknown outcome once the estimated chain time has passed it", async () => {
        const mock = start();
        const clock = new ClientClock();
        const supra = newClient();
        const sender = new SupraAccount();
        const gas = { maxGas: 5_000n };
        mock.refuseNext.set(6, { status: 500, message: "Internal error" });
        await transfer(supra, sender, { ...gas, txExpiryTime: later(mock) });
        await expect(transfer(supra, sender, gas)).rejects.toBeInstanceOf(SupraAPIError);
        await transfer(supra, sender, { ...gas, txExpiryTime: later(mock) });
        const reads = mock.counts["account"];

        // There is no simulation: the counter reads the chain because the estimated chain time has passed 6's
        // expiration time.
        clock.advance(mock, 63_000);
        await transfer(supra, sender, gas);

        expect(mock.counts["account"]).toBe((reads ?? 0) + 1);
        expect(acceptedNumbers(mock)).toEqual([5, 7, 6]);
        mock.tick();
        expect(mock.chain).toBe(8);
    });

    it("keeps the number of an unknown outcome that the node accepted", async () => {
        const mock = start();
        const supra = newClient();
        const sender = new SupraAccount();
        mock.refuseNext.set(6, { status: 500, message: "Internal error", pool: true });

        const results = await outcomes(Array.from({ length: 4 }, () => transfer(supra, sender)));
        expect(results).toEqual(["fulfilled", "SupraAPIError", "fulfilled", "fulfilled"]);
        await transfer(supra, sender);
        mock.tick();
        await transfer(supra, sender);

        expect(mock.submissions.filter((submission) => submission.status === 400)).toEqual([]);
        expect(mock.submitted).toEqual([5, 6, 7, 8, 9, 10]);
        mock.tick();
        expect(mock.chain).toBe(11);
    });

    it("fills the number of a transaction a read shows Invalid while later ones of this client are pending", async () => {
        const mock = start();
        const supra = newClient();
        const sender = new SupraAccount();
        for (let index = 0; index < 3; index += 1) {
            await transfer(supra, sender);
        }
        mock.drop(5, "Invalid");
        await supra.getTransactionByHash({ transactionHash: mock.submissionHash(5) });

        for (let index = 0; index < 3; index += 1) {
            await transfer(supra, sender);
        }

        expect(mock.submitted).toEqual([5, 6, 7, 5, 8, 9]);
        mock.tick();
        expect(mock.chain).toBe(10);
    });

    it("submits thirty concurrent transfers while blocks commit them", async () => {
        jest.spyOn(SupraAccount.prototype, "signBuffer").mockReturnValue(new HexString("00".repeat(64)));
        const mock = start({ blockMs: 50, latencyMs: [1, 2] });
        const supra = newClient();
        const sender = new SupraAccount();

        const results = await outcomes(Array.from({ length: 30 }, () => transfer(supra, sender)));

        expect(results.every((result) => result === "fulfilled")).toBe(true);
        expect([...mock.submitted].sort((a, b) => a - b)).toEqual(Array.from({ length: 30 }, (_, index) => 5 + index));
    }, 20_000);

    it("does not read transactions by hash in the checks before submission", async () => {
        const mock = start();
        const supra = newClient();
        const sender = new SupraAccount();

        for (let index = 0; index < 4; index += 1) {
            await transfer(supra, sender, { simulate: true });
        }

        expect(mock.submitted).toEqual([5, 6, 7, 8]);
        // The reads by hash are the read-backs after each submission.
        expect(mock.counts["transaction"]).toBe(4);
    });

    it("pipelines behind its pending transactions when the RPC node answers 404 for them", async () => {
        const mock = start();
        mock.pendingVisible = false;
        const supra = newClient();
        const sender = new SupraAccount();

        const results = await outcomes([transfer(supra, sender), transfer(supra, sender), transfer(supra, sender)]);

        expect(results).toEqual(["fulfilled", "fulfilled", "fulfilled"]);
        expect(mock.pooled()).toEqual([5, 6, 7]);
        mock.tick();
        expect(mock.chain).toBe(8);
    });

    it("keeps the order of the calls when the first one finds an expired number", async () => {
        const mock = start();
        const clock = new ClientClock();
        const supra = newClient();
        const sender = new SupraAccount();
        await transfer(supra, sender, { txExpiryTime: later(mock) });
        await transfer(supra, sender);
        // The first of the next calls finds 6 expired.
        clock.advance(mock, 61_000);

        await Promise.all([
            transfer(supra, sender, { amount: 1_001n }),
            transfer(supra, sender, { amount: 1_002n }),
            transfer(supra, sender, { amount: 1_003n }),
        ]);

        const accepted = mock.submissions.filter((submission) => submission.status === 200).slice(2);
        expect(accepted.map((submission) => submission.sequenceNumber)).toEqual([6, 7, 8]);
        expect(accepted.map((submission) => submission.body.includes(u64Mark(1_001n)))).toEqual([true, false, false]);
        expect(accepted.map((submission) => submission.body.includes(u64Mark(1_002n)))).toEqual([false, true, false]);
        expect(accepted.map((submission) => submission.body.includes(u64Mark(1_003n)))).toEqual([false, false, true]);
        mock.tick();
        expect(mock.chain).toBe(9);
    });

    it("throws SupraAccountQueueFullError beyond the node's queue, and submits once a transaction has committed", async () => {
        jest.spyOn(SupraAccount.prototype, "signBuffer").mockReturnValue(new HexString("00".repeat(64)));
        const mock = start({ latencyMs: [1, 1] });
        const supra = newClient();
        const sender = new SupraAccount();

        const results = await outcomes(Array.from({ length: 27 }, () => transfer(supra, sender)));

        expect(results.slice(0, 25).every((result) => result === "fulfilled")).toBe(true);
        expect(results.slice(25)).toEqual(["SupraAccountQueueFullError", "SupraAccountQueueFullError"]);
        // Not retried: 30 was refused twice, once per call.
        expect(mock.submitted.filter((number) => number === 30)).toHaveLength(2);

        // One commit: the queue holds 6 to 30.
        const first = mock.pool.get(5);
        expect(first).toBeDefined();
        mock.pool.delete(5);
        mock.committed.set((first as { hash: string }).hash, 5);
        mock.chain = 6;
        await transfer(supra, sender);

        expect(acceptedNumbers(mock).at(-1)).toBe(30);
    }, 20_000);

    it("surfaces the queue-full refusal with the refused number", async () => {
        const mock = start({ window: 2 });
        const supra = newClient();
        const sender = new SupraAccount();
        await transfer(supra, sender, { maxGas: 5_000n });
        await transfer(supra, sender, { maxGas: 5_000n });

        const error = await transfer(supra, sender, { maxGas: 5_000n }).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(SupraAccountQueueFullError);
        expect(error).toBeInstanceOf(SupraAPIError);
        expect((error as SupraAccountQueueFullError).sequenceNumber).toBe(7n);
        expect(mock.submitted).toEqual([5, 6, 7]);
    });
});

describe("the expiration time of a transaction the helpers build", () => {
    it.each([
        ["ahead of", 30_000],
        ["behind", -30_000],
    ])("is 60 seconds after the client's clock with a client clock 30 s %s the chain's", async (_name, offsetMs) => {
        const mock = start();
        const clock = new ClientClock(offsetMs);
        const supra = newClient();
        const sender = new SupraAccount();

        await transfer(supra, sender);
        const expiration = mock.submissions[0]?.expiration ?? 0;
        const clientSeconds = () => Math.floor(Date.now() / 1000);
        expect(clientSeconds() + 60 - expiration).toBeGreaterThanOrEqual(0);
        expect(clientSeconds() + 60 - expiration).toBeLessThanOrEqual(1);

        // 20 s of chain time later the transaction at 5 has not expired, and its number is not handed out again.
        clock.advance(mock, 20_000);
        await transfer(supra, sender);
        expect(mock.submitted).toEqual([5, 6]);
        const second = mock.submissions[1]?.expiration ?? 0;
        expect(clientSeconds() + 60 - second).toBeGreaterThanOrEqual(0);
        expect(clientSeconds() + 60 - second).toBeLessThanOrEqual(1);
    });

    it("is refused by the node, and thrown, when the client's clock is behind the chain's by more than the window", async () => {
        const mock = start();
        new ClientClock(-90_000);
        const supra = newClient();
        const sender = new SupraAccount();

        const error = await transfer(supra, sender, { maxGas: 5_000n }).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(SupraAPIError);
        expect((error as SupraAPIError).message).toMatch(/expiration timestamp is in the past/);
        expect(mock.submitted).toEqual([5]);
        expect(mock.pooled()).toEqual([]);
    });

    it("follows SupraConfig.txExpirySecs", async () => {
        const mock = start();
        const supra = newClient({ txExpirySecs: 300 });

        await transfer(supra, new SupraAccount());

        const expiration = mock.submissions[0]?.expiration ?? 0;
        expect(expiration - mock.blockSeconds()).toBeGreaterThanOrEqual(299);
        expect(expiration - mock.blockSeconds()).toBeLessThanOrEqual(301);
    });

    it("keeps every record while the chain produces no blocks", async () => {
        const mock = start();
        const clock = new ClientClock();
        const supra = newClient();
        const sender = new SupraAccount();
        await transfer(supra, sender);
        await transfer(supra, sender);
        mock.stallBlocks();

        clock.advance(mock, 120_000);
        await transfer(supra, sender);
        await transfer(supra, sender, { maxGas: 5_000n });

        // The latest block is older than the expiration times of 5 and 6, which can still commit.
        expect(mock.submitted).toEqual([5, 6, 7, 8]);
        expect(mock.pooled()).toEqual([5, 6, 7, 8]);
    });

    it("throws the error of a failed account read in the check, before submission and in the estimate alike", async () => {
        const mock = start();
        const supra = newClient();
        const sender = new SupraAccount();
        await transfer(supra, sender, { maxGas: 5_000n });

        mock.failAccountReads = 1;
        const presubmit = await transfer(supra, sender, { maxGas: 5_000n, simulate: true }).catch((e: unknown) => e);
        mock.failAccountReads = 1;
        const estimate = await transfer(supra, sender).catch((e: unknown) => e);

        expect((presubmit as SupraAPIError).status).toBe(503);
        expect((estimate as SupraAPIError).status).toBe(503);
        expect(mock.submitted).toEqual([5]);
        // The number was not used: the next call takes it.
        await transfer(supra, sender);
        expect(mock.submitted).toEqual([5, 6]);
    });

    it("pipelines when the read of the latest block fails in the check", async () => {
        const mock = start();
        const supra = newClient();
        const sender = new SupraAccount();
        await transfer(supra, sender);

        mock.failBlockReads = 2;
        await transfer(supra, sender, { simulate: true });

        expect(mock.submitted).toEqual([5, 6]);
    });

    it("throws the estimate's simulation failure at the chain's number and submits nothing", async () => {
        const mock = start();
        const supra = newClient();
        const sender = new SupraAccount();
        await transfer(supra, sender);

        const error = await transfer(supra, sender, { amount: 0x0102030405n }).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(SupraSimulationFailedError);
        expect(mock.submitted).toEqual([5]);
    });
});

/** A `fetch` that answers the requests `answer` returns a response for, and passes the others to `mock`. */
function intercept(mock: MockNode, answer: (path: string, method: string) => unknown): typeof fetch {
    return (async (input: string | URL | Request, init?: RequestInit) => {
        const body = answer(new URL(String(input)).pathname, init?.method ?? "GET");
        if (body === undefined) {
            return mock.fetch(input, init);
        }
        return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
}

/** The body of a latest block at `ms` milliseconds since the Unix epoch. */
function blockAtMs(ms: number): unknown {
    return {
        header: {
            height: 1,
            timestamp: { microseconds_since_unix_epoch: Math.floor(ms) * 1000, utc_date_time: "" },
            view: { epoch_id: { chain_id: 255, epoch: 1 }, round: 1 },
        },
        execution_statistics: null,
    };
}

describe("reads of the chain, chain time and expiration times", () => {
    beforeEach(() => {
        jest.spyOn(SupraAccount.prototype, "signBuffer").mockReturnValue(new HexString("00".repeat(64)));
    });

    it("reads the chain again at the next call when the block read at an expiration trigger fails", async () => {
        const mock = start({ latencyMs: [1, 1] });
        const clock = new ClientClock();
        const supra = newClient();
        const sender = new SupraAccount();
        const gas = { maxGas: 5_000n };
        // 5 is answered with 500 and not pooled: an unknown outcome the node never accepted.
        mock.refuseNext.set(5, { status: 500, message: "Internal error" });
        await expect(transfer(supra, sender, gas)).rejects.toBeInstanceOf(SupraAPIError);
        clock.advance(mock, 30_000);
        await transfer(supra, sender, gas);

        // Past 5's expiration time by more than two seconds, the block read fails once.
        clock.advance(mock, 33_000);
        mock.failBlockReads = 1;
        await transfer(supra, sender, gas);
        expect(acceptedNumbers(mock)).toEqual([6, 7]);

        clock.advance(mock, 5_000);
        await transfer(supra, sender, gas);
        expect(acceptedNumbers(mock)).toEqual([6, 7, 5]);
        mock.tick();
        expect(mock.chain).toBe(8);
    });

    it("reads the chain again at the next call when the block read at an expiration trigger has not reached it", async () => {
        const mock = start({ latencyMs: [1, 1] });
        const clock = new ClientClock();
        const supra = newClient();
        const sender = new SupraAccount();
        const gas = { maxGas: 5_000n };
        mock.refuseNext.set(5, { status: 500, message: "Internal error" });
        await expect(transfer(supra, sender, gas)).rejects.toBeInstanceOf(SupraAPIError);
        clock.advance(mock, 30_000);
        await transfer(supra, sender, gas);

        // The chain stops producing blocks 2 s before 5's expiration time.
        clock.advance(mock, 28_000);
        mock.stallBlocks();
        clock.advance(mock, 5_000);
        await transfer(supra, sender, gas);
        expect(acceptedNumbers(mock)).toEqual([6, 7]);

        mock.resumeBlocks();
        clock.advance(mock, 5_000);
        await transfer(supra, sender, gas);
        expect(acceptedNumbers(mock)).toEqual([6, 7, 5]);
    });

    it("pipelines behind a pending transaction when the account read lags the chain number the client observed", async () => {
        const mock = start({ latencyMs: [1, 1] });
        const supra = newClient();
        const sender = new SupraAccount();
        await transfer(supra, sender);
        mock.tick();
        // The read shows 5 committed: the account's number is at least 6.
        expect((await supra.getTransactionByHash({ transactionHash: mock.submissionHash(5) })).status).toBe("Success");
        await transfer(supra, sender);

        // From now on account reads come from an RPC node one commit behind.
        global.fetch = intercept(mock, (path, method) =>
            method === "GET" && /\/accounts\/0x[0-9a-f]+$/.test(path)
                ? { sequence_number: mock.chain - 1, authentication_key: "0x" + "00".repeat(32) }
                : undefined,
        );
        await transfer(supra, sender);
        await transfer(supra, sender, { simulate: true, maxGas: 5_000n });

        expect(mock.submitted).toEqual([5, 6, 7, 8]);
        expect(mock.log).toContain("SIMULATE 6 (chain 6) -> Success");
    });

    it("keeps its chain time and the expiration times of built transactions after a read of an old block by height", async () => {
        const mock = start();
        const supra = newClient();
        const sender = new SupraAccount();
        global.fetch = intercept(mock, (path) =>
            path.endsWith("/block/height/1") ? blockAtMs(mock.blockMs() - 30 * 86_400_000) : undefined,
        );

        await supra.getBlockByHeight({ height: 1 });
        const built = supra.transaction.build.rawTxnObject({
            senderAddress: sender.address(),
            senderSequenceNumber: 5n,
            function: "0x1::supra_account::transfer",
            functionTypeArgs: [],
            functionArgs: [],
            optionalTransactionPayloadArgs: { gasUnitPrice: 100_000n },
        });
        expect(Number(built.expiration_timestamp_secs) - Math.floor(Date.now() / 1000)).toBe(60);

        await transfer(supra, sender, { sequenceNumber: 5n, maxGas: 5_000n });
        expect(mock.pooled()).toEqual([5]);
    });

    it("submits when the first latest block read comes from a node 120 s behind the chain", async () => {
        const mock = start();
        const supra = newClient();
        const sender = new SupraAccount();
        let lagging = 1;
        global.fetch = intercept(mock, (path, method) => {
            if (method === "GET" && path.endsWith("/block") && lagging > 0) {
                lagging -= 1;
                return blockAtMs(mock.blockMs() - 120_000);
            }
            return undefined;
        });

        for (let index = 0; index < 4; index += 1) {
            await transfer(supra, sender, index % 2 === 0 ? {} : { maxGas: 5_000n });
        }

        expect(acceptedNumbers(mock)).toEqual([5, 6, 7, 8]);
    });

    it(`is accepted with txExpirySecs ${MAX_TX_EXPIRATION_DURATION} by a node whose clock is up to ${TX_EXPIRATION_MARGIN_SECS} s behind the client's`, async () => {
        const mock = start({ latencyMs: [1, 1] });
        const clock = new ClientClock();
        const supra = newClient({ txExpirySecs: MAX_TX_EXPIRATION_DURATION });
        const sender = new SupraAccount();

        for (let index = 0; index < 10; index += 1) {
            // From 0 to 4.9 s ahead of the node's clock.
            clock.offsetMs = Math.floor((index * (TX_EXPIRATION_MARGIN_SECS * 1_000 - 100)) / 9);
            await transfer(supra, sender, { maxGas: 5_000n });
        }

        expect(mock.submissions.map((submission) => submission.status)).toEqual(Array(10).fill(200));
    });

    it("refuses the next call after resetSequenceNumber while transactions of this client are pending", async () => {
        const mock = start({ latencyMs: [1, 1] });
        const supra = newClient();
        const sender = new SupraAccount();
        const gas = { maxGas: 5_000n };
        await transfer(supra, sender, gas);
        await transfer(supra, sender, gas);

        supra.resetSequenceNumber(sender.address());
        const error = await transfer(supra, sender, gas).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(SupraAPIError);
        expect((error as SupraAPIError).message).toMatch(/already pending/);
        // Once they have committed, the next call reads the chain and takes the next number.
        mock.tick();
        await transfer(supra, sender, gas);
        expect(acceptedNumbers(mock)).toEqual([5, 6, 7]);
    });

    it("keeps the number of an unknown outcome the node accepted until the chain's time reaches the transaction's expiration time, with a client clock behind the node's", async () => {
        const mock = start({ latencyMs: [1, 1] });
        const clock = new ClientClock(-30_000);
        const supra = newClient();
        const sender = new SupraAccount();
        const gas = { maxGas: 5_000n };
        await transfer(supra, sender, gas);
        mock.tick();

        // 629 s after the client's clock is 599 s after the node's, which the node accepts. The node pools the
        // transaction and the answer is a 500.
        const expiry = BigInt(Math.floor(Date.now() / 1000) + 629);
        mock.refuseNext.set(6, { status: 500, message: "Internal error", pool: true });
        await expect(transfer(supra, sender, { ...gas, txExpiryTime: expiry })).rejects.toBeInstanceOf(SupraAPIError);
        expect(mock.pooled()).toEqual([6]);

        // 580 s later the latest block is 19 s short of the expiration time: the number is still held.
        clock.advance(mock, 580_000);
        await transfer(supra, sender, gas);

        expect(mock.submissions.map((submission) => submission.status)).toEqual([200, 500, 200]);
        expect(mock.pooled()).toEqual([6, 7]);

        // Once the latest block has reached the expiration time and the client has read it, the number is used again.
        clock.advance(mock, 25_000);
        expect(mock.blockSeconds()).toBeGreaterThanOrEqual(Number(expiry));
        await transfer(supra, sender, gas);

        expect(mock.submitted).toEqual([5, 6, 7, 6]);
    });
});

describe("the estimate of the chain's time", () => {
    beforeEach(() => {
        jest.spyOn(SupraAccount.prototype, "signBuffer").mockReturnValue(new HexString("00".repeat(64)));
    });

    /** The account reads of ten pipelined calls with an explicit max gas after the first call, with `disturb` between. */
    async function accountReadsOfPipelinedCalls(disturb: (clock: ClientClock) => void): Promise<number> {
        const mock = start({ latencyMs: [1, 1] });
        const clock = new ClientClock();
        const supra = newClient();
        const sender = new SupraAccount();
        const gas = { maxGas: 5_000n };
        await transfer(supra, sender, gas);
        const before = mock.counts["account"] ?? 0;
        for (let index = 1; index <= 10; index += 1) {
            if (index === 3) {
                disturb(clock);
            }
            if (index === 7) {
                clock.offsetMs = 0;
            }
            await transfer(supra, sender, gas);
        }
        expect(mock.submitted).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
        return (mock.counts["account"] ?? 0) - before;
    }

    it("does not depend on the client's wall clock: a step forward and back adds no chain reads", async () => {
        const reads = await accountReadsOfPipelinedCalls((clock) => {
            clock.offsetMs += 120_000;
        });

        expect(reads).toBe(0);
    });

    it("is unchanged by a wall clock that is not stepped (control)", async () => {
        expect(await accountReadsOfPipelinedCalls(() => undefined)).toBe(0);
    });
});
