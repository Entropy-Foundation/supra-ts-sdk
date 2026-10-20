import { SupraAPIError } from "../../errors/apiError";
import { SupraSimulationFailedError } from "../../errors/transactionError";
import { TransactionStatus } from "../../types/transaction";
import type { NetworkConfig } from "../../utils/apiEndpoints";
import { getAccountInfoInternal } from "../account";
import { sequenceNumberTrackerOf, type SequenceNumberReservation } from "../sequenceNumber";
import { getTransactionByHashInternal } from "../transaction";

/**
 * The outcome of `simulateBehindPendingInternal`:
 *
 * - `simulated`: the simulation at the chain's number ran, and `result` is what `simulateAt` returned.
 * - `gap`: a number between the chain's and the transaction's is not that of a pending transaction of this client, so
 *   the transaction's number is stale.
 * - `undetermined`: the chain's number could not be compared (a read failed, the chain passed the transaction's
 *   number, or the number was stale in both rounds).
 */
export type BehindPendingSimulation<T> = { kind: "simulated"; result: T } | { kind: "gap" } | { kind: "undetermined" };

/** The number of times the chain's number is read for one transaction. */
const ROUNDS = 2;

/**
 * Simulates a transaction of `address` with `sequenceNumber`, whose simulation reported `SEQUENCE_NUMBER_TOO_NEW`, at
 * the account's sequence number on the chain, when every number between them belongs to a transaction of this client
 * that the node holds.
 *
 * Each round:
 *
 * 1. Reads the account's sequence number on the chain, C. A failed read gives `undetermined`; a C above
 *    `sequenceNumber` gives `undetermined`.
 * 2. When C is below `sequenceNumber`, reads the transaction recorded as accepted from this client for each number
 *    from C up to `sequenceNumber` (exclusive), concurrently. A failed read (other than HTTP 404) gives
 *    `undetermined`; a `Success` or `Fail` (the transaction committed after the read of C) starts the next round.
 *    When every number in the range has a recorded transaction that reads `Pending` or `PendingAfterExecution`, the
 *    round continues. Otherwise (a number with no record, or a transaction that reads `Invalid` or HTTP 404 because
 *    the node no longer holds it) the outcome is `gap`; with `reservation`, the client's counter resumes at the lowest
 *    such number and keeps the records of the pending transactions (`SequenceNumberTracker.resume`), which releases the
 *    account's lock.
 * 3. Calls `simulateAt(C)`. Its result gives `simulated`. A `SupraSimulationFailedError` for a stale sequence number
 *    starts the next round; any other error is thrown.
 *
 * After the last round the outcome is `undetermined`. Without `reservation` (a transaction with an explicit sequence
 * number) the counter is not changed.
 */
export async function simulateBehindPendingInternal<T>(
    args: {
        /** The sender's address, standardized. */
        address: string;
        sequenceNumber: bigint;
        /** The reservation of `sequenceNumber`, when the number came from the client's counter. */
        reservation?: SequenceNumberReservation | undefined;
        simulateAt: (chainSequenceNumber: bigint) => Promise<T>;
    },
    config: NetworkConfig,
): Promise<BehindPendingSimulation<T>> {
    const tracker = sequenceNumberTrackerOf(config);
    for (let round = 0; round < ROUNDS; round += 1) {
        let chainSequenceNumber: bigint;
        try {
            const account = await getAccountInfoInternal({ accountAddress: args.address }, config);
            chainSequenceNumber = BigInt(account.sequence_number);
        } catch {
            return { kind: "undetermined" };
        }
        tracker.observeChainSequenceNumber(args.address, chainSequenceNumber);
        if (chainSequenceNumber > args.sequenceNumber) {
            return { kind: "undetermined" };
        }
        if (chainSequenceNumber < args.sequenceNumber) {
            const behind = await readBehind(args.address, chainSequenceNumber, args.sequenceNumber, config);
            if (behind.kind === "undetermined") {
                return { kind: "undetermined" };
            }
            if (behind.kind === "committed") {
                continue;
            }
            if (behind.kind === "gap") {
                if (args.reservation !== undefined) {
                    tracker.resume(args.reservation, chainSequenceNumber, behind.pending);
                }
                return { kind: "gap" };
            }
        }
        try {
            return { kind: "simulated", result: await args.simulateAt(chainSequenceNumber) };
        } catch (error) {
            if (!isStaleSimulation(error)) {
                throw error;
            }
        }
    }
    return { kind: "undetermined" };
}

type Behind =
    | { kind: "pending" }
    | { kind: "gap"; pending: Map<bigint, string> }
    | { kind: "committed" }
    | { kind: "undetermined" };

type ReadStatus = "pending" | "gone" | "committed" | "undetermined";

/**
 * Reads the transactions recorded as accepted from this client for the numbers from `chainSequenceNumber` up to
 * `sequenceNumber` (exclusive), and reports whether every number in that range has one that is pending.
 */
async function readBehind(
    address: string,
    chainSequenceNumber: bigint,
    sequenceNumber: bigint,
    config: NetworkConfig,
): Promise<Behind> {
    const recorded = sequenceNumberTrackerOf(config).acceptedBetween(address, chainSequenceNumber, sequenceNumber);
    const reads = await Promise.all(
        [...recorded].map(async ([number, hash]) => ({ number, hash, status: await readStatus(hash, config) })),
    );
    if (reads.some((read) => read.status === "undetermined")) {
        return { kind: "undetermined" };
    }
    if (reads.some((read) => read.status === "committed")) {
        return { kind: "committed" };
    }
    const pending = new Map<bigint, string>();
    for (const read of reads) {
        if (read.status === "pending") {
            pending.set(read.number, read.hash);
        }
    }
    return BigInt(pending.size) === sequenceNumber - chainSequenceNumber
        ? { kind: "pending" }
        : { kind: "gap", pending };
}

/**
 * The status of a transaction that the node accepted from this client. The read reports the status to the client's
 * counter, which is invalidated for `Invalid`.
 */
async function readStatus(hash: string, config: NetworkConfig): Promise<ReadStatus> {
    let status: TransactionStatus;
    try {
        status = (await getTransactionByHashInternal({ transactionHash: hash, exclude_uncommitted: false }, config))
            .status;
    } catch (error) {
        return error instanceof SupraAPIError && error.status === 404 ? "gone" : "undetermined";
    }
    switch (status) {
        case TransactionStatus.Pending:
        case TransactionStatus.PendingAfterExecution:
            return "pending";
        case TransactionStatus.Success:
        case TransactionStatus.Fail:
            return "committed";
        default:
            return "gone";
    }
}

function isStaleSimulation(error: unknown): boolean {
    return (
        error instanceof SupraSimulationFailedError &&
        (error.major_status === "SEQUENCE_NUMBER_TOO_NEW" || error.major_status === "SEQUENCE_NUMBER_TOO_OLD")
    );
}
