import { standardizeAddress } from "../helper/account";
import { SupraAPIError } from "../errors/apiError";
import { SupraSimulationFailedError, SupraTransactionFailedError } from "../errors/transactionError";
import type { AccountAddressInput } from "../types/account";
import { TransactionStatus } from "../types/transaction";
import type { SendTxnPayload } from "../types/transactionManager/transactionBuild";
import type { NetworkConfig } from "../utils/apiEndpoints";
import { getAccountInfoInternal } from "./account";

const MAX_U64 = 18_446_744_073_709_551_615n;

/** Move VM statuses the node reports for a sequence number that does not match the account's. */
const STALE_SEQUENCE_NUMBER_STATUSES: ReadonlySet<string> = new Set([
    "SEQUENCE_NUMBER_TOO_OLD",
    "SEQUENCE_NUMBER_TOO_NEW",
]);

/**
 * A sequence number handed out by the counter. The reservation holds the lock of its account until it is settled
 * (`accepted`, `release`, `resynchronise` or `resume`); settling it a second time does nothing.
 */
export interface SequenceNumberReservation {
    readonly address: string;
    readonly sequenceNumber: bigint;
}

/**
 * Messages of a refusal that carries no VM status and concerns the account's sequence number: a number outside the
 * window the node accepts (`sequence number 30 is above ...`), and a number that already has a pending transaction
 * (`Already scheduled digest=..., sequence_number=N` on v11.7.0; `a transaction with sequence number N is already
 * pending for this account` and `transaction ... is already pending` on v12).
 */
const SEQUENCE_NUMBER_MESSAGE = /\bsequence[ _]number\b|\balready (?:pending|scheduled)\b/i;

/**
 * The number of accepted transactions the tracker records per account. When a record is added beyond it, the record
 * with the lowest number is dropped.
 */
export const MAX_ACCEPTED_RECORDS_PER_ACCOUNT = 256;

interface AccountState {
    /** The next number to hand out, or `undefined` when it has to be read from the chain. */
    next: bigint | undefined;
    /**
     * The hash of each transaction of the account that the node accepted from this client, by sequence number, for
     * the numbers not yet known to be committed.
     */
    accepted: Map<bigint, string>;
    /** The reservation that holds the account's lock, and the function that releases the lock. */
    holder: { reservation: SequenceNumberReservation; unlock: () => void } | undefined;
    /** Resolves when the call that asked for the lock last has released it. */
    tail: Promise<void>;
}

/**
 * The next sequence number of each account, kept per client, and a lock per account.
 *
 * A helper takes a number from the counter (`reserve`) after it has acquired the account's lock, and holds the lock
 * while it builds, estimates, signs and submits the transaction. The reservation is settled, and the lock released,
 * when the node answers the submission: accepted (`accepted`: the number is used), refused (`release`: the number is
 * handed out next), stale or unknown (`resynchronise`: the counter is read from the chain on the next use). A
 * transaction that throws before its submission settles its reservation the same way. Only one reservation per
 * account is held at a time, so a number handed back is always the next number and the counter leaves no number
 * unused below the numbers of the transactions the node accepted from this client.
 *
 * The tracker also records the sequence number and hash of every transaction that the node accepted from this client
 * (`recordAccepted`), until the counter is invalidated or a read shows the number committed. The counter skips the
 * numbers it records, which have a pending transaction of this client.
 *
 * Every address is standardized (`standardizeAddress`); `recordAccepted` standardizes its own.
 */
export class SequenceNumberTracker {
    private readonly accounts = new Map<string, AccountState>();

