import { e2eEnabled } from "./env";

/** `describe` when `SUPRA_E2E_RPC_URL` is set, `describe.skip` otherwise. */
export const describeE2E: jest.Describe = e2eEnabled() ? describe : describe.skip;

/** Which release line the node under test belongs to; set by the global setup. */
export function nodeGeneration(): "v11" | "v12" | undefined {
    const value = process.env["SUPRA_E2E_NODE_GENERATION"];
    return value === "v11" || value === "v12" ? value : undefined;
}

/**
 * `test` for a behaviour that holds on every node, except that an SDK defect makes it fail against a
 * v11 node. On v11 it is `test.failing`; on any other node it is `test`.
 */
export const testFailingOnV11: jest.It = nodeGeneration() === "v11" ? test.failing : test;
