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
 * A sequence number handed out by the counter. The object is the identity of the reservation: it settles the number
 * only while it is the reservation the counter holds, so a call whose reservation was dropped by a resynchronisation
 * cannot settle a later reservation of the same number.
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

/** A reservation handed out and not yet settled, with the promise that resolves when it is settled. */
interface Outstanding {
    reservation: SequenceNumberReservation;
    settled: Promise<void>;
    settle: () => void;
}

interface AccountState {
    /** The next number to hand out, or `undefined` when it has to be read from the chain. */
    next: bigint | undefined;
    /** Numbers below `next` that were handed out and not used by the node, ascending. They are handed out first. */
    freed: bigint[];
    /** Reservations handed out whose submission has not yet been accepted or refused, by number. */
    reserved: Map<bigint, Outstanding>;
    /**
     * The hash of each transaction of the account that the node accepted from this client, by sequence number, for
     * the numbers not yet known to be committed.
     */
    accepted: Map<bigint, string>;
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
 *
 * The tracker also records the sequence number and hash of every transaction that the node accepted from this client
 * (`recordAccepted`), until the counter is invalidated or a read shows the number committed.
 *
 * Every address is standardized (`standardizeAddress`); `recordAccepted` standardizes its own.
 */
export class SequenceNumberTracker {
    private readonly accounts = new Map<string, AccountState>();

    /**
     * Hands out the next sequence number of `address`. The first use of an account, and the first use after
     * `invalidate`, reads the number from the chain with `fetchChain`. Concurrent calls get distinct numbers.
     */
    reserve(address: string, fetchChain: () => Promise<bigint>): Promise<SequenceNumberReservation> {
        const state = this.stateOf(address);
        const taken = state.tail.then(() => this.take(state, address, fetchChain));
        state.tail = taken.catch(() => undefined);
        return taken;
    }

    /** The node accepted the transaction of this reservation. */
    accepted(reservation: SequenceNumberReservation): void {
        const state = this.accounts.get(reservation.address);
        const outstanding = state?.reserved.get(reservation.sequenceNumber);
        if (state !== undefined && outstanding?.reservation === reservation) {
            state.reserved.delete(reservation.sequenceNumber);
            outstanding.settle();
        }
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
        const { accepted } = this.stateOf(account);
        accepted.set(number, normalised);
        if (accepted.size > MAX_ACCEPTED_RECORDS_PER_ACCOUNT) {
            let lowest = number;
            for (const recorded of accepted.keys()) {
                if (recorded < lowest) {
                    lowest = recorded;
                }
            }
            accepted.delete(lowest);
        }
    }

    /** The hash of the transaction of `address` with `sequenceNumber` that the node accepted from this client. */
    acceptedHash(address: string, sequenceNumber: bigint): string | undefined {
        return this.accounts.get(address)?.accepted.get(sequenceNumber);
    }

