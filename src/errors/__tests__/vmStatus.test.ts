import { parseVmStatus } from "../vmStatus";
import { isMoveVmError, MoveVmError } from "../moveVmErrors";

describe("parseVmStatus", () => {
    describe("view and VM errors", () => {
        it("reads the status of a failed view function", () => {
            expect(
                parseVmStatus(
                    "Failed to execute view function: LINKER_ERROR at location UNDEFINED and message Linker Error: Module 0000000000000000000000000000000000000000000000000000000000000001::nomodule doesn't exist",
                ),
            ).toEqual({ majorStatus: "LINKER_ERROR" });
        });

        it("reads the status and sub status of an aborted view function", () => {
            expect(
                parseVmStatus(
                    "Failed to execute view function: ABORTED with sub status 4001 at location Module 0x1::view_error and message 0x1::view_error::borrow_request at offset 43",
                ),
            ).toEqual({ majorStatus: "ABORTED", subStatus: 4001 });
        });

        it("reads a status that carries a sub status and an index", () => {
            expect(
                parseVmStatus(
                    "Failed to execute view function: TYPE_RESOLUTION_FAILURE with sub status 1 at location UNDEFINED and message Cannot find ModuleId in cache",
                ),
            ).toEqual({ majorStatus: "TYPE_RESOLUTION_FAILURE", subStatus: 1 });
        });

        it("reads the status of a failure raised before a location was known", () => {
            expect(parseVmStatus("Move VM error: ABORTED")).toEqual({ majorStatus: "ABORTED" });
            expect(
                parseVmStatus("Move VM error: NUMBER_OF_ARGUMENTS_MISMATCH and message expected 1 argument"),
            ).toEqual({
                majorStatus: "NUMBER_OF_ARGUMENTS_MISMATCH",
            });
        });
    });

    describe("submit validation errors", () => {
        it.each([
            ["SEQUENCE_NUMBER_TOO_OLD"],
            ["INSUFFICIENT_BALANCE_FOR_TRANSACTION_FEE"],
            ["SENDING_ACCOUNT_DOES_NOT_EXIST"],
            ["MULTISIG_TRANSACTION_PAYLOAD_DOES_NOT_MATCH"],
        ])("reads %s", (status) => {
            expect(
                parseVmStatus(
                    `General err: MoveTransactionValidationFailed(664134d630ed6cccdab54154d5aa569fafb4ce285e269e5303eaab7d6bb32a52, 0, ${status})`,
                ),
            ).toEqual({ majorStatus: status });
        });

        it("reads the displayed forms of the validation errors", () => {
            expect(
                parseVmStatus(
                    "Move transaction sent by 0x1 with sequence number 3 failed validation with status code SEQUENCE_NUMBER_TOO_NEW.",
                ),
            ).toEqual({ majorStatus: "SEQUENCE_NUMBER_TOO_NEW" });
            expect(
                parseVmStatus(
                    "Supra transaction validation from account: 0x1 failed with status code INVALID_SIGNATURE.",
                ),
            ).toEqual({ majorStatus: "INVALID_SIGNATURE" });
        });

        it("yields nothing for the validation messages that carry no status name", () => {
            expect(
                parseVmStatus(
                    "Transaction validation failed: sequence number 50 is above 25, the highest sequence number this node can queue for the account",
                ),
            ).toEqual({});
            expect(
                parseVmStatus(
                    "Transaction validation failed: The transaction 0xab sent by AccountAddress::Move(0x1) has sequence number 50 but the expected sequence number is 1.",
                ),
            ).toEqual({});
        });
    });

    describe("vm_status of a transaction", () => {
        it("reads a discarded transaction", () => {
            expect(parseVmStatus("Status Code: SEQUENCE_NUMBER_TOO_OLD, Type Validation")).toEqual({
                majorStatus: "SEQUENCE_NUMBER_TOO_OLD",
            });
            expect(
                parseVmStatus(
                    'Status Code: INVALID_SIGNATURE, Type Validation, Status Code: INVALID_SIGNATURE, Message: Some("bad")',
                ),
            ).toEqual({ majorStatus: "INVALID_SIGNATURE" });
        });

        it("reads a Move abort with the abort name, without it and in a script", () => {
            expect(
                parseVmStatus(
                    "Move abort in 0x1::coin: EINSUFFICIENT_BALANCE(0x10006): Not enough coins to complete transaction",
                ),
            ).toEqual({ majorStatus: "ABORTED", subStatus: 0x10006 });
            expect(parseVmStatus("Move abort in 0x1::automation_registry: 0x10002")).toEqual({
                majorStatus: "ABORTED",
                subStatus: 0x10002,
            });
            expect(parseVmStatus("Move abort: code 0x3")).toEqual({ majorStatus: "ABORTED", subStatus: 3 });
        });

        it("drops an abort code that is not a safe integer", () => {
            expect(parseVmStatus("Move abort in 0x1::m: 0xffffffffffffffff")).toEqual({ majorStatus: "ABORTED" });
        });

        it("reads out of gas", () => {
            expect(parseVmStatus("Out of gas")).toEqual({ majorStatus: "OUT_OF_GAS" });
        });

        it("reads the status after an execution failure", () => {
            expect(
                parseVmStatus("Execution failed in 0x1::m::f at code offset 5, Status Code: ARITHMETIC_ERROR"),
            ).toEqual({ majorStatus: "ARITHMETIC_ERROR" });
        });

        it("reads a bare status name", () => {
            expect(parseVmStatus("STORAGE_LIMIT_REACHED")).toEqual({ majorStatus: "STORAGE_LIMIT_REACHED" });
        });

        it("yields nothing where no status is named", () => {
            expect(parseVmStatus("Execution failed with miscellaneous error and no status code")).toEqual({});
            expect(parseVmStatus("Executed successfully")).toEqual({});
        });
    });

    it("yields nothing for unrelated messages", () => {
        expect(parseVmStatus(undefined)).toEqual({});
        expect(parseVmStatus("")).toEqual({});
        expect(parseVmStatus("Bad Request")).toEqual({});
        expect(parseVmStatus("Information not available for 0x1::nomod")).toEqual({});
        expect(parseVmStatus("Cannot parse Json payload Json deserialize error: unknown variant")).toEqual({});
    });
});

describe("MoveVmError", () => {
    it("lists the statuses the node emits", () => {
        for (const status of [
            "ABORTED",
            "OUT_OF_GAS",
            "LINKER_ERROR",
            "MISSING_DATA",
            "TYPE_RESOLUTION_FAILURE",
            "SEQUENCE_NUMBER_TOO_OLD",
            "SENDING_ACCOUNT_DOES_NOT_EXIST",
        ]) {
            expect(isMoveVmError(status)).toBe(true);
        }
    });

    it("no longer lists MOVE_ABORT, which is not a Move VM status", () => {
        expect(isMoveVmError("MOVE_ABORT")).toBe(false);
    });

    it("documents OUT_OF_GAS as running out of gas", () => {
        expect(MoveVmError.OUT_OF_GAS).toBe("OUT_OF_GAS");
        expect(isMoveVmError(undefined)).toBe(false);
    });
});
