import { SupraAccount } from "supra-l1-sdk-core";
import { SupraClient } from "../../api/supraClient";
import { SupraAPIError } from "../../errors/apiError";
import { SupraTransactionFailedError } from "../../errors/transactionError";
import { TransactionStatus } from "../../types/transaction";
import { SequenceNumberTracker } from "../sequenceNumber";

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

    it("hands out distinct consecutive numbers to concurrent callers with one read of the chain", async () => {
        const tracker = new SequenceNumberTracker();
        const fetchChain = jest.fn(fetchSeven);

        const numbers = await Promise.all(Array.from({ length: 5 }, () => tracker.reserve("0x1", fetchChain)));

        expect(numbers).toEqual([7n, 8n, 9n, 10n, 11n]);
        expect(fetchChain).toHaveBeenCalledTimes(1);
    });

    it("keeps the counters of accounts apart", async () => {
        const tracker = new SequenceNumberTracker();

        expect(await tracker.reserve("0x1", async () => 3n)).toBe(3n);
        expect(await tracker.reserve("0x2", async () => 40n)).toBe(40n);
        expect(await tracker.reserve("0x1", async () => 99n)).toBe(4n);
    });

    it("hands out the latest number again when its submission is released", async () => {
        const tracker = new SequenceNumberTracker();
        await tracker.reserve("0x1", fetchSeven);
        const second = await tracker.reserve("0x1", fetchSeven);

        tracker.release("0x1", second);

        expect(await tracker.reserve("0x1", fetchSeven)).toBe(second);
    });

    it("fills a gap left by a released number before it hands out a new one", async () => {
        const tracker = new SequenceNumberTracker();
        const [first, second, third] = await Promise.all([
            tracker.reserve("0x1", fetchSeven),
            tracker.reserve("0x1", fetchSeven),
            tracker.reserve("0x1", fetchSeven),
        ]);
        expect([first, second, third]).toEqual([7n, 8n, 9n]);

        tracker.release("0x1", 8n);

        expect(await tracker.reserve("0x1", fetchSeven)).toBe(8n);
        expect(await tracker.reserve("0x1", fetchSeven)).toBe(10n);
    });

    it("lowers the counter past every released number at its end", async () => {
        const tracker = new SequenceNumberTracker();
        await Promise.all([tracker.reserve("0x1", fetchSeven), tracker.reserve("0x1", fetchSeven), tracker.reserve("0x1", fetchSeven)]);

        tracker.release("0x1", 8n);
        tracker.release("0x1", 9n);

        expect(await tracker.reserve("0x1", fetchSeven)).toBe(8n);
    });

    it("ignores the release and acceptance of a number it did not hand out", async () => {
        const tracker = new SequenceNumberTracker();
        await tracker.reserve("0x1", fetchSeven);

        tracker.release("0x1", 42n);
        tracker.accepted("0x1", 43n);

        expect(await tracker.reserve("0x1", fetchSeven)).toBe(8n);
    });

    it("reads the chain again after invalidate and ignores releases of earlier numbers", async () => {
        const tracker = new SequenceNumberTracker();
        const stale = await tracker.reserve("0x1", fetchSeven);

        tracker.invalidate("0x1");
        tracker.release("0x1", stale);

        expect(await tracker.reserve("0x1", async () => 20n)).toBe(20n);
        expect(await tracker.reserve("0x1", async () => 99n)).toBe(21n);
    });

    it("reads the chain again when invalidate happens during a read", async () => {
        const tracker = new SequenceNumberTracker();
        let release: (value: bigint) => void = () => undefined;
        const slow = new Promise<bigint>((resolve) => {
            release = resolve;
        });

        const pending = tracker.reserve("0x1", () => slow);
        tracker.invalidate("0x1");
        release(5n);

        const result = await Promise.race([pending, new Promise<string>((resolve) => setTimeout(() => resolve("blocked"), 200))]);
        // The first read is discarded and the number is read again; the slow read resolves for every attempt here.
        expect(result).toBe(5n);
    });

    it("keeps serving callers after a failed read of the chain", async () => {
        const tracker = new SequenceNumberTracker();

        await expect(tracker.reserve("0x1", async () => Promise.reject(new Error("offline")))).rejects.toThrow("offline");

        expect(await tracker.reserve("0x1", fetchSeven)).toBe(7n);
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
        submitAnswers = [() => json({ message: "Transaction validation failed: transaction 0xab is already pending" }, 400)];

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

    it("keeps the counter after an executed transaction that failed", async () => {
        const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255 });
        const sender = new SupraAccount();
        finalStatus = TransactionStatus.Fail;

        await expect(transfer(supra, sender, undefined, true)).rejects.toBeInstanceOf(SupraTransactionFailedError);
        await transfer(supra, sender);

        expect(submitted).toEqual([7, 8]);
        expect(accountReads).toBe(1);
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

    it("numbers coin and fungible asset transfers from the same counter", async () => {
        const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255 });
        const sender = new SupraAccount();

        await transfer(supra, sender);
        await supra.fungibleAsset.transferSupraFungibleAsset({
            senderAccount: sender,
            receiverAccountAddress: RECEIVER,
            amount: 1n,
            optionalTransactionArgs: { optionalTransactionPayloadArgs: GAS },
        });

        expect(submitted).toEqual([7, 8]);
        expect(accountReads).toBe(1);
    });
});
