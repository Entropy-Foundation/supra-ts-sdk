import { SupraSimulationFailedError } from "../../errors/transactionError";
import type { NetworkConfig } from "../../utils/apiEndpoints";
import { readChainInternal, sequenceNumberTrackerOf, type SequenceNumberReservation } from "../sequenceNumber";

/**
 * The outcome of `resolveSequenceNumberTooNewInternal`:
 *
 * - `simulated`: the simulation at the chain's number ran, and `result` is what `simulateAt` returned.
 * - `moved`: the transaction's reservation was given `sequenceNumber`, a number below the transaction's that has no
 *   record, or the lowest number without a record when the chain has passed the transaction's. The transaction is to
 *   be built and signed again with it.
 */
export type SequenceNumberTooNewOutcome<T> =
    | { kind: "simulated"; result: T }
    | { kind: "moved"; sequenceNumber: bigint };

/** The number of times the chain is read for one simulation that reported `SEQUENCE_NUMBER_TOO_NEW`. */
const ROUNDS = 2;

/**
 * The number of times the max gas estimate, or the simulation before a submission, handles a `SEQUENCE_NUMBER_TOO_NEW`
 * simulation of the transaction at its own number. After a `moved` outcome the transaction is simulated again with
 * its new number; the failure that follows the last check is thrown.
 */
export const MAX_TOO_NEW_CHECKS = 2;

/**
 * Handles a simulation of a transaction of `address` with `sequenceNumber` that reported `SEQUENCE_NUMBER_TOO_NEW`
 * (`tooNew`): the account's sequence number on the chain, C, is below the transaction's number, N.
 *
 * Each round reads the account and the latest block (`readChainInternal`), which drops the records of the client's
 * submissions that the chain shows dead (`SequenceNumberTracker`), then:
 *
 * 1. When every number from C up to N (exclusive) has a record of a submission of this client, calls
 *    `simulateAt(C)`, whose result gives `simulated`. A `SupraSimulationFailedError` for a stale sequence number starts
 *    the next round; any other error is thrown.
 * 2. Otherwise, or when C is above N: with `reservation`, the reservation is given the lowest number at or above C
 *    that has no record (`moved`), without releasing the account's lock. Without `reservation` (a transaction with an
 *    explicit sequence number) `tooNew` is thrown.
 *
 * A failed read of the account is thrown; a failed read of the latest block leaves the records as they are. After the
 * last round the stale failure of the last simulation is thrown. No transaction is read by hash.
 */
export async function resolveSequenceNumberTooNewInternal<T>(
    args: {
        /** The sender's address, standardized. */
        address: string;
        sequenceNumber: bigint;
        /** The reservation of `sequenceNumber`, when the number came from the client's counter. */
        reservation?: SequenceNumberReservation | undefined;
        /** The simulation's `SEQUENCE_NUMBER_TOO_NEW` failure. */
        tooNew: SupraSimulationFailedError;
        simulateAt: (chainSequenceNumber: bigint) => Promise<T>;
    },
    config: NetworkConfig,
): Promise<SequenceNumberTooNewOutcome<T>> {
    const tracker = sequenceNumberTrackerOf(config);
    let stale: unknown = args.tooNew;
    for (let round = 0; round < ROUNDS; round += 1) {
        const chainSequenceNumber = await readChainInternal(args.address, config);
        tracker.observeChainSequenceNumber(args.address, chainSequenceNumber);
        if (
            chainSequenceNumber > args.sequenceNumber ||
            !tracker.everyNumberRecorded(args.address, chainSequenceNumber, args.sequenceNumber)
        ) {
            const next = tracker.nextFree(args.address);
            if (args.reservation === undefined || next === undefined) {
                throw args.tooNew;
            }
            tracker.move(args.reservation, next);
            return { kind: "moved", sequenceNumber: next };
        }
        try {
            return { kind: "simulated", result: await args.simulateAt(chainSequenceNumber) };
        } catch (error) {
            if (!isStaleSimulation(error)) {
                throw error;
            }
            stale = error;
        }
    }
    throw stale;
}

/** Whether `error` is a simulation's `SEQUENCE_NUMBER_TOO_NEW` failure. */
export function isSequenceNumberTooNew(error: unknown): error is SupraSimulationFailedError {
    return error instanceof SupraSimulationFailedError && error.major_status === "SEQUENCE_NUMBER_TOO_NEW";
}

function isStaleSimulation(error: unknown): boolean {
    return (
        error instanceof SupraSimulationFailedError &&
        (error.major_status === "SEQUENCE_NUMBER_TOO_NEW" || error.major_status === "SEQUENCE_NUMBER_TOO_OLD")
    );
}
