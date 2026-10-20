import { BCS, HexString } from "supra-l1-sdk-core";
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
        expect(Array.from(ser(305419896, "u32"))).toEqual(Array.from(core((s) => s.serializeU32(305419896))));
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
        expect(() => serializer.prepareTransactionArgs([1, 2] as never[], ["u8"])).toThrow(/count mismatch/);
    });
});

describe("DynamicTransactionSerializer - other types", () => {
    it("serializes bool", () => {
        expect(Array.from(ser(true, "bool"))).toEqual(Array.from(core((s) => s.serializeBool(true))));
    });

    it("serializes the strings true and false like the booleans", () => {
        expect(Array.from(ser("true", "bool"))).toEqual([1]);
        expect(Array.from(ser("false", "bool"))).toEqual([0]);
        expect(Array.from(ser(false, "bool"))).toEqual([0]);
    });

    it("refuses other bool values", () => {
        for (const value of ["TRUE", "False", "1", "0", "", " true", 1, 0, null, {}]) {
            expect(() => ser(value, "bool")).toThrow(
                'Failed to serialize argument 0 (bool): Expected a boolean, "true"',
            );
        }
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

describe("DynamicTransactionSerializer - vector<u8>", () => {
    const bytes = [0, 1, 127, 128, 255];
    const expected = Array.from(core((s) => s.serializeBytes(Uint8Array.from(bytes))));

    it("gives identical BCS for number[], Uint8Array, ArrayBuffer and hex strings", () => {
        const forms: unknown[] = [
            bytes,
            Uint8Array.from(bytes),
            Uint8Array.from(bytes).buffer,
            "0x00017f80ff",
            "00017f80ff",
            "0x00017F80FF",
        ];
        for (const form of forms) {
            expect(Array.from(ser(form, "vector<u8>"))).toEqual(expected);
        }
    });

    it("serializes empty input in every form", () => {
        for (const form of [[], new Uint8Array(), "0x", ""]) {
            expect(Array.from(ser(form, "vector<u8>"))).toEqual([0]);
        }
    });

    it("serializes vector<u8> inside an Option and a vector", () => {
        expect(Array.from(ser("0x0102", "0x1::option::Option<vector<u8>>"))).toEqual([1, 2, 1, 2]);
        expect(Array.from(ser(["0x01", new Uint8Array([2])], "vector<vector<u8>>"))).toEqual([2, 1, 1, 1, 2]);
    });

    it("rejects malformed input", () => {
        expect(() => ser("0x123", "vector<u8>")).toThrow(/Failed to serialize argument 0 \(vector<u8>\)/);
        expect(() => ser("0xzz", "vector<u8>")).toThrow(/hex string/);
        expect(() => ser([256], "vector<u8>")).toThrow(/Invalid u8/);
        expect(() => ser([-1], "vector<u8>")).toThrow(/Invalid u8/);
        expect(() => ser([1.5], "vector<u8>")).toThrow(/Invalid u8/);
        expect(() => ser(5, "vector<u8>")).toThrow(/vector<u8>/);
    });
});

describe("DynamicTransactionSerializer - invalid integer strings", () => {
    const types = ["u8", "u16", "u32", "u64", "u128", "u256"];

    it.each(types)("rejects empty and whitespace-only strings for %s", (type) => {
        for (const value of ["", " ", "\t", "\n "]) {
            expect(() => ser(value, type)).toThrow(`Failed to serialize argument 0 (${type})`);
        }
    });

    it.each(types)("rejects other malformed strings for %s", (type) => {
        for (const value of ["1.5", "-1", "0x", "1e3", "abc", " 5", "5 ", "+5", "0xg1"]) {
            expect(() => ser(value, type)).toThrow(`Failed to serialize argument 0 (${type})`);
        }
    });

    it("rejects values above the maximum of the type", () => {
        const max: Record<string, bigint> = {
            u8: 255n,
            u16: 65535n,
            u32: 4294967295n,
            u64: (1n << 64n) - 1n,
            u128: (1n << 128n) - 1n,
            u256: (1n << 256n) - 1n,
        };
        for (const type of types) {
            expect(() => ser((max[type]! + 1n).toString(), type)).toThrow(/out of range/);
            expect(() => ser(max[type]! + 1n, type)).toThrow(/out of range/);
            expect(() => ser(max[type]!.toString(), type)).not.toThrow();
        }
    });

    it("rejects values that are not a number, string or bigint", () => {
        expect(() => ser(true, "u64")).toThrow(/u64/);
        expect(() => ser({}, "u8")).toThrow(/u8/);
        expect(() => ser(Number.NaN, "u32")).toThrow(/integer/);
    });

    it("accepts decimal and 0x-prefixed hexadecimal strings", () => {
        expect(Array.from(ser("16", "u8"))).toEqual([16]);
        expect(Array.from(ser("0x10", "u8"))).toEqual([16]);
        expect(Array.from(ser("007", "u64"))).toEqual(Array.from(core((s) => s.serializeU64(7n))));
    });
});

describe("DynamicTransactionSerializer - numbers above Number.MAX_SAFE_INTEGER", () => {
    const UNSAFE = [2 ** 53, 2 ** 53 + 2, 9007199254740994, 2 ** 63];

    it.each(["u64", "u128", "u256"])("rejects a number that is not a safe integer for %s", (type) => {
        for (const value of UNSAFE) {
            expect(() => ser(value, type)).toThrow(/is not a safe integer.*use a bigint or a decimal string/);
        }
    });

    it.each(["u64", "u128", "u256"])(
        "accepts Number.MAX_SAFE_INTEGER, and larger values as bigint or string, for %s",
        (type) => {
            expect(() => ser(Number.MAX_SAFE_INTEGER, type)).not.toThrow();
            expect(Array.from(ser(2n ** 53n + 1n, type))).toEqual(Array.from(ser((2n ** 53n + 1n).toString(), type)));
        },
    );

    it("encodes 2^53 + 1 given as a bigint exactly", () => {
        expect(Array.from(ser(2n ** 53n + 1n, "u64"))).toEqual(Array.from(core((s) => s.serializeU64(2n ** 53n + 1n))));
    });

    it("reports an unsafe number for u8 to u32 as out of range", () => {
        for (const type of ["u8", "u16", "u32"]) {
            expect(() => ser(2 ** 60, type)).toThrow(/out of range/);
        }
    });

    it("checks numbers inside a vector and an Option", () => {
        expect(() => ser([1, 2 ** 53], "vector<u64>")).toThrow(/not a safe integer/);
        expect(() => ser(2 ** 53, "0x1::option::Option<u128>")).toThrow(/not a safe integer/);
    });
});

describe("DynamicTransactionSerializer - addresses", () => {
    it.each(["0x1", "0xa", "0x123", `0x${"ab".repeat(30)}`, `0x${"f".repeat(63)}`, `0x${"1".repeat(64)}`])(
        "encodes %s as 32 bytes",
        (address) => {
            const hex = address.slice(2).padStart(64, "0");
            expect(Buffer.from(ser(address, "address")).toString("hex")).toBe(hex);
        },
    );

    const OBJECT = "0x1::object::Object<T0>";
    const hexOf = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

    it.each(["address", OBJECT])("accepts %s without the 0x prefix and in upper case", (type) => {
        expect(hexOf(ser("1", type))).toBe("1".padStart(64, "0"));
        expect(hexOf(ser("0xABCdef", type))).toBe("abcdef".padStart(64, "0"));
    });

    it.each(["address", OBJECT])("refuses a %s argument without a hex digit, or malformed", (type) => {
        for (const value of ["", "0x", "0X1", " 0x1", "0x1 ", "0xzz", "0x-1", `0x${"1".repeat(65)}`]) {
            expect(() => ser(value, type)).toThrow(`Failed to serialize argument 0 (${type}): Expected an address`);
        }
    });

    it.each(["address", OBJECT])("refuses a %s argument that is not a string or HexString", (type) => {
        for (const value of [1, 1n, null, {}, [1]]) {
            expect(() => ser(value, type)).toThrow(/Expected an address/);
        }
    });

    it.each(["address", OBJECT])("gives a HexString %s argument the bytes of its string", (type) => {
        for (const address of ["0xa", "0x1234", `0x${"1".repeat(64)}`]) {
            expect(hexOf(ser(new HexString(address), type))).toBe(hexOf(ser(address, type)));
        }
    });

    it("checks addresses inside a vector and an Option", () => {
        expect(hexOf(ser(["0x1", new HexString("0x2")], "vector<address>"))).toBe(
            `02${"1".padStart(64, "0")}${"2".padStart(64, "0")}`,
        );
        expect(hexOf(ser(new HexString("0xa"), `0x1::option::Option<${OBJECT}>`))).toBe(`01${"a".padStart(64, "0")}`);
        expect(() => ser(["0x1", ""], "vector<address>")).toThrow(/Expected an address/);
        expect(() => ser("0x", "0x1::option::Option<address>")).toThrow(/Expected an address/);
    });
});
