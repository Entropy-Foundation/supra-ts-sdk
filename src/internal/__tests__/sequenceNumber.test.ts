import { SupraAccount } from "supra-l1-sdk-core";
import { SupraClient } from "../../api/supraClient";
import { SupraAccountQueueFullError, SupraAPIError } from "../../errors/apiError";
import { SupraTransactionFailedError } from "../../errors/transactionError";
import { TransactionStatus } from "../../types/transaction";
import type { NetworkConfig } from "../../utils/apiEndpoints";
import type { SendTxnPayload } from "../../types/transactionManager/transactionBuild";
import { ChainClock } from "../chainTime";
import {
    MAX_SUBMISSION_RECORDS_PER_ACCOUNT,
    SequenceNumberTracker,
    bindReservation,
    isAccountQueueFullRefusal,
    isStaleSequenceNumberError,
    reservationOf,
    sequenceNumberTrackerOf,
    settleUnsubmittedSequenceNumberInternal,
    withSequenceNumberInternal,
    type SequenceNumberReservation,
} from "../sequenceNumber";

const RPC_URL = "http://node.test";
const HASH = "0x" + "5e".repeat(32);
const GAS = { maxGas: 5_000n, gasUnitPrice: 100n };
const RECEIVER = "0x" + "ab".repeat(32);
/** An expiration time far in the future, in seconds. */
const FAR = 10n ** 12n;

type Answer = { status: number; body: unknown };

let chainSequenceNumbers: number[];
let submitAnswers: Array<() => Answer>;
let finalStatus: TransactionStatus;
let accountReads: number;
let submitted: number[];
/** Number of chain ID reads still to be answered with HTTP 500. */
let failingChainIdReads: number;
const originalFetch = global.fetch;

function json(body: unknown, status = 200): Answer {
    return { status, body };
}

function tooOld(): Answer {
    return json({ message: "General err: MoveTransactionValidationFailed(0x1, 0, SEQUENCE_NUMBER_TOO_OLD)" }, 400);
}

function tooNew(): Answer {
    return json({ message: "General err: MoveTransactionValidationFailed(0x1, 0, SEQUENCE_NUMBER_TOO_NEW)" }, 400);
}

function rejected(): Answer {
    return json({ message: "General err: MoveTransactionValidationFailed(0x1, 0, INSUFFICIENT_BALANCE_FOR_TRANSACTION_FEE)" }, 400);
}

function transaction(status: TransactionStatus, vmStatus: string) {
    return {
        hash: HASH,
        status,
        txn_type: "user",
        output: { Move: { gas_used: 1, events: [], vm_status: vmStatus } },
        block_header: null,
    };
}

function respond(answer: Answer): Promise<Response> {
    return Promise.resolve(
        new Response(JSON.stringify(answer.body), {
            status: answer.status,
            headers: { "Content-Type": "application/json" },
        }),
    );
}

function apiError(status: number, message: string): SupraAPIError {
    return new SupraAPIError({ status, statusText: "Bad Request", url: RPC_URL, data: { message } });
}

beforeEach(() => {
    chainSequenceNumbers = [7];
    submitAnswers = [];
    finalStatus = TransactionStatus.Success;
    accountReads = 0;
    submitted = [];
    failingChainIdReads = 0;
    // The node of these tests serves no blocks; the counter's reads of the latest block fail and are ignored.
    global.fetch = jest.fn((input: string | URL | Request, init?: RequestInit) => {
        const path = new URL(String(input)).pathname.replace(/^\/rpc\/v3/, "");
        const method = init?.method ?? "GET";
        if (method === "GET" && /^\/accounts\/0x[0-9a-f]+$/.test(path)) {
            const index = Math.min(accountReads, chainSequenceNumbers.length - 1);
            accountReads += 1;
            return respond(json({ sequence_number: chainSequenceNumbers[index], authentication_key: "0x" + "00".repeat(32) }));
        }
        if (method === "POST" && path === "/transactions/submit") {
            const body = JSON.parse(String(init?.body)) as { Move: { raw_txn: { sequence_number: number } } };
            submitted.push(body.Move.raw_txn.sequence_number);
            const answer = submitAnswers.shift()?.() ?? json(HASH);
            return respond(answer);
        }
        if (method === "GET" && path === "/transactions/chain_id") {
            if (failingChainIdReads > 0) {
                failingChainIdReads -= 1;
                return respond(json({ message: "Internal Server Error" }, 500));
            }
            return respond(json(255));
        }
        if (method === "GET" && path.startsWith("/transactions/")) {
            return respond(
                json(
                    finalStatus === TransactionStatus.Success
                        ? transaction(TransactionStatus.Success, "Executed successfully")
                        : transaction(finalStatus, "Status Code: INVALID_SIGNATURE, Type Validation"),
                ),
            );
        }
        return respond(json({ message: `unexpected ${method} ${path}` }, 500));
    }) as typeof fetch;
});

