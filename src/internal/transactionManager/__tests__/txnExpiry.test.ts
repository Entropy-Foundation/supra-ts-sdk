import { SupraAccount } from "supra-l1-sdk-core";
import { SupraClient } from "../../../api/supraClient";
import { SupraAPIError } from "../../../errors/apiError";
import { MockNode, type MockNodeOptions } from "./helpers/mockNode";
import { newClient, RPC_URL, transfer } from "./helpers/transfers";

/**
 * The node's maximum time to live in the submit helpers, against a node answered from memory (`MockNode`): the default
 * expiration time follows the node's value, and a refusal or a failed read leaves the sequence number and the
 * account's lock as they were.
 */

const originalFetch = global.fetch;
let node: MockNode | undefined;

function start(options: MockNodeOptions = {}): MockNode {
    node?.stop();
    const started = new MockNode({ latencyMs: [1, 1], ...options });
    node = started;
    global.fetch = started.fetch;
    return started;
}

afterEach(() => {
    node?.stop();
    node = undefined;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
});

const accepted = (mock: MockNode) =>
    mock.submissions.filter((submission) => submission.status === 200).map((submission) => submission.sequenceNumber);

const nowSeconds = () => Math.floor(Date.now() / 1_000);

describe("a submit helper with a node maximum below the default", () => {
    it("is accepted, with an expiration time at most 5 s below the node's maximum", async () => {
        const mock = start();
        mock.maxTimeToLive = 30;

        await transfer(newClient(), new SupraAccount(), { maxGas: 5_000n });

        expect(mock.submissions.map((submission) => submission.status)).toEqual([200]);
        const secondsToLive = (mock.submissions[0]?.expiration ?? 0) - nowSeconds();
        expect(secondsToLive).toBeGreaterThan(20);
        expect(secondsToLive).toBeLessThanOrEqual(25);
        expect(mock.counts["parameters"]).toBe(1);
    });
});

describe("a submit helper that stops before signing", () => {
    it("leaves the sequence number and the lock as they were when txExpirySecs is above the node's maximum", async () => {
        const mock = start();
        mock.maxTimeToLive = 30;
        const sender = new SupraAccount();
        const patient = newClient({ txExpirySecs: 100 });
        const ordinary = newClient();

        await expect(transfer(patient, sender, { maxGas: 5_000n })).rejects.toThrow(RangeError);
        await expect(transfer(patient, sender, { maxGas: 5_000n })).rejects.toThrow(/txExpirySecs is 100.*30 seconds/);
        expect(mock.submissions).toEqual([]);

        // The lock is free and the number is the chain's.
        await transfer(ordinary, sender, { maxGas: 5_000n });
        mock.tick();
        await transfer(patient, sender, { maxGas: 5_000n, txExpiryTime: BigInt(nowSeconds() + 20) });
        expect(accepted(mock)).toEqual([5, 6]);
    });

    it("leaves the sequence number and the lock as they were when the read of the maximum fails, and the next call reads again", async () => {
        const mock = start();
        mock.failParameterReads = 1;
        const sender = new SupraAccount();
        const supra = newClient();

        const error: unknown = await transfer(supra, sender, { maxGas: 5_000n }).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(SupraAPIError);
        expect(mock.submissions).toEqual([]);
        await transfer(supra, sender, { maxGas: 5_000n });
        mock.tick();
        await transfer(supra, sender, { maxGas: 5_000n });
        expect(accepted(mock)).toEqual([5, 6]);
        expect(mock.counts["parameters"]).toBe(2);
    });

    it("lets a concurrent call from the account proceed", async () => {
        const mock = start();
        mock.maxTimeToLive = 30;
        const sender = new SupraAccount();

        const [refused, sent] = await Promise.allSettled([
            transfer(newClient({ txExpirySecs: 100 }), sender, { maxGas: 5_000n }),
            transfer(newClient(), sender, { maxGas: 5_000n }),
        ]);

        expect(refused.status).toBe("rejected");
        expect(sent.status).toBe("fulfilled");
        expect(accepted(mock)).toEqual([5]);
    });
});

describe("the read of the node's maximum in a submit helper", () => {
    it("is not made with verifyChainId false when the call sets txExpiryTime", async () => {
        const mock = start();
        const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255, verifyChainId: false });

        await transfer(supra, new SupraAccount(), { maxGas: 5_000n, txExpiryTime: BigInt(nowSeconds() + 20) });

        expect(accepted(mock)).toEqual([5]);
        expect(mock.counts["parameters"] ?? 0).toBe(0);
    });

    it("starts before the call takes the account's lock: a queued call asks while the call ahead is submitting", async () => {
        const mock = start();
        const inner = mock.fetch;
        let release: () => void = () => undefined;
        const asked = new Promise<void>((resolve) => {
            release = resolve;
        });
        let held = false;
        // The first submission is held until a request for the node's maximum arrives. The first call needs no such
        // read, so only a read that starts before the second call has the lock can arrive while the first is held.
        global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
            const path = new URL(String(input)).pathname;
            if (path.endsWith("/transactions/parameters")) {
                release();
            }
            if (path.endsWith("/transactions/submit") && !held) {
                held = true;
                await asked;
            }
            return inner(input, init);
        }) as typeof fetch;
        const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255, verifyChainId: false });
        const sender = new SupraAccount();

        const first = transfer(supra, sender, { maxGas: 5_000n, txExpiryTime: BigInt(nowSeconds() + 20) });
        const second = transfer(supra, sender, { maxGas: 5_000n });
        await Promise.all([first, second]);

        expect(accepted(mock)).toEqual([5, 6]);
        expect(mock.counts["parameters"]).toBe(1);
    }, 10_000);
});
