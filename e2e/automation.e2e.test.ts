import { randomInt } from "node:crypto";
import type { AutomationTaskType, MoveFunctionId, SubmitTransactionResponse, SupraAccount } from "../src/index";
import {
    BCS,
    SupraSimulationFailedError,
    SupraTransactionFailedError,
    TransactionStatus,
    TransactionType,
    standardizeAddress,
} from "../src/index";
import { createFundedAccount, createUnfundedAccount } from "./helpers/accounts";
import { describeE2E } from "./helpers/describe";
import { getE2EContext, type E2EContext } from "./helpers/env";
import { rawWaitForCommit, sleep, type RawTransaction } from "./helpers/raw";

/**
 * Automation registrations with version 1 and version 2 parameters, and the cancel and stop helpers, against the node.
 * The registry refuses registrations, cancellations and stops while it moves to the next automation cycle
 * (`ECYCLE_TRANSITION_IN_PROGRESS`); localnet cycles are short, so each such call is repeated after that refusal.
 */

const SUPRA_ACCOUNT_TRANSFER = "0x1::supra_account::transfer" as MoveFunctionId;
const TASK_METADATA_EVENT = "0x1::automation_registry::AutomationTaskMetaData";

/** The node's JSON of an automation registration payload, as far as these tests read it. */
interface RegistrationPayloadJson {
    Move: {
        type: string;
        V1?: Record<string, unknown>;
        V2?: Record<string, unknown> & { task_type: string; task_priority: number | null };
    };
}

/** The data of a `0x1::automation_registry::AutomationTaskMetaData` event. */
interface TaskMetadata {
    task_index: string;
    owner: string;
    aux_data: string[];
}

/** Runs `call` again, up to 20 times, while it fails because the registry is moving to the next cycle. */
async function outsideCycleTransition<T>(call: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
        try {
            return await call();
        } catch (error) {
            const transition = error instanceof Error && error.message.includes("ECYCLE_TRANSITION_IN_PROGRESS");
            if (!transition || attempt >= 20) {
                throw error;
            }
            await sleep(2_000);
        }
    }
}

function eventsOf(txn: RawTransaction, type: string): unknown[] {
    return (txn.output?.Move?.events ?? []).filter((event) => event.type === type).map((event) => event.data);
}

function u64Hex(value: bigint): string {
    return `0x${Buffer.from(BCS.bcsSerializeUint64(value)).toString("hex")}`;
}

/** A random priority from 2^32 to 2^32 + 2^47; the node's JSON number holds it exactly. */
function freshPriority(): bigint {
    return 2n ** 32n + BigInt(randomInt(0, 2 ** 47));
}

