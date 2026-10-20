import type { TransactionResponse, TransactionStatus } from "../types/transaction";
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
 * from {@link SupraAPIError}. The simulated transaction is available as `transaction`.
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

/** The `vm_status` of a transaction's Move output, or `undefined` when it has none. */
function vmStatusOf(transaction: TransactionResponse): string | undefined {
    const output = (transaction as { output?: unknown }).output;
    if (output !== null && typeof output === "object" && "Move" in output) {
        const vmStatus = (output as { Move?: { vm_status?: unknown } }).Move?.vm_status;
        return typeof vmStatus === "string" ? vmStatus : undefined;
    }
    return undefined;
}
