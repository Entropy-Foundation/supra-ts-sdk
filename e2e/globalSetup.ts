import { randomBytes } from "node:crypto";
import { SKIP_MESSAGE, assertChainIdAllowed, e2eRpcUrl, fetchChainId } from "./helpers/env";

/**
 * A v12 node answers a request for an account that does not exist with 404; a v11 node answers 400.
 * Tests that expect a different SDK outcome on the two lines select on this. The address is random, so
 * no account created by an earlier run exists at it.
 */
async function detectGeneration(rpcUrl: string): Promise<"v11" | "v12"> {
    const absent = `0x${randomBytes(32).toString("hex")}`;
    const response = await fetch(`${rpcUrl}/rpc/v3/accounts/${absent}`);
    if (response.status === 404) {
        return "v12";
    }
    if (response.status === 400) {
        return "v11";
    }
    throw new Error(`Cannot tell the node's release line: an absent account returned HTTP ${response.status}`);
}

/**
 * Runs once before the suite. Without `SUPRA_E2E_RPC_URL` it prints why the tests are skipped. With it,
 * it reads the chain ID from the node and aborts the run when the node is a public network.
 */
export default async function globalSetup(): Promise<void> {
    const rpcUrl = e2eRpcUrl();
    if (rpcUrl === undefined) {
        process.stderr.write(`\n${SKIP_MESSAGE}\n\n`);
        return;
    }

    const chainId = await fetchChainId(rpcUrl);
    assertChainIdAllowed(chainId);
    process.env["SUPRA_E2E_CHAIN_ID"] = String(chainId);
    process.env["SUPRA_E2E_NODE_GENERATION"] = await detectGeneration(rpcUrl);
    process.stderr.write(
        `\nEnd-to-end suite: ${rpcUrl}, chain ID ${chainId}, ${process.env["SUPRA_E2E_NODE_GENERATION"]}\n\n`,
    );
}
