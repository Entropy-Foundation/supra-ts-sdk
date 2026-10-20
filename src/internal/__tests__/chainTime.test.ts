import { SupraClient } from "../../api/supraClient";
import {
    DEFAULT_TX_EXPIRATION_DURATION,
    MAX_TX_EXPIRATION_DURATION,
    TX_EXPIRATION_MARGIN_SECS,
} from "../../utils/constants";
import { ChainClock, chainClockOf } from "../chainTime";

const RPC_URL = "http://node.test";
const originalFetch = global.fetch;

afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
});

/** A `fetch` that answers every block read with a block at `blockMs`. */
function serveBlockAt(blockMs: number): void {
    global.fetch = jest.fn(
        async () =>
            new Response(
                JSON.stringify({
                    header: {
                        author: "0x00",
                        hash: "0x00",
                        height: 1,
                        parent: "0x00",
                        timestamp: { microseconds_since_unix_epoch: blockMs * 1000, utc_date_time: "" },
                        view: { epoch_id: { chain_id: 255, epoch: 1 }, round: 1 },
                    },
                    execution_statistics: null,
                }),
                { status: 200, headers: { "Content-Type": "application/json" } },
            ),
    ) as typeof fetch;
}

function rawTxn(supra: SupraClient, txExpiryTime?: bigint) {
    return supra.transaction.build.rawTxnObject({
        senderAddress: "0x" + "cd".repeat(32),
        senderSequenceNumber: 0n,
        function: "0x1::supra_account::transfer",
        functionTypeArgs: [],
        functionArgs: [],
        ...(txExpiryTime === undefined ? {} : { optionalTransactionPayloadArgs: { txExpiryTime } }),
    });
}

/** A `ChainClock` whose monotonic and wall clocks are set by the test. */
function clockAt(monotonicMs: { now: number }, wallMs: { now: number } = { now: 0 }): ChainClock {
    return new ChainClock(
        () => monotonicMs.now,
        () => wallMs.now,
    );
}

describe("ChainClock", () => {
    it("estimates the chain's time with the client's wall clock before any block has been read", () => {
        const wall = { now: 1_000_500 };
        const clock = clockAt({ now: 50 }, wall);

        expect(clock.latestBlockSeconds()).toBeUndefined();
        expect(clock.estimatedNowMs()).toBe(1_000_500);
        expect(clock.estimatedNowSeconds()).toBe(1_000n);
    });

    it("is the latest block's timestamp plus the monotonic time elapsed since it was read", () => {
        const monotonic = { now: 5_000 };
        const clock = clockAt(monotonic);

        clock.observeLatestBlock(2_000_000_000);
        monotonic.now += 10_000;

        expect(clock.latestBlockSeconds()).toBe(2_000n);
        expect(clock.estimatedNowMs()).toBe(2_010_000);
    });

    it("does not depend on the wall clock once a block has been read", () => {
        const monotonic = { now: 5_000 };
        const wall = { now: 1_000_000 };
        const clock = clockAt(monotonic, wall);
        clock.observeLatestBlock(2_000_000_000);

        // The wall clock steps forward by 120 s and back by 240 s.
        wall.now += 120_000;
        expect(clock.estimatedNowMs()).toBe(2_000_000);
        wall.now -= 240_000;
        expect(clock.estimatedNowMs()).toBe(2_000_000);
    });

    it("ignores a block that is not newer than the latest one read", () => {
        const monotonic = { now: 5_000 };
        const clock = clockAt(monotonic);
        clock.observeLatestBlock(2_000_000_000);
        monotonic.now += 30_000;

        // The same block read 30 s later (the chain produced no block), and an older block.
        clock.observeLatestBlock(2_000_000_000);
        clock.observeLatestBlock(1_500_000_000);

        expect(clock.latestBlockSeconds()).toBe(2_000n);
        expect(clock.estimatedNowMs()).toBe(2_030_000);
    });

    it("does not move the estimate backwards for a newer block from a node that lags", () => {
        const monotonic = { now: 5_000 };
        const clock = clockAt(monotonic);
        clock.observeLatestBlock(2_000_000_000);
        monotonic.now += 3_000;
        const before = clock.estimatedNowMs();

        // The block is newer than the first, and 2 s older than the estimate.
        clock.observeLatestBlock(2_001_000_000);

        expect(clock.latestBlockSeconds()).toBe(2_001n);
        expect(before).toBe(2_003_000);
        expect(clock.estimatedNowMs()).toBe(2_003_000);
        monotonic.now += 1_000;
        expect(clock.estimatedNowMs()).toBe(2_004_000);
    });

    it("moves the estimate forwards when a block is ahead of it", () => {
        const monotonic = { now: 5_000 };
        const clock = clockAt(monotonic);
        // The first read comes from a node 120 s behind the chain; the next from a node that is current.
        clock.observeLatestBlock(1_880_000_000);
        monotonic.now += 1_000;
        clock.observeLatestBlock(2_001_000_000);

        expect(clock.estimatedNowMs()).toBe(2_001_000);
    });

    it("estimates with performance.now by default", () => {
        const clock = new ChainClock();
        clock.observeLatestBlock(2_000_000_000);
        const first = clock.estimatedNowMs();

        expect(first).toBeGreaterThanOrEqual(2_000_000);
        expect(first).toBeLessThan(2_000_000 + 5_000);
        expect(clock.estimatedNowMs()).toBeGreaterThanOrEqual(first);
    });

    it("ignores a timestamp that is not a positive safe integer", () => {
        const clock = new ChainClock();

        clock.observeLatestBlock(Number.NaN);
        clock.observeLatestBlock(-1);
        clock.observeLatestBlock(2 ** 60);

        expect(clock.latestBlockSeconds()).toBeUndefined();
    });

    it("is updated by the client's reads of the latest block, not by reads of a block by height or hash", async () => {
        jest.spyOn(Date, "now").mockReturnValue(5_000_000);
        const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255 });
        const clock = chainClockOf(supra.networkInformation);
        // A historical block 30 days before the client's clock.
        serveBlockAt(5_000_000 - 30 * 86_400_000);
        await supra.getBlockByHeight({ height: 1 });
        await supra.getBlockByHash({ blockHash: "0x" + "00".repeat(32) });
        expect(clock.latestBlockSeconds()).toBeUndefined();
        expect(clock.estimatedNowMs()).toBe(5_000_000);

        serveBlockAt(4_999_000);
        await supra.getLatestBlock();
        expect(clock.latestBlockSeconds()).toBe(4_999n);
        expect(clock.estimatedNowMs()).toBeGreaterThanOrEqual(4_999_000);
        expect(clock.estimatedNowMs()).toBeLessThan(4_999_000 + 5_000);

        serveBlockAt(9_000_000);
        await supra.getBlockByHeight({ height: 2 });
        expect(clock.latestBlockSeconds()).toBe(4_999n);
    });
});

