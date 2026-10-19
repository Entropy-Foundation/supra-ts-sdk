import { TxnBuilderTypes, TypeTagParser } from "supra-l1-sdk-core";
import {
    sleep,
    fromUint8ArrayToJSArray,
    convertMoveValueToJSONParsable,
    convertMoveValue,
    parseFunctionTypeArgs,
    parseScriptArgs,
} from "../functions";

describe("sleep", () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it("should resolve after specified time", async () => {
        const promise = sleep(1000);
        jest.advanceTimersByTime(1000);
        await expect(promise).resolves.toBeUndefined();
    });
});

describe("fromUint8ArrayToJSArray", () => {
    it("should convert array of Uint8Arrays to array of number arrays", () => {
        const input = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])];
        const result = fromUint8ArrayToJSArray(input);
        expect(result).toEqual([[1, 2, 3], [4, 5]]);
    });

    it("should return empty array for empty input", () => {
        expect(fromUint8ArrayToJSArray([])).toEqual([]);
    });

    it("should handle single-element arrays", () => {
        const input = [new Uint8Array([255])];
        expect(fromUint8ArrayToJSArray(input)).toEqual([[255]]);
    });
});

describe("parseScriptArgs", () => {
    const UNSAFE_U64 = 9007199254740993n; // 2^53 + 1
    const MAX_U128 = 340282366920938463463374607431768211455n;

    it("should keep a u64 above MAX_SAFE_INTEGER as an exact bigint", () => {
        const result = parseScriptArgs([new TxnBuilderTypes.TransactionArgumentU64(UNSAFE_U64)]);
        expect(result).toEqual([{ U64: UNSAFE_U64 }]);
    });

    it("should keep a u128 exact", () => {
        const result = parseScriptArgs([new TxnBuilderTypes.TransactionArgumentU128(MAX_U128)]);
        expect(result).toEqual([{ U128: MAX_U128 }]);
    });

    it("should keep small u64 values exact too", () => {
        const result = parseScriptArgs([new TxnBuilderTypes.TransactionArgumentU64(1000n)]);
        expect(result).toEqual([{ U64: 1000n }]);
    });

    it("should parse the small integer, address, vector and bool variants", () => {
        const result = parseScriptArgs([
            new TxnBuilderTypes.TransactionArgumentU8(7),
            new TxnBuilderTypes.TransactionArgumentU32(70000),
            new TxnBuilderTypes.TransactionArgumentAddress(
                TxnBuilderTypes.AccountAddress.fromHex("0x1"),
            ),
            new TxnBuilderTypes.TransactionArgumentU8Vector(new Uint8Array([1, 2, 3])),
            new TxnBuilderTypes.TransactionArgumentBool(true),
        ]);

        expect(result[0]).toEqual({ U8: 7 });
        expect(result[1]).toEqual({ U32: 70000 });
        expect(result[2]).toEqual({
            Address: "0x0000000000000000000000000000000000000000000000000000000000000001",
        });
        expect(result[3]).toEqual({ U8Vector: [1, 2, 3] });
        expect(result[4]).toEqual({ Bool: true });
    });

    it("should parse the u16 variant", () => {
        expect(parseScriptArgs([new TxnBuilderTypes.TransactionArgumentU16(65535)])).toEqual([{ U16: 65535 }]);
    });

    it("should parse the u32 variant at its maximum", () => {
        expect(parseScriptArgs([new TxnBuilderTypes.TransactionArgumentU32(4294967295)])).toEqual([
            { U32: 4294967295 },
        ]);
    });

    it("should write a u256 as its 32 little-endian bytes", () => {
        const [arg] = parseScriptArgs([new TxnBuilderTypes.TransactionArgumentU256((1n << 256n) - 1n)]);
        expect(arg).toEqual({ U256: new Array(32).fill(255) });

        const [small] = parseScriptArgs([new TxnBuilderTypes.TransactionArgumentU256(0x0102n)]);
        expect(small).toEqual({ U256: [2, 1, ...new Array(30).fill(0)] });
    });

    it("should parse every variant of TransactionArgument in order", () => {
        const result = parseScriptArgs([
            new TxnBuilderTypes.TransactionArgumentU8(1),
            new TxnBuilderTypes.TransactionArgumentU16(2),
            new TxnBuilderTypes.TransactionArgumentU32(3),
            new TxnBuilderTypes.TransactionArgumentU64(4n),
            new TxnBuilderTypes.TransactionArgumentU128(5n),
            new TxnBuilderTypes.TransactionArgumentU256(6n),
            new TxnBuilderTypes.TransactionArgumentAddress(TxnBuilderTypes.AccountAddress.fromHex("0x7")),
            new TxnBuilderTypes.TransactionArgumentU8Vector(new Uint8Array([8])),
            new TxnBuilderTypes.TransactionArgumentBool(false),
        ]);
        expect(result.map((arg) => Object.keys(arg)[0])).toEqual([
            "U8",
            "U16",
            "U32",
            "U64",
            "U128",
            "U256",
            "Address",
            "U8Vector",
            "Bool",
        ]);
    });

    it("should throw for an argument that is not a TransactionArgument variant", () => {
        expect(() => parseScriptArgs([{} as TxnBuilderTypes.TransactionArgument])).toThrow(
            "Invalid script argument variant",
        );
    });

    it("should return an empty array for no arguments", () => {
        expect(parseScriptArgs([])).toEqual([]);
    });
});

