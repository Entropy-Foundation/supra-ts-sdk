import { HexString, BCS } from "supra-l1-sdk-core";
import {
    addressArgument,
    assertSafeIntegerArgument,
    boolArgument,
    fixedPointRawType,
    isObjectType,
    vectorU8ToBytes,
} from "../helper/general";
import type { SimpleEntryFunctionArgumentTypes } from "../types/move";

export class DynamicTransactionSerializer {
    private serializeValue(value: unknown, type: string, serializer: BCS.Serializer): void {
        if (isObjectType(type)) {
            return this.serializeAddress(value, type, serializer);
        }

        if (type === "0x1::string::String") {
            if (typeof value !== "string") {
                throw new Error(`Expected string for 0x1::string::String, got ${typeof value}`);
            }
            serializer.serializeStr(value);
            return;
        }

        const fixedPointType = fixedPointRawType(type);
        if (fixedPointType === "u64") {
            this.serializeU64(value, serializer);
            return;
        }
        if (fixedPointType === "u128") {
            this.serializeU128(value, serializer);
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
                this.serializeAddress(value, type, serializer);
                break;
            case "bool":
                serializer.serializeBool(boolArgument(value));
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

    private serializeVector(value: unknown, innerType: string, serializer: BCS.Serializer): void {
        if (innerType === "u8") {
            this.serializeBytes(value, serializer);
            return;
        }

        if (!Array.isArray(value)) {
            throw new Error(`Expected array for vector<${innerType}>, got ${typeof value}`);
        }

        serializer.serializeU32AsUleb128(value.length);

        for (const item of value) {
            this.serializeValue(item, innerType, serializer);
        }
    }

    /** Serialize a `vector<u8>`; see `vectorU8ToBytes` for the accepted forms. */
    private serializeBytes(value: unknown, serializer: BCS.Serializer): void {
        serializer.serializeBytes(vectorU8ToBytes(value));
    }

    /**
     * Serialize an `address` or `Object<T>` argument as 32 bytes, left-padded with zeros. See `addressArgument` for
     * the accepted forms.
     */
    private serializeAddress(value: unknown, type: string, serializer: BCS.Serializer): void {
        const hex = addressArgument(value, type).replace(/^0x/, "").padStart(64, "0");
        serializer.serializeFixedBytes(new HexString(`0x${hex}`).toUint8Array());
    }

    /**
     * Parse an integer given as a string: decimal digits, or `0x` followed by hex digits.
     * Empty, whitespace-only, signed, fractional and otherwise malformed strings are rejected.
     */
    private parseIntegerString(value: string, bits: number): bigint {
        if (!/^(\d+|0x[0-9a-fA-F]+)$/.test(value)) {
            throw new Error(
                `u${bits} value must be a decimal or 0x-prefixed hexadecimal integer string, got ${JSON.stringify(value)}`,
            );
        }
        return BigInt(value);
    }

    /**
     * Parse an unsigned integer of the given width from a number, a string or a bigint into a
     * bigint, rejecting malformed, negative and out-of-range input, and numbers that are not safe
     * integers.
     */
    private parseUnsigned(value: unknown, bits: number): bigint {
        let num: bigint;
        if (typeof value === "bigint") {
            num = value;
        } else if (typeof value === "number") {
            if (!Number.isInteger(value)) {
                throw new Error(`u${bits} value must be an integer, got ${value}`);
            }
            num = BigInt(value);
        } else if (typeof value === "string") {
            num = this.parseIntegerString(value, bits);
        } else {
            throw new Error(`u${bits} value must be a number, string or bigint, got ${typeof value}`);
        }

        const max = (1n << BigInt(bits)) - 1n;
        if (num < 0n) {
            throw new Error(`u${bits} value cannot be negative: ${num}`);
        }
        if (num > max) {
            throw new Error(`u${bits} value out of range (0-${max}): ${num}`);
        }
        if (typeof value === "number") {
            assertSafeIntegerArgument(`u${bits}`, value);
        }
        return num;
    }

    /** Parse a u8, u16 or u32 value. */
    private parseUint(value: unknown, bits: 8 | 16 | 32): number {
        return Number(this.parseUnsigned(value, bits));
    }

    /** Parse a u64, u128 or u256 value. */
    private parseBigUint(value: unknown, bits: 64 | 128 | 256): bigint {
        return this.parseUnsigned(value, bits);
    }

    private serializeU8(value: unknown, serializer: BCS.Serializer): void {
        serializer.serializeU8(this.parseUint(value, 8));
    }

    private serializeU16(value: unknown, serializer: BCS.Serializer): void {
        serializer.serializeU16(this.parseUint(value, 16));
    }

    private serializeU32(value: unknown, serializer: BCS.Serializer): void {
        serializer.serializeU32(this.parseUint(value, 32));
    }

    private serializeU64(value: unknown, serializer: BCS.Serializer): void {
        // Pass the bigint directly — BCS.Serializer.serializeU64 accepts bigint and
        // range-checks the full u64 domain. Do NOT branch to serializeU128 for large
        // values: that would encode 16 bytes for a u64 and corrupt the payload.
        serializer.serializeU64(this.parseBigUint(value, 64));
    }

    private serializeU128(value: unknown, serializer: BCS.Serializer): void {
        serializer.serializeU128(this.parseBigUint(value, 128));
    }

    private serializeU256(value: unknown, serializer: BCS.Serializer): void {
        serializer.serializeU256(this.parseBigUint(value, 256));
    }

    public prepareTransactionArgs(args: Array<SimpleEntryFunctionArgumentTypes>, paramTypes: string[]): Uint8Array[] {
        if (args.length !== paramTypes.length) {
            throw new Error(`Argument count mismatch: expected ${paramTypes.length}, got ${args.length}`);
        }

        return args.map((arg, index) => {
            const serializer = new BCS.Serializer();
            const paramType = paramTypes[index];

            try {
                this.serializeValue(arg, paramType!, serializer);
                const bytes = serializer.getBytes();

                return bytes;
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                throw new Error(`Failed to serialize argument ${index} (${paramType}): ${errorMessage}`);
            }
        });
    }
}
