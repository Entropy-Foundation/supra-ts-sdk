import { HexString, SupraAccount } from "supra-l1-sdk-core";
import { SupraAPIError, SupraRateLimitError } from "../../../errors/apiError";
import { SupraSimulationFailedError, SupraTransactionTimeoutError } from "../../../errors/transactionError";
import { ABORT_AMOUNT, MockNode, type MockNodeOptions } from "./helpers/mockNode";
import { ClientClock, newClient, transfer, within, type TransferOptions } from "./helpers/transfers";

/**
 * Helper calls of one client from one account, against a node answered from memory (`MockNode`). The calls hold the
 * account's lock from taking a sequence number until the node answers the submission.
 */

const originalFetch = global.fetch;
let node: MockNode | undefined;

function start(options: MockNodeOptions = {}): MockNode {
    node?.stop();
    const started = new MockNode(options);
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

/** Two `SupraAccount` objects for one key; signing with the second one throws. */
function senderAndFailingSigner(): { sender: SupraAccount; failingSigner: SupraAccount } {
    const key = new Uint8Array(32).fill(7);
    const failingSigner = new SupraAccount(key);
    jest.spyOn(failingSigner, "signBuffer").mockImplementation(() => {
        throw new Error("signing failed");
    });
    return { sender: new SupraAccount(key), failingSigner };
}

describe("concurrent transfers of one client from one account", () => {
    it("submits the other two of three when the middle one's estimate aborts behind a pending transaction", async () => {
        const mock = start();
        const supra = newClient();
        const sender = new SupraAccount();

        const [first, second, third] = await Promise.allSettled([
            transfer(supra, sender),
            transfer(supra, sender, { amount: ABORT_AMOUNT }),
            transfer(supra, sender),
        ]);

        expect(first.status).toBe("fulfilled");
        expect(second.status === "rejected" && second.reason).toBeInstanceOf(SupraSimulationFailedError);
        expect(third.status).toBe("fulfilled");
        expect(mock.pooled()).toEqual([5, 6]);
        mock.tick();
        expect(mock.chain).toBe(7);
        expect(mock.pool.size).toBe(0);
    });

    it("submits the other four of five with consecutive numbers when the first one's estimate aborts, over 30 seeds", async () => {
        // The mock node does not verify signatures; a fixed signature keeps the 30 runs fast.
        jest.spyOn(SupraAccount.prototype, "signBuffer").mockReturnValue(new HexString("00".repeat(64)));
        for (let seed = 1; seed <= 30; seed += 1) {
            const mock = start({ latencyMs: [1, 10], seed });
            const supra = newClient();
            const sender = new SupraAccount();

            const results = await Promise.allSettled([
                transfer(supra, sender, { amount: ABORT_AMOUNT }),
                ...Array.from({ length: 4 }, () => transfer(supra, sender)),
            ]);

            expect({ seed, statuses: results.map((result) => result.status) }).toEqual({
                seed,
                statuses: ["rejected", "fulfilled", "fulfilled", "fulfilled", "fulfilled"],
            });
            expect({ seed, pooled: mock.pooled() }).toEqual({ seed, pooled: [5, 6, 7, 8] });
            // Every submission was accepted: no number was sent twice.
            expect({ seed, submitted: [...mock.submitted].sort() }).toEqual({ seed, submitted: [5, 6, 7, 8] });
        }
    }, 30_000);

    it.each([
        ["an explicit max gas", 5_000n],
        ["the estimated max gas", undefined],
    ])(
        "submits the other two of three when the node answers the middle submission 429, with %s",
        async (_name, maxGas) => {
            const mock = start();
            mock.refuseNext.set(6, { status: 429, message: "Too Many Requests" });
            const supra = newClient();
            const sender = new SupraAccount();

            const [first, second, third] = await Promise.allSettled([
                transfer(supra, sender, { maxGas }),
                transfer(supra, sender, { maxGas }),
                transfer(supra, sender, { maxGas }),
            ]);

            expect(first.status).toBe("fulfilled");
            expect(second.status === "rejected" && second.reason).toBeInstanceOf(SupraRateLimitError);
            expect(third.status).toBe("fulfilled");
            expect(mock.pooled()).toEqual([5, 6]);
            await transfer(supra, sender, { maxGas });
            expect(mock.pooled()).toEqual([5, 6, 7]);
            mock.tick();
            expect(mock.chain).toBe(8);
        },
    );

    type Failure = "an aborting simulation" | "a signing error" | "a 429" | "a 400 refusal";
    const failures: Failure[] = ["an aborting simulation", "a signing error", "a 429", "a 400 refusal"];
    const cases = failures.flatMap((failure) => [
        [failure, "the estimated max gas", undefined] as const,
        [failure, "an explicit max gas", 5_000n] as const,
    ]);

    it.each(cases)(
        "submits the other four of five with consecutive numbers when the middle one fails before submission with %s, with %s",
        async (failure, _gas, maxGas) => {
            const mock = start({ latencyMs: [0, 4] });
            const supra = newClient();
            const { sender, failingSigner } = senderAndFailingSigner();
            // The middle call takes 7, after 5 and 6.
            if (failure === "a 429") {
                mock.refuseNext.set(7, { status: 429, message: "Too Many Requests" });
            } else if (failure === "a 400 refusal") {
                mock.refuseNext.set(7, {
                    status: 400,
                    message: "Transaction validation failed: the transaction expires too far in the future",
                });
            }
            const middle = () =>
                failure === "an aborting simulation"
                    ? // With an explicit max gas there is no estimate; the simulation before submission aborts.
                      transfer(supra, sender, { amount: ABORT_AMOUNT, maxGas, simulate: maxGas !== undefined })
                    : transfer(supra, failure === "a signing error" ? failingSigner : sender, { maxGas });

            const results = await Promise.allSettled([
                transfer(supra, sender, { maxGas }),
                transfer(supra, sender, { maxGas }),
                middle(),
                transfer(supra, sender, { maxGas }),
                transfer(supra, sender, { maxGas }),
            ]);

            expect(results.map((result) => result.status)).toEqual([
                "fulfilled",
                "fulfilled",
                "rejected",
                "fulfilled",
                "fulfilled",
            ]);
            const reason = (results[2] as PromiseRejectedResult).reason as unknown;
            if (failure === "a signing error") {
                expect((reason as Error).message).toBe("signing failed");
            } else {
                const expected = {
                    "an aborting simulation": SupraSimulationFailedError,
                    "a 429": SupraRateLimitError,
                    "a 400 refusal": SupraAPIError,
                }[failure];
                expect(reason).toBeInstanceOf(expected);
            }
            expect(mock.pooled()).toEqual([5, 6, 7, 8]);
            mock.tick();
            expect(mock.chain).toBe(9);
        },
    );

    it("submits a call with an explicit max gas while an earlier call of the account waits for its final status", async () => {
        const mock = start();
        const supra = newClient();
        const sender = new SupraAccount();

        const waiting = transfer(supra, sender, { wait: true, waitTimeoutMs: 1_000 });
        const quick = await within(transfer(supra, sender, { maxGas: 5_000n }), 900);

        expect(quick.status).toBe("Pending");
        expect(mock.pooled()).toEqual([5, 6]);
        await expect(waiting).rejects.toBeInstanceOf(SupraTransactionTimeoutError);
    });

    it("submits a call with an explicit max gas after the earlier call's submission", async () => {
        const mock = start();
        const supra = newClient();
        const sender = new SupraAccount();

        await Promise.all([transfer(supra, sender), transfer(supra, sender, { maxGas: 5_000n })]);

        expect(mock.submitted).toEqual([5, 6]);
        // The second call's submission follows the first call's estimate and submission.
        const firstSubmission = mock.log.findIndex((line) => line.startsWith("SUBMIT 5"));
        expect(mock.log.findIndex((line) => line.startsWith("SIMULATE 5"))).toBeLessThan(firstSubmission);
        expect(mock.log.findIndex((line) => line.startsWith("SUBMIT 6"))).toBeGreaterThan(firstSubmission);
    });
});

describe("a transaction of this client that can no longer commit", () => {
    /** An expiration time 500 seconds after the node's latest block. */
    const later = (mock: MockNode) => BigInt(mock.blockSeconds() + 500);

    it("gives the number of a transaction that a read shows Invalid to the next transfer while the one below it is pending", async () => {
        const mock = start();
        const supra = newClient();
        const sender = new SupraAccount();
        await transfer(supra, sender);
        await transfer(supra, sender);
        mock.drop(6, "Invalid");
        await expect(supra.getTransactionByHash({ transactionHash: mock.submissionHash(6) })).resolves.toMatchObject({
            status: "Invalid",
        });

        await transfer(supra, sender);

        expect(mock.pooled()).toEqual([5, 6]);
        mock.tick();
        expect(mock.chain).toBe(7);
        expect(mock.pool.size).toBe(0);
    });

    it("keeps the number of a transaction that reads HTTP 404 until the chain's time reaches its expiration time", async () => {
        const mock = start();
        const clock = new ClientClock();
        const supra = newClient();
        const sender = new SupraAccount();
        await transfer(supra, sender, { txExpiryTime: later(mock) });
        await transfer(supra, sender);
        // The node no longer holds 6, which has not expired.
        mock.drop(6, "404");

        await transfer(supra, sender, { txExpiryTime: later(mock) });
        expect(mock.pooled()).toEqual([5, 7]);

        clock.advance(mock, 61_000);
        await transfer(supra, sender);

        expect(mock.pooled()).toEqual([5, 6, 7]);
        mock.tick();
        expect(mock.chain).toBe(8);
        expect(mock.submitted).toEqual([5, 6, 7, 6]);
    });

    it("in the middle of the pipeline (read Invalid) gives its number to the next transfer and keeps the pending ones", async () => {
        const mock = start();
        const supra = newClient();
        const sender = new SupraAccount();
        for (let index = 0; index < 3; index += 1) {
            await transfer(supra, sender);
        }
        expect(mock.pooled()).toEqual([5, 6, 7]);
        mock.drop(6, "Invalid");
        await supra.getTransactionByHash({ transactionHash: mock.submissionHash(6) });

        await transfer(supra, sender);
        expect(mock.pooled()).toEqual([5, 6, 7]);
        // The next number is 8: 7 is pending.
        await transfer(supra, sender);
        expect(mock.pooled()).toEqual([5, 6, 7, 8]);

        mock.tick();
        expect(mock.chain).toBe(9);
        expect(mock.submitted).toEqual([5, 6, 7, 6, 8]);
    });

    it("with explicit max gas and the simulation before submission, signs the next transfer again with an expired number", async () => {
        const mock = start();
        const clock = new ClientClock();
        const supra = newClient();
        const sender = new SupraAccount();
        const options = { maxGas: 5_000n, simulate: true };
        await transfer(supra, sender, { ...options, txExpiryTime: later(mock) });
        await transfer(supra, sender, options);
        await transfer(supra, sender, { ...options, txExpiryTime: later(mock) });
        // The chain's time passes 6's expiration time; the client's clocks move one second less, so the
        // estimated chain time has not passed it by two seconds and only the check before submission, which reads the
        // latest block, finds 6 expired.
        clock.offsetMs += 60_000;
        clock.monotonicOffsetMs += 60_000;
        mock.advance(61_000);

        await transfer(supra, sender, { ...options, txExpiryTime: later(mock) });
        await transfer(supra, sender, options);

        expect(mock.submitted).toEqual([5, 6, 7, 6, 8]);
        // The transfer that took 8 first was simulated at 8, then signed again with 6.
        expect(mock.log.filter((line) => line.startsWith("SIMULATE"))).toContain("SIMULATE 8 (chain 5) -> PendingAfterExecution");
        mock.tick();
        expect(mock.chain).toBe(9);
    });
});

describe("the account's lock", () => {
    function failingAccountReads(mock: MockNode, failures: number): typeof fetch {
        let remaining = failures;
        return ((input: string | URL | Request, init?: RequestInit) => {
            if ((init?.method ?? "GET") === "GET" && /\/accounts\/0x[0-9a-f]+$/.test(new URL(String(input)).pathname)) {
                if (remaining > 0) {
                    remaining -= 1;
                    return Promise.resolve(
                        new Response(JSON.stringify({ message: "unavailable" }), {
                            status: 503,
                            headers: { "Content-Type": "application/json" },
                        }),
                    );
                }
            }
            return mock.fetch(input, init);
        }) as typeof fetch;
    }

    const outcomes: Array<[string, (mock: MockNode) => void, TransferOptions, boolean]> = [
        ["a failed read of the chain's number", (mock) => (global.fetch = failingAccountReads(mock, 1)), {}, false],
        ["an aborting estimate", () => undefined, { amount: ABORT_AMOUNT }, false],
        [
            "a submission whose outcome is unknown (500)",
            (mock) => mock.refuseNext.set(5, { status: 500, message: "Internal Server Error" }),
            { maxGas: 5_000n },
            false,
        ],
        [
            "two refusals of a stale number",
            // The first call is refused, then the second call (which takes the lock before the first call's retry),
            // then the first call's retry.
            (mock) =>
                mock.refuseNext.set(5, {
                    status: 400,
                    message: "sequence number 5 is above the highest this node can queue",
                    times: 3,
                }),
            { maxGas: 5_000n },
            false,
        ],
        ["a wait for a final status that times out", () => undefined, { wait: true, waitTimeoutMs: 300 }, false],
        ["an accepted submission", () => undefined, {}, true],
    ];

    it.each(outcomes)("is released after %s", async (_name, setUp, options, succeeds) => {
        const mock = start();
        setUp(mock);
        const supra = newClient();
        const sender = new SupraAccount();

        const first = transfer(supra, sender, options);
        const next = transfer(supra, sender, { maxGas: 5_000n });

        const [outcome] = await within(Promise.allSettled([first]));
        expect(outcome?.status).toBe(succeeds ? "fulfilled" : "rejected");
        await expect(within(next)).resolves.toMatchObject({ status: "Pending" });
    });

    it("is released after a thrown error for every later call of a Promise.all of five failures", async () => {
        const mock = start();
        mock.refuseNext.set(5, { status: 429, message: "Too Many Requests" });
        const supra = newClient();
        const { sender, failingSigner } = senderAndFailingSigner();

        const results = await within(
            Promise.allSettled([
                transfer(supra, sender, { maxGas: 5_000n }),
                transfer(supra, sender, { amount: ABORT_AMOUNT }),
                transfer(supra, failingSigner),
                transfer(supra, sender, { amount: ABORT_AMOUNT, maxGas: 5_000n, simulate: true }),
                transfer(supra, sender),
            ]),
        );

        expect(results.map((result) => result.status)).toEqual([
            "rejected",
            "rejected",
            "rejected",
            "rejected",
            "fulfilled",
        ]);
        expect(mock.pooled()).toEqual([5]);
    });
});
