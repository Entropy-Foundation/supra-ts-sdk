import type { BlockHeader, CommittedTransactionResponse } from "./transaction";

/**
 * Statistics of an executed block. The node omits a field that has no value. Fields marked v12 are sent by nodes
 * from v12 onwards only.
 */
export interface ExecutedBlockStatistics {
    automated_txn_count?: number | null;
    automated_txn_gas_unit_price?: number | null;
    block_gas_unit_price_min?: number | null;
    block_gas_unit_price_max?: number | null;
    block_total_user_gas_used?: number | null;
    block_total_automated_gas_used?: number | null;
    user_txn_count?: number | null;
    automation_record_count?: number | null;
    /** v12. */
    evm_automated_txn_gas_unit_price?: number | null;
    /** v12. */
    evm_base_fee_per_gas?: number | null;
    /** v12. */
    block_total_evm_user_gas_used?: number | null;
    /** v12. */
    block_total_evm_automated_gas_used?: number | null;
    /** v12. */
    block_total_automation_record_gas_used?: number | null;
    /** v12. */
    block_total_evm_automation_record_gas_used?: number | null;
    /** v12. */
    block_total_block_metadata_gas_used?: number | null;
    /** v12. */
    block_total_evm_block_metadata_gas_used?: number | null;
}

export interface FinalizedBlockHeader {
    header: BlockHeader;
    execution_statistics: ExecutedBlockStatistics | null;
    /**
     * The transactions finalized in the block, in execution order. Absent unless the block was requested with
     * `withFinalizedTransactions: true`. Items can be of any `txn_type`, including `settlement` on nodes from v12
     * onwards; narrow on `txn_type` before reading `header`, `payload` or `authenticator`.
     */
    transactions?: CommittedTransactionResponse[] | null;
}
