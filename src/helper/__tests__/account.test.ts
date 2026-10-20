import { HexString } from "supra-l1-sdk-core";
import { addressToBytes, standardizeAddress } from "../account";
import { validateAddress } from "../validation";
import { SupraAPIError } from "../../errors/apiError";

describe("standardizeAddress", () => {
    it("should pad short address to 64 chars with 0x prefix", () => {
        const result = standardizeAddress("0x1");
        expect(result).toBe("0x0000000000000000000000000000000000000000000000000000000000000001");
        expect(result.length).toBe(66); // 0x + 64 chars
    });

    it("should pass through full 64-char address unchanged", () => {
        const fullAddr = "0x0000000000000000000000000000000000000000000000000000000000000001";
        const result = standardizeAddress(fullAddr);
        expect(result).toBe(fullAddr);
    });

    it("should pad address 0x0 correctly", () => {
        const result = standardizeAddress("0x0");
        expect(result).toBe("0x0000000000000000000000000000000000000000000000000000000000000000");
    });

    it("should pad medium-length address", () => {
        const result = standardizeAddress("0xabcdef");
        expect(result).toMatch(/^0x0+abcdef$/);
        expect(result.length).toBe(66);
    });

    it("should throw a RangeError, not an API error, for address longer than 64 chars", () => {
        const longAddr = "0x" + "a".repeat(65);
        expect(() => standardizeAddress(longAddr)).toThrow(RangeError);
        expect(() => standardizeAddress(longAddr)).not.toThrow(SupraAPIError);
    });

    it("should lower-case the hex digits", () => {
        expect(standardizeAddress("0xA")).toBe("0x" + "0".repeat(63) + "a");
        expect(standardizeAddress("0xAB" + "CD".repeat(31))).toBe("0xab" + "cd".repeat(31));
        expect(standardizeAddress("ABC")).toBe("0x" + "0".repeat(61) + "abc");
    });

    it("accepts an upper-case 0X prefix", () => {
        expect(standardizeAddress("0XA")).toBe("0x" + "0".repeat(63) + "a");
        expect(standardizeAddress("0XAB")).toBe("0x" + "0".repeat(62) + "ab");
        expect(standardizeAddress("0X" + "F".repeat(64))).toBe("0x" + "f".repeat(64));
    });

    it("accepts digits without a prefix", () => {
        expect(standardizeAddress("ab")).toBe("0x" + "0".repeat(62) + "ab");
        expect(standardizeAddress("F".repeat(64))).toBe("0x" + "f".repeat(64));
    });

    it("standardizes a HexString", () => {
        expect(standardizeAddress(new HexString("0xAB"))).toBe("0x" + "0".repeat(62) + "ab");
        expect(standardizeAddress(new HexString("ab"))).toBe("0x" + "0".repeat(62) + "ab");
    });

    it.each([
        ["an empty string", ""],
        ["a prefix without digits", "0x"],
        ["an upper-case prefix without digits", "0X"],
        ["a value that is not hex", "0xzz"],
        ["a second prefix", "0x0xab"],
        ["65 digits", "0x" + "f".repeat(65)],
        ["65 digits after an upper-case prefix", "0X" + "F".repeat(65)],
        ["a space", "0x ab"],
        ["a sign", "-0x1"],
    ])("throws a RangeError for %s", (_name, address) => {
        expect(() => standardizeAddress(address)).toThrow(RangeError);
    });

    it("throws a RangeError for a HexString built from a value with an upper-case prefix", () => {
        // `HexString` adds a `0x` prefix to `0XAB`, which gives `0x0XAB`.
        expect(() => standardizeAddress(new HexString("0XAB"))).toThrow(RangeError);
    });
});

describe("addressToBytes", () => {
    it.each(["1", "a", "123", "ab".repeat(31), "f".repeat(63), "1".repeat(64)])(
        "encodes every address that validateAddress accepts as 32 bytes: 0x%s",
        (hex) => {
            validateAddress(`0x${hex}`);
            const bytes = addressToBytes(`0x${hex}`);
            expect(bytes).toHaveLength(32);
            expect(Buffer.from(bytes).toString("hex")).toBe(hex.padStart(64, "0"));
        },
    );

    it("accepts a string without 0x prefix", () => {
        expect(Buffer.from(addressToBytes("a")).toString("hex")).toBe("a".padStart(64, "0"));
    });

    it("throws for more than 64 hex characters", () => {
        expect(() => addressToBytes(`0x${"1".repeat(65)}`)).toThrow(RangeError);
    });
});
