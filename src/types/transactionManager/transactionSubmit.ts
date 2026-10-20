import type { TransactionResponse } from "../transaction";
import type { OptionalTransactionPayloadArgs } from "./transactionBuild";

/**
 * Options of a submission.
 *
 * - `enableTransactionSimulation`: simulate the transaction before it is submitted. A simulation with a status other
 *   than `Success` throws `SupraSimulationFailedError` and the transaction is not submitted. When the transaction's
 *   number is ahead of the chain's behind transactions that this client submitted, the simulation is made with the
 *   sender's sequence number on the chain and the transaction is submitted with its own, as for the max gas estimate
 *   (see `OptionalTransactionPayloadArgs`); a failed read of the account during that check is thrown. Default false.
 * - `enableWaitForTransaction`: wait until the transaction has a final status. A final status other than `Success`
 *   throws `SupraTransactionFailedError`, unless `checkSuccess` is false; no final status within `waitTimeoutMs`
 *   throws `SupraTransactionTimeoutError`. When the submission request got no answer, the wait is for the hash derived
 *   before the submission, and no final status within `waitTimeoutMs` throws `SupraSubmissionOutcomeUnknownError`.
 *   Default false.
 * - `checkSuccess`: with `enableWaitForTransaction`, throw `SupraTransactionFailedError` for a final status other
 *   than `Success`. When false, the transaction is returned whatever its final status. Default true.
 * - `waitTimeoutMs`: with `enableWaitForTransaction`, the longest time to wait for a final status, in milliseconds.
 *   Default `waitTimeoutMs` of `SupraConfig`, else `DEFAULT_TXN_WAIT_TIMEOUT_MS` (60000).
 */
export interface EnableTransactionWaitAndSimulationArgs {
    enableWaitForTransaction?: boolean;
    enableTransactionSimulation?: boolean;
    checkSuccess?: boolean;
    waitTimeoutMs?: number;
}

export interface OptionalTransactionArgs {
    optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs;
    enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs;
}

/**
 * The result of a submission without `enableWaitForTransaction` when the node accepted the transaction but the
 * request that reads it back failed. The transaction may be pending, executed or committed; read its state with
 * `getTransactionByHash` or `waitForTransaction` using `hash`.
 */
export interface NotReadBackTransactionResponse {
    /** The hash the node returned for the accepted transaction. */
    hash: string;
    /** Marks a transaction the node accepted and the SDK could not read back. */
    status: "NotReadBack";
    /** The error of the request that read the transaction back. */
    readError: unknown;
}

/**
 * The result of a submission.
 *
 * - With `enableWaitForTransaction`: the transaction with its final status, `Success` unless `checkSuccess` is false.
 * - Without it: the transaction as the node returned it right after the submission (usually `Pending`), or a
 *   {@link NotReadBackTransactionResponse} carrying the hash when that read failed.
 */
export type SubmitTransactionResponse = TransactionResponse | NotReadBackTransactionResponse;
