import type { TransactionResponse, TransactionStatus } from "../types/transaction";
import type { SupraAPIError } from "./apiError";
import { SupraError } from "./supraError";
import { parseVmStatus } from "./vmStatus";

/**
 * SupraTransactionFailedError is thrown when a transaction that the SDK waited for is final with a status other than
 * `Success`:
 *
 * - `Fail`: the transaction was executed and failed (for example a Move abort or `Out of gas`). The sender's sequence
 *   number was incremented and the gas was charged.
 * - `Invalid`: the transaction was discarded and will be discarded on every execution. The sender's sequence number
 *   was not incremented.
 *
 * It is thrown by the submit helpers when `enableWaitForTransaction` is true, and by `waitForTransaction`, unless
 * `checkSuccess` is false. The transaction as the node returned it is available as `transaction`.
 * @group Errors
 */
export class SupraTransactionFailedError extends SupraError {
    /** The hash of the transaction. */
    readonly hash: string;
    /** The status of the transaction: `Fail` or `Invalid`. */
    readonly status: TransactionStatus;
    /** The `vm_status` of the transaction's Move output, or `undefined` when the transaction has no Move output. */
    readonly vm_status: string | undefined;
    /** The name of the Move VM status that `vm_status` reports (for example `ABORTED` or `OUT_OF_GAS`). */
    readonly major_status: string | undefined;
    /** The sub status of the Move VM status: the abort code of an `ABORTED` status. */
    readonly sub_status: number | undefined;
    /** The transaction as the node returned it. */
    readonly transaction: TransactionResponse;

    constructor(transaction: TransactionResponse) {
        const vmStatus = vmStatusOf(transaction);
        super(
            `Transaction ${transaction.hash} failed with status ${transaction.status}` +
                (vmStatus !== undefined ? `: ${vmStatus}` : ""),
        );
        this.name = "SupraTransactionFailedError";
        this.hash = transaction.hash;
        this.status = transaction.status;
        this.vm_status = vmStatus;
        const parsed = parseVmStatus(vmStatus);
        this.major_status = parsed.majorStatus;
        this.sub_status = parsed.subStatus;
        this.transaction = transaction;
    }

    toJSON() {
        return {
            name: this.name,
            message: this.message,
            hash: this.hash,
            status: this.status,
            vm_status: this.vm_status,
            major_status: this.major_status,
            sub_status: this.sub_status,
        };
    }
}

/**
 * SupraSimulationFailedError is thrown when a simulation returns a status other than `Success`. The simulated
 * transaction would not succeed against the state the node simulated it on:
 *
 * - `Fail`: it would be executed and fail (for example a Move abort or `Out of gas`).
 * - `PendingAfterExecution`: it failed validation with a status that can change with the chain's state, for example
 *   `SENDING_ACCOUNT_DOES_NOT_EXIST` or `SEQUENCE_NUMBER_TOO_NEW`. `gas_used` is 0.
 * - `Invalid`: it would be discarded.
 *
 * The node answers a simulation with HTTP 200 whatever its status, so this error derives from {@link SupraError}, not
 * from {@link SupraAPIError}. The simulated transaction is available as `transaction`. A simulation refused for a gas
 * unit price below the node's minimum throws `SupraGasUnitPriceBelowMinimumError` instead.
 * @group Errors
 */
export class SupraSimulationFailedError extends SupraError {
    /** The status of the simulated transaction. */
    readonly status: TransactionStatus;
    /** The `vm_status` of the simulated transaction's Move output, or `undefined` when it has no Move output. */
    readonly vm_status: string | undefined;
    /** The name of the Move VM status that `vm_status` reports (for example `SENDING_ACCOUNT_DOES_NOT_EXIST`). */
    readonly major_status: string | undefined;
    /** The sub status of the Move VM status: the abort code of an `ABORTED` status. */
    readonly sub_status: number | undefined;
    /** The simulated transaction as the node returned it, with its output. */
    readonly transaction: TransactionResponse;

