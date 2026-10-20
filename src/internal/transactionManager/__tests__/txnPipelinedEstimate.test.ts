import { SupraAccount } from "supra-l1-sdk-core";
import { SupraClient } from "../../../api/supraClient";
import { SupraServiceUnavailableError } from "../../../errors/apiError";
import { SupraSimulationFailedError } from "../../../errors/transactionError";
import { TransactionStatus } from "../../../types/transaction";
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
let simulate: (sequenceNumber: number, chainSequenceNumber: number, body: string) => Answer;
/** The hash the node returns for each submission, in order. */
let submittedHashes: string[];
/** The hashes of the transaction reads, in order. */
let transactionReads: string[];
/** Answers a read of a transaction by its hash; the default is `Pending`. */
let readTransaction: (hash: string) => Answer;
/** Answers of the chain-ID reads in order; once they are used up, the reads answer 255. */
let chainIdAnswers: Answer[];
let chainIdReads: number;
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
    chainIdAnswers = [];
    chainIdReads = 0;
    submittedHashes = [];
    transactionReads = [];
    readTransaction = () => json(moveTxn(TransactionStatus.Pending, "", 0));
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
            return respond(simulate(record.sequenceNumber, chainSequenceNumbers[read] ?? 0, String(init?.body)));
        }
        if (method === "POST" && path === "/transactions/submit") {
            submissions.push(recordOf(init));
            const hash = "0x" + (submittedHashes.length + 1).toString(16).padStart(64, "0");
            submittedHashes.push(hash);
            return respond(json(hash));
        }
        if (method === "GET" && path === "/transactions/estimate_gas_price") {
            return respond(
                json({
                    mean_gas_price: 100_000,
                    max_gas_price: 100_000,
                    median_gas_price: 100_000,
                    min_configured_gas_price: 100_000,
                }),
            );
        }
        if (method === "GET" && path === "/transactions/chain_id") {
            chainIdReads += 1;
            return respond(chainIdAnswers.shift() ?? json(255));
        }
        if (method === "GET" && path.startsWith("/transactions/")) {
            const hash = path.slice("/transactions/".length);
            transactionReads.push(hash);
            return respond(readTransaction(hash));
        }
        return respond(json({ message: `unexpected ${method} ${path}` }, 500));
    }) as typeof fetch;
});

afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
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
        // Each build reads the clock for the expiry; a fixed clock keeps the builds of one transaction in one second.
        jest.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 0, 1));
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
        // The estimate relies on the record of transaction 3 and reads no transaction: the reads are the read-backs.
        expect(transactionReads).toEqual(submittedHashes);
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
        // Transactions 3 and 4 are accepted and pending.
        await transfer(supra, sender);
        await transfer(supra, sender);
        simulations = [];
        submissions = [];
        // The third transaction (5) is too new. The simulation at the first number read (3) is stale because
        // transaction 3 committed after the read; the second read (4) and simulation succeed.
        let calls = 0;
        simulate = (sequenceNumber) => {
            calls += 1;
            if (calls === 1) {
                return tooNew();
            }
            if (calls === 2) {
                return tooOld();
            }
            return sequenceNumber === 4 ? gasUsed(4_000) : tooNew();
        };
        chainSequenceNumbers = [3, 4];
        accountReads = 0;

        await transfer(supra, sender);

        expect(simulations.map((s) => s.sequenceNumber)).toEqual([5, 3, 4]);
        expect(submissions.at(-1)).toMatchObject({ sequenceNumber: 5, maxGas: 6_000 });
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

    it("builds the transaction with the chain's number when the chain has passed the transaction's", async () => {
        const supra = newClient();
        const sender = new SupraAccount();
        await transfer(supra, sender);
        simulations = [];
        submissions = [];
        // The counter hands out 4; until the estimate reads the account, the node's number is still 3. Another sender
        // of the account then moved it to 5.
        chainSequenceNumbers = [3, 5];

        await transfer(supra, sender);

        expect(simulations.map((s) => s.sequenceNumber)).toEqual([4, 5]);
        expect(submissions).toEqual([expect.objectContaining({ sequenceNumber: 5, maxGas: 3_000 })]);
        expect(accountReads).toBe(2);
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

    it("throws the stale failure when the simulation at the chain's number is stale twice, after one retry", async () => {
        const supra = newClient();
        const sender = new SupraAccount();
        await transfer(supra, sender);
        simulations = [];
        submissions = [];
        simulate = () => tooNew();

        const error: unknown = await transfer(supra, sender).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(SupraSimulationFailedError);
        expect(isStaleSequenceNumberError(error)).toBe(true);
        // Each run: the simulation at 4, then at the chain's number in two rounds. The helper runs the call twice.
        expect(simulations.map((s) => s.sequenceNumber)).toEqual([4, 3, 3, 4, 3, 3]);
        expect(submissions).toHaveLength(0);
    });

    it("throws the error of a failed read of the chain's number, submits nothing and hands the number out next", async () => {
        const supra = newClient();
        const sender = new SupraAccount();
        await transfer(supra, sender);
        submissions = [];
        const read = global.fetch;
        let failures = 1;
        global.fetch = jest.fn((input: string | URL | Request, init?: RequestInit) => {
            const path = new URL(String(input)).pathname;
            if ((init?.method ?? "GET") === "GET" && /\/accounts\/0x[0-9a-f]+$/.test(path) && failures > 0) {
                failures -= 1;
                return respond(json({ message: "unavailable" }, 503));
            }
            return (read as typeof fetch)(input, init);
        }) as typeof fetch;

        await expect(transfer(supra, sender)).rejects.toBeInstanceOf(SupraServiceUnavailableError);
        expect(submissions).toHaveLength(0);
        await transfer(supra, sender);

        expect(submissions).toEqual([expect.objectContaining({ sequenceNumber: 4, maxGas: 3_000 })]);
    });

    it("numbers concurrent transfers consecutively and estimates each behind the earlier ones", async () => {
        const supra = newClient();
        const sender = new SupraAccount();

        await Promise.all([transfer(supra, sender), transfer(supra, sender), transfer(supra, sender)]);

        expect(submissions.map((s) => s.sequenceNumber).sort()).toEqual([3, 4, 5]);
        expect(submissions.every((s) => s.maxGas === 3_000)).toBe(true);
        // Transactions 4 and 5 were simulated at 3, the chain's number.
        expect(simulations.filter((s) => s.sequenceNumber === 3)).toHaveLength(3);
    });

    it("gives a concurrent call the number of a call whose estimate failed", async () => {
        const supra = newClient();
        const sender = new SupraAccount();
        // The transfer of 0x0102030405 aborts in its simulation (its amount serialises as these bytes).
        simulate = (sequenceNumber, chain, body) => {
            if (body.includes("[5,4,3,2,1,0,0,0]")) {
                return json(
                    moveTxn(TransactionStatus.Fail, "Move abort in 0x1::coin: EINSUFFICIENT_BALANCE(0x10006)", 5),
                );
            }
            return sequenceNumber > chain ? tooNew() : sequenceNumber < chain ? tooOld() : gasUsed(2_000);
        };
        const aborting = supra.coin.transferSupraCoin({
            senderAccount: sender,
            receiverAccountAddress: "0x" + "ab".repeat(32),
            amount: 0x0102030405n,
            optionalTransactionArgs: { enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: false } },
        });

        const [first, second] = await Promise.allSettled([aborting, transfer(supra, sender)]);

        expect(first.status).toBe("rejected");
        expect(second.status).toBe("fulfilled");
        // The first call held 3 until its estimate failed and handed 3 back; the second call then took 3.
        expect(submissions.map((s) => s.sequenceNumber)).toEqual([3]);
        expect(simulations.map((s) => s.sequenceNumber)).toEqual([3, 3]);
        expect(accountReads).toBe(1);
    });

    it("gives the number of an earlier transaction that a read shows Invalid to the next transfer", async () => {
        const supra = newClient();
        const sender = new SupraAccount();
        await transfer(supra, sender);
        simulations = [];
        submissions = [];
        // Transaction 3 was accepted and then discarded; the chain stays at 3.
        readTransaction = () => json(moveTxn(TransactionStatus.Invalid, "SEQUENCE_NUMBER_TOO_OLD", 0));
        await supra.getTransactionByHash({ transactionHash: submittedHashes[0] as string });
        readTransaction = () => json(moveTxn(TransactionStatus.Pending, "", 0));

        await transfer(supra, sender);

        expect(simulations.map((s) => s.sequenceNumber)).toEqual([3]);
        expect(submissions.map((s) => s.sequenceNumber)).toEqual([3]);
    });

    it("estimates behind an earlier transaction of this client that reads HTTP 404", async () => {
        const supra = newClient();
        const sender = new SupraAccount();
        await transfer(supra, sender);
        simulations = [];
        submissions = [];
        // Another RPC node behind the same URL does not hold transaction 3.
        readTransaction = () => json({ message: "not found" }, 404);
        await expect(supra.getTransactionByHash({ transactionHash: submittedHashes[0] as string })).rejects.toThrow();

        await transfer(supra, sender);

        expect(simulations.map((s) => s.sequenceNumber)).toEqual([4, 3]);
        expect(submissions.map((s) => s.sequenceNumber)).toEqual([4]);
    });

    it("throws SEQUENCE_NUMBER_TOO_NEW for an explicit number with no pending transaction before it", async () => {
        const supra = newClient();
        const sender = new SupraAccount();

        const error: unknown = await supra.coin
            .transferSupraCoin({
                senderAccount: sender,
                receiverAccountAddress: "0x" + "ab".repeat(32),
                amount: 1n,
                optionalTransactionArgs: {
                    optionalTransactionPayloadArgs: { sequenceNumber: 4n },
                    enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: false },
                },
            })
            .catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(SupraSimulationFailedError);
        expect((error as SupraSimulationFailedError).major_status).toBe("SEQUENCE_NUMBER_TOO_NEW");
        expect(simulations.map((s) => s.sequenceNumber)).toEqual([4]);
        expect(submissions).toHaveLength(0);
    });

    it("estimates an explicit number behind a pending transaction of this client", async () => {
        const supra = newClient();
        const sender = new SupraAccount();
        await transfer(supra, sender);
        simulations = [];

        await supra.coin.transferSupraCoin({
            senderAccount: sender,
            receiverAccountAddress: "0x" + "ab".repeat(32),
            amount: 1n,
            optionalTransactionArgs: {
                optionalTransactionPayloadArgs: { sequenceNumber: 4n },
                enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: false },
            },
        });

        expect(simulations.map((s) => s.sequenceNumber)).toEqual([4, 3]);
        expect(submissions.map((s) => s.sequenceNumber)).toEqual([3, 4]);
    });
});

