import { HexString, BCS } from "supra-l1-sdk-core";
import type { SimpleEntryFunctionArgumentTypes } from "../types/move";

export class DynamicTransactionSerializer {
    private serializeValue(
        value: any,
        type: string,
        serializer: BCS.Serializer
    ): void {


        if (type.startsWith("0x1::object::Object")) {
            if (typeof value !== 'string') {
                throw new Error(`Expected string for Object, got ${typeof value}`);
            }
            return this.serializeAddress(value, serializer);
        }

        if (type.startsWith("0x1::option::Option<")) {
            if (value === null || value === undefined) {
                serializer.serializeU8(0);
            } else {
                serializer.serializeU8(1);
                const innerType = type.slice(19, -1);
                this.serializeValue(value, innerType, serializer);
            }
            return;
        }

        if (type.startsWith("vector<")) {
            const innerType = type.slice(7, -1);
            this.serializeVector(value, innerType, serializer);
            return;
        }

        switch (type) {
            case "address":
                this.serializeAddress(value, serializer);
                break;
            case "u8":
                this.serializeU8(value, serializer);
                break;
            case "u64":
                this.serializeU64(value, serializer);
                break;
            case "u128":
                this.serializeU128(value, serializer);
                break;
            case "bool":
                this.serializeBool(value, serializer);
                break;
            default:
                throw new Error(`Unsupported type: ${type}`);
        }
    }

    private serializeVector(
        value: any[],
        innerType: string,
        serializer: BCS.Serializer
    ): void {
        if (!Array.isArray(value)) {
            throw new Error(
                `Expected array for vector<${innerType}>, got ${typeof value}`
            );
        }

        serializer.serializeU32AsUleb128(value.length);

        for (const item of value) {
            this.serializeValue(item, innerType, serializer);
        }
    }

    private serializeAddress(value: string, serializer: BCS.Serializer): void {
        if (typeof value !== "string") {
            throw new Error(`Expected string for address, got ${typeof value}`);
        }

        let cleanAddress = value.replace(/^0x/, "");
        if (cleanAddress.length !== 64) {
            cleanAddress = cleanAddress.padStart(64, "0");
        }

        const addressBytes = new HexString("0x" + cleanAddress).toUint8Array();
        if (addressBytes.length !== 32) {
            throw new Error("Invalid address length");
        }
        serializer.serializeFixedBytes(addressBytes);
    }

    private serializeU8(
        value: number | string,
        serializer: BCS.Serializer
    ): void {
        const num = typeof value === "string" ? parseInt(value, 10) : value;
        if (num < 0 || num > 255) {
            throw new Error(`u8 value out of range: ${num}`);
        }
        serializer.serializeU8(num);
    }

    private serializeU64(
        value: number | string | bigint,
        serializer: BCS.Serializer
    ): void {
        let num: bigint;
        if (typeof value === "string") {
            num = BigInt(value);
        } else if (typeof value === "number") {
            num = BigInt(value);
        } else {
            num = value;
        }

        if (num < 0) {
            throw new Error(`u64 value cannot be negative: ${num}`);
        }

        if (num <= BigInt(Number.MAX_SAFE_INTEGER)) {
            serializer.serializeU64(Number(num));
        } else {
            serializer.serializeU128(num);
        }
    }

    private serializeU128(
        value: number | string | bigint,
        serializer: BCS.Serializer
    ): void {
        let num: bigint;
        if (typeof value === "string") {
            num = BigInt(value);
        } else if (typeof value === "number") {
            num = BigInt(value);
        } else {
            num = value;
        }

        if (num < 0) {
            throw new Error(`u128 value cannot be negative: ${num}`);
        }

        serializer.serializeU128(num);
    }

    private serializeBool(value: boolean, serializer: BCS.Serializer): void {
        if (typeof value !== "boolean") {
            throw new Error(`Expected boolean, got ${typeof value}`);
        }
        serializer.serializeBool(value);
    }

    public prepareTransactionArgs(
        args: Array<Exclude<SimpleEntryFunctionArgumentTypes, Uint8Array>>,
        paramTypes: string[]
    ): Uint8Array[] {

        if (args.length !== paramTypes.length) {
            throw new Error(
                `Argument count mismatch: expected ${paramTypes.length}, got ${args.length}`
            );
        }

        return args.map((arg, index) => {
            const serializer = new BCS.Serializer();
            const paramType = paramTypes[index];

            try {
                this.serializeValue(arg, paramType!, serializer);
                const bytes = serializer.getBytes();

                return bytes;
            } catch (error) {
                const errorMessage =
                    error instanceof Error ? error.message : String(error);
                throw new Error(
                    `Failed to serialize argument ${index} (${paramType}): ${errorMessage}`
                );
            }
        });
    }
}