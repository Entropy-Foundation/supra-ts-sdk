import { SupraAccount } from "supra-l1-sdk-core";
import { SupraClient } from "../../../api/supraClient";
import { SupraSimulationFailedError } from "../../../errors/transactionError";
import { TransactionStatus } from "../../../types/transaction";
import { DEFAULT_MAX_GAS_UNITS } from "../../../utils/constants";
import { isStaleSequenceNumberError } from "../../sequenceNumber";

/**
 * The max gas estimate of a transaction whose sequence number is ahead of the account's number on the chain, because
 * an earlier transaction of the account has not committed. `fetch` is stubbed and answers like a node: a simulation
 * with a number above the chain's reports `SEQUENCE_NUMBER_TOO_NEW`.
 */

const RPC_URL = "http://node.test";
const HASH = "0x" + "5e".repeat(32);

type Answer = { status: number; body: unknown };

interface SimulationRecord {
    sequenceNumber: number;
    maxGas: number;
    gasUnitPrice: number;
    expiration: number;
    chainId: number;
}

let chainSequenceNumbers: number[];
let simulations: SimulationRecord[];
let submissions: SimulationRecord[];
let accountReads: number;
/** Answers of the balance views in order; the last one repeats. */
let balances: string[];
/** Answers a simulation at a number that matches the chain's. */
let simulateAtChainNumber: () => Answer;
let simulate: (sequenceNumber: number, chainSequenceNumber: number) => Answer;
const originalFetch = global.fetch;

function json(body: unknown, status = 200): Answer {
    return { status, body };
}

function moveTxn(status: TransactionStatus, vmStatus: string, gasUsed: number) {
    return {
        hash: HASH,
        status,
        txn_type: "user",
        output: { Move: { gas_used: gasUsed, events: [], vm_status: vmStatus } },
        block_header: null,
    };
}

function tooNew(): Answer {
    return json(moveTxn(TransactionStatus.PendingAfterExecution, "SEQUENCE_NUMBER_TOO_NEW", 0));
}

function tooOld(): Answer {
    return json(moveTxn(TransactionStatus.Invalid, "SEQUENCE_NUMBER_TOO_OLD", 0));
}

function gasUsed(units: number): Answer {
    return json(moveTxn(TransactionStatus.Success, "Executed successfully", units));
}

function recordOf(init: RequestInit | undefined): SimulationRecord {
    const body = JSON.parse(String(init?.body)) as {
        Move: {
            raw_txn: {
                sequence_number: number;
                max_gas_amount: number;
                gas_unit_price: number;
                expiration_timestamp_secs: number;
                chain_id: number;
            };
        };
    };
    const raw = body.Move.raw_txn;
    return {
        sequenceNumber: raw.sequence_number,
        maxGas: raw.max_gas_amount,
        gasUnitPrice: raw.gas_unit_price,
        expiration: raw.expiration_timestamp_secs,
        chainId: raw.chain_id,
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
    chainSequenceNumbers = [3];
    simulations = [];
    submissions = [];
    accountReads = 0;
    balances = [String(1_000n * 100_000_000n)];
    simulateAtChainNumber = () => gasUsed(2_000);
    simulate = (sequenceNumber, chainSequenceNumber) => {
        if (sequenceNumber > chainSequenceNumber) {
            return tooNew();
        }
        return sequenceNumber < chainSequenceNumber ? tooOld() : simulateAtChainNumber();
    };
    global.fetch = jest.fn((input: string | URL | Request, init?: RequestInit) => {
        const path = new URL(String(input)).pathname.replace(/^\/rpc\/v3/, "");
        const method = init?.method ?? "GET";
        if (method === "GET" && /^\/accounts\/0x[0-9a-f]+$/.test(path)) {
            const index = Math.min(accountReads, chainSequenceNumbers.length - 1);
            accountReads += 1;
            return respond(
                json({ sequence_number: chainSequenceNumbers[index], authentication_key: "0x" + "00".repeat(32) }),
            );
        }
        if (method === "POST" && path === "/view") {
            return respond(
                json({ result: [balances.length > 1 ? (balances.shift() as string) : (balances[0] as string)] }),
            );
        }
        if (method === "POST" && path === "/transactions/simulate") {
            const record = recordOf(init);
            simulations.push(record);
            // The node's number is the one the latest account read returned.
            const read = Math.min(Math.max(accountReads - 1, 0), chainSequenceNumbers.length - 1);
            return respond(simulate(record.sequenceNumber, chainSequenceNumbers[read] ?? 0));
        }
        if (method === "POST" && path === "/transactions/submit") {
            submissions.push(recordOf(init));
            return respond(json(HASH));
        }
        if (method === "GET" && path === "/transactions/chain_id") {
            return respond(json(255));
        }
        if (method === "GET" && path.startsWith("/transactions/")) {
            return respond(json(moveTxn(TransactionStatus.Success, "Executed successfully", 7)));
        }
        return respond(json({ message: `unexpected ${method} ${path}` }, 500));
    }) as typeof fetch;
});