describeE2E("automation tasks", () => {
    let ctx: E2EContext;
    let gasUnitPrice: bigint;

    beforeAll(async () => {
        ctx = await getE2EContext();
        gasUnitPrice = await ctx.supra.getEstimatedGasUnitPrice();
    });

    /**
     * Builds an automation registration of a transfer of 1000 quants with the SDK, submits it, and returns what the
     * submission returned, the hash the SDK derived before submitting it, and the node's JSON of the transaction.
     */
    async function register(
        owner: SupraAccount,
        version2: { automationTaskType?: AutomationTaskType; automationPriority?: bigint },
        options: { simulate: boolean } = { simulate: true },
    ): Promise<{ response: SubmitTransactionResponse; derived: string; committed: RawTransaction }> {
        return outsideCycleTransition(async () => {
            const info = await ctx.supra.getAccountInfo({ accountAddress: owner.address() });
            const rawTxn = ctx.supra.transaction.build.automationRegistrationRawTxnObject({
                senderAddress: owner.address(),
                senderSequenceNumber: info.sequence_number,
                function: SUPRA_ACCOUNT_TRANSFER,
                functionTypeArgs: [],
                functionArgs: [createUnfundedAccount().address().toUint8Array(), BCS.bcsSerializeUint64(1_000n)],
                automationMaxGasAmount: 500n,
                automationGasPriceCap: 2n * gasUnitPrice,
                automationFeeCapForEpoch: 1_000_000_000n,
                automationExpirationTimestampSecs: BigInt(Math.floor(Date.now() / 1000) + 60 * 60),
                automationAuxData: [],
                ...version2,
                optionalTransactionPayloadArgs: { maxGas: 20_000n, gasUnitPrice },
            });
            const derived = ctx.supra.transaction.deriveTransactionHash({
                signedTransaction: await rawTxn.signedTransaction(owner),
            });
            const response = await rawTxn.submitTransaction({
                senderAccount: owner,
                enableTransactionWaitAndSimulationArgs: {
                    enableWaitForTransaction: true,
                    enableTransactionSimulation: options.simulate,
                },
            });
            return { response, derived, committed: await rawWaitForCommit(ctx, response.hash) };
        });
    }

    function taskOf(committed: RawTransaction): TaskMetadata {
        const [task] = eventsOf(committed, TASK_METADATA_EVENT) as TaskMetadata[];
        if (task === undefined) {
            throw new Error(`Transaction ${committed.hash} emitted no ${TASK_METADATA_EVENT} event`);
        }
        return task;
    }

    /** Stops the tasks a test registered, so that they do not stay in the registry of the shared localnet. */
    async function removeTasks(owner: SupraAccount, tasks: TaskMetadata[]): Promise<void> {
        await outsideCycleTransition(() =>
            ctx.supra.automation.stopAutomationTasks({
                senderAccount: owner,
                taskIndexes: tasks.map((task) => BigInt(task.task_index)),
                optionalTransactionArgs: { enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true } },
            }),
        );
    }

    test("a version 2 registration of a user task with task_type and priority_value commits under the derived hash", async () => {
        const owner = await createFundedAccount(ctx);
        const priority = freshPriority();
        const { response, derived, committed } = await register(owner, {
            automationTaskType: "User",
            automationPriority: priority,
        });

        expect(response.status).toBe(TransactionStatus.Success);
        expect(response.hash.toLowerCase()).toBe(derived);
        expect(committed.hash.toLowerCase()).toBe(derived);
        const task = taskOf(committed);
        await removeTasks(owner, [task]);

        const payload = committed.payload as RegistrationPayloadJson;
        expect(payload.Move.type).toBe("automation_registration_payload");
        expect(payload.Move.V2?.task_type).toBe("user");
        expect(payload.Move.V2?.task_priority).toBe(Number(priority));

        // The registry stores the task type (1, a user task) and the priority in the task's auxiliary data.
        // The node renders an address without its leading zeros.
        expect(standardizeAddress(task.owner)).toBe(owner.address().toString());
        expect(task.aux_data).toEqual(["0x01", u64Hex(priority)]);

        // The SDK's response types describe the node's answer.
        const read = await ctx.supra.getTransactionByHash({ transactionHash: derived });
        if (read === null || read.txn_type !== TransactionType.User || !("Move" in read.payload)) {
            throw new Error("The registration is not a user transaction with a Move payload");
        }
        const move = read.payload.Move;
        if (move.type !== "automation_registration_payload" || move.V2 === undefined) {
            throw new Error("The registration payload is not version 2");
        }
        expect(move.V2.task_type).toBe("user");
        expect(move.V2.task_priority).toBe(Number(priority));
    });

    test("a version 2 registration without a priority gets the task's index as its priority", async () => {
        const owner = await createFundedAccount(ctx);
        const { response, derived, committed } = await register(owner, { automationTaskType: "User" });

        expect(response.status).toBe(TransactionStatus.Success);
        expect(committed.hash.toLowerCase()).toBe(derived);
        const task = taskOf(committed);
        await removeTasks(owner, [task]);
        const payload = committed.payload as RegistrationPayloadJson;
        expect(payload.Move.V2?.task_type).toBe("user");
        expect(payload.Move.V2?.task_priority).toBeNull();
        expect(task.aux_data).toEqual(["0x01", u64Hex(BigInt(task.task_index))]);
    });

    test("a registration without a task type or a priority commits with version 1 parameters", async () => {
        const owner = await createFundedAccount(ctx);
        const { response, derived, committed } = await register(owner, {});

        expect(response.status).toBe(TransactionStatus.Success);
        expect(committed.hash.toLowerCase()).toBe(derived);
        await removeTasks(owner, [taskOf(committed)]);
        const payload = committed.payload as RegistrationPayloadJson;
        expect(payload.Move.V1).toBeDefined();
        expect(payload.Move.V2).toBeUndefined();
    });

    test("a system task registration of an account without authorisation fails under the derived hash", async () => {
        const owner = await createFundedAccount(ctx);

        // The simulation reports the abort, and nothing is submitted.
        const simulated = await register(owner, { automationTaskType: "System" }).catch((error: unknown) => error);
        expect(simulated).toBeInstanceOf(SupraSimulationFailedError);
        expect((simulated as SupraSimulationFailedError).vm_status).toContain("EUNAUTHORIZED_SYSTEM_ACCOUNT");

        // Submitted without the simulation, the transaction commits with status Fail.
        const priority = freshPriority();
        const failed = await register(
            owner,
            { automationTaskType: "System", automationPriority: priority },
            {
                simulate: false,
            },
        ).catch((error: unknown) => error);
        expect(failed).toBeInstanceOf(SupraTransactionFailedError);
        const error = failed as SupraTransactionFailedError;
        expect(error.vm_status).toContain("EUNAUTHORIZED_SYSTEM_ACCOUNT");
        const committed = await rawWaitForCommit(ctx, error.hash);
        expect(committed.status).toBe("Fail");
        expect(committed.hash.toLowerCase()).toBe(error.hash.toLowerCase());
        const payload = committed.payload as RegistrationPayloadJson;
        expect(payload.Move.V2?.task_type).toBe("system");
        expect(payload.Move.V2?.task_priority).toBe(Number(priority));
    });

    test("cancelAutomationTask cancels a task of the sender", async () => {
        const owner = await createFundedAccount(ctx);
        const task = taskOf(
            (await register(owner, { automationTaskType: "User", automationPriority: freshPriority() })).committed,
        );

        const response = await outsideCycleTransition(() =>
            ctx.supra.automation.cancelAutomationTask({
                senderAccount: owner,
                taskIndex: BigInt(task.task_index),
                optionalTransactionArgs: { enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true } },
            }),
        );

        expect(response.status).toBe(TransactionStatus.Success);
        const committed = await rawWaitForCommit(ctx, response.hash);
        expect(committed.hash.toLowerCase()).toBe(response.hash.toLowerCase());
        const cancelled = eventsOf(committed, "0x1::automation_registry::TaskCancelledV2") as Array<{
            owner: string;
            task_index: string;
        }>;
        expect(cancelled.map((event) => [event.task_index, standardizeAddress(event.owner)])).toEqual([
            [task.task_index, owner.address().toString()],
        ]);
    });

    test("stopAutomationTasks stops tasks of the sender", async () => {
        const owner = await createFundedAccount(ctx);
        const first = taskOf((await register(owner, { automationTaskType: "User" })).committed);
        const second = taskOf((await register(owner, {})).committed);

        const response = await outsideCycleTransition(() =>
            ctx.supra.automation.stopAutomationTasks({
                senderAccount: owner,
                taskIndexes: [BigInt(first.task_index), Number(second.task_index)],
                optionalTransactionArgs: { enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true } },
            }),
        );

        expect(response.status).toBe(TransactionStatus.Success);
        const committed = await rawWaitForCommit(ctx, response.hash);
        expect(committed.hash.toLowerCase()).toBe(response.hash.toLowerCase());
        const [stopped] = eventsOf(committed, "0x1::automation_registry::TasksStoppedV2") as Array<{
            owner: string;
            tasks: Array<{ task_index: string }>;
        }>;
        expect(stopped === undefined ? undefined : standardizeAddress(stopped.owner)).toBe(owner.address().toString());
        expect(stopped?.tasks.map((task) => task.task_index)).toEqual([first.task_index, second.task_index]);
    });

    test("cancelAutomationTask of a task of another account fails with EUNAUTHORIZED_TASK_OWNER", async () => {
        const owner = await createFundedAccount(ctx);
        const other = await createFundedAccount(ctx);
        const task = taskOf((await register(owner, { automationTaskType: "User" })).committed);

        const error = await outsideCycleTransition(() =>
            ctx.supra.automation.cancelAutomationTask({ senderAccount: other, taskIndex: BigInt(task.task_index) }),
        ).catch((thrown: unknown) => thrown);
        await removeTasks(owner, [task]);

        expect(error).toBeInstanceOf(SupraSimulationFailedError);
        expect((error as SupraSimulationFailedError).vm_status).toContain("EUNAUTHORIZED_TASK_OWNER");
    });
});
