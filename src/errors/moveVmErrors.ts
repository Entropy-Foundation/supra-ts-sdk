/**
 * Names of Move VM status codes (`StatusCode` of the Move VM) that a node reports in error messages and in the
 * `vm_status` of a transaction, and that `SupraAPIError.major_status` carries.
 *
 * The list holds the statuses a client commonly handles: validation statuses of a submitted transaction, the
 * statuses of a failing view function and the runtime statuses of an executed transaction. The Move VM defines
 * more; a status that is not listed here is still reported by `major_status` as its name.
 */
export enum MoveVmError {
    // Validation (0-999): the prologue rejects the transaction.
    /** The default value, which is not a valid status. */
    UNKNOWN_VALIDATION_STATUS = "UNKNOWN_VALIDATION_STATUS",
    /** The transaction has a bad signature. */
    INVALID_SIGNATURE = "INVALID_SIGNATURE",
    /** Bad account authentication key. */
    INVALID_AUTH_KEY = "INVALID_AUTH_KEY",
    /** The sequence number is too old. */
    SEQUENCE_NUMBER_TOO_OLD = "SEQUENCE_NUMBER_TOO_OLD",
    /** The sequence number is too new. */
    SEQUENCE_NUMBER_TOO_NEW = "SEQUENCE_NUMBER_TOO_NEW",
    /** The balance is below `max_gas_amount * gas_unit_price`, which the account must hold to pay the fee. */
    INSUFFICIENT_BALANCE_FOR_TRANSACTION_FEE = "INSUFFICIENT_BALANCE_FOR_TRANSACTION_FEE",
    /** The transaction has expired. */
    TRANSACTION_EXPIRED = "TRANSACTION_EXPIRED",
    /** The sending account does not exist. */
    SENDING_ACCOUNT_DOES_NOT_EXIST = "SENDING_ACCOUNT_DOES_NOT_EXIST",
    /** The size of the transaction exceeds the maximum transaction size. */
    EXCEEDED_MAX_TRANSACTION_SIZE = "EXCEEDED_MAX_TRANSACTION_SIZE",
    /** The max gas units of the transaction exceed the maximum the VM allows. */
    MAX_GAS_UNITS_EXCEEDS_MAX_GAS_UNITS_BOUND = "MAX_GAS_UNITS_EXCEEDS_MAX_GAS_UNITS_BOUND",
    /** The max gas units of the transaction do not cover its intrinsic cost. */
    MAX_GAS_UNITS_BELOW_MIN_TRANSACTION_GAS_UNITS = "MAX_GAS_UNITS_BELOW_MIN_TRANSACTION_GAS_UNITS",
    /** The gas unit price of the transaction is below the minimum gas price set in the VM. */
    GAS_UNIT_PRICE_BELOW_MIN_BOUND = "GAS_UNIT_PRICE_BELOW_MIN_BOUND",
    /** The gas unit price of the transaction is above the maximum gas price set in the VM. */
    GAS_UNIT_PRICE_ABOVE_MAX_BOUND = "GAS_UNIT_PRICE_ABOVE_MAX_BOUND",
    /** The sending account is frozen. */
    SENDING_ACCOUNT_FROZEN = "SENDING_ACCOUNT_FROZEN",
    /** The chain ID of the transaction does not match the one published on chain. */
    BAD_CHAIN_ID = "BAD_CHAIN_ID",
    /** The sequence number is so large that executing the transaction would overflow it. */
    SEQUENCE_NUMBER_TOO_BIG = "SEQUENCE_NUMBER_TOO_BIG",
    /** The number of secondary signer addresses differs from the number of secondary public keys. */
    SECONDARY_KEYS_ADDRESSES_COUNT_MISMATCH = "SECONDARY_KEYS_ADDRESSES_COUNT_MISMATCH",
    /** The signers, including the sender and all secondary signers, contain duplicates. */
    SIGNERS_CONTAIN_DUPLICATES = "SIGNERS_CONTAIN_DUPLICATES",
    /** The account is not a multisig account. */
    ACCOUNT_NOT_MULTISIG = "ACCOUNT_NOT_MULTISIG",
    /** The sender is not an owner of the multisig account. */
    NOT_MULTISIG_OWNER = "NOT_MULTISIG_OWNER",
    /** The multisig transaction does not exist. */
    MULTISIG_TRANSACTION_NOT_FOUND = "MULTISIG_TRANSACTION_NOT_FOUND",
    /** The multisig transaction has fewer approvals than the account requires. */
    MULTISIG_TRANSACTION_INSUFFICIENT_APPROVALS = "MULTISIG_TRANSACTION_INSUFFICIENT_APPROVALS",
    /** The payload of the multisig transaction does not match the stored payload hash. */
    MULTISIG_TRANSACTION_PAYLOAD_DOES_NOT_MATCH_HASH = "MULTISIG_TRANSACTION_PAYLOAD_DOES_NOT_MATCH_HASH",
    /** The payload of the multisig transaction does not match the stored payload. */
    MULTISIG_TRANSACTION_PAYLOAD_DOES_NOT_MATCH = "MULTISIG_TRANSACTION_PAYLOAD_DOES_NOT_MATCH",
    /** The fee payer account does not exist. */
    GAS_PAYER_ACCOUNT_MISSING = "GAS_PAYER_ACCOUNT_MISSING",
    /** The balance does not cover the deposit the transaction requires. */
    INSUFFICIENT_BALANCE_FOR_REQUIRED_DEPOSIT = "INSUFFICIENT_BALANCE_FOR_REQUIRED_DEPOSIT",

