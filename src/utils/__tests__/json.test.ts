import { stringifyWithBigInt } from "../json";

const UNSAFE_U64 = 9007199254740993n; // 2^53 + 1, the smallest u64 a `number` cannot hold
const MAX_U64 = 18446744073709551615n;

describe("stringifyWithBigInt", () => {
    it("should emit a bigint above MAX_SAFE_INTEGER as an exact number literal", () => {
        expect(stringifyWithBigInt({ U64: UNSAFE_U64 })).toBe('{"U64":9007199254740993}');
    });

    it("should emit u64::MAX exactly", () => {
        expect(stringifyWithBigInt({ U64: MAX_U64 })).toBe('{"U64":18446744073709551615}');
    });

    it("should not round-trip through Number", () => {
        const json = stringifyWithBigInt({ U64: UNSAFE_U64 });
        expect(json).not.toContain("9007199254740992");
    });

    it("should emit a top-level bigint", () => {
        expect(stringifyWithBigInt(UNSAFE_U64)).toBe("9007199254740993");
    });

    it("should emit bigints nested in arrays and objects", () => {
        const value = { args: [{ U64: UNSAFE_U64 }, { U64: 1000n }], meta: { seq: 42n } };
        expect(stringifyWithBigInt(value)).toBe(
            '{"args":[{"U64":9007199254740993},{"U64":1000}],"meta":{"seq":42}}',
        );
    });

    it("should emit a negative bigint", () => {
        expect(stringifyWithBigInt({ n: -9007199254740993n })).toBe('{"n":-9007199254740993}');
    });

    it("should match JSON.stringify exactly when there are no bigints", () => {
        const value = {
            function: "0x1::coin::balance",
            args: ["0x1", 5, true, null],
            nested: { a: [1, 2, 3] },
        };
        expect(stringifyWithBigInt(value)).toBe(JSON.stringify(value));
    });

    it("should leave a marker-shaped string untouched when there are no bigints", () => {
        const value = { note: "__supra_bigint__5__supra_bigint__" };
        expect(stringifyWithBigInt(value)).toBe(JSON.stringify(value));
    });

    it("should throw rather than emit a number the caller never supplied", () => {
        // A string that mimics the internal marker would otherwise be unwrapped into
        // a bare `5`. The serializer fails closed instead.
        expect(() =>
            stringifyWithBigInt({ seq: 1n, note: "__supra_bigint__5__supra_bigint__" }),
        ).toThrow(/Refusing to serialize/);
    });

    it("should throw when the value is not JSON-serializable", () => {
        expect(() => stringifyWithBigInt(undefined)).toThrow(/not JSON-serializable/);
    });
});
