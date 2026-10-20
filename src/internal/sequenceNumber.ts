import { standardizeAddress } from "../helper/account";
import { SupraAccountQueueFullError, SupraAPIError } from "../errors/apiError";
import { SupraSimulationFailedError, SupraTransactionFailedError } from "../errors/transactionError";
import type { AccountAddressInput } from "../types/account";
import { TransactionStatus } from "../types/transaction";
import type { RawTxnJSON, SendTxnPayload } from "../types/transactionManager/transactionBuild";
import type { NetworkConfig } from "../utils/apiEndpoints";
import { MAX_TX_EXPIRATION_DURATION, MILLISECONDS_PER_SECOND, TX_EXPIRATION_MARGIN_SECS } from "../utils/constants";
import { getAccountInfoInternal } from "./account";
import { getLatestBlockInternal } from "./block";
import { ChainClock, chainClockOf } from "./chainTime";

const MAX_U64 = 18_446_744_073_709_551_615n;

/** Move VM statuses the node reports for a sequence number that does not match the account's. */
const STALE_SEQUENCE_NUMBER_STATUSES: ReadonlySet<string> = new Set([
    "SEQUENCE_NUMBER_TOO_OLD",
    "SEQUENCE_NUMBER_TOO_NEW",
]);

/**
 * Messages of a refusal that carries no VM status and concerns the account's sequence number: a number below the
 * account's (`sequence number 3 is below the account's next sequence number 7` on v12, `has sequence number 3 but the
 * expected sequence number is 7` on v11.7.0), and a number that already has a pending transaction (`Already scheduled
 * digest=..., sequence_number=N` on v11.7.0; `a transaction with sequence number N is already pending for this
 * account` and `transaction ... is already pending` on v12).
 */
const SEQUENCE_NUMBER_MESSAGE = /\bsequence[ _]number\b|\balready (?:pending|scheduled)\b/i;

/**
 * Messages of the nodes' refusal of a number beyond the numbers they queue for the account ahead of its sequence
 * number on the chain: v12 names the highest number it queues (`sequence number 30 is above 25, the highest sequence
 * number this node can queue for the account`); v11.7.0 names the account's next number (`has sequence number 30 but
 * the expected sequence number is 5`), the message it also gives for a number below the account's.
 */
const QUEUE_FULL_MESSAGE = /\bsequence number \d+ is above \d+, the highest sequence number this node can queue\b/i;
const EXPECTED_SEQUENCE_NUMBER_MESSAGE = /\bhas sequence number (\d+) but the expected sequence number is (\d+)/i;

/**
 * The number of submissions the tracker records per account. When a record is added beyond it, the record with the
 * lowest number is dropped.
 */
export const MAX_SUBMISSION_RECORDS_PER_ACCOUNT = 256;

/**
 * Seconds by which the estimated chain time passes the expiration time of a record before the next number is taken
 * after a read of the chain. The estimate follows the timestamp of the latest block, which trails the time at which it
 * is read by up to a block interval.
 */
const EXPIRED_RECORD_READ_DELAY_SECONDS = 2n;

/**
 * A sequence number handed out by the counter. The reservation holds the lock of its account until it is settled
 * (`release` or `resynchronise`); settling it a second time does nothing.
 */
export interface SequenceNumberReservation {
    readonly address: string;
    /**
     * The number the transaction is built with. `SequenceNumberTracker.move` changes it while the reservation holds the
     * lock.
     */
    sequenceNumber: bigint;
}

/** A transaction of the account that this client submitted and that may still commit. */
export interface SubmissionRecord {
    /** The transaction's expiration time, in seconds since the Unix epoch. */
    readonly expiration: bigint;
    /** The transaction's hash, when the node returned it. */
    readonly hash: string | undefined;
}

interface AccountState {
    /** The highest sequence number of the account read from the chain, or `undefined` before the first read. */
    chain: bigint | undefined;
    /** Whether the next number is taken after a read of the chain. */
    readChain: boolean;
    /** The submissions of this client that may still commit, by sequence number. */
    submissions: Map<bigint, SubmissionRecord>;
    /** The reservation that holds the account's lock, and the function that releases the lock. */
    holder: { reservation: SequenceNumberReservation; unlock: () => void } | undefined;
    /** Resolves when the call that asked for the lock last has released it. */
    tail: Promise<void>;
}