afterEach(() => {
    global.fetch = originalFetch;
});

function transfer(supra: SupraClient, sender: SupraAccount, sequenceNumber?: bigint | number, wait = false) {
    return supra.coin.transferSupraCoin({
        senderAccount: sender,
        receiverAccountAddress: RECEIVER,
        amount: 1n,
        optionalTransactionArgs: {
            optionalTransactionPayloadArgs: sequenceNumber === undefined ? GAS : { ...GAS, sequenceNumber },
            enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: wait },
        },
    });
}

const ADDRESS = "0x" + "0".repeat(63) + "1";
const hashOf = (n: number | bigint) => "0x" + n.toString(16).padStart(64, "0");

/** The node accepted the transaction of `reservation`: its submission is recorded and the lock released. */
function accept(tracker: SequenceNumberTracker, reservation: SequenceNumberReservation, expiration = FAR): void {
    tracker.record(reservation.address, reservation.sequenceNumber, expiration, hashOf(reservation.sequenceNumber));
    tracker.release(reservation);
}

describe("SequenceNumberTracker", () => {
    const fetchSeven = async () => 7n;
    const next = async (tracker: SequenceNumberTracker, fetchChain: () => Promise<bigint>) =>
        (await tracker.reserve(ADDRESS, fetchChain)).sequenceNumber;

    /** Resolves to the value of `promise`, or to "waiting" when it has not settled after the pending callbacks ran. */
    async function settledNow<T>(promise: Promise<T>): Promise<T | "waiting"> {
        return Promise.race([promise, new Promise<"waiting">((resolve) => setTimeout(() => resolve("waiting"), 20))]);
    }

    it("hands out consecutive numbers with one read of the chain, one reservation at a time", async () => {
        const tracker = new SequenceNumberTracker();
        const fetchChain = jest.fn(fetchSeven);

        const first = await tracker.reserve(ADDRESS, fetchChain);
        const second = tracker.reserve(ADDRESS, fetchChain);
        expect(await settledNow(second)).toBe("waiting");

        accept(tracker, first);
        expect((await second).sequenceNumber).toBe(8n);
        expect(first.sequenceNumber).toBe(7n);
        expect(fetchChain).toHaveBeenCalledTimes(1);
    });

    it("hands the lock to waiting callers in the order of their calls", async () => {
        const tracker = new SequenceNumberTracker();
        const first = await tracker.reserve(ADDRESS, fetchSeven);
        const order: bigint[] = [];

        const waiting = Array.from({ length: 3 }, () =>
            tracker.reserve(ADDRESS, fetchSeven).then((reservation) => {
                order.push(reservation.sequenceNumber);
                accept(tracker, reservation);
            }),
        );
        accept(tracker, first);
        await Promise.all(waiting);

        expect(order).toEqual([8n, 9n, 10n]);
    });

    it("keeps the counters and locks of accounts apart", async () => {
        const tracker = new SequenceNumberTracker();
        const other = "0x" + "0".repeat(63) + "2";

        const one = await tracker.reserve(ADDRESS, async () => 3n);
        // The lock of ADDRESS is held; `other` has a lock of its own.
        const two = await tracker.reserve(other, async () => 40n);
        expect(two.sequenceNumber).toBe(40n);
        accept(tracker, one);
        accept(tracker, two);

        expect(await next(tracker, async () => 99n)).toBe(4n);
    });

    it("hands a released number without a record out next", async () => {
        const tracker = new SequenceNumberTracker();
        accept(tracker, await tracker.reserve(ADDRESS, fetchSeven));
        const second = await tracker.reserve(ADDRESS, fetchSeven);

        tracker.release(second);

        expect(await next(tracker, fetchSeven)).toBe(second.sequenceNumber);
    });

    it("skips the numbers of recorded submissions", async () => {
        const tracker = new SequenceNumberTracker();
        tracker.record(ADDRESS, 7n, FAR, hashOf(7));
        tracker.record(ADDRESS, 8n, FAR);

        expect(await next(tracker, fetchSeven)).toBe(9n);
    });

    it("ignores a settlement of a reservation that does not hold the lock", async () => {
        const tracker = new SequenceNumberTracker();
        const first = await tracker.reserve(ADDRESS, fetchSeven);
        tracker.release(first);
        const second = await tracker.reserve(ADDRESS, fetchSeven);
        expect(second.sequenceNumber).toBe(7n);

        // `first` is settled, and this one was never handed out.
        tracker.release(first);
        tracker.resynchronise(first);
        tracker.move(first, 30n);
        tracker.release({ address: ADDRESS, sequenceNumber: 7n });
        const third = tracker.reserve(ADDRESS, fetchSeven);
        expect(await settledNow(third)).toBe("waiting");

        accept(tracker, second);
        expect((await third).sequenceNumber).toBe(8n);
    });

    it("reads the chain again after reset, while the reservation that holds the lock keeps it", async () => {
        const tracker = new SequenceNumberTracker();
        tracker.record(ADDRESS, 8n, FAR);
        const held = await tracker.reserve(ADDRESS, fetchSeven);

        tracker.reset(ADDRESS);
        const after = tracker.reserve(ADDRESS, async () => 7n);
        expect(await settledNow(after)).toBe("waiting");
        tracker.release(held);

        // The record of 8 is forgotten too.
        expect((await after).sequenceNumber).toBe(7n);
        expect(tracker.recorded(ADDRESS).size).toBe(0);
    });

    it("reads the chain again after resynchronise and keeps the records the chain does not show dead", async () => {
        const tracker = new SequenceNumberTracker();
        accept(tracker, await tracker.reserve(ADDRESS, fetchSeven));
        accept(tracker, await tracker.reserve(ADDRESS, fetchSeven));
        const fetchChain = jest.fn(fetchSeven);

        tracker.resynchronise(await tracker.reserve(ADDRESS, fetchSeven));

        // 7 and 8 are pending: the next number is 9, read after the chain.
        expect(await next(tracker, fetchChain)).toBe(9n);
        expect(fetchChain).toHaveBeenCalledTimes(1);
    });

    it("drops the records below the chain's number read after resynchronise", async () => {
        const tracker = new SequenceNumberTracker();
        accept(tracker, await tracker.reserve(ADDRESS, fetchSeven));
        accept(tracker, await tracker.reserve(ADDRESS, fetchSeven));

        tracker.resynchronise(await tracker.reserve(ADDRESS, fetchSeven));

        expect(await next(tracker, async () => 8n)).toBe(9n);
        expect([...tracker.recorded(ADDRESS).keys()]).toEqual([8n]);
    });

    it("keeps the highest number the chain was read at", async () => {
        const tracker = new SequenceNumberTracker();
        tracker.resynchronise(await tracker.reserve(ADDRESS, async () => 9n));

        // A read from a node that is behind does not move the counter back.
        expect(await next(tracker, async () => 4n)).toBe(9n);
    });

    it("releases the lock and keeps serving callers after a failed read of the chain", async () => {
        const tracker = new SequenceNumberTracker();

        await expect(tracker.reserve(ADDRESS, async () => Promise.reject(new Error("offline")))).rejects.toThrow("offline");

        expect(await next(tracker, fetchSeven)).toBe(7n);
    });

    it("moves a reservation to another number and frees its own", async () => {
        const tracker = new SequenceNumberTracker();
        tracker.record(ADDRESS, 7n, FAR);
        const reservation = await tracker.reserve(ADDRESS, fetchSeven);
        expect(reservation.sequenceNumber).toBe(8n);

        tracker.move(reservation, 12n);
        expect(reservation.sequenceNumber).toBe(12n);
        accept(tracker, reservation);

        expect(await next(tracker, fetchSeven)).toBe(8n);
    });
});

