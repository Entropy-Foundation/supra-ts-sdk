import { BCS, TxnBuilderTypes } from "supra-l1-sdk-core";
import { SupraClient } from "../../../api/supraClient";
import type { AutomationTaskType } from "../../../types/transactionManager/transactionBuild";
import { stringifyWithBigInt } from "../../../utils/json";
import { AutomationRegistrationParamsV2, deserializeRawTransaction } from "../automationRegistration";
import { getRawTxnJSONInternal, getTransactionPayloadJSONInternal } from "../txnBuild";

// Offline building: no request is sent.
const supra = new SupraClient({ rpcUrl: "http://127.0.0.1:1", chainId: 255, verifyChainId: false });

const SENDER = `0x${"ab".repeat(32)}`;
const RECEIVER = new Uint8Array(32).fill(0xcd);

function hex(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString("hex");
}

function u64(value: bigint): string {
    return hex(BCS.bcsSerializeUint64(value));
}

function registration(extra: { automationTaskType?: AutomationTaskType; automationPriority?: bigint } = {}) {
    return supra.transaction.build.automationRegistrationRawTxnObject({
        senderAddress: SENDER,
        senderSequenceNumber: 3n,
        function: "0x1::supra_account::transfer",
        functionTypeArgs: [],
        functionArgs: [RECEIVER, BCS.bcsSerializeUint64(1000n)],
        automationMaxGasAmount: 500n,
        automationGasPriceCap: 200_000n,
        automationFeeCapForEpoch: 1_000_000_000n,
        automationExpirationTimestampSecs: 1_800_000_000n,
        automationAuxData: [],
        optionalTransactionPayloadArgs: { maxGas: 20_000n, gasUnitPrice: 100_000n, txExpiryTime: 1_790_000_000n },
        ...extra,
    });
}

/** The BCS of `0x1::supra_account::transfer(RECEIVER, 1000)` as an `EntryFunction`. */
const ENTRY_FUNCTION =
    `${"00".repeat(31)}01` + // module address 0x1
    "0d" +
    hex(new TextEncoder().encode("supra_account")) +
    "08" +
    hex(new TextEncoder().encode("transfer")) +
    "00" + // no type arguments
    "02" + // two arguments
    "20" +
    hex(RECEIVER) +
    "08" +
    u64(1000n);

/** The version 1 fields, in the order both versions serialize them. */
const COMMON_FIELDS =
    ENTRY_FUNCTION +
    u64(500n) + // max_gas_amount
    u64(200_000n) + // gas_price_cap
    u64(1_000_000_000n) + // automation_fee_cap_for_epoch
    u64(1_800_000_000n) + // expiration_timestamp_secs
    "00"; // aux_data: empty vector

const PREFIX = "ab".repeat(32) + u64(3n);
const SUFFIX = u64(20_000n) + u64(100_000n) + u64(1_790_000_000n) + "ff";

describe("the BCS of an automation registration", () => {
    test("without a task type or a priority is version 1 (variant 0)", () => {
        const rawTxn = registration();
        expect(rawTxn.payload).toBeInstanceOf(TxnBuilderTypes.TransactionPayloadAutomationRegistration);
        expect((rawTxn.payload as TxnBuilderTypes.TransactionPayloadAutomationRegistration).value).toBeInstanceOf(
            TxnBuilderTypes.AutomationRegistrationParamsV1,
        );
        expect(hex(rawTxn.toBytes())).toBe(PREFIX + "04" + "00" + COMMON_FIELDS + SUFFIX);
    });

    test.each<[string, { automationTaskType?: AutomationTaskType; automationPriority?: bigint }, string]>([
        ["a user task with a priority", { automationTaskType: "User", automationPriority: 7n }, "00" + "01" + u64(7n)],
        ["a user task without a priority", { automationTaskType: "User" }, "00" + "00"],
        ["a priority alone, as a user task", { automationPriority: 0n }, "00" + "01" + u64(0n)],
        [
            "a system task with the largest priority",
            { automationTaskType: "System", automationPriority: 2n ** 64n - 1n },
            "01" + "01" + "ff".repeat(8),
        ],
    ])("of %s is version 2 (variant 1): task type index, then the optional priority", (_name, extra, tail) => {
        const rawTxn = registration(extra);
        expect((rawTxn.payload as TxnBuilderTypes.TransactionPayloadAutomationRegistration).value).toBeInstanceOf(
            AutomationRegistrationParamsV2,
        );
        expect(hex(rawTxn.toBytes())).toBe(PREFIX + "04" + "01" + COMMON_FIELDS + tail + SUFFIX);
    });

    test.each<[string, { automationTaskType?: AutomationTaskType; automationPriority?: bigint }]>([
        ["a task type that is not User or System", { automationTaskType: "user" as AutomationTaskType }],
        ["a negative priority", { automationPriority: -1n }],
        ["a priority above 2^64 - 1", { automationPriority: 2n ** 64n }],
        ["a priority that is a number", { automationPriority: 7 as unknown as bigint }],
    ])("throws a RangeError before building for %s", (_name, extra) => {
        expect(() => registration(extra)).toThrow(RangeError);
    });
});

