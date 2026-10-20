import { SupraClient } from "../../api/supraClient";
import { DEFAULT_TX_EXPIRATION_DURATION, MAX_TX_EXPIRATION_DURATION } from "../../utils/constants";
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

describe("ChainClock", () => {
    it("estimates the chain's time with the client's clock before any block has been read", () => {
        const clock = new ChainClock();

        expect(clock.latestBlockSeconds()).toBeUndefined();
        expect(clock.estimatedNowMs(1_000_000)).toBe(1_000_000);
        expect(clock.estimatedNowSeconds(1_000_500)).toBe(1_001n);
    });

    it("shifts the client's clock by the difference observed when the latest block was first read", () => {
        const clock = new ChainClock();

        clock.observeBlock(2_000_000_000, 1_000_000);

        expect(clock.latestBlockSeconds()).toBe(2_000n);
        expect(clock.estimatedNowMs(1_010_000)).toBe(2_010_000);
    });

    it("keeps the estimate for a block that is not newer than the latest one read", () => {
        const clock = new ChainClock();
        clock.observeBlock(2_000_000_000, 1_000_000);

        // The same block read 30 s later (the chain produced no block), and an older block.
        clock.observeBlock(2_000_000_000, 1_030_000);
        clock.observeBlock(1_500_000_000, 1_030_000);

        expect(clock.latestBlockSeconds()).toBe(2_000n);
        expect(clock.estimatedNowMs(1_030_000)).toBe(2_030_000);
    });

    it("ignores a timestamp that is not a positive safe integer", () => {
        const clock = new ChainClock();

        clock.observeBlock(Number.NaN);
        clock.observeBlock(-1);
        clock.observeBlock(2 ** 60);

        expect(clock.latestBlockSeconds()).toBeUndefined();
    });

    it("is updated by every block read of the client", async () => {
        const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255 });
        serveBlockAt(5_000_000);

        await supra.getLatestBlock();

        expect(chainClockOf(supra.networkInformation).latestBlockSeconds()).toBe(5_000n);
        serveBlockAt(6_000_000);
        await supra.getBlockByHeight({ height: 1 });
        expect(chainClockOf(supra.networkInformation).latestBlockSeconds()).toBe(6_000n);
        serveBlockAt(7_000_000);
        await supra.getBlockByHash({ blockHash: "0x" + "00".repeat(32) });
        expect(chainClockOf(supra.networkInformation).latestBlockSeconds()).toBe(7_000n);
    });
});

describe("the default expiration time of a built transaction", () => {
    it(`is ${DEFAULT_TX_EXPIRATION_DURATION} s after the client's clock before the client has read a block`, () => {
        jest.spyOn(Date, "now").mockReturnValue(1_000_000_000);
        const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255 });

        expect(rawTxn(supra).expiration_timestamp_secs).toBe(1_000_000n + BigInt(DEFAULT_TX_EXPIRATION_DURATION));
    });

    it(`is ${DEFAULT_TX_EXPIRATION_DURATION} s after the estimated chain time once the client has read a block`, async () => {
        jest.spyOn(Date, "now").mockReturnValue(1_000_000_000);
        const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255 });
        // The chain's clock is 45 s behind the client's.
        serveBlockAt(1_000_000_000 - 45_000);
        await supra.getLatestBlock();

        expect(rawTxn(supra).expiration_timestamp_secs).toBe(1_000_000n - 45n + 60n);
    });

    it("is SupraConfig.txExpirySecs after the estimated chain time", () => {
        jest.spyOn(Date, "now").mockReturnValue(1_000_000_000);
        const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255, txExpirySecs: 600 });

        expect(rawTxn(supra).expiration_timestamp_secs).toBe(1_000_600n);
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
