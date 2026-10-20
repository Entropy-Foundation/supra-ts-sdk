import { SupraAPIError } from "../../errors/apiError";
import { SupraSimulationFailedError } from "../../errors/transactionError";
import { TransactionStatus } from "../../types/transaction";
import type { NetworkConfig } from "../../utils/apiEndpoints";
import { getAccountInfoInternal } from "../account";
import { sequenceNumberTrackerOf } from "../sequenceNumber";
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
 * 1. Waits until every reservation of the client's counter for `address` with a number below `sequenceNumber` is
 *    settled, so that the outcome of a concurrent call with a lower number is known.
 * 2. Reads the account's sequence number on the chain, C. A failed read gives `undetermined`; a C above
 *    `sequenceNumber` gives `undetermined`.
 * 3. When C is below `sequenceNumber`: if a number from C up to `sequenceNumber` (exclusive) is not recorded as
 *    accepted by the node from this client, the outcome is `gap`. Otherwise the transaction recorded for C is read: a
 *    status of `Pending` or `PendingAfterExecution` continues; `Invalid` or HTTP 404 (the node no longer holds it)
 *    gives `gap`; `Success` or `Fail` (it committed after the read of C) starts the next round; a failed read gives
 *    `undetermined`.
 * 4. Calls `simulateAt(C)`. Its result gives `simulated`. A `SupraSimulationFailedError` for a stale sequence number
 *    starts the next round; any other error is thrown.
 *
 * After the last round the outcome is `undetermined`.
 */
export async function simulateBehindPendingInternal<T>(
    args: {
        /** The sender's address, standardized. */
        address: string;
        sequenceNumber: bigint;
        simulateAt: (chainSequenceNumber: bigint) => Promise<T>;
    },
    config: NetworkConfig,
): Promise<BehindPendingSimulation<T>> {
    const tracker = sequenceNumberTrackerOf(config);
    for (let round = 0; round < ROUNDS; round += 1) {
        await tracker.settledBelow(args.address, args.sequenceNumber);
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
            const pending = await isPendingBehind(args.address, chainSequenceNumber, args.sequenceNumber, config);
            if (pending === "gap" || pending === "undetermined") {
                return { kind: pending };
            }
            if (pending === "committed") {
                continue;
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

/**
 * Whether the numbers from `chainSequenceNumber` up to `sequenceNumber` (exclusive) belong to transactions that the
 * node accepted from this client, and the transaction at `chainSequenceNumber` is still pending.
 */
async function isPendingBehind(
    address: string,
    chainSequenceNumber: bigint,
    sequenceNumber: bigint,
    config: NetworkConfig,
): Promise<"pending" | "gap" | "committed" | "undetermined"> {
    const tracker = sequenceNumberTrackerOf(config);
    if (sequenceNumber - chainSequenceNumber > BigInt(tracker.acceptedCount(address))) {
        return "gap";
    }
    for (let number = chainSequenceNumber; number < sequenceNumber; number += 1n) {
        if (tracker.acceptedHash(address, number) === undefined) {
            return "gap";
        }
    }
    const hash = tracker.acceptedHash(address, chainSequenceNumber);
    if (hash === undefined) {
        return "gap";
    }
    let status: TransactionStatus;
    try {
        // The read reports the status to the tracker, which invalidates the counter for `Invalid`.
        status = (await getTransactionByHashInternal({ transactionHash: hash, exclude_uncommitted: false }, config))
            .status;
    } catch (error) {
        return error instanceof SupraAPIError && error.status === 404 ? "gap" : "undetermined";
    }
    switch (status) {
        case TransactionStatus.Pending:
        case TransactionStatus.PendingAfterExecution:
            return "pending";
        case TransactionStatus.Success:
        case TransactionStatus.Fail:
            return "committed";
        default:
            return "gap";
    }
}

function isStaleSimulation(error: unknown): boolean {
    return (
        error instanceof SupraSimulationFailedError &&
        (error.major_status === "SEQUENCE_NUMBER_TOO_NEW" || error.major_status === "SEQUENCE_NUMBER_TOO_OLD")
    );
}
