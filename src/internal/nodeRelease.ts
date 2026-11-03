import type { NetworkConfig } from "../utils/apiEndpoints";
import { getNodeVersionInternal } from "./supraClient";

/**
 * Per client, keyed by its network configuration: `true` once its node has reported a `release`, or the pending request
 * that reads it, so that concurrent readers share one request.
 */
const nodeReleases = new WeakMap<NetworkConfig, true | Promise<boolean>>();

/**
 * Whether the client's node reports a `release` in `GET /rpc/v3/version`, which a node from `supra_node_v12.0.0` does
 * and an earlier node does not. Concurrent callers share one request. Only a `true` answer is kept for the client: after
 * `false` or a failed request the next call reads again, so a client sees its node's upgrade to `supra_node_v12.0.0`
 * without being recreated. Behind a load balancer whose nodes run different releases, the node that answers the version
 * request need not be the node that answers the next request.
 */
export function nodeReportsReleaseInternal(config: NetworkConfig): Promise<boolean> {
    const cached = nodeReleases.get(config);
    if (cached !== undefined) {
        return Promise.resolve(cached);
    }
    const request = getNodeVersionInternal(config).then(
        (version) => {
            const reportsRelease = typeof version.release === "string" && version.release.length > 0;
            if (reportsRelease) {
                nodeReleases.set(config, true);
            } else {
                nodeReleases.delete(config);
            }
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
