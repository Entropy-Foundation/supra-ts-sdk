import { BCS, SupraAccount } from "supra-l1-sdk-core";
import { SupraClient } from "../../api/supraClient";
import type { OptionalTransactionArgs } from "../../types/transactionManager/transactionSubmit";
import { SUPRA_FRAMEWORK_ADDRESS } from "../../utils/constants";

jest.mock("../transactionManager/txnSubmit", () => ({
    buildAndSubmitEntryFunctionInternal: jest.fn().mockResolvedValue({ hash: "0x1", status: "Success" }),
}));

import { buildAndSubmitEntryFunctionInternal } from "../transactionManager/txnSubmit";
const mockSubmit = buildAndSubmitEntryFunctionInternal as jest.MockedFunction<
    typeof buildAndSubmitEntryFunctionInternal
>;

const supra = new SupraClient({ rpcUrl: "http://localhost:1", chainId: 255 });
const owner = new SupraAccount();

function hex(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString("hex");
}

function lastCall() {
    const call = mockSubmit.mock.calls.at(-1);
    if (call === undefined) {
        throw new Error("No submission");
    }
    return call;
}

beforeEach(() => mockSubmit.mockClear());

describe("cancelAutomationTask", () => {
    test.each<[string, bigint | number]>([
        ["a bigint", 42n],
        ["a number", 42],
    ])("submits 0x1::automation_registry::cancel_task with the task index as %s", async (_name, taskIndex) => {
        const optionalTransactionArgs: OptionalTransactionArgs = {
            optionalTransactionPayloadArgs: { maxGas: 5_000n },
            enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true },
        };
        await expect(
            supra.automation.cancelAutomationTask({ senderAccount: owner, taskIndex, optionalTransactionArgs }),
        ).resolves.toEqual({ hash: "0x1", status: "Success" });

        const [args, config] = lastCall();
        expect(args.senderAccount).toBe(owner);
        expect(args.payload.function).toBe(`${SUPRA_FRAMEWORK_ADDRESS}::automation_registry::cancel_task`);
        expect(args.payload.functionTypeArgs).toEqual([]);
        expect(args.payload.functionArgs.map(hex)).toEqual([hex(BCS.bcsSerializeUint64(42n))]);
        expect(args.optionalTransactionArgs).toBe(optionalTransactionArgs);
        expect(config).toBe(supra.networkInformation);
    });

    test("is mixed into the client", async () => {
        await supra.cancelAutomationTask({ senderAccount: owner, taskIndex: 2n ** 64n - 1n });
        expect(lastCall()[0].payload.functionArgs.map(hex)).toEqual(["ff".repeat(8)]);
    });

    test.each<[string, unknown]>([
        ["a negative index", -1n],
        ["an index above 2^64 - 1", 2n ** 64n],
        ["a fractional number", 1.5],
        ["a number above 2^53 - 1", 2 ** 53],
        ["a string", "1"],
    ])("throws a RangeError for %s and submits nothing", async (_name, taskIndex) => {
        await expect(
            supra.automation.cancelAutomationTask({ senderAccount: owner, taskIndex: taskIndex as bigint }),
        ).rejects.toThrow(RangeError);
        expect(mockSubmit).not.toHaveBeenCalled();
    });
});

describe("stopAutomationTasks", () => {
    test("submits 0x1::automation_registry::stop_tasks with the task indexes as a vector<u64>", async () => {
        const optionalTransactionArgs: OptionalTransactionArgs = {
            optionalTransactionPayloadArgs: { sequenceNumber: 9n },
        };
        await supra.automation.stopAutomationTasks({
            senderAccount: owner,
            taskIndexes: [1n, 2, 2n ** 64n - 1n],
            optionalTransactionArgs,
        });

        const [args, config] = lastCall();
        expect(args.senderAccount).toBe(owner);
        expect(args.payload.function).toBe(`${SUPRA_FRAMEWORK_ADDRESS}::automation_registry::stop_tasks`);
        expect(args.payload.functionTypeArgs).toEqual([]);
        expect(args.payload.functionArgs.map(hex)).toEqual([
            "03" + hex(BCS.bcsSerializeUint64(1n)) + hex(BCS.bcsSerializeUint64(2n)) + "ff".repeat(8),
        ]);
        expect(args.optionalTransactionArgs).toBe(optionalTransactionArgs);
        expect(config).toBe(supra.networkInformation);
    });

    test("is mixed into the client", async () => {
        await supra.stopAutomationTasks({ senderAccount: owner, taskIndexes: [7n] });
        expect(lastCall()[0].payload.functionArgs.map(hex)).toEqual(["01" + hex(BCS.bcsSerializeUint64(7n))]);
    });

    test.each<[string, unknown]>([
        ["no task index", []],
        ["a negative task index", [1n, -1n]],
        ["a task index above 2^64 - 1", [2n ** 64n]],
        ["a list that is not an array", 1n],
    ])("throws a RangeError for %s and submits nothing", async (_name, taskIndexes) => {
        await expect(
            supra.automation.stopAutomationTasks({
                senderAccount: owner,
                taskIndexes: taskIndexes as Array<bigint>,
            }),
        ).rejects.toThrow(RangeError);
        expect(mockSubmit).not.toHaveBeenCalled();
    });
});
