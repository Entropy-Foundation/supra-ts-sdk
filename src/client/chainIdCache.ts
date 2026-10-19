import type { NetworkConfig } from "../utils/apiEndpoints";

/** Response header in which the node reports its chain ID. Every response of the RPC service carries it. */
export const CHAIN_ID_HEADER = "x-supra-chain-id";

/**
 * The node's chain ID per client, keyed by the client's network configuration (each client has its own). The entry is
 * the chain ID once it is known, or the pending request that reads it, so that concurrent readers share one request.
 */
const nodeChainIds = new WeakMap<NetworkConfig, number | Promise<number>>();

/** The node's chain ID or the pending request for it, if either exists for this client. */
export function cachedNodeChainId(config: NetworkConfig): number | Promise<number> | undefined {
    return nodeChainIds.get(config);
}

/** Stores the node's chain ID, or the pending request for it, for this client. */
export function storeNodeChainId(config: NetworkConfig, chainId: number | Promise<number>): void {
    nodeChainIds.set(config, chainId);
}

/** Removes the entry of this client, so that the next reader sends a new request. */
export function forgetNodeChainId(config: NetworkConfig): void {
    nodeChainIds.delete(config);
}

/** Parses a chain ID: an integer from 0 to 255. Returns undefined for any other value. */
export function parseChainId(value: unknown): number | undefined {
    const text = typeof value === "number" ? String(value) : value;
    if (typeof text !== "string" || !/^\d{1,3}$/.test(text.trim())) {
        return undefined;
    }
    const chainId = Number(text.trim());
    return chainId <= 255 ? chainId : undefined;
}

/**
 * Records the chain ID of a response's `x-supra-chain-id` header for this client when none is known or pending yet.
 * A missing or malformed header is ignored.
 */
export function recordChainIdHeader(config: NetworkConfig, headers: Pick<Headers, "get">): void {
    if (nodeChainIds.has(config)) {
        return;
    }
    const chainId = parseChainId(headers.get(CHAIN_ID_HEADER));
    if (chainId !== undefined) {
        nodeChainIds.set(config, chainId);
    }
}
