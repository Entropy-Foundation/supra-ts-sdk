/**
 * A node for one account's transactions, answered from memory through `fetch`, for tests of the sequence-number
 * counter. The pool holds accepted transactions by sequence number; `tick` commits the transactions from the chain's
 * number upwards while there is no gap, and runs every `blockMs` when that is set.
 *
 * - Account reads return the chain's number; balance views return 500 SUPRA; the chain ID is 255.
 * - A simulation reports `SEQUENCE_NUMBER_TOO_NEW` above the chain's number, `SEQUENCE_NUMBER_TOO_OLD` below it, a
 *   Move abort for a transfer of `ABORT_AMOUNT`, and otherwise `Success` with 1,000 gas units used.
 * - A submission is refused with 400 and the message of the node below the chain's number (`SEQUENCE_NUMBER_TOO_OLD`),
 *   for a number in the pool (`already pending`) and for a number at or beyond the window; otherwise it is accepted.
 *   `refuseNext` answers the next submissions of a number with the status and message given.
 * - A read by hash returns `Success` once committed, `Pending` while pooled, `Invalid` for a transaction dropped as
 *   discarded, and 404 for a dropped (expired) or unknown one.
 *
 * Each answer is delayed by `latencyMs[0]` plus a pseudo-random part of up to `latencyMs[1]` milliseconds, from a
 * generator seeded with `seed`.
 */

export interface Pooled {
    hash: string;
    sequenceNumber: number;
}

export interface MockNodeOptions {
    chain?: number;
    /** Commits every `blockMs` milliseconds; without it, only `tick` commits. */
    blockMs?: number;
    latencyMs?: [number, number];
    seed?: number;
    /** The number of sequence numbers the node queues ahead of the chain's. */
    window?: number;
}

/** A transfer of this amount aborts in the simulation (`EINSUFFICIENT_BALANCE`). */
export const ABORT_AMOUNT = 0x0102030405n;
/** `ABORT_AMOUNT` as the bytes of a u64 argument in a transaction's JSON. */
const ABORT_MARK = "[5,4,3,2,1,0,0,0]";

type Answer = { status: number; body: unknown };

export class MockNode {
    chain: number;
    readonly pool = new Map<number, Pooled>();
    /** The sequence number of each committed transaction, by hash. */
    readonly committed = new Map<string, number>();
    /** How each dropped transaction is reported, by hash. */
    readonly dropped = new Map<string, "Invalid" | "404">();
    /** One line per request and event. */
    readonly log: string[] = [];
    /** The number of requests of each kind. */
    readonly counts: Record<string, number> = {};
    /** The answer to the next submissions of a sequence number: `times` of them (default 1). */
    readonly refuseNext = new Map<number, { status: number; message: string; times?: number }>();
    /** The sequence numbers submitted, in order of arrival. */
    readonly submitted: number[] = [];

    private hashes = 0;
    private seed: number;
    private readonly latencyMs: [number, number];
    private readonly window: number;
    private timer: ReturnType<typeof setInterval> | undefined;

    constructor(options: MockNodeOptions = {}) {
        this.chain = options.chain ?? 5;
        this.latencyMs = options.latencyMs ?? [1, 2];
        this.seed = options.seed ?? 1;
        this.window = options.window ?? 25;
        if (options.blockMs !== undefined) {
            this.timer = setInterval(() => this.tick(), options.blockMs);
        }
    }

    /** Stops the commits every `blockMs`. */
    stop(): void {
        if (this.timer !== undefined) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }

    /** Commits the pooled transactions from the chain's number upwards, up to the first number without one. */
    tick(): void {
        for (;;) {
            const pooled = this.pool.get(this.chain);
            if (pooled === undefined) {
                return;
            }
            this.pool.delete(this.chain);
            this.committed.set(pooled.hash, pooled.sequenceNumber);
            this.log.push(`COMMIT ${pooled.sequenceNumber}`);
            this.chain += 1;
        }
    }

    /** Drops the pooled transaction with `sequenceNumber`, which then reads `Invalid` or HTTP 404. */
    drop(sequenceNumber: number, as: "Invalid" | "404"): void {
        const pooled = this.pool.get(sequenceNumber);
        if (pooled === undefined) {
            return;
        }
        this.pool.delete(sequenceNumber);
        this.dropped.set(pooled.hash, as);
        this.log.push(`DROP ${sequenceNumber} as ${as}`);
    }

    /** The sequence numbers in the pool, ascending. */
    pooled(): number[] {
        return [...this.pool.keys()].sort((a, b) => a - b);
    }