describe("parseFunctionTypeArgs", () => {
    const parse = (type: string) => new TypeTagParser(type).parseTypeTag();

    it("should return an empty array for no type arguments", () => {
        expect(parseFunctionTypeArgs([])).toEqual([]);
    });

    it("should convert primitive, vector and struct type arguments in one call", () => {
        const result = parseFunctionTypeArgs([
            parse("u64"),
            parse("address"),
            parse("vector<u8>"),
            parse("vector<0x1::string::String>"),
            parse("0x1::coin::CoinStore<0x1::supra_coin::SupraCoin>"),
        ]);
        const one = "0x0000000000000000000000000000000000000000000000000000000000000001";
        const struct = (module: string, name: string, type_args: unknown[] = []) => ({
            struct: { address: one, module, name, type_args },
        });
        expect(result).toEqual([
            "u64",
            "address",
            { vector: "u8" },
            { vector: struct("string", "String") },
            struct("coin", "CoinStore", [struct("supra_coin", "SupraCoin")]),
        ]);
    });
});

describe("convertMoveValueToJSONParsable", () => {
    it("should convert u8 to String", () => {
        expect(convertMoveValueToJSONParsable("u8", 42)).toBe("42");
    });

    it("should convert u16 to String", () => {
        expect(convertMoveValueToJSONParsable("u16", 1000)).toBe("1000");
    });

    it("should convert u32 to String", () => {
        expect(convertMoveValueToJSONParsable("u32", 100000)).toBe("100000");
    });

    it("should convert u64 to String", () => {
        expect(convertMoveValueToJSONParsable("u64", 100n)).toBe("100");
    });

    it("should convert u128 to String", () => {
        expect(convertMoveValueToJSONParsable("u128", 999n)).toBe("999");
    });

    it("should convert u256 to String", () => {
        expect(convertMoveValueToJSONParsable("u256", 12345n)).toBe("12345");
    });

    it("should convert address to String", () => {
        expect(convertMoveValueToJSONParsable("address", "0x1")).toBe("0x1");
    });

    it("should convert bool", () => {
        expect(convertMoveValueToJSONParsable("bool", true)).toBe(true);
        expect(convertMoveValueToJSONParsable("bool", false)).toBe(false);
    });

    it("should recursively convert vector<u8>", () => {
        expect(convertMoveValueToJSONParsable("vector<u8>", [1, 2, 3])).toEqual(["1", "2", "3"]);
    });

    it("should recursively convert vector<u64>", () => {
        expect(convertMoveValueToJSONParsable("vector<u64>", [100n, 200n])).toEqual(["100", "200"]);
    });

    it("should pass through unknown types", () => {
        const value = { custom: "data" };
        expect(convertMoveValueToJSONParsable("unknown_type", value)).toBe(value);
    });
});

describe("convertMoveValue", () => {
    it("should convert u8 to Number", () => {
        expect(convertMoveValue("u8", "42")).toBe(42);
    });

    it("should convert u16 to Number", () => {
        expect(convertMoveValue("u16", "1000")).toBe(1000);
    });

    it("should convert u32 to Number", () => {
        expect(convertMoveValue("u32", "100000")).toBe(100000);
    });

    it("should convert u64 to BigInt", () => {
        expect(convertMoveValue("u64", "100")).toBe(100n);
    });

    it("should convert u128 to BigInt", () => {
        expect(convertMoveValue("u128", "999")).toBe(999n);
    });

    it("should convert u256 to BigInt", () => {
        expect(convertMoveValue("u256", "12345")).toBe(12345n);
    });

    it("should convert address to String", () => {
        expect(convertMoveValue("address", "0x1")).toBe("0x1");
    });

    it("should convert bool to Boolean", () => {
        expect(convertMoveValue("bool", true)).toBe(true);
        expect(convertMoveValue("bool", false)).toBe(false);
    });

    it("should recursively convert vector<u8> to array of Numbers", () => {
        expect(convertMoveValue("vector<u8>", ["1", "2", "3"])).toEqual([1, 2, 3]);
    });

    it("should recursively convert vector<u64> to array of BigInts", () => {
        expect(convertMoveValue("vector<u64>", ["100", "200"])).toEqual([100n, 200n]);
    });

    it("should pass through unknown types", () => {
        const value = { custom: "data" };
        expect(convertMoveValue("unknown_type", value)).toBe(value);
    });
});