afterEach(() => {
    global.fetch = originalFetch;
});

function newClient(): SupraClient {
    return new SupraClient({ rpcUrl: RPC_URL, chainId: 255 });
}

function transfer(supra: SupraClient, sender: SupraAccount) {
    return supra.coin.transferSupraCoin({
        senderAccount: sender,
        receiverAccountAddress: "0x" + "ab".repeat(32),
        amount: 1n,
        optionalTransactionArgs: { enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: false } },
    });
}

describe("the max gas estimate of a transaction behind a pending one", () => {
    it("simulates at the chain's number and submits the transaction with the counter's number and that estimate", async () => {
        const supra = newClient();
        const sender = new SupraAccount();
        // The counter reads 3 from the chain and hands out 3 to the first call and 4 to the second. The first
        // transaction is pending, so the chain stays at 3.
        await transfer(supra, sender);
        simulations = [];

        await transfer(supra, sender);

        expect(simulations.map((s) => s.sequenceNumber)).toEqual([4, 3]);
        expect(submissions.map((s) => s.sequenceNumber)).toEqual([3, 4]);
        const [first, second] = simulations as [SimulationRecord, SimulationRecord];
        expect(second).toMatchObject({
            maxGas: first.maxGas,
            gasUnitPrice: first.gasUnitPrice,
            expiration: first.expiration,
            chainId: first.chainId,
        });
        expect(submissions[1]?.maxGas).toBe(3_000);
        expect(submissions[1]?.expiration).toBe(first.expiration);
    });

    it("makes one simulation when the numbers are equal", async () => {
        await transfer(newClient(), new SupraAccount());

        expect(simulations).toHaveLength(1);
        expect(accountReads).toBe(1);
        expect(submissions[0]?.maxGas).toBe(3_000);
    });

    it("throws the failure of the simulation at the chain's number, submits nothing and releases the number", async () => {
        const supra = newClient();
        const sender = new SupraAccount();
        await transfer(supra, sender);
        submissions = [];
        simulateAtChainNumber = () =>
            json(moveTxn(TransactionStatus.Fail, "Move abort in 0x1::coin: EINSUFFICIENT_BALANCE(0x10006): x", 5));

        const error: unknown = await transfer(supra, sender).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(SupraSimulationFailedError);
        expect(isStaleSequenceNumberError(error)).toBe(false);
        expect(submissions).toHaveLength(0);
        // No retry: one simulation at the counter's number and one at the chain's. The counter is not reset, so the next
        // call takes 4 again without reading the chain.
        expect(simulations.slice(1).map((s) => s.sequenceNumber)).toEqual([4, 3]);
        expect(accountReads).toBe(2);
        const readsBefore = accountReads;
        simulateAtChainNumber = () => gasUsed(2_000);
        await transfer(supra, sender);
        expect(submissions.map((s) => s.sequenceNumber)).toEqual([4]);
        expect(accountReads).toBe(readsBefore + 1);
    });

    it("reads the number and simulates once more when the chain moved, and uses the second result", async () => {
        const supra = newClient();
        const sender = new SupraAccount();
        await transfer(supra, sender);
        simulations = [];
        submissions = [];
        // The simulation at the first number read is stale (the chain moved after the read); the second read and
        // simulation succeed.
        let calls = 0;
        simulate = (sequenceNumber) => {
            calls += 1;
            if (calls === 1) {
                return tooNew();
            }
            if (calls === 2) {
                return tooOld();
            }
            return sequenceNumber === 3 ? gasUsed(4_000) : tooNew();
        };
        chainSequenceNumbers = [2, 3];
        accountReads = 0;

        await transfer(supra, sender);

        expect(simulations.map((s) => s.sequenceNumber)).toEqual([4, 2, 3]);
        expect(submissions.at(-1)).toMatchObject({ sequenceNumber: 4, maxGas: 6_000 });
    });

    it("simulates at the transaction's own number when the chain reached it after the first simulation", async () => {
        const supra = newClient();
        const sender = new SupraAccount();
        await transfer(supra, sender);
        simulations = [];
        submissions = [];
        // The first simulation of the second transaction (number 4) is too new; the earlier transaction then commits
        // and the chain's number is 4.
        let calls = 0;
        simulate = (sequenceNumber) => {
            calls += 1;
            if (calls === 1) {
                return tooNew();
            }
            return sequenceNumber === 4 ? gasUsed(4_000) : tooOld();
        };
        chainSequenceNumbers = [4];

        await transfer(supra, sender);

        expect(simulations.map((s) => s.sequenceNumber)).toEqual([4, 4]);
        expect(submissions.at(-1)).toMatchObject({ sequenceNumber: 4, maxGas: 6_000 });
    });

    it("falls back to DEFAULT_MAX_GAS_UNITS when the chain's number is above the transaction's", async () => {
        const supra = newClient();
        const sender = new SupraAccount();
        await transfer(supra, sender);
        simulations = [];
        submissions = [];
        simulate = () => tooNew();
        chainSequenceNumbers = [5];

        await transfer(supra, sender);

        expect(simulations.map((s) => s.sequenceNumber)).toEqual([4]);
        expect(submissions.at(-1)).toMatchObject({ sequenceNumber: 4, maxGas: Number(DEFAULT_MAX_GAS_UNITS) });
    });

    it("simulates with what the new balance pays for when an earlier transaction committed after the balance was read", async () => {
        const supra = newClient();
        const sender = new SupraAccount();
        await transfer(supra, sender);
        simulations = [];
        submissions = [];
        balances = ["100000000000", "99000000000"];
        simulate = (sequenceNumber, chain) => {
            if (sequenceNumber > chain) {
                return tooNew();
            }
            const record = simulations.at(-1);
            return (record?.maxGas ?? 0) > 990_000
                ? json(moveTxn(TransactionStatus.Invalid, "INSUFFICIENT_BALANCE_FOR_TRANSACTION_FEE", 0))
                : gasUsed(2_000);
        };

        await transfer(supra, sender);

        expect(simulations.map((s) => [s.sequenceNumber, s.maxGas])).toEqual([
            [4, 1_000_000],
            [3, 1_000_000],
            [3, 990_000],
        ]);
        expect(submissions[0]).toMatchObject({ sequenceNumber: 4, maxGas: 3_000 });
    });

    it("throws a failure for an insufficient balance that the balance read does not explain", async () => {
        const supra = newClient();
        const sender = new SupraAccount();
        await transfer(supra, sender);
        submissions = [];
        simulate = (sequenceNumber, chain) =>
            sequenceNumber > chain
                ? tooNew()
                : json(moveTxn(TransactionStatus.Invalid, "INSUFFICIENT_BALANCE_FOR_TRANSACTION_FEE", 0));

        await expect(transfer(supra, sender)).rejects.toBeInstanceOf(SupraSimulationFailedError);

        expect(submissions).toHaveLength(0);
    });

    it("falls back to DEFAULT_MAX_GAS_UNITS when the number is stale in both simulations", async () => {
        const supra = newClient();
        const sender = new SupraAccount();
        await transfer(supra, sender);
        simulations = [];
        submissions = [];
        simulate = () => tooNew();

        await transfer(supra, sender);

        expect(simulations).toHaveLength(3);
        expect(submissions).toHaveLength(1);
        expect(submissions[0]).toMatchObject({ sequenceNumber: 4, maxGas: Number(DEFAULT_MAX_GAS_UNITS) });
    });

    it("falls back to DEFAULT_MAX_GAS_UNITS when the chain's number cannot be read", async () => {
        const supra = newClient();
        const sender = new SupraAccount();
        await transfer(supra, sender);
        submissions = [];
        const read = global.fetch;
        global.fetch = jest.fn((input: string | URL | Request, init?: RequestInit) => {
            const path = new URL(String(input)).pathname;
            if ((init?.method ?? "GET") === "GET" && /\/accounts\/0x[0-9a-f]+$/.test(path)) {
                return respond(json({ message: "unavailable" }, 503));
            }
            return (read as typeof fetch)(input, init);
        }) as typeof fetch;

        await transfer(supra, sender);

        expect(submissions[0]).toMatchObject({ sequenceNumber: 4, maxGas: Number(DEFAULT_MAX_GAS_UNITS) });
    });
});