describe("SequenceNumberTracker records and chain time", () => {
    /** Every record of `ADDRESS`, by number, with its expiration time. */
    const expirations = (tracker: SequenceNumberTracker) =>
        new Map([...tracker.recorded(ADDRESS)].map(([number, record]) => [number, record.expiration]));
    const blockAt = (seconds: bigint) => Number(seconds) * 1_000_000;

    it("records a submission with the address and hash standardized", () => {
        const tracker = new SequenceNumberTracker();

        tracker.record("0x1", 7, 100, "0X" + "AB".repeat(32));

        expect(tracker.recorded(ADDRESS)).toEqual(new Map([[7n, { expiration: 100n, hash: "0x" + "ab".repeat(32) }]]));
    });

    it("records a submission without a hash, and drops a hash that is not hex", () => {
        const tracker = new SequenceNumberTracker();

        tracker.record(ADDRESS, 7n, 100n);
        tracker.record(ADDRESS, 8n, 100n, "not a hash");

        expect(tracker.recorded(ADDRESS)).toEqual(
            new Map([
                [7n, { expiration: 100n, hash: undefined }],
                [8n, { expiration: 100n, hash: undefined }],
            ]),
        );
    });

    it(`keeps at most ${MAX_SUBMISSION_RECORDS_PER_ACCOUNT} records per account and drops the lowest number`, () => {
        const tracker = new SequenceNumberTracker();

        for (let n = 0; n <= MAX_SUBMISSION_RECORDS_PER_ACCOUNT; n += 1) {
            tracker.record(ADDRESS, BigInt(n), FAR, hashOf(n + 1));
        }

        expect(tracker.recorded(ADDRESS).size).toBe(MAX_SUBMISSION_RECORDS_PER_ACCOUNT);
        expect(tracker.recorded(ADDRESS).get(0n)).toBeUndefined();
        expect(tracker.recorded(ADDRESS).get(BigInt(MAX_SUBMISSION_RECORDS_PER_ACCOUNT))).toBeDefined();
    });

    it("drops the records below the chain's number", () => {
        const tracker = new SequenceNumberTracker();
        [3, 4, 5].forEach((n) => tracker.record(ADDRESS, BigInt(n), FAR, hashOf(n)));

        tracker.observeChainSequenceNumber(ADDRESS, 5n);

        expect([...tracker.recorded(ADDRESS).keys()]).toEqual([5n]);
    });

    it("drops a record once a block read from the node has reached its expiration time, not before", () => {
        const clock = new ChainClock();
        const tracker = new SequenceNumberTracker(clock);
        tracker.record(ADDRESS, 3n, 1_000n);
        tracker.record(ADDRESS, 4n, 1_060n);

        clock.observeLatestBlock(blockAt(999n) + 999_999);
        expect(expirations(tracker)).toEqual(
            new Map([
                [3n, 1_000n],
                [4n, 1_060n],
            ]),
        );
        clock.observeLatestBlock(blockAt(1_000n));
        expect(expirations(tracker)).toEqual(new Map([[4n, 1_060n]]));
    });

    it("keeps a record whatever the client's wall clock while no block has reached its expiration time", () => {
        const monotonic = { now: 0 };
        const wall = { now: 1_000_000 };
        const clock = new ChainClock(
            () => monotonic.now,
            () => wall.now,
        );
        const tracker = new SequenceNumberTracker(clock);
        clock.observeLatestBlock(blockAt(1_000n));
        tracker.record(ADDRESS, 3n, 1_060n);

        // The client's wall clock is an hour past the expiration time; the chain has produced no block since.
        wall.now = 1_060_000 + 3_600_000;

        expect(tracker.everyNumberRecorded(ADDRESS, 3n, 4n)).toBe(true);
    });

    it("drops only the record of a transaction that reads Invalid", () => {
        const tracker = new SequenceNumberTracker();
        [3, 4, 5].forEach((n) => tracker.record(ADDRESS, BigInt(n), FAR, hashOf(n)));

        tracker.observeTransaction(hashOf(4), TransactionStatus.Invalid);

        expect([...tracker.recorded(ADDRESS).keys()]).toEqual([3n, 5n]);
    });

    it("drops the records up to a transaction that reads Success or Fail", () => {
        const tracker = new SequenceNumberTracker();
        [3, 4, 5].forEach((n) => tracker.record(ADDRESS, BigInt(n), FAR, hashOf(n)));

        tracker.observeTransaction(hashOf(4), TransactionStatus.Fail);

        expect([...tracker.recorded(ADDRESS).keys()]).toEqual([5n]);
    });

    it.each([TransactionStatus.Pending, TransactionStatus.PendingAfterExecution])(
        "keeps the records when a recorded transaction reads %s",
        (status) => {
            const tracker = new SequenceNumberTracker();
            tracker.record(ADDRESS, 3n, FAR, hashOf(3));

            tracker.observeTransaction(hashOf(3), status);

            expect(tracker.recorded(ADDRESS).get(3n)?.hash).toBe(hashOf(3));
        },
    );

    it("reports the lowest number without a record and whether a range is recorded", () => {
        const tracker = new SequenceNumberTracker();
        expect(tracker.nextFree(ADDRESS)).toBeUndefined();
        [5, 6, 8].forEach((n) => tracker.record(ADDRESS, BigInt(n), FAR));
        tracker.observeChainSequenceNumber(ADDRESS, 5n);

        expect(tracker.nextFree(ADDRESS)).toBe(7n);
        expect(tracker.everyNumberRecorded(ADDRESS, 5n, 7n)).toBe(true);
        expect(tracker.everyNumberRecorded(ADDRESS, 5n, 8n)).toBe(false);
        expect(tracker.everyNumberRecorded(ADDRESS, 5n, 5n)).toBe(true);
    });

    it("reads the chain before the next number once the estimated chain time passes a record's expiration time by 2 s", async () => {
        const monotonic = { now: 0 };
        const clock = new ChainClock(() => monotonic.now);
        const tracker = new SequenceNumberTracker(clock);
        const fetchChain = jest.fn(async () => 7n);
        clock.observeLatestBlock(blockAt(1_000n));
        const first = await tracker.reserve(ADDRESS, fetchChain);
        accept(tracker, first, 1_060n);
        accept(tracker, await tracker.reserve(ADDRESS, fetchChain), 1_070n);
        expect(fetchChain).toHaveBeenCalledTimes(1);

        // One second after 7's expiration time the chain is not read.
        monotonic.now = 61_000;
        tracker.release(await tracker.reserve(ADDRESS, fetchChain));
        expect(fetchChain).toHaveBeenCalledTimes(1);

        // Two seconds after it the chain is read; it finds no newer block, so 7 is kept.
        monotonic.now = 62_000;
        const third = await tracker.reserve(ADDRESS, fetchChain);
        expect(third.sequenceNumber).toBe(9n);
        expect(fetchChain).toHaveBeenCalledTimes(2);
        tracker.release(third);

        // The read did not show 7 expired, so the next call reads the chain again, once.
        tracker.release(await tracker.reserve(ADDRESS, fetchChain));
        expect(fetchChain).toHaveBeenCalledTimes(3);

        // A block read after 7's expiration time drops it, and 7 is handed out.
        fetchChain.mockImplementationOnce(async () => {
            clock.observeLatestBlock(blockAt(1_065n));
            return 7n;
        });
        monotonic.now = 66_000;
        const fourth = await tracker.reserve(ADDRESS, fetchChain);
        expect(fourth.sequenceNumber).toBe(7n);
        expect(fetchChain).toHaveBeenCalledTimes(4);
        tracker.release(fourth);

        // With no record past its expiration time, the chain is not read.
        tracker.release(await tracker.reserve(ADDRESS, fetchChain));
        expect(fetchChain).toHaveBeenCalledTimes(4);
    });

    it("reads the chain again at the next call after a read whose block request failed at an expiration trigger", async () => {
        const monotonic = { now: 0 };
        const clock = new ChainClock(() => monotonic.now);
        const tracker = new SequenceNumberTracker(clock);
        clock.observeLatestBlock(blockAt(1_000n));
        // The account reads succeed; the block read at the first trigger fails (the clock is not updated).
        let blockReads = 0;
        const fetchChain = jest.fn(async () => {
            blockReads += 1;
            if (blockReads > 2) {
                clock.observeLatestBlock(blockAt(1_070n));
            }
            return 7n;
        });
        accept(tracker, await tracker.reserve(ADDRESS, fetchChain), 1_060n);
        monotonic.now = 70_000;

        const atTrigger = await tracker.reserve(ADDRESS, fetchChain);
        expect(atTrigger.sequenceNumber).toBe(8n);
        tracker.release(atTrigger);
        expect(fetchChain).toHaveBeenCalledTimes(2);

        const next = await tracker.reserve(ADDRESS, fetchChain);
        expect(fetchChain).toHaveBeenCalledTimes(3);
        expect(next.sequenceNumber).toBe(7n);
    });
});

