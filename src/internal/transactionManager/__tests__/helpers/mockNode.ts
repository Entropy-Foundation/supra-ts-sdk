import { hashOfSubmittedBody } from "./submittedHash";

/**
 * A node for one account's transactions, answered from memory through `fetch`, for tests of the sequence-number
 * counter. The pool holds accepted transactions by sequence number; `tick` commits the transactions from the chain's
 * number upwards while there is no gap, and runs every `blockMs` when that is set.
 *
 * The node has a clock of its own: it starts at `startMs` (default the real time) and runs with the real time, plus
 * what `advance` adds. The latest block's timestamp is the node's clock, or the time at which `stallBlocks` stopped the
 * blocks. A pooled transaction whose expiration time the latest block's timestamp has reached is dropped (it then reads
 * HTTP 404), before every answer and before every commit.
 *
 * - Account reads return the chain's number; balance views return 500 SUPRA; the chain ID is 255; `GET /block`
 *   returns the latest block's timestamp.
 * - A simulation reports `TRANSACTION_EXPIRED` for an expiration time the latest block's timestamp has reached,
 *   `SEQUENCE_NUMBER_TOO_NEW` above the chain's number, `SEQUENCE_NUMBER_TOO_OLD` below it, a Move abort for a transfer
 *   of `ABORT_AMOUNT`, and otherwise `Success` with 1,000 gas units used.
 * - A submission is refused with 400 and the messages of a v12 node: below the chain's number, for a number in the
 *   pool (`already pending`), for a number at or beyond the window ahead of the chain's number (the account's queue is
 *   full), for an expiration time not after the node's clock, and for an expiration time more than 600 s after the
 *   node's clock in whole seconds. Otherwise it is accepted. `refuseNext` answers the next submissions of a number with
 *   the status and message given, and pools the transaction when `pool` is set. A pooled transaction has the hash a
 *   node gives it: the Keccak-256 of the BCS of the signed transaction in the request body (`hashOfSubmittedBody`).
 * - A read by hash returns `Success` once committed, `Pending` while pooled (HTTP 404 instead with
 *   `pendingVisible: false`, as from an RPC node that did not receive the transaction), `Invalid` for a transaction
 *   dropped as discarded, and 404 for an expired or unknown one.
 *
 * Each answer is delayed by `latencyMs[0]` plus a pseudo-random part of up to `latencyMs[1]` milliseconds, from a
 * generator seeded with `seed`.
 */

export interface Pooled {
    hash: string;
    sequenceNumber: number;
    /** Seconds since the Unix epoch. */
    expiration: number;
}

export interface Submission {
    sequenceNumber: number;
    expiration: number;
    /** The request body. */
    body: string;
    /** The HTTP status of the answer. */
    status: number;
}

export interface MockNodeOptions {
    chain?: number;
    /** Commits every `blockMs` milliseconds; without it, only `tick` commits. */
    blockMs?: number;
    latencyMs?: [number, number];
    seed?: number;
    /** The number of sequence numbers the node queues from the chain's number. */
    window?: number;
    /** The node's clock at the start, in milliseconds since the Unix epoch. */
    startMs?: number;
}

/** The node's monotonic clock, read from `performance.now` directly, so a test's mock of the SDK's clocks does not move it. */
const nodePerformanceNow = performance.now.bind(performance);

/** A transfer of this amount aborts in the simulation (`EINSUFFICIENT_BALANCE`). */
export const ABORT_AMOUNT = 0x0102030405n;
/** `ABORT_AMOUNT` as the bytes of a u64 argument in a transaction's JSON. */
const ABORT_MARK = "[5,4,3,2,1,0,0,0]";