    /**
     * Waits until no other reservation of `address` holds the account's lock, then hands out the next sequence number
     * of `address` with the lock held. Callers acquire the lock in the order of their calls. The first use of an
     * account, and the first use after `invalidate`, reads the number from the chain with `fetchChain`; when that read
     * throws, the lock is released and the error is thrown.
     */
    async reserve(address: string, fetchChain: () => Promise<bigint>): Promise<SequenceNumberReservation> {
        const state = this.stateOf(address);
        const previous = state.tail;
        let unlock: () => void = () => undefined;
        state.tail = new Promise<void>((resolve) => {
            unlock = resolve;
        });
        await previous;
        let sequenceNumber: bigint;
        try {
            sequenceNumber = await this.take(state, address, fetchChain);
        } catch (error) {
            unlock();
            throw error;
        }
        const reservation: SequenceNumberReservation = { address, sequenceNumber };
        state.holder = { reservation, unlock };
        return reservation;
    }

    /** The node accepted the transaction of this reservation. The lock is released. */
    accepted(reservation: SequenceNumberReservation): void {
        this.settle(reservation, () => undefined);
    }

    /** The node did not take the number of this reservation, so it is handed out next. The lock is released. */
    release(reservation: SequenceNumberReservation): void {
        this.settle(reservation, (state) => {
            if (state.next === reservation.sequenceNumber + 1n) {
                state.next = reservation.sequenceNumber;
            }
        });
    }

    /**
     * The number of this reservation is stale, or the node may have taken it: the counter of its account is
     * invalidated. The lock is released.
     */
    resynchronise(reservation: SequenceNumberReservation): void {
        this.settle(reservation, () => this.invalidate(reservation.address));
    }

    /**
     * The transaction of this reservation was not submitted because a number from `chainSequenceNumber` up to its own
     * (exclusive) has no pending transaction of this client. `pending` holds the numbers in that range whose
     * transactions of this client read `Pending` or `PendingAfterExecution`, with their hashes. The records of the
     * other numbers in that range and below `chainSequenceNumber` are dropped, those in `pending` are kept, and the
     * counter resumes at the lowest number from `chainSequenceNumber` that is not in `pending`. The lock is released.
     */
    resume(
        reservation: SequenceNumberReservation,
        chainSequenceNumber: bigint,
        pending: ReadonlyMap<bigint, string>,
    ): void {
        this.settle(reservation, (state) => {
            for (const recorded of [...state.accepted.keys()]) {
                if (recorded < chainSequenceNumber) {
                    state.accepted.delete(recorded);
                } else if (recorded < reservation.sequenceNumber && !pending.has(recorded)) {
                    state.accepted.delete(recorded);
                }
            }
            for (const [sequenceNumber, hash] of pending) {
                this.record(state, sequenceNumber, hash);
            }
            let next = chainSequenceNumber;
            while (pending.has(next)) {
                next += 1n;
            }
            state.next = next;
        });
    }

    /**
     * Records that the node accepted the transaction `hash` of `address` with `sequenceNumber` from this client,
     * whether or not its number came from the counter. Nothing is recorded when the address, the number or the hash
     * cannot be read.
     */
    recordAccepted(address: AccountAddressInput, sequenceNumber: bigint | number, hash: string): void {
        let account: string;
        let normalised: string;
        let number: bigint;
        try {
            account = standardizeAddress(address);
            normalised = standardizeAddress(hash);
            number = BigInt(sequenceNumber);
        } catch {
            return;
        }
        this.record(this.stateOf(account), number, normalised);
    }

    /**
     * The hashes of the transactions of `address` that the node accepted from this client, by sequence number, for the
     * recorded numbers from `from` up to `to` (exclusive).
     */
    acceptedBetween(address: string, from: bigint, to: bigint): Map<bigint, string> {
        const between = new Map<bigint, string>();
        for (const [sequenceNumber, hash] of this.accounts.get(address)?.accepted ?? []) {
            if (sequenceNumber >= from && sequenceNumber < to) {
                between.set(sequenceNumber, hash);
            }
        }
        return between;
    }

    /**
     * The account's sequence number on the chain is at least `chainSequenceNumber`: the transactions recorded with a
     * lower number have committed, and their records are dropped.
     */
    observeChainSequenceNumber(address: string, chainSequenceNumber: bigint): void {
        const accepted = this.accounts.get(address)?.accepted;
        if (accepted === undefined) {
            return;
        }
        for (const recorded of [...accepted.keys()]) {
            if (recorded < chainSequenceNumber) {
                accepted.delete(recorded);
            }
        }
    }

