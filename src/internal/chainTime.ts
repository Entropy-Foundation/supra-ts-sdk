import type { FinalizedBlockHeader } from "../types/block";
import type { NetworkConfig } from "../utils/apiEndpoints";
import { MILLISECONDS_PER_SECOND } from "../utils/constants";

const MICROSECONDS_PER_MILLISECOND = 1_000;

/**
 * The client's view of the chain's time, from the client's reads of the latest block (`GET /rpc/v3/block`). A read of
 * a block by height or by hash does not change it.
 *
 * The node executes a transaction only while the timestamp of the block that executes it is below the transaction's
 * expiration time, so a transaction whose expiration time the latest block's timestamp has reached can no longer
 * commit. `latestBlockSeconds` is the highest timestamp read. `estimatedNowMs` is the client's clock shifted by the
 * largest difference between a latest block's timestamp and the client's clock observed at its read; before any
 * latest block has been read it is the client's clock. A read that gives a smaller difference (an older block, or a
 * block from a node that lags) leaves the estimate as it is, so the estimate does not move backwards while the client's
 * clock does not.
 */
export class ChainClock {
    /** The highest latest-block timestamp read, in microseconds since the Unix epoch. */
    private latestBlockMicros: number | undefined;
    /**
     * The largest difference between a latest block's timestamp and the client's clock when it was read, in
     * milliseconds; `undefined` before the first read.
     */
    private offsetMs: number | undefined;

    /**
     * Records the timestamp of a latest block read from the node at `localNowMs` on the client's clock. A timestamp that
     * is not a positive safe integer is ignored.
     */
    observeLatestBlock(timestampMicros: number, localNowMs: number = Date.now()): void {
        if (!Number.isSafeInteger(timestampMicros) || timestampMicros <= 0) {
            return;
        }
        if (this.latestBlockMicros === undefined || timestampMicros > this.latestBlockMicros) {
            this.latestBlockMicros = timestampMicros;
        }
        const offsetMs = timestampMicros / MICROSECONDS_PER_MILLISECOND - localNowMs;
        if (this.offsetMs === undefined || offsetMs > this.offsetMs) {
            this.offsetMs = offsetMs;
        }
    }

    /** Records the timestamp of `block`, a latest block as the node returned it, when it has one. */
    observeLatestBlockHeader(block: FinalizedBlockHeader): void {
        const micros = (block as { header?: { timestamp?: { microseconds_since_unix_epoch?: unknown } } } | null)
            ?.header?.timestamp?.microseconds_since_unix_epoch;
        if (typeof micros === "number") {
            this.observeLatestBlock(micros);
        }
    }

    /**
     * The highest timestamp of a latest block read, in whole seconds (the unit of a transaction's expiration time), or
     * `undefined` before any latest block has been read.
     */
    latestBlockSeconds(): bigint | undefined {
        return this.latestBlockMicros === undefined
            ? undefined
            : BigInt(Math.floor(this.latestBlockMicros / (MICROSECONDS_PER_MILLISECOND * MILLISECONDS_PER_SECOND)));
    }

    /** The estimated chain time, in milliseconds since the Unix epoch. */
    estimatedNowMs(localNowMs: number = Date.now()): number {
        return localNowMs + (this.offsetMs ?? 0);
    }

    /** The estimated chain time in whole seconds, rounded down. */
    estimatedNowSeconds(localNowMs: number = Date.now()): bigint {
        return BigInt(Math.floor(this.estimatedNowMs(localNowMs) / MILLISECONDS_PER_SECOND));
    }
}

const clocks = new WeakMap<NetworkConfig, ChainClock>();

/** The chain clock of the client that owns `config`, created on first use. */
export function chainClockOf(config: NetworkConfig): ChainClock {
    let clock = clocks.get(config);
    if (clock === undefined) {
        clock = new ChainClock();
        clocks.set(config, clock);
    }
    return clock;
}
