import { sleep, fromUint8ArrayToJSArray, convertMoveValueToJSONParsable, convertMoveValue } from "../functions";

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