describe("refusals concerning the sequence number", () => {
    it.each([
        ["v12 number above the queue", "Transaction validation failed: sequence number 30 is above 25, the highest sequence number this node can queue for the account", true],
        ["v11.7.0 number above the expected one", "Transaction validation failed: The transaction 0xab sent by AccountAddress::Move(0x1) has sequence number 30 but the expected sequence number is 1.", true],
        ["v11.7.0 number below the expected one", "Transaction validation failed: The transaction 0xab sent by AccountAddress::Move(0x1) has sequence number 3 but the expected sequence number is 7.", false],
        ["v12 number below the account's", "Transaction validation failed: sequence number 3 is below the account's next sequence number 7", false],
    ])("classifies the %s", (_name, message, full) => {
        const error = apiError(400, message);

        expect(isAccountQueueFullRefusal(error)).toBe(full);
        expect(isStaleSequenceNumberError(error)).toBe(!full);
    });
});

describe("sequence numbers of the transfer helpers", () => {
    it("reads the chain once and numbers concurrent transfers consecutively", async () => {
        const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255 });
        const sender = new SupraAccount();

        await Promise.all(Array.from({ length: 5 }, () => transfer(supra, sender)));
        await transfer(supra, sender);

        expect([...submitted].sort((a, b) => a - b)).toEqual([7, 8, 9, 10, 11, 12]);
        expect(accountReads).toBe(1);
    });

    it("keeps a counter per client", async () => {
        const first = new SupraClient({ rpcUrl: RPC_URL, chainId: 255 });
        const second = new SupraClient({ rpcUrl: RPC_URL, chainId: 255 });
        const sender = new SupraAccount();

        await transfer(first, sender);
        await transfer(first, sender);
        await transfer(second, sender);

        expect(submitted).toEqual([7, 8, 7]);
        expect(accountReads).toBe(2);
    });

    it("uses an explicit sequence number as given and does not hand it out", async () => {
        const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255 });
        const sender = new SupraAccount();
        // The transactions stay pending.
        finalStatus = TransactionStatus.Pending;

        await transfer(supra, sender, 42n);
        await transfer(supra, sender, 8);
        expect(accountReads).toBe(0);
        await transfer(supra, sender);
        // 8 has a pending transaction of this client.
        await transfer(supra, sender);

        expect(submitted).toEqual([42, 8, 7, 9]);
    });

    it("rejects an explicit sequence number that is not a u64", async () => {
        const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255 });

        await expect(transfer(supra, new SupraAccount(), -1n)).rejects.toThrow(RangeError);
        await expect(transfer(supra, new SupraAccount(), 1.5)).rejects.toThrow(RangeError);
        expect(submitted).toEqual([]);
    });

    it("reads the chain again and sends the transfer again when the node refuses a stale number", async () => {
        const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255 });
        const sender = new SupraAccount();
        await transfer(supra, sender);
        expect(submitted).toEqual([7]);

        chainSequenceNumbers = [20];
        accountReads = 0;
        submitAnswers = [tooOld];

        const result = await transfer(supra, sender);

        expect(submitted).toEqual([7, 8, 20]);
        expect(result.hash).toBe(HASH);
        await transfer(supra, sender);
        expect(submitted).toEqual([7, 8, 20, 21]);
        expect(accountReads).toBe(1);
    });

    it("reads the chain again and retries when the node refuses a number that is too new", async () => {
        const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255 });
        const sender = new SupraAccount();
        chainSequenceNumbers = [7, 3];
        submitAnswers = [tooNew];

        await transfer(supra, sender);

        // The account's sequence number on the chain never decreases: the read of 3 comes from a node that is
        // behind, and the counter keeps 7.
        expect(submitted).toEqual([7, 7]);
        expect(accountReads).toBe(2);
    });

    it.each([
        [
            "a number below the account's next",
            "Transaction validation failed: sequence number 3 is below the account's next sequence number 7",
        ],
        [
            "a number below the expected one (v11.7.0)",
            "Transaction validation failed: The transaction 0xab sent by AccountAddress::Move(0x1) has sequence number 3 but the expected sequence number is 9.",
        ],
        [
            "a number already scheduled (v11.7.0)",
            "Transaction validation failed: Already scheduled digest=0xab, sender=0x1, sequence_number=7",
        ],
        [
            "a number that already has a pending transaction (v12)",
            "Transaction validation failed: a transaction with sequence number 7 is already pending for this account at gas unit price 100; a replacement must offer a higher gas unit price than that, and this one offers 100",
        ],
        ["a transaction already pending (v12)", "Transaction validation failed: transaction 0xab is already pending"],
    ])("resynchronises and retries when the node refuses with a message about %s", async (_name, message) => {
        const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255 });
        const sender = new SupraAccount();
        chainSequenceNumbers = [7, 9];
        submitAnswers = [() => json({ message }, 400)];

        await transfer(supra, sender);

        expect(submitted).toEqual([7, 9]);
    });

    it.each([
        [
            "v12",
            "Transaction validation failed: sequence number 7 is above 6, the highest sequence number this node can queue for the account",
        ],
        [
            "v11.7.0",
            "Transaction validation failed: The transaction 0xab sent by AccountAddress::Move(0x1) has sequence number 7 but the expected sequence number is 1.",
        ],
    ])(
        "throws SupraAccountQueueFullError for the %s refusal of a full queue, and reads the chain before the next number",
        async (_name, message) => {
            const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255 });
            const sender = new SupraAccount();
            submitAnswers = [() => json({ message }, 400)];

            const error = await transfer(supra, sender).catch((caught: unknown) => caught);

            expect(error).toBeInstanceOf(SupraAccountQueueFullError);
            expect(error).toBeInstanceOf(SupraAPIError);
            expect((error as SupraAccountQueueFullError).sequenceNumber).toBe(7n);
            expect((error as SupraAccountQueueFullError).message).toBe(message);
            expect(submitted).toEqual([7]);
            await transfer(supra, sender);
            expect(submitted).toEqual([7, 7]);
            expect(accountReads).toBe(2);
        },
    );

    it("does not treat other refusals as a stale number", async () => {
        const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255 });
        submitAnswers = [() => json({ message: "Transaction validation failed: Invalid transaction expiry" }, 400)];

        await expect(transfer(supra, new SupraAccount())).rejects.toBeInstanceOf(SupraAPIError);

        expect(submitted).toHaveLength(1);
    });

    it("throws the error of the second refusal and does not retry again", async () => {
        const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255 });
        const sender = new SupraAccount();
        submitAnswers = [tooOld, tooOld];

        const error = await transfer(supra, sender).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(SupraAPIError);
        expect((error as SupraAPIError).major_status).toBe("SEQUENCE_NUMBER_TOO_OLD");
        expect(submitted).toHaveLength(2);
    });

    it("does not retry a stale explicit number", async () => {
        const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255 });
        submitAnswers = [tooOld];

        await expect(transfer(supra, new SupraAccount(), 1n)).rejects.toBeInstanceOf(SupraAPIError);

        expect(submitted).toEqual([1]);
    });

    it("hands the number out again when the node refuses the transaction for another reason", async () => {
        const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255 });
        const sender = new SupraAccount();
        submitAnswers = [rejected];

        await expect(transfer(supra, sender)).rejects.toBeInstanceOf(SupraAPIError);
        await transfer(supra, sender);

        expect(submitted).toEqual([7, 7]);
        expect(accountReads).toBe(1);
    });

    it.each([
        ["an explicit number", 7],
        ["a number from the counter", undefined],
    ])("keeps the number of a submission whose outcome is unknown, with %s", async (_name, sequenceNumber) => {
        const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255 });
        const sender = new SupraAccount();
        submitAnswers = [() => json({ message: "Internal error" }, 500)];

        await expect(transfer(supra, sender, sequenceNumber)).rejects.toBeInstanceOf(SupraAPIError);
        await transfer(supra, sender);

        // The node may have accepted 7: the counter does not hand it out until the chain shows it dead.
        expect(submitted).toEqual([7, 8]);
        expect(accountReads).toBe(1);
    });

    it("gives the number of a transaction whose wait reads Invalid to the next transfer", async () => {
        const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255 });
        const sender = new SupraAccount();
        finalStatus = TransactionStatus.Invalid;

        await expect(transfer(supra, sender, undefined, true)).rejects.toBeInstanceOf(SupraTransactionFailedError);
        finalStatus = TransactionStatus.Success;
        await transfer(supra, sender);

        expect(submitted).toEqual([7, 7]);
        expect(accountReads).toBe(1);
    });

    it("gives the number of a discarded transaction that checkSuccess false returns to the next transfer", async () => {
        const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255 });
        const sender = new SupraAccount();
        finalStatus = TransactionStatus.Invalid;

        const result = await supra.coin.transferSupraCoin({
            senderAccount: sender,
            receiverAccountAddress: RECEIVER,
            amount: 1n,
            optionalTransactionArgs: {
                optionalTransactionPayloadArgs: GAS,
                enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true, checkSuccess: false },
            },
        });
        expect(result.status).toBe(TransactionStatus.Invalid);
        finalStatus = TransactionStatus.Success;
        await transfer(supra, sender);

        expect(submitted).toEqual([7, 7]);
        expect(accountReads).toBe(1);
    });

    it("does not use a number for a call whose waitTimeoutMs is invalid", async () => {
        const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255 });
        const sender = new SupraAccount();

        await expect(
            supra.coin.transferSupraCoin({
                senderAccount: sender,
                receiverAccountAddress: RECEIVER,
                amount: 1n,
                optionalTransactionArgs: {
                    optionalTransactionPayloadArgs: GAS,
                    enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true, waitTimeoutMs: -1 },
                },
            }),
        ).rejects.toThrow(RangeError);
        expect(accountReads).toBe(0);
        await transfer(supra, sender);

        expect(submitted).toEqual([7]);
    });

    it("keeps the counter after an executed transaction that failed", async () => {
        const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255 });
        const sender = new SupraAccount();
        finalStatus = TransactionStatus.Fail;

        await expect(transfer(supra, sender, undefined, true)).rejects.toBeInstanceOf(SupraTransactionFailedError);
        await transfer(supra, sender);

        expect(submitted).toEqual([7, 8]);
        expect(accountReads).toBe(1);
    });

    it("reads the chain again after resetSequenceNumber with the address in upper case", async () => {
        const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255 });
        const sender = new SupraAccount();
        await transfer(supra, sender);

        chainSequenceNumbers = [30];
        supra.resetSequenceNumber("0x" + sender.address().toString().slice(2).toUpperCase());
        await transfer(supra, sender);

        expect(submitted).toEqual([7, 30]);
    });

    it("forgets the records of the account's submissions on resetSequenceNumber", async () => {
        const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255 });
        const sender = new SupraAccount();
        await transfer(supra, sender);

        supra.resetSequenceNumber(sender.address());
        await transfer(supra, sender);

        // The chain still reads 7, and the record of the pending 7 is forgotten.
        expect(submitted).toEqual([7, 7]);
    });

    it("hands the number out again when signing throws before the submission", async () => {
        const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255 });
        const sender = new SupraAccount();
        failingChainIdReads = 1;

        await expect(transfer(supra, sender)).rejects.toBeInstanceOf(SupraAPIError);
        await transfer(supra, sender);

        expect(submitted).toEqual([7]);
        expect(accountReads).toBe(1);
    });

    it("numbers coin and fungible asset transfers from the same counter", async () => {
        const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255 });
        const sender = new SupraAccount();

        await transfer(supra, sender);
        // A fungible asset other than SUPRA, which the transfer submits without reading balances first.
        await supra.fungibleAsset.transferFungibleAsset({
            senderAccount: sender,
            receiverAccountAddress: RECEIVER,
            amount: 1n,
            assetAddress: "0x" + "ab".repeat(32),
            optionalTransactionArgs: { optionalTransactionPayloadArgs: GAS },
        });

        expect(submitted).toEqual([7, 8]);
        expect(accountReads).toBe(1);
    });
});