    /**
     * A read of the transaction `hash` returned `status`. For a transaction recorded as accepted: `Invalid` (the
     * transaction was discarded and did not use its number) invalidates the counter of its account; `Success` or
     * `Fail` (the transaction committed) drops the records up to its number.
     */
    observeTransaction(hash: string, status: TransactionStatus): void {
        if (
            status !== TransactionStatus.Invalid &&
            status !== TransactionStatus.Success &&
            status !== TransactionStatus.Fail
        ) {
            return;
        }
        let normalised: string;
        try {
            normalised = standardizeAddress(hash);
        } catch {
            return;
        }
        for (const [address, state] of this.accounts) {
            for (const [sequenceNumber, recorded] of state.accepted) {
                if (recorded !== normalised) {
                    continue;
                }
                if (status === TransactionStatus.Invalid) {
                    this.invalidate(address);
                } else {
                    this.observeChainSequenceNumber(address, sequenceNumber + 1n);
                }
                return;
            }
        }
    }

    /**
     * Forgets the counter of `address` and its records of accepted transactions; the next use reads the number from
     * the chain. A reservation that holds the account's lock keeps it.
     */
    invalidate(address: string): void {
        const state = this.accounts.get(address);
        if (state === undefined) {
            return;
        }
        state.next = undefined;
        state.accepted.clear();
    }

    /**
     * Applies `update` to the account of `reservation` and releases the lock, when `reservation` holds the lock.
     * Otherwise (a reservation already settled, or not handed out by this tracker) does nothing.
     */
    private settle(reservation: SequenceNumberReservation, update: (state: AccountState) => void): void {
        const state = this.accounts.get(reservation.address);
        const holder = state?.holder;
        if (state === undefined || holder === undefined || holder.reservation !== reservation) {
            return;
        }
        state.holder = undefined;
        try {
            update(state);
        } finally {
            holder.unlock();
        }
    }

    /** Records `hash` for `sequenceNumber`, and drops the lowest record beyond `MAX_ACCEPTED_RECORDS_PER_ACCOUNT`. */
    private record(state: AccountState, sequenceNumber: bigint, hash: string): void {
        const { accepted } = state;
        accepted.set(sequenceNumber, hash);
        if (accepted.size > MAX_ACCEPTED_RECORDS_PER_ACCOUNT) {
            let lowest = sequenceNumber;
            for (const recorded of accepted.keys()) {
                if (recorded < lowest) {
                    lowest = recorded;
                }
            }
            accepted.delete(lowest);
        }
    }

    private stateOf(address: string): AccountState {
        let state = this.accounts.get(address);
        if (state === undefined) {
            state = { next: undefined, accepted: new Map(), holder: undefined, tail: Promise.resolve() };
            this.accounts.set(address, state);
        }
        return state;
    }