/**
 * The sequence numbers of each account, kept per client, and a lock per account.
 *
 * The tracker records every transaction of an account that this client submitted and that the node accepted or may
 * have accepted (the submission request failed without an answer), with its expiration time. A transaction that the
 * node accepted either commits or can no longer commit once the chain's time (the timestamp of its latest block) has
 * reached its expiration time. A record is dropped when the account's sequence number on the chain passes its number,
 * when the timestamp of a latest block read from the node has reached its expiration time, or when a read of the transaction
 * by hash returns `Invalid`; until then its number is not handed out. A refused submission is not recorded.
 *
 * A helper takes a number (`reserve`) after it has acquired the account's lock, and holds the lock while it builds,
 * estimates, signs and submits the transaction. The number handed out is the lowest number, at or above the account's
 * sequence number on the chain, that has no record. The chain is read (the account and the latest block) on the first
 * use of an account, after a refusal that reports a stale number or a full queue (`resynchronise`), and while the
 * estimated chain time has passed the expiration time of a record by two seconds and no latest block read has reached
 * that expiration time: a read that fails, or whose block has not reached it, leaves the record, and the next number
 * is again taken after a read. A number is taken after at most one read of the chain. A read of the chain drops the
 * records it shows dead and keeps the others.
 *
 * Every address is standardized (`standardizeAddress`); `record` standardizes its own.
 */
export class SequenceNumberTracker {
    private readonly accounts = new Map<string, AccountState>();

    constructor(private readonly clock: ChainClock = new ChainClock()) {}

    /**
     * Waits until no other reservation of `address` holds the account's lock, then hands out the next sequence number
     * of `address` with the lock held. Callers acquire the lock in the order of their calls. When the chain has to be
     * read first, `readChain` returns the account's sequence number on the chain; when it throws, the lock is released
     * and the error is thrown.
     */
    async reserve(address: string, readChain: () => Promise<bigint>): Promise<SequenceNumberReservation> {
        const state = this.stateOf(address);
        const previous = state.tail;
        let unlock: () => void = () => undefined;
        state.tail = new Promise<void>((resolve) => {
            unlock = resolve;
        });
        await previous;
        let sequenceNumber: bigint;
        try {
            sequenceNumber = await this.take(state, readChain);
        } catch (error) {
            unlock();
            throw error;
        }
        const reservation: SequenceNumberReservation = { address, sequenceNumber };
        state.holder = { reservation, unlock };
        return reservation;
    }

    /**
     * Releases the lock of `reservation`. Its number stays taken when its submission was recorded (`record`); otherwise
     * the next call can take it.
     */
    release(reservation: SequenceNumberReservation): void {
        this.settle(reservation, () => undefined);
    }

    /**
     * Releases the lock of `reservation`; the next number is taken after a read of the chain. For a number the node
     * refused as stale, or a refusal because the account's queue on the node is full.
     */
    resynchronise(reservation: SequenceNumberReservation): void {
        this.settle(reservation, (state) => {
            state.readChain = true;
        });
    }

    /**
     * Gives `reservation`, which holds the lock, the number `sequenceNumber` instead of its own. Its own number has no
     * record, so the next call can take it. Does nothing for a reservation that does not hold the lock.
     */
    move(reservation: SequenceNumberReservation, sequenceNumber: bigint): void {
        if (this.accounts.get(reservation.address)?.holder?.reservation === reservation) {
            reservation.sequenceNumber = sequenceNumber;
        }
    }

    /**
     * Records the transaction of `address` with `sequenceNumber` and `expiration` (seconds since the Unix epoch) that
     * this client submitted and that the node accepted (with its `hash`) or may have accepted (without a hash), whether
     * or not its number came from the counter. Nothing is recorded when the address, the number or the expiration time
     * cannot be read; a hash that cannot be read is not kept.
     */
    record(
        address: AccountAddressInput,
        sequenceNumber: bigint | number,
        expiration: bigint | number,
        hash?: string | undefined,
    ): void {
        let account: string;
        let number: bigint;
        let expires: bigint;
        try {
            account = standardizeAddress(address);
            number = BigInt(sequenceNumber);
            expires = BigInt(expiration);
        } catch {
            return;
        }
        let normalised: string | undefined;
        try {
            normalised = hash === undefined ? undefined : standardizeAddress(hash);
        } catch {
            normalised = undefined;
        }
        const { submissions } = this.stateOf(account);
        submissions.set(number, { expiration: expires, hash: normalised });
        if (submissions.size > MAX_SUBMISSION_RECORDS_PER_ACCOUNT) {
            submissions.delete(minimum(submissions.keys()) as bigint);
        }
    }

