import { standardizeAddress } from "../helper/account";
import { SupraAPIError } from "../errors/apiError";
import { SupraSimulationFailedError, SupraTransactionFailedError } from "../errors/transactionError";
import type { AccountAddressInput } from "../types/account";
import type { SendTxnPayload } from "../types/transactionManager/transactionBuild";
import type { NetworkConfig } from "../utils/apiEndpoints";
import { getAccountInfoInternal } from "./account";

const MAX_U64 = 18_446_744_073_709_551_615n;

/** Move VM statuses the node reports for a sequence number that does not match the account's. */
const STALE_SEQUENCE_NUMBER_STATUSES: ReadonlySet<string> = new Set([
    "SEQUENCE_NUMBER_TOO_OLD",
    "SEQUENCE_NUMBER_TOO_NEW",
]);

interface AccountState {
    /** The next number to hand out, or `undefined` when it has to be read from the chain. */
    next: bigint | undefined;
    /** Numbers below `next` that were handed out and not used by the node, ascending. They are handed out first. */
    freed: bigint[];
    /** Numbers handed out whose submission has not yet been accepted or refused. */
    reserved: Set<bigint>;
    /** Incremented by every resynchronisation; a reservation of an earlier generation is ignored. */
    generation: number;
    /** Serialises the reads and increments of `next`. */
    tail: Promise<unknown>;
}

/**
 * The next sequence number of each account, kept per client.
 *
 * A number is taken from the counter when a helper builds a transaction (`reserve`) and is settled when the
 * submission ends: accepted (the number is used), refused (the number is handed out again) or unknown (the counter
 * is read from the chain again on the next use).
 */
export class SequenceNumberTracker {
    private readonly accounts = new Map<string, AccountState>();

    /**
     * Hands out the next sequence number of `address`. The first use of an account, and the first use after
     * `invalidate`, reads the number from the chain with `fetchChain`. Concurrent calls get distinct numbers.
     */
    reserve(address: string, fetchChain: () => Promise<bigint>): Promise<bigint> {
        const state = this.stateOf(address);
        const taken = state.tail.then(() => this.take(state, fetchChain));
        state.tail = taken.catch(() => undefined);
        return taken;
    }

    /** The node accepted the transaction with this number. */
    accepted(address: string, sequenceNumber: bigint): void {
        this.accounts.get(address)?.reserved.delete(sequenceNumber);
    }

    /** The node did not accept the transaction with this number, so the number is handed out again. */
    release(address: string, sequenceNumber: bigint): void {
        const state = this.accounts.get(address);
        if (state === undefined || !state.reserved.delete(sequenceNumber) || state.next === undefined) {
            return;
        }
        if (sequenceNumber + 1n === state.next) {
            state.next = sequenceNumber;
            while (state.freed.length > 0 && state.freed[state.freed.length - 1] === state.next - 1n) {
                state.freed.pop();
                state.next -= 1n;
            }
            return;
        }
        state.freed.push(sequenceNumber);
        state.freed.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    }

    /** Forgets the counter of `address`; the next use reads the number from the chain. */
    invalidate(address: string): void {
        const state = this.accounts.get(address);
        if (state === undefined) {
            return;
        }
        state.next = undefined;
        state.freed = [];
        state.reserved.clear();
        state.generation += 1;
    }

    /** Whether `sequenceNumber` was handed out for `address` and its submission is not settled. */
    isReserved(address: string, sequenceNumber: bigint): boolean {
        return this.accounts.get(address)?.reserved.has(sequenceNumber) ?? false;
    }

    private stateOf(address: string): AccountState {
        let state = this.accounts.get(address);
        if (state === undefined) {
            state = {
                next: undefined,
                freed: [],
                reserved: new Set(),
                generation: 0,
                tail: Promise.resolve(),
            };
            this.accounts.set(address, state);
        }
        return state;
    }

    private async take(state: AccountState, fetchChain: () => Promise<bigint>): Promise<bigint> {
        for (;;) {
            let next = state.next;
            if (next === undefined) {
                const generation = state.generation;
                const fromChain = await fetchChain();
                if (state.generation !== generation) {
                    continue;
                }
                next = fromChain;
                state.next = next;
            }
            const freed = state.freed.shift();
            let sequenceNumber: bigint;
            if (freed !== undefined) {
                sequenceNumber = freed;
            } else {
                sequenceNumber = next;
                state.next = next + 1n;
            }
            state.reserved.add(sequenceNumber);
            return sequenceNumber;
        }
    }
}

const trackers = new WeakMap<NetworkConfig, SequenceNumberTracker>();

/** The tracker of the client that owns `config`, created on first use. */
export function sequenceNumberTrackerOf(config: NetworkConfig): SequenceNumberTracker {
    let tracker = trackers.get(config);
    if (tracker === undefined) {
        tracker = new SequenceNumberTracker();
        trackers.set(config, tracker);
    }
    return tracker;
}