describe("a number whose transaction threw before submission", () => {
    const address = "0x" + "cd".repeat(32);
    const newConfig = (): NetworkConfig => ({ name: "custom", chainId: 255, rpcUrl: RPC_URL });

    it("is handed out again after an error that does not report the number", async () => {
        const config = newConfig();
        const tracker = sequenceNumberTrackerOf(config);
        const reservation = await tracker.reserve(address, async () => 7n);

        settleUnsubmittedSequenceNumberInternal(reservation, new Error("signing failed"), config);

        expect((await tracker.reserve(address, async () => 99n)).sequenceNumber).toBe(7n);
    });

    it("makes the counter read the chain again after an error that reports a stale number", async () => {
        const config = newConfig();
        const tracker = sequenceNumberTrackerOf(config);
        const reservation = await tracker.reserve(address, async () => 7n);
        const stale = apiError(400, "General err: MoveTransactionValidationFailed(0x1, 0, SEQUENCE_NUMBER_TOO_OLD)");

        settleUnsubmittedSequenceNumberInternal(reservation, stale, config);

        expect((await tracker.reserve(address, async () => 12n)).sequenceNumber).toBe(12n);
    });
});

describe("withSequenceNumberInternal", () => {
    const address = "0x" + "cd".repeat(32);
    const newConfig = (): NetworkConfig => ({ name: "custom", chainId: 255, rpcUrl: RPC_URL });

    it("releases the lock and hands the number out next when the run throws before the submission", async () => {
        const config = newConfig();

        await expect(
            withSequenceNumberInternal({ address }, config, async () => {
                throw new Error("build failed");
            }),
        ).rejects.toThrow("build failed");
        const taken = await withSequenceNumberInternal({ address }, config, async (sequenceNumber) => sequenceNumber);

        expect(taken).toBe(7n);
        expect(accountReads).toBe(1);
    });

    it("makes the counter read the chain again when the run throws a stale number", async () => {
        const config = newConfig();
        const stale = apiError(400, "General err: MoveTransactionValidationFailed(0x1, 0, SEQUENCE_NUMBER_TOO_OLD)");

        await expect(
            withSequenceNumberInternal({ address }, config, async () => {
                throw stale;
            }),
        ).rejects.toBe(stale);
        chainSequenceNumbers = [12];
        accountReads = 0;

        expect(await withSequenceNumberInternal({ address }, config, async (sequenceNumber) => sequenceNumber)).toBe(12n);
        expect(accountReads).toBe(1);
    });

    it("releases a reservation that the run leaves unsettled", async () => {
        const config = newConfig();

        await withSequenceNumberInternal({ address }, config, async (sequenceNumber) => sequenceNumber);

        expect(await withSequenceNumberInternal({ address }, config, async (sequenceNumber) => sequenceNumber)).toBe(7n);
    });

    it("keeps a record made by the run, and releases the lock after an error thrown later", async () => {
        const config = newConfig();

        await expect(
            withSequenceNumberInternal({ address }, config, async (sequenceNumber) => {
                // The node accepted the transaction; the wait for its final status then fails.
                sequenceNumberTrackerOf(config).record(address, sequenceNumber, FAR, HASH);
                throw new Error("wait failed");
            }),
        ).rejects.toThrow("wait failed");

        expect(await withSequenceNumberInternal({ address }, config, async (sequenceNumber) => sequenceNumber)).toBe(8n);
    });

    it("runs a call with an explicit number without the lock", async () => {
        const config = newConfig();
        const held = await sequenceNumberTrackerOf(config).reserve(address, async () => 7n);

        const run = withSequenceNumberInternal({ address, sequenceNumber: 42 }, config, async (sequenceNumber, reservation) => ({
            sequenceNumber,
            reservation,
        }));

        await expect(run).resolves.toEqual({ sequenceNumber: 42n, reservation: undefined });
        sequenceNumberTrackerOf(config).release(held);
    });
});

describe("the reservation of a submission", () => {
    const payload = (): SendTxnPayload =>
        ({ Move: { raw_txn: { sender: "0x" + "cd".repeat(32), sequence_number: 7 } } }) as unknown as SendTxnPayload;

    it("belongs only to the payload it was bound to", async () => {
        const tracker = new SequenceNumberTracker();
        const reservation = await tracker.reserve("0x" + "cd".repeat(32), async () => 7n);
        const bound = payload();
        const resign = jest.fn(async () => payload());
        bindReservation(bound, reservation, resign);

        expect(reservationOf(bound)).toEqual({ reservation, resign });
        // The same sender and number without the binding, as with an explicit sequence number.
        expect(reservationOf(payload())).toBeUndefined();
    });
});
