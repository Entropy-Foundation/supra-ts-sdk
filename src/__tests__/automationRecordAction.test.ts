import { expectTypeOf } from "expect-type";
import type { AutomationRecordAction, AutomationRecordData } from "../types/transaction";

type RemoveAction = Extract<AutomationRecordAction, { Remove: unknown }>["Remove"];

/**
 * Automation record data as `supra_node_v12.0.0.rc7` renders it, one record per removal kind, and a `Process` record
 * as every node renders it.
 */
const records = JSON.parse(`[
    { "record_index": 0, "cycle_index": 4, "block_height": 100, "action": { "Process": [1, 2, 3] } },
    { "record_index": 1, "cycle_index": 4, "block_height": 100, "action": { "Remove": {
        "task_index": 7, "kind": "Error", "reason": "predicate returned false" } } },
    { "record_index": 2, "cycle_index": 4, "block_height": 101, "action": { "Remove": {
        "task_index": 12, "kind": "ConfigUpdate",
        "reason": "max gas amount 2000000 is above the per-transaction gas cap 1500000" } } },
    { "record_index": 3, "cycle_index": 4, "block_height": 102, "action": { "Remove": {
        "task_index": 15, "kind": "PreExecutionLimit",
        "reason": "Automated task failed a pre-execution limit: EXCEEDED_MAX_TRANSACTION_SIZE" } } }
]`) as AutomationRecordData[];

describe("AutomationRecordAction removal kind", () => {
    it("is the set of kinds supra_node_v12.0.0.rc7 sends", () => {
        expectTypeOf<RemoveAction["kind"]>().toEqualTypeOf<"Error" | "ConfigUpdate" | "PreExecutionLimit">();
    });

    it("reads one rc7 record of each kind", () => {
        const kinds = records.flatMap(({ action }) => ("Remove" in action ? [action.Remove.kind] : []));
        expect(kinds).toEqual(["Error", "ConfigUpdate", "PreExecutionLimit"]);
    });

    it("reads a Process record beside the removal records", () => {
        const first = records[0];
        expect(first && "Process" in first.action ? first.action.Process : undefined).toEqual([1, 2, 3]);
    });
});
