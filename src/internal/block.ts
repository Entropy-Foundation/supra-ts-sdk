import { U64_FIELDS } from "../client/exactU64";
import { get } from "../client/get";
import type { FinalizedBlockHeader } from "../types/block";
import type { TransactionQueryType } from "../types/transaction";
import type { NetworkConfig } from "../utils/apiEndpoints";
import { chainClockOf } from "./chainTime";

/**
 * Reads the latest block. Its timestamp updates the client's chain time (`chainClockOf`); the reads of a block by
 * height or by hash do not.
 */
export async function getLatestBlockInternal(config: NetworkConfig): Promise<FinalizedBlockHeader> {
    const block = await get<FinalizedBlockHeader>(
        {
            path: `/block`,
            u64Fields: U64_FIELDS.block,
        },
        config,
    ).then((res) => res.data);
    chainClockOf(config).observeLatestBlockHeader(block);
    return block;
}

export async function getBlockByHeightInternal(
    args: {
        height: number;
        options?: { withFinalizedTransactions?: boolean; type?: TransactionQueryType };
    },
    config: NetworkConfig,
): Promise<FinalizedBlockHeader> {
    return await get<FinalizedBlockHeader>(
        {
            path: `/block/height/${args.height}`,
            query: {
                with_finalized_transactions: args.options?.withFinalizedTransactions,
                type: args.options?.type,
            },
            u64Fields: U64_FIELDS.blockWithTransactions,
        },
        config,
    ).then((res) => res.data);
}

export async function getBlockByHashInternal(
    args: { blockHash: string },
    config: NetworkConfig,
): Promise<FinalizedBlockHeader> {
    return await get<FinalizedBlockHeader>(
        {
            path: `/block/${args.blockHash}`,
            u64Fields: U64_FIELDS.block,
        },
        config,
    ).then((res) => res.data);
}

export async function getTransactionsByBlockHashInternal(
    args: {
        blockHash: string;
        options?: { type?: TransactionQueryType };
    },
    config: NetworkConfig,
): Promise<string[]> {
    return await get<string[]>(
        {
            path: `/block/${args.blockHash}/transactions`,
            query: {
                type: args.options?.type,
            },
        },
        config,
    ).then((res) => res.data);
}