describe("a read of a transaction this client submitted", () => {
    it.each([
        [
            "getTransactionByHash",
            (supra: SupraClient, hash: string) => supra.getTransactionByHash({ transactionHash: hash }),
        ],
        [
            "waitForTransaction",
            (supra: SupraClient, hash: string) =>
                supra.waitForTransaction({ transactionHash: hash, options: { checkSuccess: false, timeoutMs: 1_000 } }),
        ],
    ])("gives the transaction's number to the next transfer when %s reads Invalid", async (_name, read) => {
        const supra = newClient();
        const sender = new SupraAccount();
        await transfer(supra, sender);
        readTransaction = () => json(moveTxn(TransactionStatus.Invalid, "SEQUENCE_NUMBER_TOO_OLD", 0));
        await read(supra, submittedHashes[0] as string);
        readTransaction = () => json(moveTxn(TransactionStatus.Pending, "", 0));
        const readsBefore = accountReads;

        await transfer(supra, sender);

        // Only the record of the discarded transaction is dropped; the chain is not read again.
        expect(accountReads).toBe(readsBefore);
        expect(submissions.map((s) => s.sequenceNumber)).toEqual([3, 3]);
    });

    it("leaves the counter alone when another transaction reads Invalid", async () => {
        const supra = newClient();
        const sender = new SupraAccount();
        await transfer(supra, sender);
        readTransaction = () => json(moveTxn(TransactionStatus.Invalid, "SEQUENCE_NUMBER_TOO_OLD", 0));
        await supra.getTransactionByHash({ transactionHash: "0x" + "77".repeat(32) });
        readTransaction = () => json(moveTxn(TransactionStatus.Pending, "", 0));
        const readsBefore = accountReads;

        await transfer(supra, sender);

        // No chain read for the counter; the estimate of 4 reads the chain once behind pending transaction 3.
        expect(accountReads).toBe(readsBefore + 1);
        expect(submissions.map((s) => s.sequenceNumber)).toEqual([3, 4]);
    });
});

