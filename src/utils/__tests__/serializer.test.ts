import { BCS } from "supra-l1-sdk-core";
import { DynamicTransactionSerializer } from "../serializer";

const serializer = new DynamicTransactionSerializer();

/** Serialize a single arg of a given Move type and return its BCS bytes. */
function ser(value: unknown, type: string): Uint8Array {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return serializer.prepareTransactionArgs([value as any], [type])[0]!;
}

/** Oracle: bytes produced by the core BCS serializer directly. */
function core(fn: (s: BCS.Serializer) => void): Uint8Array {
    const s = new BCS.Serializer();
    fn(s);
    return s.getBytes();
}

describe("DynamicTransactionSerializer - unsigned integers", () => {
    it("serializes u8", () => {
        expect(Array.from(ser(255, "u8"))).toEqual(Array.from(core((s) => s.serializeU8(255))));
    });

    it("serializes u16", () => {
        expect(Array.from(ser(4660, "u16"))).toEqual(Array.from(core((s) => s.serializeU16(4660))));
    });

    it("serializes u32", () => {
        expect(Array.from(ser(305419896, "u32"))).toEqual(
            Array.from(core((s) => s.serializeU32(305419896))),
        );
    });

    it("serializes small u64", () => {
        expect(Array.from(ser(42, "u64"))).toEqual(Array.from(core((s) => s.serializeU64(42n))));
    });

    it("serializes u128", () => {
        const v = 340282366920938463463374607431768211455n; // 2^128 - 1
        expect(Array.from(ser(v, "u128"))).toEqual(Array.from(core((s) => s.serializeU128(v))));
    });

    it("serializes u256", () => {
        const v = 123456789012345678901234567890n;
        const bytes = ser(v, "u256");
        expect(bytes.length).toBe(32);
        expect(Array.from(bytes)).toEqual(Array.from(core((s) => s.serializeU256(v))));
    });
});

describe("DynamicTransactionSerializer - u64 regression (large values)", () => {
    // Regression: values above Number.MAX_SAFE_INTEGER must still be encoded as a
    // u64 (8 bytes), NOT promoted to u128 (16 bytes) as the old code did.
    it("encodes a u64 above MAX_SAFE_INTEGER as exactly 8 bytes", () => {
        const big = BigInt(Number.MAX_SAFE_INTEGER) + 1n; // 2^53
        const bytes = ser(big, "u64");
        expect(bytes.length).toBe(8);
        expect(Array.from(bytes)).toEqual(Array.from(core((s) => s.serializeU64(big))));
    });

    it("encodes u64::MAX as 8 bytes of 0xff", () => {
        const maxU64 = 18446744073709551615n; // 2^64 - 1
        const bytes = ser(maxU64, "u64");
        expect(bytes.length).toBe(8);
        expect(Array.from(bytes)).toEqual(new Array(8).fill(255));
    });

    it("accepts a large u64 passed as a string", () => {
        const s = "10000000000000000"; // 1e16 > MAX_SAFE_INTEGER
        const bytes = ser(s, "u64");
        expect(bytes.length).toBe(8);
        expect(Array.from(bytes)).toEqual(Array.from(core((c) => c.serializeU64(BigInt(s)))));
    });
});

describe("DynamicTransactionSerializer - validation", () => {
    it("rejects non-numeric u8 strings instead of serializing NaN", () => {
        expect(() => ser("abc", "u8")).toThrow(/integer/);
    });

    it("rejects out-of-range u8", () => {
        expect(() => ser(256, "u8")).toThrow(/out of range/);
    });

    it("rejects negative u64", () => {
        expect(() => ser(-1, "u64")).toThrow(/negative/);
    });

    it("rejects unknown types", () => {
        expect(() => ser(1, "u99")).toThrow(/Unsupported type/);
    });

    it("throws on argument/param count mismatch", () => {
        expect(() => serializer.prepareTransactionArgs([1, 2] as never[], ["u8"])).toThrow(
            /count mismatch/,
        );
    });
});

describe("DynamicTransactionSerializer - other types", () => {
    it("serializes bool", () => {
        expect(Array.from(ser(true, "bool"))).toEqual(Array.from(core((s) => s.serializeBool(true))));
    });

    it("serializes 0x1::string::String", () => {
        expect(Array.from(ser("hello", "0x1::string::String"))).toEqual(
            Array.from(core((s) => s.serializeStr("hello"))),
        );
    });

    it("serializes address (padded to 32 bytes)", () => {
        const bytes = ser("0x1", "address");
        expect(bytes.length).toBe(32);
        expect(bytes[31]).toBe(1);
    });

    it("serializes vector<u64> with large values as 8 bytes each", () => {
        const values = [1n, 18446744073709551615n];
        const bytes = ser(values, "vector<u64>");
        // uleb128 length (1 byte for len=2) + 2 * 8 bytes
        expect(bytes.length).toBe(1 + 16);
        expect(bytes[0]).toBe(2);
    });

    it("serializes empty Option<u64> as a single 0 byte", () => {
        expect(Array.from(ser(null, "0x1::option::Option<u64>"))).toEqual([0]);
    });

    it("serializes present Option<u64> as tag 1 + value", () => {
        const bytes = ser(5n, "0x1::option::Option<u64>");
        expect(bytes[0]).toBe(1);
        expect(bytes.length).toBe(1 + 8);
    });
});