    /** The next number of the counter, from the chain when it is unknown, skipping the numbers recorded as accepted. */
    private async take(state: AccountState, address: string, fetchChain: () => Promise<bigint>): Promise<bigint> {
        if (state.next === undefined) {
            const fromChain = await fetchChain();
            this.observeChainSequenceNumber(address, fromChain);
            state.next = fromChain;
        }
        let sequenceNumber = state.next;
        while (state.accepted.has(sequenceNumber)) {
            sequenceNumber += 1n;
        }
        state.next = sequenceNumber + 1n;
        return sequenceNumber;
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
 * Runs `send` with the sequence number of a transaction of `address`.
 *
 * With `sequenceNumber`, `send` gets that number and no reservation: the counter is not used or changed and the
 * account's lock is not taken. Otherwise `send` runs with the next number of the client's counter and its reservation,
 * which holds the account's lock. `send` passes the reservation to the submission (`bindReservation`), which settles it
 * when the node answers. When `send` throws before then, the reservation is settled as a transaction that was not
 * submitted (`settleUnsubmittedSequenceNumberInternal`). A reservation that is still held when `send` ends is
 * released, so the lock is released on every path.
 */
export async function withSequenceNumberInternal<T>(
    args: { address: AccountAddressInput; sequenceNumber?: bigint | number | undefined },
    config: NetworkConfig,
    send: (sequenceNumber: bigint, reservation: SequenceNumberReservation | undefined) => Promise<T>,
): Promise<T> {
    if (args.sequenceNumber !== undefined) {
        return send(validateSequenceNumber(args.sequenceNumber), undefined);
    }
    const address = standardizeAddress(args.address);
    const tracker = sequenceNumberTrackerOf(config);
    const reservation = await tracker.reserve(address, async () =>
        BigInt((await getAccountInfoInternal({ accountAddress: address }, config)).sequence_number),
    );
    try {
        return await send(reservation.sequenceNumber, reservation);
    } catch (error) {
        settleUnsubmittedSequenceNumberInternal(reservation, error, config);
        throw error;
    } finally {
        tracker.release(reservation);
    }
}

/**
 * Settles a reservation whose transaction threw before it was submitted, while it was built, its max gas
 * estimated or it was signed. An error that reports a stale number (for example the estimating simulation's
 * `SEQUENCE_NUMBER_TOO_OLD`) means the counter is wrong, so it is read from the chain again; after any other error the
 * number is handed out next. A reservation already settled is left as it is.
 */
export function settleUnsubmittedSequenceNumberInternal(
    reservation: SequenceNumberReservation,
    error: unknown,
    config: NetworkConfig,
): void {
    const tracker = sequenceNumberTrackerOf(config);
    if (isStaleSequenceNumberError(error)) {
        tracker.resynchronise(reservation);
    } else {
        tracker.release(reservation);
    }
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
 * beyond what they queue for the account, or below the account's next number, or a number that already has a pending
 * transaction, with a message of that form and no VM status. In every case the counter is wrong and is read from the
 * chain again.
 */
export function isStaleSequenceNumberError(error: unknown): boolean {
    if (error instanceof SupraAPIError && error.major_status === undefined) {
        return error.status === 400 && SEQUENCE_NUMBER_MESSAGE.test(error.message);
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
 * node reports a stale number. By then the first run has released the account's lock and the counter has been read
 * from the chain again, or resumed below the number (`SequenceNumberTracker.resume`), so the second run takes the lock
 * again and builds the transaction with a fresh number. A call that passes `sequenceNumber` is run once.
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

const reservations = new WeakMap<SendTxnPayload, SequenceNumberReservation>();

/** Marks `payload`, built with the number of `reservation`, so that its submission settles the reservation. */
export function bindReservation(payload: SendTxnPayload, reservation: SequenceNumberReservation): void {
    reservations.set(payload, reservation);
}

/**
 * The reservation of a submission, when its payload was built with a number from the client's counter. A payload
 * built with an explicit number has none.
 */
export function reservationOf(payload: SendTxnPayload): SequenceNumberReservation | undefined {
    return reservations.get(payload);
}

/**
 * Settles the number of a submission that threw before the node accepted it, and so releases the account's lock.
 *
 * - A stale number, an answer with an error status of the client, a 503 and a failed simulation: the node did not
 *   take the number. A stale number means the counter is wrong, so it is read from the chain again; the other
 *   refusals hand the number out next.
 * - Any other error (a timeout, a connection failure, a 5xx other than 503): the node may have accepted the
 *   transaction, so the counter is read from the chain again.
 *
 * A reservation already settled is left as it is.
 */
export function settleRefusedSubmission(
    reservation: SequenceNumberReservation,
    error: unknown,
    config: NetworkConfig,
): void {
    const tracker = sequenceNumberTrackerOf(config);
    if (isStaleSequenceNumberError(error)) {
        tracker.resynchronise(reservation);
    } else if (error instanceof SupraSimulationFailedError) {
        tracker.release(reservation);
    } else if (error instanceof SupraAPIError && (error.status < 500 || error.status === 503)) {
        tracker.release(reservation);
    } else {
        tracker.resynchronise(reservation);
    }
}