/** The bytes of a u64 argument in a transaction's JSON, as `[b0,b1,...,b7]`. */
export function u64Mark(value: bigint): string {
    const bytes: number[] = [];
    let rest = value;
    for (let index = 0; index < 8; index += 1) {
        bytes.push(Number(rest & 0xffn));
        rest >>= 8n;
    }
    return `[${bytes.join(",")}]`;
}

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
    readonly refuseNext = new Map<number, { status: number; message: string; times?: number; pool?: boolean }>();
    /** The sequence numbers submitted, in order of arrival. */
    readonly submitted: number[] = [];
    /** Every submission, in order of arrival. */
    readonly submissions: Submission[] = [];
    /** The hash of the last accepted submission of each sequence number. */
    readonly accepted = new Map<number, string>();
    /** Whether a pooled transaction reads `Pending` (else HTTP 404). */
    pendingVisible = true;
    /** The number of the next account reads answered with HTTP 503. */
    failAccountReads = 0;
    /** The number of the next block reads answered with HTTP 503. */
    failBlockReads = 0;

    private seed: number;
    private readonly latencyMs: [number, number];
    private readonly window: number;
    private readonly startMs: number;
    private readonly startPerformance = nodePerformanceNow();
    private advancedMs = 0;
    private stalledAtMs: number | undefined;
    private timer: ReturnType<typeof setInterval> | undefined;

    constructor(options: MockNodeOptions = {}) {
        this.chain = options.chain ?? 5;
        this.latencyMs = options.latencyMs ?? [1, 2];
        this.seed = options.seed ?? 1;
        this.window = options.window ?? 25;
        this.startMs = options.startMs ?? Date.now();
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

    /** The node's clock, in milliseconds since the Unix epoch. */
    nowMs(): number {
        return this.startMs + (nodePerformanceNow() - this.startPerformance) + this.advancedMs;
    }

    /** The latest block's timestamp, in milliseconds since the Unix epoch. */
    blockMs(): number {
        return this.stalledAtMs ?? this.nowMs();
    }

    /** The latest block's timestamp, in whole seconds. */
    blockSeconds(): number {
        return Math.floor(this.blockMs() / 1000);
    }

    /** Moves the node's clock forward by `ms`, and drops the transactions that expire on the way. */
    advance(ms: number): void {
        this.advancedMs += ms;
        this.expire();
    }

    /** The chain produces no more blocks: the latest block's timestamp stays where it is. */
    stallBlocks(): void {
        this.stalledAtMs = this.blockMs();
    }

    /** The chain produces blocks again: the latest block's timestamp is the node's clock. */
    resumeBlocks(): void {
        this.stalledAtMs = undefined;
    }

    /** Commits the pooled transactions from the chain's number upwards, up to the first number without one. */
    tick(): void {
        this.expire();
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
        this.expire();
        return [...this.pool.keys()].sort((a, b) => a - b);
    }

    /** The hash of the last accepted submission with `sequenceNumber`; throws when there is none. */
    submissionHash(sequenceNumber: number): string {
        const hash = this.accepted.get(sequenceNumber);
        if (hash === undefined) {
            throw new Error(`no accepted submission with sequence number ${sequenceNumber}`);
        }
        return hash;
    }

    readonly fetch = ((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        this.expire();
        const path = new URL(String(input)).pathname.replace(/^\/rpc\/v3/, "");
        const method = init?.method ?? "GET";
        if (method === "GET" && /^\/accounts\/0x[0-9a-f]+$/.test(path)) {
            this.count("account");
            if (this.failAccountReads > 0) {
                this.failAccountReads -= 1;
                return this.respond({ status: 503, body: { message: "Service Unavailable" } });
            }
            this.log.push(`ACCOUNT -> ${this.chain}`);
            return this.respond({
                status: 200,
                body: { sequence_number: this.chain, authentication_key: "0x" + "00".repeat(32) },
            });
        }
        if (method === "GET" && path === "/block") {
            this.count("block");
            if (this.failBlockReads > 0) {
                this.failBlockReads -= 1;
                return this.respond({ status: 503, body: { message: "Service Unavailable" } });
            }
            return this.respond({ status: 200, body: this.block() });
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
            const raw = (
                JSON.parse(body) as {
                    Move: { raw_txn: { sender: string; sequence_number: number; expiration_timestamp_secs: number } };
                }
            ).Move.raw_txn;
            const sequenceNumber = Number(raw.sequence_number);
            const expiration = Number(raw.expiration_timestamp_secs);
            return path === "/transactions/simulate"
                ? this.simulate(sequenceNumber, expiration, body)
                : this.submit(sequenceNumber, expiration, body);
        }
        if (method === "GET" && path.startsWith("/transactions/")) {
            return this.read(path.slice("/transactions/".length));
        }
        return this.respond({ status: 500, body: { message: `unexpected ${method} ${path}` } });
    }) as typeof fetch;

    private block(): unknown {
        return {
            header: {
                author: "0x" + "00".repeat(32),
                hash: "0x" + "00".repeat(32),
                height: this.committed.size + 1,
                parent: "0x" + "00".repeat(32),
                timestamp: {
                    microseconds_since_unix_epoch: Math.floor(this.blockMs()) * 1000,
                    utc_date_time: new Date(this.blockMs()).toISOString(),
                },
                view: { epoch_id: { chain_id: 255, epoch: 1 }, round: 1 },
            },
            execution_statistics: null,
        };
    }

    /** Drops the pooled transactions whose expiration time the latest block's timestamp has reached. */
    private expire(): void {
        const now = this.blockSeconds();
        for (const [sequenceNumber, pooled] of [...this.pool]) {
            if (pooled.expiration <= now) {
                this.pool.delete(sequenceNumber);
                this.dropped.set(pooled.hash, "404");
                this.log.push(`EXPIRE ${sequenceNumber}`);
            }
        }
    }

    private simulate(sequenceNumber: number, expiration: number, body: string): Promise<Response> {
        this.count("simulate");
        let answer: Answer;
        if (expiration <= this.blockSeconds()) {
            answer = transaction("0x00", "Invalid", "Status Code: TRANSACTION_EXPIRED, Type Validation", 0);
        } else if (sequenceNumber > this.chain) {
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

    private submit(sequenceNumber: number, expiration: number, body: string): Promise<Response> {
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
            if (refusal.pool === true) {
                this.accept(sequenceNumber, expiration, body);
            }
            answer = { status: refusal.status, body: { message: refusal.message } };
        } else if (sequenceNumber < this.chain) {
            answer = refused(
                `sequence number ${sequenceNumber} is below the account's next sequence number ${this.chain}`,
            );
        } else if (this.pool.has(sequenceNumber)) {
            answer = refused(
                `a transaction with sequence number ${sequenceNumber} is already pending for this account at gas ` +
                    "unit price 100000; a replacement must offer a higher gas unit price than that, and this one " +
                    "offers 100000",
            );
        } else if (sequenceNumber >= this.chain + this.window) {
            answer = refused(
                `sequence number ${sequenceNumber} is above ${this.chain + this.window - 1}, the highest sequence ` +
                    "number this node can queue for the account",
            );
        } else if (expiration * 1000 <= this.nowMs()) {
            answer = refused(
                `Transaction expiration timestamp is in the past: expiration time ${expiration}, submission time ` +
                    `${Math.floor(this.nowMs() / 1000)}, both in Unix seconds`,
            );
        } else if (expiration > Math.floor(this.nowMs() / 1000) + 600) {
            const submission = Math.floor(this.nowMs() / 1000);
            answer = refused(
                `Transaction expiration timestamp is too far in the future: expiration time ${expiration}, ` +
                    `submission time ${submission}, both in Unix seconds; time to live ${expiration - submission} ` +
                    "seconds exceeds the maximum of 600 seconds",
            );
        } else {
            answer = { status: 200, body: this.accept(sequenceNumber, expiration, body) };
        }
        this.submissions.push({ sequenceNumber, expiration, body, status: answer.status });
        this.log.push(`SUBMIT ${sequenceNumber} (chain ${this.chain}) -> ${answer.status}`);
        return this.respond(answer);
    }

    /** Pools the transaction of `body` under the hash a node gives it, and returns that hash. */
    private accept(sequenceNumber: number, expiration: number, body: string): string {
        const hash = hashOfSubmittedBody(body);
        this.pool.set(sequenceNumber, { hash, sequenceNumber, expiration });
        this.accepted.set(sequenceNumber, hash);
        return hash;
    }

    private read(hash: string): Promise<Response> {
        this.count("transaction");
        let answer: Answer;
        if (this.committed.has(hash)) {
            answer = transaction(hash, "Success", "Executed successfully", 1_000);
        } else if ([...this.pool.values()].some((pooled) => pooled.hash === hash)) {
            answer = this.pendingVisible ? transaction(hash, "Pending", "", 0) : notFound();
        } else if (this.dropped.get(hash) === "Invalid") {
            answer = transaction(hash, "Invalid", "Status Code: SEQUENCE_NUMBER_TOO_OLD, Type Validation", 0);
        } else {
            answer = notFound();
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

function refused(reason: string): Answer {
    return { status: 400, body: { message: `Transaction validation failed: ${reason}` } };
}

function notFound(): Answer {
    return { status: 404, body: { message: "Not Found" } };
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
