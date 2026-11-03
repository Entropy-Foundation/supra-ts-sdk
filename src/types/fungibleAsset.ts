export interface FungibleAssetMetadata {
    name: string;
    symbol: string;
    decimals: number;
    icon_uri: string;
    project_uri: string;
}

/**
 * The cross-VM crossings that are recorded and not yet applied. A crossing is debited on one side before it is
 * credited on the other, so a queue that is never empty is normal; an oldest entry that keeps getting older is not.
 */
export interface InFlightSettlements {
    /** How many crossings are queued. */
    count: number;
    /** What they are worth in total, in wei, as a decimal string. */
    value_wei: string;
    /** The block that recorded the oldest of them; `null` when the queue is empty. */
    oldest_recorded_at_height?: number | null;
    /** The blocks executed since that block; `null` when the queue is empty (zero is a crossing of this very block). */
    oldest_age_blocks?: number | null;
}

/**
 * Native SUPRA on SupraEVM and the SupraMVM escrow that backs it, as of one height on one node. Wei figures are
 * decimal strings. The `*_quants` figures are JSON numbers: a value above `Number.MAX_SAFE_INTEGER` (about 90 million
 * SUPRA) is rounded when the response is parsed.
 */
export interface NativeSupply {
    /** The height the node had executed to when it answered; every counter is as of this height. */
    as_of_height: number;
    /** Native SUPRA in existence on SupraEVM, in wei. */
    evm_supply_wei: string;
    /** Value debited on one side of a crossing and not yet credited on the other, in wei. */
    in_flight_wei: string;
    /** The sub-quant remainder held back by the settlement path, in wei; less than one quant. */
    dust_wei: string;
    /** Quants destroyed on SupraEVM that SupraMVM has not yet retired from the escrow. */
    burn_owed_quants: number;
    /** The total the node claims against the SupraMVM escrow, in wei. */
    claimed_wei: string;
    /** The quants the node's own bookkeeping says the escrow holds. */
    escrow_settled_quants: number;
    /**
     * The quants SupraMVM reports the escrow holding; `0` on a chain that never installed the settlement module.
     * `null` means the escrow could not be read, which says nothing about the backing.
     */
    escrow_balance_quants?: number | null;
    /**
     * The wei claimed beyond what the escrow holds, `"0"` when every claim is backed. `null` when the escrow could not
     * be read.
     */
    escrow_shortfall_wei?: string | null;
    /** The crossings recorded and not yet applied. */
    in_flight: InFlightSettlements;
}
