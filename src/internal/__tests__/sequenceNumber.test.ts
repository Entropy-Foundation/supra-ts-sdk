import { SupraAccount } from "supra-l1-sdk-core";
import { SupraClient } from "../../api/supraClient";
import { SupraAPIError } from "../../errors/apiError";
import { SupraTransactionFailedError } from "../../errors/transactionError";
import { TransactionStatus } from "../../types/transaction";
import type { NetworkConfig } from "../../utils/apiEndpoints";
import type { SendTxnPayload } from "../../types/transactionManager/transactionBuild";
import {
    MAX_ACCEPTED_RECORDS_PER_ACCOUNT,
    SequenceNumberTracker,
    bindReservation,
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

beforeEach(() => {
    chainSequenceNumbers = [7];
    submitAnswers = [];
    finalStatus = TransactionStatus.Success;
    accountReads = 0;
    submitted = [];
    failingChainIdReads = 0;
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

describe("SequenceNumberTracker", () => {
    const fetchSeven = async () => 7n;
    const next = async (tracker: SequenceNumberTracker, address: string, fetchChain: () => Promise<bigint>) =>
        (await tracker.reserve(address, fetchChain)).sequenceNumber;

    /** Resolves to the value of `promise`, or to "waiting" when it has not settled after the pending callbacks ran. */
    async function settledNow<T>(promise: Promise<T>): Promise<T | "waiting"> {
        return Promise.race([promise, new Promise<"waiting">((resolve) => setTimeout(() => resolve("waiting"), 20))]);
    }

    it("hands out consecutive numbers with one read of the chain, one reservation at a time", async () => {
        const tracker = new SequenceNumberTracker();
        const fetchChain = jest.fn(fetchSeven);

        const first = await tracker.reserve("0x1", fetchChain);
        const second = tracker.reserve("0x1", fetchChain);
        expect(await settledNow(second)).toBe("waiting");

        tracker.accepted(first);
        expect((await second).sequenceNumber).toBe(8n);
        expect(first.sequenceNumber).toBe(7n);
        expect(fetchChain).toHaveBeenCalledTimes(1);
    });

    it("hands the lock to waiting callers in the order of their calls", async () => {
        const tracker = new SequenceNumberTracker();
        const first = await tracker.reserve("0x1", fetchSeven);
        const order: bigint[] = [];

        const waiting = Array.from({ length: 3 }, () =>
            tracker.reserve("0x1", fetchSeven).then((reservation) => {
                order.push(reservation.sequenceNumber);
                tracker.accepted(reservation);
            }),
        );
        tracker.accepted(first);
        await Promise.all(waiting);

        expect(order).toEqual([8n, 9n, 10n]);
    });

    it("keeps the counters and locks of accounts apart", async () => {
        const tracker = new SequenceNumberTracker();

        const one = await tracker.reserve("0x1", async () => 3n);
        // The lock of 0x1 is held; 0x2 has a lock of its own.
        const two = await tracker.reserve("0x2", async () => 40n);
        expect(two.sequenceNumber).toBe(40n);
        tracker.accepted(one);
        tracker.accepted(two);

        expect(await next(tracker, "0x1", async () => 99n)).toBe(4n);
    });

    it("hands a released number out next", async () => {
        const tracker = new SequenceNumberTracker();
        tracker.accepted(await tracker.reserve("0x1", fetchSeven));
        const second = await tracker.reserve("0x1", fetchSeven);

        tracker.release(second);

        expect(await next(tracker, "0x1", fetchSeven)).toBe(second.sequenceNumber);
    });

    it("skips the numbers recorded as accepted from this client", async () => {
        const tracker = new SequenceNumberTracker();
        const address = "0x" + "0".repeat(63) + "1";
        tracker.recordAccepted(address, 7n, "0x" + "07".repeat(32));
        tracker.recordAccepted(address, 8n, "0x" + "08".repeat(32));

        expect(await next(tracker, address, fetchSeven)).toBe(9n);
    });

    it("ignores a settlement of a reservation that does not hold the lock", async () => {
        const tracker = new SequenceNumberTracker();
        const first = await tracker.reserve("0x1", fetchSeven);
        tracker.release(first);
        const second = await tracker.reserve("0x1", fetchSeven);
        expect(second.sequenceNumber).toBe(7n);

        // `first` is settled, and these were never handed out.
        tracker.release(first);
        tracker.accepted(first);
        tracker.resynchronise(first);
        tracker.release({ address: "0x1", sequenceNumber: 7n });
        tracker.accepted({ address: "0x1", sequenceNumber: 7n });
        const third = tracker.reserve("0x1", fetchSeven);
        expect(await settledNow(third)).toBe("waiting");

        tracker.accepted(second);
        expect((await third).sequenceNumber).toBe(8n);
    });

    it("reads the chain again after invalidate, while the reservation that holds the lock keeps it", async () => {
        const tracker = new SequenceNumberTracker();
        const held = await tracker.reserve("0x1", fetchSeven);

        tracker.invalidate("0x1");
        const after = tracker.reserve("0x1", async () => 20n);
        expect(await settledNow(after)).toBe("waiting");
        // A release after the invalidation leaves the counter to be read from the chain.
        tracker.release(held);

        expect((await after).sequenceNumber).toBe(20n);
    });

    it("reads the chain again after resynchronise and releases the lock", async () => {
        const tracker = new SequenceNumberTracker();

        tracker.resynchronise(await tracker.reserve("0x1", fetchSeven));

        expect(await next(tracker, "0x1", async () => 30n)).toBe(30n);
    });

    it("releases the lock and keeps serving callers after a failed read of the chain", async () => {
        const tracker = new SequenceNumberTracker();

        await expect(tracker.reserve("0x1", async () => Promise.reject(new Error("offline")))).rejects.toThrow("offline");

        expect(await next(tracker, "0x1", fetchSeven)).toBe(7n);
    });
});

describe("SequenceNumberTracker.resume", () => {
    const ADDRESS = "0x" + "0".repeat(63) + "1";
    const hashOf = (n: number) => "0x" + n.toString(16).padStart(64, "0");

    it("resumes at the lowest number without a pending transaction and keeps the records of the pending ones", async () => {
        const tracker = new SequenceNumberTracker();
        // Transactions 5, 6 and 7 were accepted; 6 is no longer pending.
        for (const n of [5, 6, 7]) {
            const reservation = await tracker.reserve(ADDRESS, async () => 5n);
            tracker.recordAccepted(ADDRESS, reservation.sequenceNumber, hashOf(n));
            tracker.accepted(reservation);
        }
        const eight = await tracker.reserve(ADDRESS, async () => 5n);
        expect(eight.sequenceNumber).toBe(8n);

        tracker.resume(
            eight,
            5n,
            new Map([
                [5n, hashOf(5)],
                [7n, hashOf(7)],
            ]),
        );

        expect([...tracker.acceptedBetween(ADDRESS, 0n, 100n).keys()]).toEqual([5n, 7n]);
        // 6 is handed out, then 8: 7 has a pending transaction.
        const six = await tracker.reserve(ADDRESS, async () => 99n);
        expect(six.sequenceNumber).toBe(6n);
        tracker.accepted(six);
        expect(await (async () => (await tracker.reserve(ADDRESS, async () => 99n)).sequenceNumber)()).toBe(8n);
    });

    it("drops the records below the chain's number and resumes at it when nothing is pending", async () => {
        const tracker = new SequenceNumberTracker();
        tracker.recordAccepted(ADDRESS, 3n, hashOf(3));
        tracker.recordAccepted(ADDRESS, 4n, hashOf(4));
        const reservation = await tracker.reserve(ADDRESS, async () => 3n);
        expect(reservation.sequenceNumber).toBe(5n);

        tracker.resume(reservation, 4n, new Map());

        expect(tracker.acceptedBetween(ADDRESS, 0n, 100n).size).toBe(0);
        expect((await tracker.reserve(ADDRESS, async () => 99n)).sequenceNumber).toBe(4n);
    });
});

describe("SequenceNumberTracker records of accepted transactions", () => {
    const ADDRESS = "0x" + "0".repeat(63) + "1";
    const hashOf = (n: number) => "0x" + n.toString(16).padStart(64, "0");
    /** Every record of `ADDRESS`. */
    const recorded = (tracker: SequenceNumberTracker) => tracker.acceptedBetween(ADDRESS, 0n, 2n ** 64n);

    it("records the hash of an accepted number, with the address and hash standardized", () => {
        const tracker = new SequenceNumberTracker();

        tracker.recordAccepted("0x1", 7, "0X" + "AB".repeat(32));

        expect(recorded(tracker)).toEqual(new Map([[7n, "0x" + "ab".repeat(32)]]));
    });

    it("records nothing for a hash that is not hex", () => {
        const tracker = new SequenceNumberTracker();

        tracker.recordAccepted(ADDRESS, 7n, "not a hash");

        expect(recorded(tracker).size).toBe(0);
    });

    it(`keeps at most ${MAX_ACCEPTED_RECORDS_PER_ACCOUNT} records per account and drops the lowest number`, () => {
        const tracker = new SequenceNumberTracker();

        for (let n = 0; n <= MAX_ACCEPTED_RECORDS_PER_ACCOUNT; n += 1) {
            tracker.recordAccepted(ADDRESS, BigInt(n), hashOf(n + 1));
        }

        expect(recorded(tracker).size).toBe(MAX_ACCEPTED_RECORDS_PER_ACCOUNT);
        expect(recorded(tracker).get(0n)).toBeUndefined();
        expect(recorded(tracker).get(BigInt(MAX_ACCEPTED_RECORDS_PER_ACCOUNT))).toBeDefined();
    });

    it("returns the records from one number up to another (exclusive)", () => {
        const tracker = new SequenceNumberTracker();
        [3, 4, 5, 6].forEach((n) => tracker.recordAccepted(ADDRESS, BigInt(n), hashOf(n)));

        expect([...tracker.acceptedBetween(ADDRESS, 4n, 6n).keys()]).toEqual([4n, 5n]);
        expect(tracker.acceptedBetween("0x" + "0".repeat(63) + "2", 0n, 10n).size).toBe(0);
    });

    it("drops the records below the chain's number", () => {
        const tracker = new SequenceNumberTracker();
        [3, 4, 5].forEach((n) => tracker.recordAccepted(ADDRESS, BigInt(n), hashOf(n)));

        tracker.observeChainSequenceNumber(ADDRESS, 5n);

        expect(recorded(tracker)).toEqual(new Map([[5n, hashOf(5)]]));
    });

    it("drops the records up to a transaction that reads Success or Fail", () => {
        const tracker = new SequenceNumberTracker();
        [3, 4, 5].forEach((n) => tracker.recordAccepted(ADDRESS, BigInt(n), hashOf(n)));

        tracker.observeTransaction(hashOf(4), TransactionStatus.Fail);

        expect(recorded(tracker)).toEqual(new Map([[5n, hashOf(5)]]));
    });

    it("invalidates the counter and its records when a recorded transaction reads Invalid", async () => {
        const tracker = new SequenceNumberTracker();
        tracker.accepted(await tracker.reserve(ADDRESS, async () => 3n));
        tracker.recordAccepted(ADDRESS, 3n, hashOf(3));
        const fetchChain = jest.fn(async () => 3n);

        tracker.observeTransaction(hashOf(3), TransactionStatus.Invalid);

        expect(recorded(tracker).size).toBe(0);
        expect((await tracker.reserve(ADDRESS, fetchChain)).sequenceNumber).toBe(3n);
        expect(fetchChain).toHaveBeenCalledTimes(1);
    });

    it.each([TransactionStatus.Pending, TransactionStatus.PendingAfterExecution])(
        "keeps the records when a recorded transaction reads %s",
        (status) => {
            const tracker = new SequenceNumberTracker();
            tracker.recordAccepted(ADDRESS, 3n, hashOf(3));

            tracker.observeTransaction(hashOf(3), status);

            expect(recorded(tracker).get(3n)).toBe(hashOf(3));
        },
    );
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

    it("uses an explicit sequence number as given and leaves the counter alone", async () => {
        const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255 });
        const sender = new SupraAccount();

        await transfer(supra, sender, 42n);
        await transfer(supra, sender, 43);
        expect(accountReads).toBe(0);
        await transfer(supra, sender);

        expect(submitted).toEqual([42, 43, 7]);
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

    it("resynchronises and retries when the node refuses a number that is too new", async () => {
        const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255 });
        const sender = new SupraAccount();
        chainSequenceNumbers = [7, 3];
        submitAnswers = [tooNew];

        await transfer(supra, sender);

        expect(submitted).toEqual([7, 3]);
    });

    it.each([
        [
            "a number above what the node queues",
            "Transaction validation failed: sequence number 30 is above 25, the highest sequence number this node can queue for the account",
        ],
        [
            "a number below the account's next",
            "Transaction validation failed: sequence number 3 is below the account's next sequence number 7",
        ],
        [
            "a number the node did not expect",
            "Transaction validation failed: The transaction 0xab sent by AccountAddress::Move(0x1) has sequence number 30 but the expected sequence number is 1.",
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

    it("reads the chain again after a refusal whose effect on the node is unknown", async () => {
        const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255 });
        const sender = new SupraAccount();
        submitAnswers = [() => json({ message: "Internal error" }, 500)];

        await expect(transfer(supra, sender)).rejects.toBeInstanceOf(SupraAPIError);
        chainSequenceNumbers = [8];
        await transfer(supra, sender);

        expect(submitted).toEqual([7, 8]);
        expect(accountReads).toBe(2);
    });

    it("reads the chain again after a discarded transaction", async () => {
        const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255 });
        const sender = new SupraAccount();
        finalStatus = TransactionStatus.Invalid;

        await expect(transfer(supra, sender, undefined, true)).rejects.toBeInstanceOf(SupraTransactionFailedError);
        finalStatus = TransactionStatus.Success;
        await transfer(supra, sender);

        expect(submitted).toEqual([7, 7]);
        expect(accountReads).toBe(2);
    });

    it("reads the chain again after a discarded transaction that checkSuccess false returns", async () => {
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
        expect(accountReads).toBe(2);
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

    it("reads the chain again after resetSequenceNumber", async () => {
        const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255 });
        const sender = new SupraAccount();
        await transfer(supra, sender);

        chainSequenceNumbers = [30];
        supra.resetSequenceNumber(sender.address());
        await transfer(supra, sender);

        expect(submitted).toEqual([7, 30]);
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
        const stale = new SupraAPIError({
            status: 400,
            statusText: "Bad Request",
            url: RPC_URL,
            data: { message: "General err: MoveTransactionValidationFailed(0x1, 0, SEQUENCE_NUMBER_TOO_OLD)" },
        });

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
        const taken = await withSequenceNumberInternal({ address }, config, async (sequenceNumber, reservation) => {
            sequenceNumberTrackerOf(config).accepted(reservation as SequenceNumberReservation);
            return sequenceNumber;
        });

        expect(taken).toBe(7n);
        expect(accountReads).toBe(1);
    });

    it("makes the counter read the chain again when the run throws a stale number", async () => {
        const config = newConfig();
        const stale = new SupraAPIError({
            status: 400,
            statusText: "Bad Request",
            url: RPC_URL,
            data: { message: "General err: MoveTransactionValidationFailed(0x1, 0, SEQUENCE_NUMBER_TOO_OLD)" },
        });

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

    it("keeps a settlement made by the run, and releases the lock after an error thrown later", async () => {
        const config = newConfig();

        await expect(
            withSequenceNumberInternal({ address }, config, async (_sequenceNumber, reservation) => {
                // The node accepted the transaction; the wait for its final status then fails.
                sequenceNumberTrackerOf(config).accepted(reservation as SequenceNumberReservation);
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
        sequenceNumberTrackerOf(config).accepted(held);
    });
});

describe("the reservation of a submission", () => {
    const payload = (): SendTxnPayload =>
        ({ Move: { raw_txn: { sender: "0x" + "cd".repeat(32), sequence_number: 7 } } }) as unknown as SendTxnPayload;

    it("belongs only to the payload it was bound to", async () => {
        const tracker = new SequenceNumberTracker();
        const reservation = await tracker.reserve("0x" + "cd".repeat(32), async () => 7n);
        const bound = payload();
        bindReservation(bound, reservation);

        expect(reservationOf(bound)).toBe(reservation);
        // The same sender and number without the binding, as with an explicit sequence number.
        expect(reservationOf(payload())).toBeUndefined();
    });
});