    // Verification (1000-1999): publishing, linking and calling code.
    /** A lookup of a handle or definition in the tables of a module or script failed. */
    LOOKUP_FAILED = "LOOKUP_FAILED",
    /** A type does not match where the bytecode verifier requires it to. */
    TYPE_MISMATCH = "TYPE_MISMATCH",
    /** A type argument does not satisfy the constraints of its type parameter. */
    CONSTRAINT_NOT_SATISFIED = "CONSTRAINT_NOT_SATISFIED",
    /** The number of type arguments differs from the number of type parameters. */
    NUMBER_OF_TYPE_ARGUMENTS_MISMATCH = "NUMBER_OF_TYPE_ARGUMENTS_MISMATCH",
    /** A module that the code or a type argument refers to cannot be linked, for example because it does not exist. */
    LINKER_ERROR = "LINKER_ERROR",
    /** The function that is called cannot be resolved. */
    FUNCTION_RESOLUTION_FAILURE = "FUNCTION_RESOLUTION_FAILURE",
    /** The updated module breaks the compatibility checks against the published module. */
    BACKWARD_INCOMPATIBLE_MODULE_UPDATE = "BACKWARD_INCOMPATIBLE_MODULE_UPDATE",
    /** The number of arguments differs from the number of parameters of the function. */
    NUMBER_OF_ARGUMENTS_MISMATCH = "NUMBER_OF_ARGUMENTS_MISMATCH",
    /** The type of a parameter cannot be deserialized from an argument. */
    INVALID_PARAM_TYPE_FOR_DESERIALIZATION = "INVALID_PARAM_TYPE_FOR_DESERIALIZATION",
    /** An argument cannot be deserialized into the type of its parameter. */
    FAILED_TO_DESERIALIZE_ARGUMENT = "FAILED_TO_DESERIALIZE_ARGUMENT",
    /** The number of signer arguments differs from the number of signers the function expects. */
    NUMBER_OF_SIGNER_ARGUMENTS_MISMATCH = "NUMBER_OF_SIGNER_ARGUMENTS_MISMATCH",
    /** `execute_entry_function` was called on a function that is not an entry function. */
    EXECUTE_ENTRY_FUNCTION_CALLED_ON_NON_ENTRY_FUNCTION = "EXECUTE_ENTRY_FUNCTION_CALLED_ON_NON_ENTRY_FUNCTION",

