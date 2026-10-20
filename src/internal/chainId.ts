import { TxnBuilderTypes, type AnyRawTransaction } from "supra-l1-sdk-core";
import { cachedNodeChainId, forgetNodeChainId, storeNodeChainId } from "../client/chainIdCache";
import { SupraChainIdMismatchError } from "../errors/chainIdError";
import type { NetworkConfig } from "../utils/apiEndpoints";
import { getChainIdInternal } from "./supraClient";

/**
 * The node's chain ID for this client. A value already known, from an earlier read or from the `x-supra-chain-id`
 * header of an earlier response, is returned without a request; otherwise it is read with
 * `GET /rpc/v3/transactions/chain_id` and kept. Concurrent callers share one request. A failed request is not kept:
 * the next call sends a new one.
 */
export function getNodeChainIdInternal(config: NetworkConfig): Promise<number> {
    const cached = cachedNodeChainId(config);
    if (cached !== undefined) {
        return Promise.resolve(cached);
    }
    const request = getChainIdInternal(config).then(
        (chainId) => {
            storeNodeChainId(config, chainId);
            return chainId;
        },
        (error: unknown) => {
            forgetNodeChainId(config);
            return Promise.reject(error instanceof Error ? error : new Error(String(error)));
        },
    );
    storeNodeChainId(config, request);
    return request;
}

/**
 * The chain ID this client signs for. With `verifyChainId: false` it is the configured chain ID and no request is
 * sent. Otherwise it is the node's chain ID ({@link getNodeChainIdInternal}), and the call throws when the configured
 * chain ID differs from it.
 * @throws {SupraChainIdMismatchError} If the configured chain ID is not the node's.
 */
export async function getSigningChainIdInternal(config: NetworkConfig): Promise<number> {
    if (config.verifyChainId === false) {
        return config.chainId;
    }
    const nodeChainId = await getNodeChainIdInternal(config);
    if (nodeChainId !== config.chainId) {
        throw new SupraChainIdMismatchError({ configuredChainId: config.chainId, nodeChainId });
    }
    return nodeChainId;
}

/**
 * Checks, before a transaction is signed, that the configured chain ID and the chain ID of the transaction are the
 * node's. Does nothing with `verifyChainId: false`.
 * @throws {SupraChainIdMismatchError} If either chain ID differs from the node's.
 */
export async function checkChainIdBeforeSigningInternal(
    rawTxn: AnyRawTransaction,
    config: NetworkConfig,
): Promise<void> {
    if (config.verifyChainId === false) {
        return;
    }
    const nodeChainId = await getSigningChainIdInternal(config);
    const transactionChainId = chainIdOfTransaction(rawTxn);
    if (transactionChainId !== nodeChainId) {
        throw new SupraChainIdMismatchError({ configuredChainId: config.chainId, nodeChainId, transactionChainId });
    }
}

/** The chain ID inside a raw, multi-agent or fee-payer transaction. */
function chainIdOfTransaction(rawTxn: AnyRawTransaction): number {
    return rawTxn instanceof TxnBuilderTypes.RawTransaction ? rawTxn.chain_id.value : rawTxn.raw_txn.chain_id.value;
}