    readonly fetch = ((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const path = new URL(String(input)).pathname.replace(/^\/rpc\/v3/, "");
        const method = init?.method ?? "GET";
        if (method === "GET" && /^\/accounts\/0x[0-9a-f]+$/.test(path)) {
            this.count("account");
            this.log.push(`ACCOUNT -> ${this.chain}`);
            return this.respond({
                status: 200,
                body: { sequence_number: this.chain, authentication_key: "0x" + "00".repeat(32) },
            });
        }
        if (method === "POST" && path === "/view") {
            this.count("view");
            return this.respond({ status: 200, body: { result: ["50000000000"] } });
        }
        if (method === "GET" && path === "/transactions/chain_id") {
            this.count("chain_id");
            return this.respond({ status: 200, body: 255 });
        }
        if (method === "POST" && (path === "/transactions/simulate" || path === "/transactions/submit")) {
            const body = String(init?.body);
            const raw = (JSON.parse(body) as { Move: { raw_txn: { sender: string; sequence_number: number } } }).Move
                .raw_txn;
            const sequenceNumber = Number(raw.sequence_number);
            return path === "/transactions/simulate"
                ? this.simulate(sequenceNumber, body)
                : this.submit(sequenceNumber, raw.sender);
        }
        if (method === "GET" && path.startsWith("/transactions/")) {
            return this.read(path.slice("/transactions/".length));
        }
        return this.respond({ status: 500, body: { message: `unexpected ${method} ${path}` } });
    }) as typeof fetch;

    private simulate(sequenceNumber: number, body: string): Promise<Response> {
        this.count("simulate");
        let answer: Answer;
        if (sequenceNumber > this.chain) {
            answer = transaction(
                "0x00",
                "PendingAfterExecution",
                "Status Code: SEQUENCE_NUMBER_TOO_NEW, Type Validation",
                0,
            );
        } else if (sequenceNumber < this.chain) {
            answer = transaction("0x00", "Invalid", "Status Code: SEQUENCE_NUMBER_TOO_OLD, Type Validation", 0);
        } else if (body.includes(ABORT_MARK)) {
            answer = transaction("0x00", "Fail", "Move abort in 0x1::coin: EINSUFFICIENT_BALANCE(0x10006)", 5);
        } else {
            answer = transaction("0x00", "Success", "Executed successfully", 1_000);
        }
        this.log.push(`SIMULATE ${sequenceNumber} (chain ${this.chain}) -> ${statusOf(answer)}`);
        return this.respond(answer);
    }

    private submit(sequenceNumber: number, sender: string): Promise<Response> {
        this.count("submit");
        this.submitted.push(sequenceNumber);
        const refusal = this.refuseNext.get(sequenceNumber);
        let answer: Answer;
        if (refusal !== undefined) {
            const times = (refusal.times ?? 1) - 1;
            if (times > 0) {
                this.refuseNext.set(sequenceNumber, { ...refusal, times });
            } else {
                this.refuseNext.delete(sequenceNumber);
            }
            answer = { status: refusal.status, body: { message: refusal.message } };
        } else if (sequenceNumber < this.chain) {
            answer = {
                status: 400,
                body: {
                    message: `General err: MoveTransactionValidationFailed(${sender}, ${sequenceNumber}, SEQUENCE_NUMBER_TOO_OLD)`,
                },
            };
        } else if (this.pool.has(sequenceNumber)) {
            answer = {
                status: 400,
                body: {
                    message: `a transaction with sequence number ${sequenceNumber} is already pending for this account`,
                },
            };
        } else if (sequenceNumber >= this.chain + this.window) {
            answer = {
                status: 400,
                body: { message: `sequence number ${sequenceNumber} is above the highest this node can queue` },
            };
        } else {
            this.hashes += 1;
            const hash = "0x" + this.hashes.toString(16).padStart(64, "0");
            this.pool.set(sequenceNumber, { hash, sequenceNumber });
            answer = { status: 200, body: hash };
        }
        this.log.push(`SUBMIT ${sequenceNumber} (chain ${this.chain}) -> ${answer.status}`);
        return this.respond(answer);
    }

    private read(hash: string): Promise<Response> {
        this.count("transaction");
        let answer: Answer;
        if (this.committed.has(hash)) {
            answer = transaction(hash, "Success", "Executed successfully", 1_000);
        } else if ([...this.pool.values()].some((pooled) => pooled.hash === hash)) {
            answer = transaction(hash, "Pending", "", 0);
        } else if (this.dropped.get(hash) === "Invalid") {
            answer = transaction(hash, "Invalid", "Status Code: SEQUENCE_NUMBER_TOO_OLD, Type Validation", 0);
        } else {
            answer = { status: 404, body: { message: "Not Found" } };
        }
        this.log.push(`READ ${hash.slice(-4)} -> ${answer.status === 200 ? statusOf(answer) : answer.status}`);
        return this.respond(answer);
    }

    private count(kind: string): void {
        this.counts[kind] = (this.counts[kind] ?? 0) + 1;
    }

    /** A mulberry32 generator. */
    private random(): number {
        this.seed = (this.seed + 0x6d2b79f5) | 0;
        let t = Math.imul(this.seed ^ (this.seed >>> 15), 1 | this.seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    private respond(answer: Answer): Promise<Response> {
        const delay = this.latencyMs[0] + this.random() * this.latencyMs[1];
        return new Promise((resolve) =>
            setTimeout(
                () =>
                    resolve(
                        new Response(JSON.stringify(answer.body), {
                            status: answer.status,
                            headers: { "Content-Type": "application/json" },
                        }),
                    ),
                delay,
            ),
        );
    }
}

function transaction(hash: string, status: string, vmStatus: string, gasUsed: number): Answer {
    return {
        status: 200,
        body: {
            hash,
            status,
            txn_type: "user",
            output: { Move: { gas_used: gasUsed, events: [], vm_status: vmStatus } },
            block_header: null,
        },
    };
}

function statusOf(answer: Answer): string {
    return (answer.body as { status: string }).status;
}