    constructor(transaction: TransactionResponse) {
        const vmStatus = vmStatusOf(transaction);
        super(`Simulation returned status ${transaction.status}` + (vmStatus !== undefined ? `: ${vmStatus}` : ""));
        this.name = "SupraSimulationFailedError";
        this.status = transaction.status;
        this.vm_status = vmStatus;
        const parsed = parseVmStatus(vmStatus);
        this.major_status = parsed.majorStatus;
        this.sub_status = parsed.subStatus;
        this.transaction = transaction;
    }

    toJSON() {
        return {
            name: this.name,
            message: this.message,
            status: this.status,
            vm_status: this.vm_status,
            major_status: this.major_status,
            sub_status: this.sub_status,
        };
    }
}

/**
 * SupraGasUnitPriceBelowMinimumError is thrown when the node refuses a transaction because its gas unit price is below
 * the node's minimum (`GAS_UNIT_PRICE_BELOW_MIN_BOUND`), in a submission or in a simulation (the max gas estimate, the
 * simulation before a submission, or `simulate` of a built transaction). The price of the refused transaction can be
 * the call's, the client's `gasUnitPrice`, the node's estimate (when the node's minimum rose after the estimate was
 * read) or the price of a transaction built by hand. The SDK does not send the transaction again and does not raise the
 * price. The helpers that take the sequence number from the client's counter hand the number out again.
 *
 * The original error is available as `cause`: the {@link SupraAPIError} of the submission or the
 * {@link SupraSimulationFailedError} of the simulation. This error is neither of them, so `instanceof` checks for those
 * classes do not match it. `message` is the original error's message.
 *
 * `gasUnitPrice` is the price the transaction carried, in quants. `minimumGasUnitPrice` is the node's minimum
 * (`getMinGasUnitPrice()`), read after the refusal, or `undefined` when that read failed.
 * @group Errors
 */
export class SupraGasUnitPriceBelowMinimumError extends SupraError {
    /** The name of the Move VM status of the refusal: `GAS_UNIT_PRICE_BELOW_MIN_BOUND`. */
    readonly major_status = "GAS_UNIT_PRICE_BELOW_MIN_BOUND";
    /** The gas unit price of the refused transaction, in quants. */
    readonly gasUnitPrice: bigint;
    /** The node's minimum gas unit price in quants, or `undefined` when reading it failed. */
    readonly minimumGasUnitPrice: bigint | undefined;

    constructor(args: {
        cause: SupraAPIError | SupraSimulationFailedError;
        gasUnitPrice: bigint;
        minimumGasUnitPrice?: bigint | undefined;
    }) {
        super(args.cause.message, { cause: args.cause });
        this.name = "SupraGasUnitPriceBelowMinimumError";
        this.gasUnitPrice = args.gasUnitPrice;
        this.minimumGasUnitPrice = args.minimumGasUnitPrice;
    }

    toJSON() {
        return {
            name: this.name,
            message: this.message,
            major_status: this.major_status,
            gasUnitPrice: this.gasUnitPrice.toString(),
            minimumGasUnitPrice: this.minimumGasUnitPrice?.toString(),
        };
    }
}

/**
 * SupraTransactionTimeoutError is thrown when a transaction that the SDK waits for has no final status
 * (`Success`, `Fail` or `Invalid`) when the wait timeout elapses. The transaction may still be committed later; read
 * its state with `getTransactionByHash` or `waitForTransaction` using `hash`.
 *
 * `lastStatus` is the status of the last successful read: `Pending` or `PendingAfterExecution`, or `undefined` when
 * the node never returned the transaction. When the last read failed, its error is available as `cause`.
 * @group Errors
 */
export class SupraTransactionTimeoutError extends SupraError {
    /** The hash of the transaction. */
    readonly hash: string;
    /** The wait timeout that elapsed, in milliseconds. */
    readonly timeoutMs: number;
    /** The status of the last successful read, or `undefined` when the node never returned the transaction. */
    readonly lastStatus: TransactionStatus | undefined;
    /** The transaction as the last successful read returned it, or `undefined`. */
    readonly transaction: TransactionResponse | undefined;

    constructor(args: {
        hash: string;
        timeoutMs: number;
        transaction?: TransactionResponse | undefined;
        cause?: unknown;
    }) {
        const lastStatus = args.transaction?.status;
        super(
            `Transaction ${args.hash} has no final status after ${args.timeoutMs} ms` +
                (lastStatus !== undefined ? ` (last status ${lastStatus})` : " (not returned by the node)"),
            args.cause === undefined ? undefined : { cause: args.cause },
        );
        this.name = "SupraTransactionTimeoutError";
        this.hash = args.hash;
        this.timeoutMs = args.timeoutMs;
        this.lastStatus = lastStatus;
        this.transaction = args.transaction;
    }

