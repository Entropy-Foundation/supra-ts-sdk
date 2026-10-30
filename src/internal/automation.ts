import { BCS, type SupraAccount } from "supra-l1-sdk-core";
import type { OptionalTransactionArgs, SubmitTransactionResponse } from "../types/transactionManager/transactionSubmit";
import type { NetworkConfig } from "../utils/apiEndpoints";
import { SUPRA_FRAMEWORK_ADDRESS } from "../utils/constants";
import { buildAndSubmitEntryFunctionInternal } from "./transactionManager/txnSubmit";

const MAX_U64 = 18_446_744_073_709_551_615n;

/** `value` as a `bigint` when it is an integer from 0 to 2^64 - 1; throws a `RangeError` naming `name` otherwise. */
function taskIndexOf(value: bigint | number, name: string): bigint {
    const valid =
        (typeof value === "bigint" && value >= 0n && value <= MAX_U64) ||
        (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
    if (!valid) {
        throw new RangeError(`${name} must be an integer from 0 to 2^64 - 1, got ${String(value)}`);
    }
    return BigInt(value);
}

/** Submits `0x1::automation_registry::cancel_task(task_index)` from `senderAccount`. */
export async function cancelAutomationTaskInternal(
    args: {
        senderAccount: SupraAccount;
        taskIndex: bigint | number;
        optionalTransactionArgs?: OptionalTransactionArgs | undefined;
    },
    config: NetworkConfig,
): Promise<SubmitTransactionResponse> {
    const taskIndex = taskIndexOf(args.taskIndex, "taskIndex");
    return await buildAndSubmitEntryFunctionInternal(
        {
            senderAccount: args.senderAccount,
            payload: {
                function: `${SUPRA_FRAMEWORK_ADDRESS}::automation_registry::cancel_task`,
                functionTypeArgs: [],
                functionArgs: [BCS.bcsSerializeUint64(taskIndex)],
            },
            optionalTransactionArgs: args.optionalTransactionArgs,
        },
        config,
    );
}

/** Submits `0x1::automation_registry::stop_tasks(task_indexes)` from `senderAccount`. */
export async function stopAutomationTasksInternal(
    args: {
        senderAccount: SupraAccount;
        taskIndexes: Array<bigint | number>;
        optionalTransactionArgs?: OptionalTransactionArgs | undefined;
    },
    config: NetworkConfig,
): Promise<SubmitTransactionResponse> {
    if (!Array.isArray(args.taskIndexes) || args.taskIndexes.length === 0) {
        throw new RangeError("taskIndexes must name at least one task");
    }
    const taskIndexes = args.taskIndexes.map((taskIndex, at) => taskIndexOf(taskIndex, `taskIndexes[${at}]`));
    const serializer = new BCS.Serializer();
    serializer.serializeU32AsUleb128(taskIndexes.length);
    taskIndexes.forEach((taskIndex) => serializer.serializeU64(taskIndex));
    return await buildAndSubmitEntryFunctionInternal(
        {
            senderAccount: args.senderAccount,
            payload: {
                function: `${SUPRA_FRAMEWORK_ADDRESS}::automation_registry::stop_tasks`,
                functionTypeArgs: [],
                functionArgs: [serializer.getBytes()],
            },
            optionalTransactionArgs: args.optionalTransactionArgs,
        },
        config,
    );
}
