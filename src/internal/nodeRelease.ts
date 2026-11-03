import type { NetworkConfig } from "../utils/apiEndpoints";
import { getNodeVersionInternal } from "./supraClient";

/**
 * Per client, keyed by its network configuration: whether its node reports a `release`, or the pending request that
 * reads it, so that concurrent readers share one request.
 */
const nodeReleases = new WeakMap<NetworkConfig, boolean | Promise<boolean>>();

/**
 * Whether the client's node reports a `release` in `GET /rpc/v3/version`, which a node from `supra_node_v12.0.0` does
 * and an earlier node does not. The first call reads it and the answer is kept for the client; concurrent callers share
 * one request. A failed request is not kept: the next call sends a new one.
 */
export function nodeReportsReleaseInternal(config: NetworkConfig): Promise<boolean> {
    const cached = nodeReleases.get(config);
    if (cached !== undefined) {
        return Promise.resolve(cached);
    }
    const request = getNodeVersionInternal(config).then(
        (version) => {
            const reportsRelease = typeof version.release === "string" && version.release.length > 0;
            nodeReleases.set(config, reportsRelease);
            return reportsRelease;
        },
        (error: unknown) => {
            nodeReleases.delete(config);
            return Promise.reject(error instanceof Error ? error : new Error(String(error)));
        },
    );
    nodeReleases.set(config, request);
    return request;
}