    /** The number of accepted transactions of `address` that the tracker records. */
    acceptedCount(address: string): number {
        return this.accounts.get(address)?.accepted.size ?? 0;
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
     * Resolves when every reservation of `address` with a number below `sequenceNumber` that is outstanding now has
     * been accepted, refused or dropped by `invalidate`.
     */
    async settledBelow(address: string, sequenceNumber: bigint): Promise<void> {
        const state = this.accounts.get(address);
        if (state === undefined) {
            return;
        }
        const pending = [...state.reserved.values()]
            .filter((outstanding) => outstanding.reservation.sequenceNumber < sequenceNumber)
            .map((outstanding) => outstanding.settled);
        await Promise.all(pending);
    }

    /** The node did not accept the transaction of this reservation, so its number is handed out again. */
    release(reservation: SequenceNumberReservation): void {
        const { sequenceNumber } = reservation;
        const state = this.accounts.get(reservation.address);
        const outstanding = state?.reserved.get(sequenceNumber);
        if (state === undefined || outstanding?.reservation !== reservation || state.next === undefined) {
            return;
        }
        state.reserved.delete(sequenceNumber);
        outstanding.settle();
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

    /**
     * Forgets the counter of `address` and its records of accepted transactions; the next use reads the number from
     * the chain. The outstanding reservations are dropped.
     */
    invalidate(address: string): void {
        const state = this.accounts.get(address);
        if (state === undefined) {
            return;
        }
        state.next = undefined;
        state.freed = [];
        for (const outstanding of state.reserved.values()) {
            outstanding.settle();
        }
        state.reserved.clear();
        state.accepted.clear();
        state.generation += 1;
    }

    private stateOf(address: string): AccountState {
        let state = this.accounts.get(address);
        if (state === undefined) {
            state = {
                next: undefined,
                freed: [],
                reserved: new Map(),
                accepted: new Map(),
                generation: 0,
                tail: Promise.resolve(),
            };
            this.accounts.set(address, state);
        }
        return state;
    }

    private async take(
        state: AccountState,
        address: string,
        fetchChain: () => Promise<bigint>,
    ): Promise<SequenceNumberReservation> {
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
                this.observeChainSequenceNumber(address, fromChain);
            }
            const freed = state.freed.shift();
            let sequenceNumber: bigint;
            if (freed !== undefined) {
                sequenceNumber = freed;
            } else {
                sequenceNumber = next;
                state.next = next + 1n;
            }
            const reservation: SequenceNumberReservation = { address, sequenceNumber };
            let settle: () => void = () => undefined;
            const settled = new Promise<void>((resolve) => {
                settle = resolve;
            });
            state.reserved.set(sequenceNumber, { reservation, settled, settle });
            return reservation;
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
 * not used or changed and there is no reservation), otherwise the next number of the client's counter with the
 * reservation that settles it.
 */
export async function reserveSequenceNumberInternal(
    args: { address: AccountAddressInput; sequenceNumber?: bigint | number | undefined },
    config: NetworkConfig,
): Promise<{ sequenceNumber: bigint; reservation: SequenceNumberReservation | undefined }> {
    if (args.sequenceNumber !== undefined) {
        return { sequenceNumber: validateSequenceNumber(args.sequenceNumber), reservation: undefined };
    }
    const address = standardizeAddress(args.address);
    const reservation = await sequenceNumberTrackerOf(config).reserve(address, async () =>
        BigInt((await getAccountInfoInternal({ accountAddress: address }, config)).sequence_number),
    );
    return { sequenceNumber: reservation.sequenceNumber, reservation };
}

/**
 * Settles a reservation whose transaction threw before it was submitted, while it was built, its max gas
 * estimated or it was signed. An error that reports a stale number (for example the estimating simulation's
 * `SEQUENCE_NUMBER_TOO_OLD`) means the counter is wrong, so it is read from the chain again; after any other error the
 * number is handed out again.
 */
export function settleUnsubmittedSequenceNumberInternal(
    reservation: SequenceNumberReservation,
    error: unknown,
    config: NetworkConfig,
): void {
    const tracker = sequenceNumberTrackerOf(config);
    if (isStaleSequenceNumberError(error)) {
        tracker.invalidate(reservation.address);
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
 * Settles the number of a submission that threw before the node accepted it.
 *
 * - A stale number, an answer with an error status of the client, a 503 and a failed simulation: the node did not
 *   take the number. A stale number means the counter is wrong, so it is read from the chain again; the other
 *   refusals hand the number out again.
 * - Any other error (a timeout, a connection failure, a 5xx other than 503): the node may have accepted the
 *   transaction, so the counter is read from the chain again.
 */
export function settleRefusedSubmission(
    reservation: SequenceNumberReservation,
    error: unknown,
    config: NetworkConfig,
): void {
    const tracker = sequenceNumberTrackerOf(config);
    if (isStaleSequenceNumberError(error)) {
        tracker.invalidate(reservation.address);
    } else if (error instanceof SupraSimulationFailedError) {
        tracker.release(reservation);
    } else if (error instanceof SupraAPIError && (error.status < 500 || error.status === 503)) {
        tracker.release(reservation);
    } else {
        tracker.invalidate(reservation.address);
    }
}