describe("deserializeRawTransaction", () => {
    test.each<[string, { automationTaskType?: AutomationTaskType; automationPriority?: bigint }]>([
        ["version 1", {}],
        ["version 2 with a priority", { automationTaskType: "User", automationPriority: 7n }],
        ["version 2 without a priority", { automationTaskType: "User" }],
        ["version 2 of a system task", { automationTaskType: "System", automationPriority: 1n }],
    ])("reads %s and serializes back to the same bytes", (_name, extra) => {
        const bytes = registration(extra).toBytes();
        const parsed = deserializeRawTransaction(bytes);
        expect(hex(BCS.bcsToBytes(parsed))).toBe(hex(bytes));
        expect(getRawTxnJSONInternal(parsed)).toEqual(getRawTxnJSONInternal(registration(extra)));
    });

    test("reads the other payloads as the core deserializer does", () => {
        const entry = supra.transaction.build.rawTxnObject({
            senderAddress: SENDER,
            senderSequenceNumber: 1n,
            function: "0x1::supra_account::transfer",
            functionTypeArgs: [],
            functionArgs: [RECEIVER, BCS.bcsSerializeUint64(1n)],
            optionalTransactionPayloadArgs: { gasUnitPrice: 100_000n },
        });
        const script = supra.transaction.build.scriptRawTxnObject({
            senderAddress: SENDER,
            senderSequenceNumber: 1n,
            scriptCode: new Uint8Array([1, 2, 3]),
            scriptTypeArgs: [],
            scriptArgs: [new TxnBuilderTypes.TransactionArgumentU64(5n)],
            optionalTransactionPayloadArgs: { gasUnitPrice: 100_000n },
        });
        const multisig = supra.transaction.build.multisigRawTxnObject({
            senderAddress: SENDER,
            senderSequenceNumber: 1n,
            multisigAddress: "0x5",
            function: "0x1::supra_account::transfer",
            functionTypeArgs: [],
            functionArgs: [RECEIVER, BCS.bcsSerializeUint64(1n)],
            optionalTransactionPayloadArgs: { gasUnitPrice: 100_000n },
        });
        for (const rawTxn of [entry, script, multisig]) {
            const bytes = rawTxn.toBytes();
            const ours = deserializeRawTransaction(bytes);
            const core = TxnBuilderTypes.RawTransaction.deserialize(new BCS.Deserializer(bytes));
            expect(ours.payload.constructor).toBe(core.payload.constructor);
            expect(hex(BCS.bcsToBytes(ours))).toBe(hex(bytes));
        }
    });

    test.each<[string, (bytes: string) => string, RegExp]>([
        [
            "a registration parameters variant other than 0 and 1",
            (bytes) => bytes.replace(PREFIX + "0401", PREFIX + "0402"),
            /Unknown variant index for AutomationRegistrationParams: 2/,
        ],
        [
            "a task type variant other than 0 and 1",
            (bytes) => bytes.replace(COMMON_FIELDS + "0001", COMMON_FIELDS + "0201"),
            /Unknown variant index for AutomationTaskType: 2/,
        ],
        [
            "an option tag other than 0 and 1",
            (bytes) => bytes.replace(COMMON_FIELDS + "0001", COMMON_FIELDS + "0002"),
            /Invalid tag for Option<u64>: 2/,
        ],
        [
            "a payload variant that does not exist",
            (bytes) => bytes.replace(PREFIX + "04", PREFIX + "09"),
            /Unknown variant index for TransactionPayload: 9/,
        ],
    ])("throws for %s", (_name, corrupt, message) => {
        const bytes = hex(registration({ automationTaskType: "User", automationPriority: 7n }).toBytes());
        const corrupted = corrupt(bytes);
        expect(corrupted).not.toBe(bytes);
        expect(() => deserializeRawTransaction(new Uint8Array(Buffer.from(corrupted, "hex")))).toThrow(message);
    });
});

describe("the JSON of an automation registration", () => {
    const automatedFunction = {
        module: { address: `0x${"0".repeat(63)}1`, name: "supra_account" },
        function: "transfer",
        ty_args: [],
        args: [Array.from(RECEIVER), Array.from(BCS.bcsSerializeUint64(1000n))],
    };
    const fields = {
        automated_function: automatedFunction,
        max_gas_amount: 500n,
        gas_price_cap: 200_000n,
        automation_fee_cap_for_epoch: 1_000_000_000n,
        expiration_timestamp_secs: 1_800_000_000n,
        aux_data: [],
    };

    test("of version 1 is `V1` with the version 1 fields", () => {
        expect(getTransactionPayloadJSONInternal(registration().payload)).toEqual({
            AutomationRegistration: { V1: fields },
        });
    });

    test("of version 2 is `V2` with `task_type` and `priority_value`", () => {
        expect(
            getTransactionPayloadJSONInternal(
                registration({ automationTaskType: "System", automationPriority: 2n ** 64n - 1n }).payload,
            ),
        ).toEqual({
            AutomationRegistration: {
                V2: { ...fields, task_type: "System", priority_value: 18_446_744_073_709_551_615n },
            },
        });
    });

    test("of version 2 without a priority has `priority_value: null`", () => {
        expect(getTransactionPayloadJSONInternal(registration({ automationTaskType: "User" }).payload)).toEqual({
            AutomationRegistration: { V2: { ...fields, task_type: "User", priority_value: null } },
        });
    });

    test("writes the priority as an exact JSON number", () => {
        const json = stringifyWithBigInt(
            getTransactionPayloadJSONInternal(registration({ automationPriority: 2n ** 64n - 1n }).payload),
        );
        expect(json).toContain('"task_type":"User","priority_value":18446744073709551615}');
    });
});
