import type { FinalizedBlockHeader } from "../types/block";
import type { NetworkConfig } from "../utils/apiEndpoints";
import { MILLISECONDS_PER_SECOND } from "../utils/constants";

const MICROSECONDS_PER_MILLISECOND = 1_000;

/**
 * The client's view of the chain's time: the timestamp of the latest block it has read, and the difference between
 * that timestamp and the client's clock when the block was read.
 *
 * The node executes a transaction only while the timestamp of the block that executes it is below the transaction's
 * expiration time, so a transaction whose expiration time the latest block's timestamp has reached can no longer
 * commit. `latestBlockSeconds` is that timestamp. `estimatedNowMs` is the client's clock shifted by the difference
 * observed when the latest block was first read; before any block has been read it is the client's clock.
 */
export class ChainClock {
    /** The highest block timestamp read, in microseconds since the Unix epoch. */
    private latestBlockMicros: number | undefined;
    /** The block timestamp minus the client's clock, in milliseconds, when the latest block was first read. */
    private offsetMs = 0;

    /**
     * Records a block timestamp read from the node. A timestamp not above the highest one read changes nothing, so a
     * read of an older block, or of the same block again, keeps the estimate.
     */
    observeBlock(timestampMicros: number, localNowMs: number = Date.now()): void {
        if (!Number.isSafeInteger(timestampMicros) || timestampMicros <= 0) {
            return;
        }
        if (this.latestBlockMicros !== undefined && timestampMicros <= this.latestBlockMicros) {
            return;
        }
        this.latestBlockMicros = timestampMicros;
        this.offsetMs = timestampMicros / MICROSECONDS_PER_MILLISECOND - localNowMs;
    }

    /** Records the timestamp of `block`, a block as the node returned it, when it has one. */
    observeBlockHeader(block: FinalizedBlockHeader): void {
        const micros = (block as { header?: { timestamp?: { microseconds_since_unix_epoch?: unknown } } } | null)
            ?.header?.timestamp?.microseconds_since_unix_epoch;
        if (typeof micros === "number") {
            this.observeBlock(micros);
        }
    }

    /**
     * The timestamp of the latest block read, in whole seconds (the unit of a transaction's expiration time), or
     * `undefined` before any block has been read.
     */
    latestBlockSeconds(): bigint | undefined {
        return this.latestBlockMicros === undefined
            ? undefined
            : BigInt(Math.floor(this.latestBlockMicros / (MICROSECONDS_PER_MILLISECOND * MILLISECONDS_PER_SECOND)));
    }

    /** The estimated chain time, in milliseconds since the Unix epoch. */
    estimatedNowMs(localNowMs: number = Date.now()): number {
        return localNowMs + this.offsetMs;
    }

    /** The estimated chain time in whole seconds, rounded up. */
    estimatedNowSeconds(localNowMs: number = Date.now()): bigint {
        return BigInt(Math.ceil(this.estimatedNowMs(localNowMs) / MILLISECONDS_PER_SECOND));
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
