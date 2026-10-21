import { BCS, TxnBuilderTypes } from "supra-l1-sdk-core";
import type { AutomationTaskType } from "../../types/transactionManager/transactionBuild";

const MAX_U64 = 18_446_744_073_709_551_615n;

/**
 * The task types in the order of the variants of the node's `AutomationTaskType` enum. A task type is serialized as
 * the ULEB128 of its index here (`User` 0, `System` 1).
 */
const TASK_TYPES: readonly AutomationTaskType[] = ["User", "System"];

/** Returns `taskType` when it is `"User"` or `"System"`, and throws a `RangeError` otherwise. */
export function validateAutomationTaskType(taskType: AutomationTaskType): AutomationTaskType {
    if (!TASK_TYPES.includes(taskType)) {
        throw new RangeError(`automationTaskType must be "User" or "System", got ${String(taskType)}`);
    }
    return taskType;
}

/** Returns `value` when it is a `bigint` from 0 to 2^64 - 1, and throws a `RangeError` naming `name` otherwise. */
export function validateU64(value: bigint, name: string): bigint {
    if (typeof value !== "bigint" || value < 0n || value > MAX_U64) {
        throw new RangeError(`${name} must be a bigint from 0 to 2^64 - 1, got ${String(value)}`);
    }
    return value;
}

/**
 * The fields of version 2 of the automation registration parameters (`RegistrationParamsV2` of the node), in their
 * BCS order: the version 1 fields followed by the task type and the optional priority.
 */
export class AutomationRegistrationParamsV2Data {
    constructor(
        public readonly automated_function: TxnBuilderTypes.EntryFunction,
        public readonly max_gas_amount: bigint,
        public readonly gas_price_cap: bigint,
        public readonly automation_fee_cap_for_epoch: bigint,
        public readonly expiration_timestamp_secs: bigint,
        public readonly aux_data: Uint8Array[],
        public readonly task_type: AutomationTaskType,
        /** `undefined` when the registry assigns the priority. */
        public readonly priority_value: bigint | undefined,
    ) {}

    serialize(serializer: BCS.Serializer): void {
        this.automated_function.serialize(serializer);
        serializer.serializeU64(this.max_gas_amount);
        serializer.serializeU64(this.gas_price_cap);
        serializer.serializeU64(this.automation_fee_cap_for_epoch);
        serializer.serializeU64(this.expiration_timestamp_secs);
        BCS.serializeVectorOfBytes(this.aux_data, serializer);
        serializer.serializeU32AsUleb128(TASK_TYPES.indexOf(validateAutomationTaskType(this.task_type)));
        if (this.priority_value === undefined) {
            serializer.serializeU8(0);
        } else {
            serializer.serializeU8(1);
            serializer.serializeU64(this.priority_value);
        }
    }

    static deserialize(deserializer: BCS.Deserializer): AutomationRegistrationParamsV2Data {
        const automatedFunction = TxnBuilderTypes.EntryFunction.deserialize(deserializer);
        const maxGasAmount = deserializer.deserializeU64();
        const gasPriceCap = deserializer.deserializeU64();
        const automationFeeCapForEpoch = deserializer.deserializeU64();
        const expirationTimestampSecs = deserializer.deserializeU64();
        const auxData = BCS.deserializeVectorOfBytes(deserializer);
        const taskTypeIndex = deserializer.deserializeUleb128AsU32();
        const taskType = TASK_TYPES[taskTypeIndex];
        if (taskType === undefined) {
            throw new Error(`Unknown variant index for AutomationTaskType: ${taskTypeIndex}`);
        }
        const priorityTag = deserializer.deserializeU8();
        if (priorityTag > 1) {
            throw new Error(`Invalid tag for Option<u64>: ${priorityTag}`);
        }
        const priorityValue = priorityTag === 1 ? deserializer.deserializeU64() : undefined;
        return new AutomationRegistrationParamsV2Data(
            automatedFunction,
            maxGasAmount,
            gasPriceCap,
            automationFeeCapForEpoch,
            expirationTimestampSecs,
            auxData,
            taskType,
            priorityValue,
        );
    }
}

/**
 * Version 2 of the automation registration parameters: variant 1 of the node's `RegistrationParams` enum. Version 1
 * (variant 0) is `TxnBuilderTypes.AutomationRegistrationParamsV1`.
 */
export class AutomationRegistrationParamsV2 extends TxnBuilderTypes.AutomationRegistrationParams {
    constructor(public readonly value: AutomationRegistrationParamsV2Data) {
        super();
    }

    serialize(serializer: BCS.Serializer): void {
        serializer.serializeU32AsUleb128(1);
        this.value.serialize(serializer);
    }

    static load(deserializer: BCS.Deserializer): AutomationRegistrationParamsV2 {
        return new AutomationRegistrationParamsV2(AutomationRegistrationParamsV2Data.deserialize(deserializer));
    }
}

function deserializeAutomationRegistrationParams(
    deserializer: BCS.Deserializer,
): TxnBuilderTypes.AutomationRegistrationParams {
    const index = deserializer.deserializeUleb128AsU32();
    switch (index) {
        case 0:
            return TxnBuilderTypes.AutomationRegistrationParamsV1.load(deserializer);
        case 1:
            return AutomationRegistrationParamsV2.load(deserializer);
        default:
            throw new Error(`Unknown variant index for AutomationRegistrationParams: ${index}`);
    }
}

/**
 * Deserializes a transaction payload as `TxnBuilderTypes.TransactionPayload.deserialize` does, and also reads
 * version 2 of the automation registration parameters.
 */
function deserializeTransactionPayload(deserializer: BCS.Deserializer): TxnBuilderTypes.TransactionPayload {
    const index = deserializer.deserializeUleb128AsU32();
    switch (index) {
        case 0:
            return TxnBuilderTypes.TransactionPayloadScript.load(deserializer);
        case 2:
            return TxnBuilderTypes.TransactionPayloadEntryFunction.load(deserializer);
        case 3:
            return TxnBuilderTypes.TransactionPayloadMultisig.load(deserializer);
        case 4:
            return new TxnBuilderTypes.TransactionPayloadAutomationRegistration(
                deserializeAutomationRegistrationParams(deserializer),
            );
        default:
            throw new Error(`Unknown variant index for TransactionPayload: ${index}`);
    }
}

/**
 * Deserializes the BCS bytes of a raw transaction as `TxnBuilderTypes.RawTransaction.deserialize` does, and also
 * reads an automation registration with version 2 of the registration parameters.
 */
export function deserializeRawTransaction(bytes: Uint8Array): TxnBuilderTypes.RawTransaction {
    const deserializer = new BCS.Deserializer(bytes);
    const sender = TxnBuilderTypes.AccountAddress.deserialize(deserializer);
    const sequenceNumber = deserializer.deserializeU64();
    const payload = deserializeTransactionPayload(deserializer);
    const maxGasAmount = deserializer.deserializeU64();
    const gasUnitPrice = deserializer.deserializeU64();
    const expirationTimestampSecs = deserializer.deserializeU64();
    const chainId = TxnBuilderTypes.ChainId.deserialize(deserializer);
    return new TxnBuilderTypes.RawTransaction(
        sender,
        sequenceNumber,
        payload,
        maxGasAmount,
        gasUnitPrice,
        expirationTimestampSecs,
        chainId,
    );
}
