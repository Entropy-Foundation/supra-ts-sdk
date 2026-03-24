import { standardizeAddress } from "../account";
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

    it("should throw SupraAPIError for address longer than 64 chars", () => {
        const longAddr = "0x" + "a".repeat(65);
        expect(() => standardizeAddress(longAddr)).toThrow(SupraAPIError);
        try {
            standardizeAddress(longAddr);
        } catch (error) {
            const apiError = error as SupraAPIError;
            expect(apiError.status).toBe(400);
        }
    });
});
