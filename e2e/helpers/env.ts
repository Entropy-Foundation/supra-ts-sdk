import { SupraClient } from "../../src/index";

/**
 * Environment variables read by the end-to-end suite.
 *
 * - `SUPRA_E2E_RPC_URL`: base URL of the node's RPC service, without `/rpc/v3`. The suite is skipped
 *   when it is not set.
 * - `SUPRA_E2E_ALLOW_PUBLIC`: set to `1` to allow a run against Devnet (chain ID 50). Testnet (6) and
 *   Mainnet (8) are always refused.
 * - `SUPRA_E2E_FAUCET_PATH`: faucet path relative to the base URL, with `{address}` standing for the
 *   account address. Defaults to `/rpc/v3/wallet/faucet/{address}`.
 * - `SUPRA_E2E_TEST_TIMEOUT_MS`: per-test timeout in milliseconds. Defaults to 240000.
 * - `SUPRA_E2E_CHAIN_ID`: set by the global setup after it has read the chain ID from the node.
 */

/** Chain IDs of the public networks the suite does not run against. */
export const REFUSED_CHAIN_IDS: ReadonlyMap<number, string> = new Map([
    [6, "Testnet"],
    [8, "Mainnet"],
]);

/** Chain ID of Devnet, which requires `SUPRA_E2E_ALLOW_PUBLIC=1`. */
export const DEVNET_CHAIN_ID = 50;

export const DEFAULT_FAUCET_PATH = "/rpc/v3/wallet/faucet/{address}";

export const SKIP_MESSAGE = "SUPRA_E2E_RPC_URL is not set: the end-to-end tests are skipped.";

export function e2eRpcUrl(): string | undefined {
    const raw = process.env["SUPRA_E2E_RPC_URL"]?.trim();
    if (!raw) {
        return undefined;
    }
    return raw.replace(/\/+$/, "");
}

export function e2eEnabled(): boolean {
    return e2eRpcUrl() !== undefined;
}

/** Throws when the suite must not run against a node with this chain ID. */
export function assertChainIdAllowed(chainId: number): void {
    const refused = REFUSED_CHAIN_IDS.get(chainId);
    if (refused !== undefined) {
        throw new Error(
            `Refusing to run the end-to-end suite against ${refused} (chain ID ${chainId}). Point SUPRA_E2E_RPC_URL at a localnet.`,
        );
    }
    if (chainId === DEVNET_CHAIN_ID && process.env["SUPRA_E2E_ALLOW_PUBLIC"] !== "1") {
        throw new Error(
            `The node reports chain ID ${DEVNET_CHAIN_ID} (Devnet). Set SUPRA_E2E_ALLOW_PUBLIC=1 to run the end-to-end suite against it.`,
        );
    }
}

/** Reads the chain ID from the node's RPC service. */
export async function fetchChainId(rpcUrl: string): Promise<number> {
    const response = await fetch(`${rpcUrl}/rpc/v3/transactions/chain_id`);
    if (!response.ok) {
        throw new Error(`GET /rpc/v3/transactions/chain_id returned HTTP ${response.status}`);
    }
    return Number(await response.json());
}

export interface E2EContext {
    rpcUrl: string;
    chainId: number;
    /** An SDK client configured for the node under test. */
    supra: SupraClient;
}

let cached: Promise<E2EContext> | undefined;

/**
 * The node under test: its URL, chain ID and an SDK client for it. The chain ID is checked against the
 * refused networks on every call path that reaches a test.
 */
export function getE2EContext(): Promise<E2EContext> {
    cached ??= (async () => {
        const rpcUrl = e2eRpcUrl();
        if (rpcUrl === undefined) {
            throw new Error(SKIP_MESSAGE);
        }
        const fromSetup = process.env["SUPRA_E2E_CHAIN_ID"];
        const chainId = fromSetup !== undefined ? Number(fromSetup) : await fetchChainId(rpcUrl);
        assertChainIdAllowed(chainId);
        return { rpcUrl, chainId, supra: new SupraClient({ rpcUrl, chainId }) };
    })();
    return cached;
}