    // Invariant violation (2000-2999): faults of the VM or of the node.
    /** An invariant of the VM was violated. */
    UNKNOWN_INVARIANT_VIOLATION_ERROR = "UNKNOWN_INVARIANT_VIOLATION_ERROR",
    /** A type could not be resolved because linking broke after verification. */
    TYPE_RESOLUTION_FAILURE = "TYPE_RESOLUTION_FAILURE",
    /** A native function that the code calls is not registered in the VM. */
    MISSING_NATIVE_FUNCTION = "MISSING_NATIVE_FUNCTION",

    // Runtime (4000-4999): the outcome of executing a transaction or view function.
    /** The status of runtime errors that have no more specific status. */
    UNKNOWN_RUNTIME_STATUS = "UNKNOWN_RUNTIME_STATUS",
    /** The transaction was executed successfully. */
    EXECUTED = "EXECUTED",
    /** The execution used more gas than the transaction's max gas amount (or a view function's gas budget). */
    OUT_OF_GAS = "OUT_OF_GAS",
    /** A resource that the code accessed does not exist under the account. */
    RESOURCE_DOES_NOT_EXIST = "RESOURCE_DOES_NOT_EXIST",
    /** A resource that the code created already exists under the account. */
    RESOURCE_ALREADY_EXISTS = "RESOURCE_ALREADY_EXISTS",
    /** The code read data that is not in storage, for example a global resource that does not exist. */
    MISSING_DATA = "MISSING_DATA",
    /** Data in storage is not in the format the code expects. */
    DATA_FORMAT_ERROR = "DATA_FORMAT_ERROR",
    /** The execution aborted with an abort code (the `sub_status`), for example through `abort` or a failed `assert!`. */
    ABORTED = "ABORTED",
    /** An arithmetic error such as overflow, underflow or division by zero. */
    ARITHMETIC_ERROR = "ARITHMETIC_ERROR",
    /** An invalid vector operation, for example an index out of bounds. */
    VECTOR_OPERATION_ERROR = "VECTOR_OPERATION_ERROR",
    /** The execution stack overflowed. */
    EXECUTION_STACK_OVERFLOW = "EXECUTION_STACK_OVERFLOW",
    /** The call stack overflowed. */
    CALL_STACK_OVERFLOW = "CALL_STACK_OVERFLOW",
    /** The maximum type depth was reached. */
    VM_MAX_TYPE_DEPTH_REACHED = "VM_MAX_TYPE_DEPTH_REACHED",
    /** The maximum value depth was reached. */
    VM_MAX_VALUE_DEPTH_REACHED = "VM_MAX_VALUE_DEPTH_REACHED",
    /** The write set of the transaction exceeds the storage write limit. */
    STORAGE_WRITE_LIMIT_REACHED = "STORAGE_WRITE_LIMIT_REACHED",
    /** The execution exceeded the memory limit. */
    MEMORY_LIMIT_EXCEEDED = "MEMORY_LIMIT_EXCEEDED",
    /** The execution reached the execution limit. */
    EXECUTION_LIMIT_REACHED = "EXECUTION_LIMIT_REACHED",
    /** The execution reached the I/O limit. */
    IO_LIMIT_REACHED = "IO_LIMIT_REACHED",
    /** The execution reached the storage limit. */
    STORAGE_LIMIT_REACHED = "STORAGE_LIMIT_REACHED",
    /** A resource was accessed in a way the active access control specifier does not permit. */
    ACCESS_DENIED = "ACCESS_DENIED",
}

/**
 * Checks if a `major_status` string is one of the statuses listed in {@link MoveVmError}.
 */
export function isMoveVmError(status: string | undefined): status is MoveVmError {
    if (!status) return false;
    return Object.values(MoveVmError).includes(status as MoveVmError);
}