/**
 * The sequence number for a transaction of `address`: `sequenceNumber` when the caller passes one (the counter is
 * not used or changed), otherwise the next number of the client's counter.
 */
export async function reserveSequenceNumberInternal(
    args: { address: AccountAddressInput; sequenceNumber?: bigint | number | undefined },
    config: NetworkConfig,
): Promise<bigint> {
    if (args.sequenceNumber !== undefined) {
        return validateSequenceNumber(args.sequenceNumber);
    }
    const address = standardizeAddress(args.address);
    return sequenceNumberTrackerOf(config).reserve(address, async () =>
        BigInt((await getAccountInfoInternal({ accountAddress: address }, config)).sequence_number),
    );
}

/** Hands a reserved number out again when the transaction could not be built or submitted. */
export function releaseSequenceNumberInternal(
    args: { address: AccountAddressInput; sequenceNumber: bigint },
    config: NetworkConfig,
): void {
    sequenceNumberTrackerOf(config).release(standardizeAddress(args.address), args.sequenceNumber);
}

/** Forgets the counter of `address`; the next transaction reads its sequence number from the chain. */
export function resetSequenceNumberInternal(args: { address: AccountAddressInput }, config: NetworkConfig): void {
    sequenceNumberTrackerOf(config).invalidate(standardizeAddress(args.address));
}

function validateSequenceNumber(value: bigint | number): bigint {
    if (typeof value === "number" && !Number.isSafeInteger(value)) {
        throw new RangeError(`sequenceNumber must be a safe integer or a bigint, got ${value}`);
    }
    const sequenceNumber = BigInt(value);
    if (sequenceNumber < 0n || sequenceNumber > MAX_U64) {
        throw new RangeError(`sequenceNumber must be between 0 and 2^64 - 1, got ${value}`);
    }
    return sequenceNumber;
}

/**
 * Whether the error reports a sequence number that does not match the account's, from the node's refusal of a
 * submission, a simulation or a discarded transaction. That is a Move VM status of `SEQUENCE_NUMBER_TOO_OLD` or
 * `SEQUENCE_NUMBER_TOO_NEW`, or a status 400 whose message names the sequence number: the nodes refuse a number
 * beyond what they queue for the account, or below the account's next number, with a message of that form and no VM
 * status.
 */
export function isStaleSequenceNumberError(error: unknown): boolean {
    if (error instanceof SupraAPIError && error.major_status === undefined) {
        return error.status === 400 && /\bsequence number\b/i.test(error.message);
    }
    if (
        error instanceof SupraAPIError ||
        error instanceof SupraSimulationFailedError ||
        error instanceof SupraTransactionFailedError
    ) {
        return error.major_status !== undefined && STALE_SEQUENCE_NUMBER_STATUSES.has(error.major_status);
    }
    return false;
}

/**
 * Runs `send`, a helper that takes its sequence number from the client's counter, and runs it once more when the
 * node reports a stale number: the counter has been read from the chain again by then, so the second run builds the
 * transaction with the fresh number. A call that passes `sequenceNumber` is run once.
 */
export async function retryWithFreshSequenceNumber<T>(
    sequenceNumber: bigint | number | undefined,
    send: () => Promise<T>,
): Promise<T> {
    if (sequenceNumber !== undefined) {
        return send();
    }
    try {
        return await send();
    } catch (error) {
        if (isStaleSequenceNumberError(error)) {
            return send();
        }
        throw error;
    }
}

interface Reservation {
    address: string;
    sequenceNumber: bigint;
}

/** The sender and sequence number of a submission, when they came from the client's counter. */
export function reservationOf(payload: SendTxnPayload, config: NetworkConfig): Reservation | undefined {
    const tracker = trackers.get(config);
    if (tracker === undefined) {
        return undefined;
    }
    const raw = payload.Move.raw_txn;
    const address = standardizeAddress(raw.sender);
    const sequenceNumber = BigInt(raw.sequence_number);
    return tracker.isReserved(address, sequenceNumber) ? { address, sequenceNumber } : undefined;
}

/**
 * Settles the number of a submission that threw before the node accepted it.
 *
 * - A stale number, an answer with an error status of the client, a 503 and a failed simulation: the node did not
 *   take the number. A stale number means the counter is wrong, so it is read from the chain again; the other
 *   refusals hand the number out again.
 * - Any other error (a timeout, a connection failure, a 5xx other than 503): the node may have accepted the
 *   transaction, so the counter is read from the chain again.
 */
export function settleRefusedSubmission(reservation: Reservation, error: unknown, config: NetworkConfig): void {
    const tracker = sequenceNumberTrackerOf(config);
    if (isStaleSequenceNumberError(error)) {
        tracker.invalidate(reservation.address);
    } else if (error instanceof SupraSimulationFailedError) {
        tracker.release(reservation.address, reservation.sequenceNumber);
    } else if (error instanceof SupraAPIError && (error.status < 500 || error.status === 503)) {
        tracker.release(reservation.address, reservation.sequenceNumber);
    } else {
        tracker.invalidate(reservation.address);
    }
}