    toJSON() {
        return {
            name: this.name,
            message: this.message,
            hash: this.hash,
            timeoutMs: this.timeoutMs,
            lastStatus: this.lastStatus,
        };
    }
}

/**
 * SupraSubmissionOutcomeUnknownError is thrown by a submit helper when the request that submits the transaction fails
 * in a way that leaves it open whether the node accepted the transaction: the request times out, the connection fails
 * before the node answers, or the node answers with a 5xx status other than 503. The error of the request (a
 * `SupraTimeoutError`, `SupraNetworkError` or `SupraAPIError`) is `cause`.
 *
 * Look `hash` up with `getTransactionByHash`, or wait for it with `waitForTransaction`, before sending the transaction
 * again: a transaction the node accepted can commit until the chain's time reaches `expirationTimestampSecs`. The SDK
 * derives `hash` from the signed transaction before it submits it; it is the hash the node gives the transaction.
 *
 * With `enableWaitForTransaction`, the submit helper waits for `hash` within the wait timeout before it throws: a
 * transaction that reaches a final status is returned (or throws `SupraTransactionFailedError`) as after an accepted
 * submission, and this error is thrown when the wait ends without a final status, with the wait's
 * `SupraTransactionTimeoutError` as `waitError`.
 * @group Errors
 */
export class SupraSubmissionOutcomeUnknownError extends SupraError {
    /** The hash of the transaction, derived from the signed transaction. */
    readonly hash: string;
    /** The sender's address, as the transaction carries it. */
    readonly sender: string;
    /** The sequence number of the transaction. */
    readonly sequenceNumber: bigint;
    /** The expiration time of the transaction, in seconds since the Unix epoch. */
    readonly expirationTimestampSecs: bigint;
    /** The error of the wait for `hash`, or `undefined` when the SDK did not wait. */
    readonly waitError: SupraTransactionTimeoutError | undefined;

    constructor(args: {
        hash: string;
        sender: string;
        sequenceNumber: bigint;
        expirationTimestampSecs: bigint;
        cause: unknown;
        waitError?: SupraTransactionTimeoutError | undefined;
    }) {
        const wait = args.waitError;
        const reason = args.cause instanceof Error ? ` (${args.cause.message})` : "";
        const waited =
            wait === undefined
                ? ""
                : ` It has no final status after a wait of ${wait.timeoutMs} ms` +
                  (wait.lastStatus !== undefined
                      ? ` (last status ${wait.lastStatus}).`
                      : " (not returned by the node).");
        super(
            `The submission of transaction ${args.hash} (sender ${args.sender}, sequence number ` +
                `${args.sequenceNumber}) failed${reason}, and the node may have accepted it.` +
                waited +
                ` Look the hash up or wait for it before resending; the transaction can commit until its expiration ` +
                `time ${args.expirationTimestampSecs}.`,
            { cause: args.cause },
        );
        this.name = "SupraSubmissionOutcomeUnknownError";
        this.hash = args.hash;
        this.sender = args.sender;
        this.sequenceNumber = args.sequenceNumber;
        this.expirationTimestampSecs = args.expirationTimestampSecs;
        this.waitError = wait;
    }

    toJSON() {
        return {
            name: this.name,
            message: this.message,
            hash: this.hash,
            sender: this.sender,
            sequenceNumber: this.sequenceNumber.toString(),
            expirationTimestampSecs: this.expirationTimestampSecs.toString(),
        };
    }
}

/** The `vm_status` of a transaction's Move output, or `undefined` when it has none. */
function vmStatusOf(transaction: TransactionResponse): string | undefined {
    const output = (transaction as { output?: unknown }).output;
    if (output !== null && typeof output === "object" && "Move" in output) {
        const vmStatus = (output as { Move?: { vm_status?: unknown } }).Move?.vm_status;
        return typeof vmStatus === "string" ? vmStatus : undefined;
    }
    return undefined;
}