describe("the default expiration time of a built transaction", () => {
    it(`is ${DEFAULT_TX_EXPIRATION_DURATION} s after the client's clock in whole seconds`, () => {
        jest.spyOn(Date, "now").mockReturnValue(1_000_000_999);
        const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255 });

        expect(rawTxn(supra).expiration_timestamp_secs).toBe(1_000_000n + BigInt(DEFAULT_TX_EXPIRATION_DURATION));
    });

    it(`is ${DEFAULT_TX_EXPIRATION_DURATION} s after the client's clock after the client has read a block`, async () => {
        jest.spyOn(Date, "now").mockReturnValue(1_000_000_000);
        const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255 });
        // The chain's clock is 45 s behind the client's.
        serveBlockAt(1_000_000_000 - 45_000);
        await supra.getLatestBlock();

        expect(rawTxn(supra).expiration_timestamp_secs).toBe(1_000_000n + 60n);
    });

    it("is SupraConfig.txExpirySecs after the client's clock", () => {
        jest.spyOn(Date, "now").mockReturnValue(1_000_000_000);
        const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255, txExpirySecs: 300 });

        expect(rawTxn(supra).expiration_timestamp_secs).toBe(1_000_300n);
    });

    it(`is at most ${MAX_TX_EXPIRATION_DURATION - TX_EXPIRATION_MARGIN_SECS} s after the client's clock`, () => {
        jest.spyOn(Date, "now").mockReturnValue(1_000_000_999);
        const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255, txExpirySecs: MAX_TX_EXPIRATION_DURATION });

        expect(rawTxn(supra).expiration_timestamp_secs).toBe(
            1_000_000n + BigInt(MAX_TX_EXPIRATION_DURATION - TX_EXPIRATION_MARGIN_SECS),
        );
    });

    it("is the call's txExpiryTime as given", () => {
        const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255, txExpirySecs: 600 });

        expect(rawTxn(supra, 42n).expiration_timestamp_secs).toBe(42n);
    });

    it.each([0, -1, 1.5, MAX_TX_EXPIRATION_DURATION + 1, Number.NaN])("rejects txExpirySecs %s", (txExpirySecs) => {
        expect(() => new SupraClient({ rpcUrl: RPC_URL, chainId: 255, txExpirySecs })).toThrow(RangeError);
    });

    it.each([1, MAX_TX_EXPIRATION_DURATION])("accepts txExpirySecs %s", (txExpirySecs) => {
        expect(new SupraClient({ rpcUrl: RPC_URL, chainId: 255, txExpirySecs }).networkInformation.txExpirySecs).toBe(
            txExpirySecs,
        );
    });
});
