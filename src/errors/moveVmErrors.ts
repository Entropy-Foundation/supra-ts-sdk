/**
 * Common Move VM major status codes returned in transaction failures.
 * These codes help identify the specific type of Move VM error.
 * @see https://github.com/nicetomeetyou1/supra-l1-devnet/blob/master/aptos-move/vm-genesis/src/error_mapping.rs
 */
export enum MoveVmError {
    /** The transaction was executed successfully */
    EXECUTED = "EXECUTED",
    /** An account address was out of range */
    OUT_OF_GAS = "OUT_OF_GAS",
    /** The sequence number is too old */
    SEQUENCE_NUMBER_TOO_OLD = "SEQUENCE_NUMBER_TOO_OLD",
    /** The sequence number is too new */
    SEQUENCE_NUMBER_TOO_NEW = "SEQUENCE_NUMBER_TOO_NEW",
    /** Insufficient balance to pay the transaction fee */
    INSUFFICIENT_BALANCE_FOR_TRANSACTION_FEE = "INSUFFICIENT_BALANCE_FOR_TRANSACTION_FEE",
    /** The transaction has expired */
    TRANSACTION_EXPIRED = "TRANSACTION_EXPIRED",
    /** Sending account does not exist */
    SENDING_ACCOUNT_DOES_NOT_EXIST = "SENDING_ACCOUNT_DOES_NOT_EXIST",
    /** The sending account is frozen */
    SENDING_ACCOUNT_FROZEN = "SENDING_ACCOUNT_FROZEN",
    /** An unknown validation status was encountered */
    UNKNOWN_VALIDATION_STATUS = "UNKNOWN_VALIDATION_STATUS",
    /** The maximum transaction size has been exceeded */
    EXCEEDED_MAX_TRANSACTION_SIZE = "EXCEEDED_MAX_TRANSACTION_SIZE",
    /** Module not found */
    LINKER_ERROR = "LINKER_ERROR",
    /** Function not found in module */
    FUNCTION_RESOLUTION_FAILURE = "FUNCTION_RESOLUTION_FAILURE",
    /** Type argument mismatch */
    TYPE_MISMATCH = "TYPE_MISMATCH",
    /** Move abort: execution aborted with code */
    MOVE_ABORT = "MOVE_ABORT",
    /** Arithmetic error in the VM */
    ARITHMETIC_ERROR = "ARITHMETIC_ERROR",
    /** Execution stack overflow */
    EXECUTION_STACK_OVERFLOW = "EXECUTION_STACK_OVERFLOW",
    /** Out of bounds memory access in the VM */
    MEMORY_LIMIT_EXCEEDED = "MEMORY_LIMIT_EXCEEDED",
}

/**
 * Checks if a major_status string matches a known Move VM error.
 */
export function isMoveVmError(status: string | undefined): status is MoveVmError {
    if (!status) return false;
    return Object.values(MoveVmError).includes(status as MoveVmError);
}
