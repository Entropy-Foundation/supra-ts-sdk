import type { SupraAccount } from "supra-l1-sdk-core";
import type { NetworkConfig } from "../utils/apiEndpoints";
import type { OptionalTransactionArgs, SubmitTransactionResponse } from "../types/transactionManager/transactionSubmit";
import { cancelAutomationTaskInternal, stopAutomationTasksInternal } from "../internal/automation";
import { retryWithFreshSequenceNumber } from "../internal/sequenceNumber";

/**
 * The Automation class provides methods for managing the automation tasks of an account on the Supra network. A task
 * is registered with an automation registration transaction (`transaction.build.automationRegistrationRawTxnObject`).
 * @group Automation
 */
export class Automation {
    /**
     * The networkInformation property is A NetworkConfig object that contains information about the network on which the Supra client is running.
     */
    protected readonly networkInformation: NetworkConfig;

    /**
     * The constructor function takes a NetworkConfig object as a parameter and assigns it to the networkInformation property.
     * @param networkInformation - A NetworkConfig object that contains information about the network on which the Supra client is running.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     * ```
     * @group Automation
     */
    constructor(networkInformation: NetworkConfig) {
        this.networkInformation = networkInformation;
    }

    /**
     * Cancels a user automation task of the sender with `0x1::automation_registry::cancel_task`. A task that has not
     * run yet is removed and half of its deposit is refunded. An active task is marked cancelled: it runs until the end
     * of the current automation cycle, and its deposit is refunded then. The transaction aborts when the task does not
     * exist, is not the sender's, is a system task or is already cancelled, and while the registry moves to the next
     * cycle.
     *
     * The sequence number comes from the client's counter unless `optionalTransactionPayloadArgs.sequenceNumber` is
     * set, and the client submits its calls from one account one after another. The client checks the chain ID of its
     * node before it signs; see {@link SupraConfig}.
     * @param args.senderAccount - The owner of the task.
     * @param args.taskIndex - The index of the task in the automation registry, a `u64`: the `task_index` of the
     * `0x1::automation_registry::AutomationTaskMetaData` event of its registration.
     * @param args.optionalTransactionArgs - Optional transaction arguments. The gas settings in
     * `optionalTransactionPayloadArgs` apply to the transaction; without `maxGas` it is estimated
     * (see {@link OptionalTransactionPayloadArgs}). The object is not modified.
     * @returns A Promise that resolves to a `SubmitTransactionResponse`. {@link Submit} describes the statuses and
     * errors of a submission.
     * @throws {RangeError} Before any request, when `taskIndex` is not an integer from 0 to 2^64 - 1 (a `number` must
     * be a safe integer).
     * @throws {SupraSimulationFailedError} When the estimating simulation or an enabled simulation does not succeed.
     * @throws {SupraGasUnitPriceBelowMinimumError} When the node refuses the submission or a simulation because the gas
     * unit price is below its minimum (this replaces `SupraSimulationFailedError` and `SupraAPIError` for that refusal).
     * @throws {SupraTransactionFailedError} When `enableWaitForTransaction` is set and the transaction fails.
     * @throws {SupraSubmissionOutcomeUnknownError} When the submission request times out, fails before the node
     * answers or is answered with a 5xx status other than 503 (after the wait, with `enableWaitForTransaction`).
     * @throws {SupraChainIdMismatchError} Before signing, when the chain ID is not the node's.
     * @example
     * ```typescript
     * import { Network, SupraAccount, SupraClient } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     * const owner = new SupraAccount(); // the account that registered the task
     *
     * async function runExample() {
     *    const response = await supra.automation.cancelAutomationTask({
     *        senderAccount: owner,
     *        taskIndex: 42n,
     *        optionalTransactionArgs: { enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true } },
     *    });
     *    console.log(response.hash, response.status);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Automation
     */
    async cancelAutomationTask(args: {
        senderAccount: SupraAccount;
        taskIndex: bigint | number;
        optionalTransactionArgs?: OptionalTransactionArgs;
    }): Promise<SubmitTransactionResponse> {
        return retryWithFreshSequenceNumber(
            args.optionalTransactionArgs?.optionalTransactionPayloadArgs?.sequenceNumber,
            () => cancelAutomationTaskInternal(args, this.networkInformation),
        );
    }

    /**
     * Stops user automation tasks of the sender at once with `0x1::automation_registry::stop_tasks`. Each task is
     * removed from the registry; its deposit is refunded (half of it for a task that has not run yet) together with half
     * of its fee for the rest of the current automation cycle. Indexes of tasks that do not exist are skipped. The
     * transaction aborts when a task is not the sender's or is a system task, and while the registry moves to the next
     * cycle.
     *
     * The sequence number comes from the client's counter unless `optionalTransactionPayloadArgs.sequenceNumber` is
     * set, and the client submits its calls from one account one after another. The client checks the chain ID of its
     * node before it signs; see {@link SupraConfig}.
     * @param args.senderAccount - The owner of the tasks.
     * @param args.taskIndexes - The indexes of the tasks in the automation registry, each a `u64`: the `task_index` of
     * the `0x1::automation_registry::AutomationTaskMetaData` event of the task's registration. At least one.
     * @param args.optionalTransactionArgs - Optional transaction arguments. The gas settings in
     * `optionalTransactionPayloadArgs` apply to the transaction; without `maxGas` it is estimated
     * (see {@link OptionalTransactionPayloadArgs}). The object is not modified.
     * @returns A Promise that resolves to a `SubmitTransactionResponse`. {@link Submit} describes the statuses and
     * errors of a submission.
     * @throws {RangeError} Before any request, when `taskIndexes` is empty or one of its elements is not an integer
     * from 0 to 2^64 - 1 (a `number` must be a safe integer).
     * @throws {SupraSimulationFailedError} When the estimating simulation or an enabled simulation does not succeed.
     * @throws {SupraGasUnitPriceBelowMinimumError} When the node refuses the submission or a simulation because the gas
     * unit price is below its minimum (this replaces `SupraSimulationFailedError` and `SupraAPIError` for that refusal).
     * @throws {SupraTransactionFailedError} When `enableWaitForTransaction` is set and the transaction fails.
     * @throws {SupraSubmissionOutcomeUnknownError} When the submission request times out, fails before the node
     * answers or is answered with a 5xx status other than 503 (after the wait, with `enableWaitForTransaction`).
     * @throws {SupraChainIdMismatchError} Before signing, when the chain ID is not the node's.
     * @example
     * ```typescript
     * import { Network, SupraAccount, SupraClient } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     * const owner = new SupraAccount(); // the account that registered the tasks
     *
     * async function runExample() {
     *    const response = await supra.automation.stopAutomationTasks({
     *        senderAccount: owner,
     *        taskIndexes: [42n, 43n],
     *        optionalTransactionArgs: { enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true } },
     *    });
     *    console.log(response.hash, response.status);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Automation
     */
    async stopAutomationTasks(args: {
        senderAccount: SupraAccount;
        taskIndexes: Array<bigint | number>;
        optionalTransactionArgs?: OptionalTransactionArgs;
    }): Promise<SubmitTransactionResponse> {
        return retryWithFreshSequenceNumber(
            args.optionalTransactionArgs?.optionalTransactionPayloadArgs?.sequenceNumber,
            () => stopAutomationTasksInternal(args, this.networkInformation),
        );
    }
}
