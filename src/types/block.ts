import type { BlockHeader, TransactionResponse } from "./transaction";

export interface FinalizedBlockHeader {
    header: BlockHeader;
    execution_statistics: {
        automated_txn_count?: number | null,
        automated_txn_gas_unit_price?: number | null,
        block_gas_unit_price_min?: number | null,
        block_gas_unit_price_max?: number | null,
        block_total_user_gas_used?: number | null,
        block_total_automated_gas_used?: number | null,
        user_txn_count?: number | null
    } | null,
    transactions: TransactionResponse[] | null
}