import { get } from "../client/get";
import type { FinalizedBlockHeader } from "../types/block";
import type { NetworkConfig } from "../utils/apiEndpoints";

export async function getLatestBlockInternal(config: NetworkConfig): Promise<FinalizedBlockHeader> {
    return await get<FinalizedBlockHeader>({
        path: `/block`,
    }, config).then(res => res.data);
}


export async function getBlockByHeightInternal(
    args: {
        height: number,
        options?: { withFinalizedTransactions?: boolean, type?: "user" | "auto" | "meta" }
    },
    config: NetworkConfig
): Promise<FinalizedBlockHeader> {
    return await get<FinalizedBlockHeader>({
        path: `/block/height/${args.height}`,
        query: {
            with_finalized_transactions: args.options?.withFinalizedTransactions,
            type: args.options?.type
        }
    }, config).then(res => res.data);

}

export async function getBlockByHashInternal(args: { blockHash: string }, config: NetworkConfig): Promise<FinalizedBlockHeader> {
    return await get<FinalizedBlockHeader>({
        path: `/block/${args.blockHash}`,
    }, config).then(res => res.data);
}


export async function getTransactionsByBlockHashInternal(
    args: {
        blockHash: string,
        options?: { type?: "user" | "auto" | "meta" }
    },
    config: NetworkConfig
): Promise<string[]> {
    return await get<string[]>({
        path: `/block/${args.blockHash}/transactions`,
        query: {
            type: args.options?.type
        }
    }, config).then(res => res.data);
}