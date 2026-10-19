/**
 * The Move VM status that a node message or a transaction `vm_status` reports.
 * `majorStatus` is the name of a Move VM `StatusCode` (see {@link MoveVmError}); `subStatus` is the status's sub
 * status, which for an abort is the abort code.
 */
export interface ParsedVmStatus {
    majorStatus?: string;
    subStatus?: number;
}

const STATUS_NAME = "[A-Z][A-Z0-9_]+";

/**
 * Parses the Move VM status out of a message the node produced. The formats are:
 *
 * - View and VM errors: `Failed to execute view function: LINKER_ERROR at location ...`,
 *   `Failed to execute view function: ABORTED with sub status 4001 at location ...`,
 *   `Move VM error: ABORTED`.
 * - Submit validation errors: `General err: MoveTransactionValidationFailed(<sender>, <sequence number>, SEQUENCE_NUMBER_TOO_OLD)`.
 * - `vm_status` of a discarded transaction: `Status Code: SEQUENCE_NUMBER_TOO_OLD, Type Validation`.
 * - `vm_status` of a kept transaction: `Move abort in 0x1::coin: EINSUFFICIENT_BALANCE(0x10006): ...`
 *   (status `ABORTED`, sub status `0x10006`), `Out of gas` (status `OUT_OF_GAS`), and
 *   `Execution failed in ... at code offset N, Status Code: ARITHMETIC_ERROR`.
 *
 * A message that carries none of these yields an empty result.
 */
export function parseVmStatus(message: string | undefined): ParsedVmStatus {
    if (message === undefined) {
        return {};
    }

    const vm = message.match(
        new RegExp(`(?:Failed to execute view function|Move VM error): (${STATUS_NAME})(?: with sub status (\\d+))?`),
    );
    if (vm?.[1] !== undefined) {
        return withSubStatus(vm[1], vm[2] === undefined ? undefined : Number(vm[2]));
    }

    const validation = message.match(new RegExp(`ValidationFailed\\([^)]*,\\s*(${STATUS_NAME})\\)`));
    if (validation?.[1] !== undefined) {
        return { majorStatus: validation[1] };
    }

    const validationText = message.match(new RegExp(`failed (?:validation )?with status code (${STATUS_NAME})`));
    if (validationText?.[1] !== undefined) {
        return { majorStatus: validationText[1] };
    }

    if (message.startsWith("Move abort")) {
        const code =
            message.match(/^Move abort in \S+: (?:\w+\()?(0x[0-9a-fA-F]+)/) ??
            message.match(/^Move abort: code (0x[0-9a-fA-F]+)/);
        return withSubStatus("ABORTED", code?.[1] === undefined ? undefined : Number(code[1]));
    }

    if (message.startsWith("Out of gas")) {
        return { majorStatus: "OUT_OF_GAS" };
    }

    const statusCode = message.match(new RegExp(`Status Code: (${STATUS_NAME})`));
    if (statusCode?.[1] !== undefined) {
        return { majorStatus: statusCode[1] };
    }

    if (new RegExp(`^${STATUS_NAME}$`).test(message)) {
        return { majorStatus: message };
    }

    return {};
}

function withSubStatus(majorStatus: string, subStatus: number | undefined): ParsedVmStatus {
    return subStatus === undefined || !Number.isSafeInteger(subStatus) ? { majorStatus } : { majorStatus, subStatus };
}