    /** The records of `address` that the chain read so far does not show dead, by sequence number. */
    recorded(address: string): ReadonlyMap<bigint, SubmissionRecord> {
        const state = this.accounts.get(address);
        if (state === undefined) {
            return new Map();
        }
        this.prune(state);
        return new Map(state.submissions);
    }

    /**
     * The account's sequence number on the chain is at least `chainSequenceNumber`: the records with a lower number are
     * dropped.
     */
    observeChainSequenceNumber(address: string, chainSequenceNumber: bigint): void {
        const state = this.stateOf(address);
        if (state.chain === undefined || chainSequenceNumber > state.chain) {
            state.chain = chainSequenceNumber;
        }
        this.prune(state);
    }

    /**
     * The highest sequence number of `address` on the chain that the tracker has observed, or `undefined` when the
     * chain has not been read for the account.
     */
    chainSequenceNumber(address: string): bigint | undefined {
        return this.accounts.get(address)?.chain;
    }

    /**
     * The lowest number of `address`, at or above the account's sequence number on the chain, that has no record, or
     * `undefined` when the chain has not been read for the account.
     */
    nextFree(address: string): bigint | undefined {
        const state = this.accounts.get(address);
        return state === undefined || state.chain === undefined ? undefined : this.firstFree(state);
    }

    /** Whether every number of `address` from `from` up to `to` (exclusive) has a record. */
    everyNumberRecorded(address: string, from: bigint, to: bigint): boolean {
        const state = this.accounts.get(address);
        if (state === undefined) {
            return from >= to;
        }
        this.prune(state);
        for (let number = from; number < to; number += 1n) {
            if (!state.submissions.has(number)) {
                return false;
            }
        }
        return true;
    }