describe("the simulation before a submission (enableTransactionSimulation)", () => {
    function simulatedTransfer(supra: SupraClient, sender: SupraAccount, maxGas?: bigint) {
        return supra.coin.transferSupraCoin({
            senderAccount: sender,
            receiverAccountAddress: "0x" + "ab".repeat(32),
            amount: 1n,
            optionalTransactionArgs: {
                ...(maxGas === undefined ? {} : { optionalTransactionPayloadArgs: { maxGas } }),
                enableTransactionWaitAndSimulationArgs: {
                    enableWaitForTransaction: false,
                    enableTransactionSimulation: true,
                },
            },
        });
    }

    it.each([
        ["with the estimated max gas", undefined],
        ["with an explicit max gas", 5_000n],
    ])("submits transfers sent one after another behind pending ones %s", async (_name, maxGas) => {
        const supra = newClient();
        const sender = new SupraAccount();

        for (let index = 0; index < 3; index += 1) {
            await simulatedTransfer(supra, sender, maxGas);
        }

        expect(submissions.map((s) => s.sequenceNumber)).toEqual([3, 4, 5]);
        if (maxGas !== undefined) {
            // No estimate: each transfer is simulated at its own number, then at the chain's.
            expect(simulations.map((s) => s.sequenceNumber)).toEqual([3, 4, 3, 5, 3]);
            expect(submissions.every((s) => s.maxGas === Number(maxGas))).toBe(true);
        }
    });

    it("signs the transfer again with the chain's number when the chain has passed it", async () => {
        const supra = newClient();
        const sender = new SupraAccount();
        await simulatedTransfer(supra, sender, 5_000n);
        simulations = [];
        submissions = [];
        // The counter hands out 4; another sender of the account then moved the chain to 6.
        chainSequenceNumbers = [3, 6];

        await simulatedTransfer(supra, sender, 5_000n);

        expect(simulations.map((s) => s.sequenceNumber)).toEqual([4, 6]);
        expect(submissions.map((s) => s.sequenceNumber)).toEqual([6]);
    });

    it("throws the failure of the simulation at the chain's number and submits nothing", async () => {
        const supra = newClient();
        const sender = new SupraAccount();
        await simulatedTransfer(supra, sender, 5_000n);
        submissions = [];
        simulateAtChainNumber = () =>
            json(moveTxn(TransactionStatus.Fail, "Move abort in 0x1::coin: EINSUFFICIENT_BALANCE(0x10006): x", 5));

        const error: unknown = await simulatedTransfer(supra, sender, 5_000n).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(SupraSimulationFailedError);
        expect(isStaleSequenceNumberError(error)).toBe(false);
        expect(submissions).toHaveLength(0);
    });
});

describe("the max gas estimate", () => {
    it("throws the error of a failed chain-ID read made while signing the simulated transaction", async () => {
        const supra = newClient();
        const sender = new SupraAccount();
        chainIdAnswers = [json({ message: "unavailable" }, 503)];

        const error: unknown = await transfer(supra, sender).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(SupraServiceUnavailableError);
        expect(chainIdReads).toBe(1);
        expect(simulations).toHaveLength(0);
        expect(submissions).toHaveLength(0);
        // The number was not used: the next transfer takes it.
        await transfer(supra, sender);
        expect(submissions.map((s) => s.sequenceNumber)).toEqual([3]);
    });

    it("simulates with what the new balance pays for when the earlier transaction commits before the first simulation", async () => {
        const supra = newClient();
        const sender = new SupraAccount();
        await transfer(supra, sender);
        simulations = [];
        submissions = [];
        // The second transfer (number 4) reads the balance while transaction 3 is pending; transaction 3 then commits,
        // so the chain is at 4 and the balance pays for 990,000 units.
        balances = ["100000000000", "99000000000"];
        simulate = (sequenceNumber) => {
            if (sequenceNumber !== 4) {
                return tooOld();
            }
            return (simulations.at(-1)?.maxGas ?? 0) > 990_000
                ? json(moveTxn(TransactionStatus.Invalid, "INSUFFICIENT_BALANCE_FOR_TRANSACTION_FEE", 0))
                : gasUsed(2_000);
        };

        await transfer(supra, sender);

        expect(simulations.map((s) => [s.sequenceNumber, s.maxGas])).toEqual([
            [4, 1_000_000],
            [4, 990_000],
        ]);
        expect(submissions).toEqual([expect.objectContaining({ sequenceNumber: 4, maxGas: 3_000 })]);
    });

    it("limits the fallback to the lowest balance read when a later simulation request fails", async () => {
        const supra = newClient();
        const sender = new SupraAccount();
        // The first read pays for 1,000,000 units, the second for 15,000, below DEFAULT_MAX_GAS_UNITS.
        balances = ["100000000000", "1500000000"];
        let calls = 0;
        simulate = () => {
            calls += 1;
            return calls === 1
                ? json(moveTxn(TransactionStatus.Invalid, "INSUFFICIENT_BALANCE_FOR_TRANSACTION_FEE", 0))
                : json({ message: "internal error" }, 500);
        };

        await transfer(supra, sender);

        expect(simulations.map((s) => s.maxGas)).toEqual([1_000_000, 15_000]);
        expect(submissions).toEqual([expect.objectContaining({ sequenceNumber: 3, maxGas: 15_000 })]);
    });

    it("throws a first simulation's insufficient balance that a new balance read does not explain", async () => {
        const supra = newClient();
        const sender = new SupraAccount();
        simulate = () => json(moveTxn(TransactionStatus.Invalid, "INSUFFICIENT_BALANCE_FOR_TRANSACTION_FEE", 0));

        await expect(transfer(supra, sender)).rejects.toBeInstanceOf(SupraSimulationFailedError);

        expect(simulations).toHaveLength(1);
        expect(submissions).toHaveLength(0);
    });
});
