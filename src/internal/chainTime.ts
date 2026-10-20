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
 * commit. `latestBlockSeconds` is the highest timestamp read. `estimatedNowMs` is the highest latest-block timestamp
 * read plus the time elapsed since that read, measured with a monotonic clock, so it does not depend on the client's
 * wall clock. A latest block that is not newer than the newest one read is ignored. When a newer block gives an
 * earlier time than the estimate has already reached (a block from a node that lags), the estimate keeps its value, so
 * it never decreases. Before any latest block has been read the estimate is the client's wall clock.
 */
export class ChainClock {
    /** The highest latest-block timestamp read, in microseconds since the Unix epoch. */
    private latestBlockMicros: number | undefined;
    /** The estimated chain time at `anchorMonotonicMs`, in milliseconds since the Unix epoch. */
    private anchorChainMs: number | undefined;
    /** The reading of the monotonic clock at which `anchorChainMs` was set. */
    private anchorMonotonicMs = 0;

    /**
     * @param monotonicNowMs A monotonic clock in milliseconds; `performance.now()` by default.
     * @param wallNowMs The client's wall clock in milliseconds since the Unix epoch, used before any latest block has
     * been read; `Date.now()` by default.
     */
    constructor(
        private readonly monotonicNowMs: () => number = () => performance.now(),
        private readonly wallNowMs: () => number = () => Date.now(),
    ) {}

    /**
     * Records the timestamp of a latest block read from the node. A timestamp that is not a positive safe integer, or
     * not newer than the newest one read, is ignored.
     */
    observeLatestBlock(timestampMicros: number): void {
        if (!Number.isSafeInteger(timestampMicros) || timestampMicros <= 0) {
            return;
        }
        if (this.latestBlockMicros !== undefined && timestampMicros <= this.latestBlockMicros) {
            return;
        }
        const blockMs = timestampMicros / MICROSECONDS_PER_MILLISECOND;
        const previousEstimateMs = this.anchorChainMs === undefined ? undefined : this.estimatedNowMs();
        this.latestBlockMicros = timestampMicros;
        this.anchorChainMs = previousEstimateMs === undefined ? blockMs : Math.max(previousEstimateMs, blockMs);
        this.anchorMonotonicMs = this.monotonicNowMs();
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
    estimatedNowMs(): number {
        if (this.anchorChainMs === undefined) {
            return this.wallNowMs();
        }
        return this.anchorChainMs + (this.monotonicNowMs() - this.anchorMonotonicMs);
    }

    /** The estimated chain time in whole seconds, rounded down. */
    estimatedNowSeconds(): bigint {
        return BigInt(Math.floor(this.estimatedNowMs() / MILLISECONDS_PER_SECOND));
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
