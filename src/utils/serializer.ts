import { HexString, BCS } from "supra-l1-sdk-core";
import type { SimpleEntryFunctionArgumentTypes } from "../types/move";

export class DynamicTransactionSerializer {
    private serializeValue(
        value: unknown,
        type: string,
        serializer: BCS.Serializer
    ): void {


        if (type.startsWith("0x1::object::Object")) {
            if (typeof value !== 'string') {
                throw new Error(`Expected string for Object, got ${typeof value}`);
            }
            return this.serializeAddress(value, serializer);
        }

        if (type === "0x1::string::String") {
            if (typeof value !== "string") {
                throw new Error(`Expected string for 0x1::string::String, got ${typeof value}`);
            }
            serializer.serializeStr(value);
            return;
        }

        const optionPrefix = "0x1::option::Option<";
        if (type.startsWith(optionPrefix)) {
            if (value === null || value === undefined) {
                serializer.serializeU8(0);
            } else {
                serializer.serializeU8(1);
                const innerType = type.slice(optionPrefix.length, -1);
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
                this.serializeAddress(value as string, serializer);
                break;
            case "bool":
                this.serializeBool(value as boolean, serializer);
                break;
            case "u8":
                this.serializeU8(value as number | string, serializer);
                break;
            case "u16":
                this.serializeU16(value as number | string, serializer);
                break;
            case "u32":
                this.serializeU32(value as number | string, serializer);
                break;
            case "u64":
                this.serializeU64(value as number | string | bigint, serializer);
                break;
            case "u128":
                this.serializeU128(value as number | string | bigint, serializer);
                break;
            case "u256":
                this.serializeU256(value as number | string | bigint, serializer);
                break;
            default:
                throw new Error(`Unsupported type: ${type}`);
        }
    }

    private serializeVector(
        value: unknown,
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

    /**
     * Parse a small unsigned integer (u8/u16/u32) from number or string, rejecting
     * non-integer / out-of-range / NaN input before handing it to the serializer.
     */
    private parseUint(value: number | string, bits: 8 | 16 | 32): number {
        const num = typeof value === "string" ? Number(value) : value;
        if (typeof num !== "number" || !Number.isInteger(num)) {
            throw new Error(`u${bits} value must be an integer, got ${JSON.stringify(value)}`);
        }
        const max = 2 ** bits - 1;
        if (num < 0 || num > max) {
            throw new Error(`u${bits} value out of range (0-${max}): ${num}`);
        }
        return num;
    }

    /**
     * Parse a large unsigned integer (u64/u128/u256) into a non-negative bigint.
     * `BigInt()` throws on malformed input, so no NaN can slip through. Range is
     * enforced by the underlying BCS serializer.
     */
    private parseBigUint(value: number | string | bigint, bits: 64 | 128 | 256): bigint {
        let num: bigint;
        if (typeof value === "bigint") {
            num = value;
        } else if (typeof value === "number") {
            if (!Number.isInteger(value)) {
                throw new Error(`u${bits} value must be an integer, got ${value}`);
            }
            num = BigInt(value);
        } else {
            num = BigInt(value);
        }

        if (num < 0n) {
            throw new Error(`u${bits} value cannot be negative: ${num}`);
        }
        return num;
    }

    private serializeU8(value: number | string, serializer: BCS.Serializer): void {
        serializer.serializeU8(this.parseUint(value, 8));
    }

    private serializeU16(value: number | string, serializer: BCS.Serializer): void {
        serializer.serializeU16(this.parseUint(value, 16));
    }

    private serializeU32(value: number | string, serializer: BCS.Serializer): void {
        serializer.serializeU32(this.parseUint(value, 32));
    }

    private serializeU64(value: number | string | bigint, serializer: BCS.Serializer): void {
        // Pass the bigint directly — BCS.Serializer.serializeU64 accepts bigint and
        // range-checks the full u64 domain. Do NOT branch to serializeU128 for large
        // values: that would encode 16 bytes for a u64 and corrupt the payload.
        serializer.serializeU64(this.parseBigUint(value, 64));
    }

    private serializeU128(value: number | string | bigint, serializer: BCS.Serializer): void {
        serializer.serializeU128(this.parseBigUint(value, 128));
    }

    private serializeU256(value: number | string | bigint, serializer: BCS.Serializer): void {
        serializer.serializeU256(this.parseBigUint(value, 256));
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