    /**
     * A read of the transaction `hash` returned `status`. For a recorded transaction: `Invalid` (the transaction was
     * discarded and did not use its number) drops its record; `Success` or `Fail` (the transaction committed) shows the
     * account's sequence number on the chain above its number.
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
            for (const [sequenceNumber, record] of state.submissions) {
                if (record.hash !== normalised) {
                    continue;
                }
                if (status === TransactionStatus.Invalid) {
                    state.submissions.delete(sequenceNumber);
                } else {
                    this.observeChainSequenceNumber(address, sequenceNumber + 1n);
                }
                return;
            }
        }
    }

    /**
     * Forgets the account's sequence number on the chain and the records of `address`; the next number is taken after
     * a read of the chain. A reservation that holds the account's lock keeps it.
     */
    reset(address: string): void {
        const state = this.accounts.get(address);
        if (state === undefined) {
            return;
        }
        state.chain = undefined;
        state.readChain = false;
        state.submissions.clear();
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

    private stateOf(address: string): AccountState {
        let state = this.accounts.get(address);
        if (state === undefined) {
            state = {
                chain: undefined,
                readChain: false,
                submissions: new Map(),
                holder: undefined,
                tail: Promise.resolve(),
            };
            this.accounts.set(address, state);
        }
        return state;
    }

    /** Drops the records below the chain's number and those whose expiration time the latest block has reached. */
    private prune(state: AccountState): void {
        const latestBlock = this.clock.latestBlockSeconds();
        for (const [sequenceNumber, record] of [...state.submissions]) {
            if (
                (state.chain !== undefined && sequenceNumber < state.chain) ||
                (latestBlock !== undefined && record.expiration <= latestBlock)
            ) {
                state.submissions.delete(sequenceNumber);
            }
        }
    }

    private firstFree(state: AccountState): bigint {
        this.prune(state);
        let sequenceNumber = state.chain ?? 0n;
        while (state.submissions.has(sequenceNumber)) {
            sequenceNumber += 1n;
        }
        return sequenceNumber;
    }

    /**
     * Whether the next number is taken after a read of the chain: the chain was never read, a refusal asked for a read,
     * or the estimated chain time has passed the expiration time of a record by `EXPIRED_RECORD_READ_DELAY_SECONDS`.
     * Such a record stays until a latest block read has reached its expiration time (or the chain passes its number),
     * so a read whose block request fails or returns an earlier block is followed by another read at the next call.
     */
    private needsChainRead(state: AccountState): boolean {
        if (state.chain === undefined || state.readChain) {
            return true;
        }
        this.prune(state);
        const earliest = minimum([...state.submissions.values()].map((record) => record.expiration));
        return (
            earliest !== undefined && earliest + EXPIRED_RECORD_READ_DELAY_SECONDS <= this.clock.estimatedNowSeconds()
        );
    }

    /** The next number of the account, after a read of the chain when one is needed. */
    private async take(state: AccountState, readChain: () => Promise<bigint>): Promise<bigint> {
        if (this.needsChainRead(state)) {
            const chain = await readChain();
            state.readChain = false;
            if (state.chain === undefined || chain > state.chain) {
                state.chain = chain;
            }
        }
        return this.firstFree(state);
    }
}

function minimum(values: Iterable<bigint>): bigint | undefined {
    let lowest: bigint | undefined;
    for (const value of values) {
        if (lowest === undefined || value < lowest) {
            lowest = value;
        }
    }
    return lowest;
}

const trackers = new WeakMap<NetworkConfig, SequenceNumberTracker>();

/** The tracker of the client that owns `config`, created on first use. */
export function sequenceNumberTrackerOf(config: NetworkConfig): SequenceNumberTracker {
    let tracker = trackers.get(config);
    if (tracker === undefined) {
        tracker = new SequenceNumberTracker(chainClockOf(config));
        trackers.set(config, tracker);
    }
    return tracker;
}

/**
 * Reads the account's sequence number on the chain and, in parallel, the latest block, whose timestamp updates the
 * client's chain time (`chainClockOf`). A failed account read is thrown; a failed block read is ignored, and the chain
 * time keeps its previous value.
 */
export async function readChainInternal(address: string, config: NetworkConfig): Promise<bigint> {
    const [account] = await Promise.all([
        getAccountInfoInternal({ accountAddress: address }, config),
        getLatestBlockInternal(config).catch(() => undefined),
    ]);
    return BigInt(account.sequence_number);
}

/**
 * Runs `send` with the sequence number of a transaction of `address`.
 *
 * With `sequenceNumber`, `send` gets that number and no reservation: the counter does not hand it out and the
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
    const reservation = await tracker.reserve(address, () => readChainInternal(address, config));
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
 * estimated, signed or simulated. After an error that reports a stale number (for example the estimating simulation's
 * `SEQUENCE_NUMBER_TOO_OLD`) the next number is taken after a read of the chain; after any other error the number is
 * handed out next. A reservation already settled is left as it is.
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

/**
 * Settles a submission of `rawTxn` whose request threw, and returns the error to throw.
 *
 * - A refusal because the account's queue on the node is full: `SupraAccountQueueFullError` is returned; with
 *   `reservation`, the next number is taken after a read of the chain.
 * - A stale number: with `reservation`, the next number is taken after a read of the chain.
 * - Another answer with an error status of the client, and a 503: the node did not take the number; with
 *   `reservation`, the number is handed out next.
 * - Any other error (a timeout, a connection failure, a 5xx other than 503): the node may have accepted the
 *   transaction, so it is recorded without a hash, whether or not its number came from the counter. The record's
 *   expiration time is the transaction's, at most `unknownOutcomeExpiration` (the latest expiration time a node
 *   accepts).
 *
 * A reservation is released in every case.
 */
export function settleFailedSubmissionInternal(
    args: { rawTxn: RawTxnJSON; reservation: SequenceNumberReservation | undefined },
    error: unknown,
    config: NetworkConfig,
): unknown {
    const tracker = sequenceNumberTrackerOf(config);
    const { rawTxn, reservation } = args;
    const settle = (resynchronise: boolean) => {
        if (reservation !== undefined) {
            if (resynchronise) {
                tracker.resynchronise(reservation);
            } else {
                tracker.release(reservation);
            }
        }
    };
    if (isAccountQueueFullRefusal(error)) {
        settle(true);
        return new SupraAccountQueueFullError({
            status: error.status,
            statusText: error.statusText,
            url: error.url,
            data: error.data,
            sequenceNumber: BigInt(rawTxn.sequence_number),
        });
    }
    if (isStaleSequenceNumberError(error)) {
        settle(true);
    } else if (error instanceof SupraAPIError && (error.status < 500 || error.status === 503)) {
        settle(false);
    } else {
        tracker.record(
            rawTxn.sender,
            rawTxn.sequence_number,
            unknownOutcomeExpiration(rawTxn.expiration_timestamp_secs),
        );
        settle(false);
    }
    return error;
}

/**
 * The expiration time recorded for a submission whose request failed without an answer: `expiration`, at most
 * `MAX_TX_EXPIRATION_DURATION + TX_EXPIRATION_MARGIN_SECS` seconds after the client's clock (rounded up). A node
 * refuses a transaction whose expiration time is more than `MAX_TX_EXPIRATION_DURATION` seconds after the node's
 * clock, so a transaction with a later expiration time was refused by a node whose clock is less than
 * `TX_EXPIRATION_MARGIN_SECS` seconds ahead of the client's, and its record does not hold the number beyond that time.
 * `expiration` is returned unchanged when it cannot be read as an integer.
 */
export function unknownOutcomeExpiration(
    expiration: bigint | number,
    localNowMs: number = Date.now(),
): bigint | number {
    let expires: bigint;
    try {
        expires = BigInt(expiration);
    } catch {
        return expiration;
    }
    const latest =
        BigInt(Math.ceil(localNowMs / MILLISECONDS_PER_SECOND)) +
        BigInt(MAX_TX_EXPIRATION_DURATION + TX_EXPIRATION_MARGIN_SECS);
    return expires < latest ? expires : latest;
}

/**
 * Forgets the account's sequence number and the records of the client's submissions of `address`; the next
 * transaction reads its sequence number from the chain.
 */
export function resetSequenceNumberInternal(args: { address: AccountAddressInput }, config: NetworkConfig): void {
    sequenceNumberTrackerOf(config).reset(standardizeAddress(args.address));
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
 * Whether `error` is the node's refusal of a submission whose sequence number is beyond the numbers the node queues
 * for the account: a `SupraAccountQueueFullError`, or a status 400 with one of the messages the nodes give for it. A
 * refusal of a number below the account's is not.
 */
export function isAccountQueueFullRefusal(error: unknown): error is SupraAPIError {
    if (error instanceof SupraAccountQueueFullError) {
        return true;
    }
    if (!(error instanceof SupraAPIError) || error.status !== 400 || error.major_status !== undefined) {
        return false;
    }
    if (QUEUE_FULL_MESSAGE.test(error.message)) {
        return true;
    }
    const expected = EXPECTED_SEQUENCE_NUMBER_MESSAGE.exec(error.message);
    return expected !== null && BigInt(expected[1] as string) > BigInt(expected[2] as string);
}

/**
 * Whether the error reports a sequence number that does not match the account's, from the node's refusal of a
 * submission, a simulation or a discarded transaction. That is a Move VM status of `SEQUENCE_NUMBER_TOO_OLD` or
 * `SEQUENCE_NUMBER_TOO_NEW`, or a status 400 whose message names the sequence number: the nodes refuse a number below
 * the account's next number, or a number that already has a pending transaction, with a message of that form and no VM
 * status. A refusal because the account's queue on the node is full (`isAccountQueueFullRefusal`) is not a stale number.
 */
export function isStaleSequenceNumberError(error: unknown): boolean {
    if (isAccountQueueFullRefusal(error)) {
        return false;
    }
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
 * node reports a stale number. By then the first run has released the account's lock and asked for a read of the chain
 * before the next number, so the second run takes the lock again and builds the transaction with the lowest number
 * that has no record. A call that passes `sequenceNumber` is run once.
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

/**
 * The reservation of a payload built with a number from the client's counter, and the function that builds and signs
 * the same transaction with another number.
 */
export interface ReservationBinding {
    readonly reservation: SequenceNumberReservation;
    readonly resign: (sequenceNumber: bigint) => Promise<SendTxnPayload>;
}

const bindings = new WeakMap<SendTxnPayload, ReservationBinding>();

/**
 * Marks `payload`, built with the number of `reservation`, so that its submission settles the reservation. `resign`
 * builds and signs the same transaction with another number, for the simulation before submission
 * (`enableTransactionSimulation`) when it gives the transaction a lower number.
 */
export function bindReservation(
    payload: SendTxnPayload,
    reservation: SequenceNumberReservation,
    resign: (sequenceNumber: bigint) => Promise<SendTxnPayload>,
): void {
    bindings.set(payload, { reservation, resign });
}

/**
 * The reservation of a submission, when its payload was built with a number from the client's counter. A payload
 * built with an explicit number has none.
 */
export function reservationOf(payload: SendTxnPayload): ReservationBinding | undefined {
    return bindings.get(payload);
}
