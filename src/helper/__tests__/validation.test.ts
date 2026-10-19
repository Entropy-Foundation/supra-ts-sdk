import {
    validateAddress,
    validateFunctionId,
    validateMoveIdentifier,
    validateStructId,
    validateTransactionHash,
    validatePaginationCount,
    validateHexString,
    validateAmount,
    validateBlockHeight,
} from "../validation";

describe("validateAddress", () => {
    it("accepts valid hex addresses", () => {
        expect(() => validateAddress("0x1")).not.toThrow();
        expect(() => validateAddress("0x0000000000000000000000000000000000000000000000000000000000000001")).not.toThrow();
        expect(() => validateAddress("0xabcdef1234567890")).not.toThrow();
    });

    it("rejects non-hex strings", () => {
        expect(() => validateAddress("hello")).toThrow("Invalid address");
        expect(() => validateAddress("0xGGG")).toThrow("Invalid address");
        expect(() => validateAddress("")).toThrow("Invalid address");
    });

    it("rejects missing 0x prefix", () => {
        expect(() => validateAddress("1234")).toThrow("Invalid address");
    });

    it("rejects non-string types", () => {
        expect(() => validateAddress(123)).toThrow("Invalid address");
        expect(() => validateAddress(null)).toThrow("Invalid address");
        expect(() => validateAddress(undefined)).toThrow("Invalid address");
    });

    it("accepts HexString-like objects with valid toString()", () => {
        const hexString = { toString: () => "0x1" };
        expect(() => validateAddress(hexString)).not.toThrow();
    });

    it("uses custom paramName in error message", () => {
        expect(() => validateAddress("bad", "accountAddress")).toThrow("Invalid accountAddress");
    });
});

describe("validateFunctionId", () => {
    it("accepts valid function IDs", () => {
        expect(() => validateFunctionId("0x1::coin::balance")).not.toThrow();
        expect(() => validateFunctionId("0xabcd::my_module::my_function")).not.toThrow();
    });

    it("rejects wrong number of parts", () => {
        expect(() => validateFunctionId("0x1::coin")).toThrow("expected format");
        expect(() => validateFunctionId("0x1::coin::balance::extra")).toThrow("expected format");
    });

    it("rejects invalid address part", () => {
        expect(() => validateFunctionId("notaddr::coin::balance")).toThrow("Invalid function module address");
    });

    it("rejects invalid module name", () => {
        expect(() => validateFunctionId("0x1::123invalid::balance")).toThrow("module name");
    });

    it("rejects invalid function name", () => {
        expect(() => validateFunctionId("0x1::coin::123bad")).toThrow("function name");
    });

    it("rejects non-string input", () => {
        expect(() => validateFunctionId(123)).toThrow("expected a string");
    });
});

describe("validateStructId", () => {
    it("accepts valid struct IDs", () => {
        expect(() => validateStructId("0x1::coin::CoinStore")).not.toThrow();
    });

    it("accepts struct IDs with generics", () => {
        expect(() => validateStructId("0x1::coin::CoinStore<0x1::supra_coin::SupraCoin>")).not.toThrow();
    });

    it("rejects invalid format", () => {
        expect(() => validateStructId("not_a_struct")).toThrow("expected format");
    });

    it("rejects invalid address in struct ID", () => {
        expect(() => validateStructId("badaddr::coin::CoinStore")).toThrow("Invalid resourceType module address");
    });

    it.each(["0x1::../resources::X", "0x1::coin::Co/in", "0x1::coin::Co in", "0x1::::X", "0x1::1coin::X", "0x1::coin::"])(
        "rejects a module or struct name that is not a Move identifier: %s",
        (structId) => {
            expect(() => validateStructId(structId)).toThrow("Invalid resourceType");
        },
    );

    it("does not check the type arguments", () => {
        expect(() => validateStructId("0x1::coin::CoinStore<0x1::supra_coin::SupraCoin, vector<u8>>")).not.toThrow();
    });
});

describe("validateMoveIdentifier", () => {
    it.each(["coin", "_x", "Coin2", "a_b_C"])("accepts %s", (value) => {
        expect(() => validateMoveIdentifier(value)).not.toThrow();
    });

    it.each(["", "../resources", "a/b", "a b", "1a", "a-b", "a::b", "a%2Fb"])("rejects %j", (value) => {
        expect(() => validateMoveIdentifier(value, "moduleName")).toThrow("Invalid moduleName");
    });

    it("rejects a value that is not a string", () => {
        expect(() => validateMoveIdentifier(1)).toThrow("Invalid name");
    });
});

describe("validateTransactionHash", () => {
    it("accepts valid transaction hashes", () => {
        expect(() => validateTransactionHash("0xabc123")).not.toThrow();
        expect(() => validateTransactionHash("0x0000000000000000000000000000000000000000000000000000000000000001")).not.toThrow();
    });

    it("rejects non-hex values", () => {
        expect(() => validateTransactionHash("hello")).toThrow("Invalid transactionHash");
        expect(() => validateTransactionHash("0x")).toThrow("Invalid transactionHash");
    });

    it("rejects non-string types", () => {
        expect(() => validateTransactionHash(123)).toThrow("Invalid transactionHash");
    });
});

describe("validatePaginationCount", () => {
    it("accepts valid counts", () => {
        expect(() => validatePaginationCount(1)).not.toThrow();
        expect(() => validatePaginationCount(50)).not.toThrow();
        expect(() => validatePaginationCount(100)).not.toThrow();
    });

    it("accepts undefined/null", () => {
        expect(() => validatePaginationCount(undefined)).not.toThrow();
        expect(() => validatePaginationCount(null)).not.toThrow();
    });

    it("rejects out-of-range values", () => {
        expect(() => validatePaginationCount(0)).toThrow("expected an integer between 1 and 100");
        expect(() => validatePaginationCount(101)).toThrow("expected an integer between 1 and 100");
        expect(() => validatePaginationCount(-1)).toThrow("expected an integer between 1 and 100");
    });

    it("rejects non-integer values", () => {
        expect(() => validatePaginationCount(1.5)).toThrow("expected an integer between 1 and 100");
        expect(() => validatePaginationCount("10")).toThrow("expected an integer between 1 and 100");
    });
});

describe("validateHexString", () => {
    it("accepts 0x-prefixed hex", () => {
        expect(() => validateHexString("0xabc123")).not.toThrow();
        expect(() => validateHexString("0x1")).not.toThrow();
    });

    it("rejects non-hex / missing prefix / empty", () => {
        expect(() => validateHexString("abc123")).toThrow("expected a 0x-prefixed hex string");
        expect(() => validateHexString("0x")).toThrow("expected a 0x-prefixed hex string");
        expect(() => validateHexString("0xZZ")).toThrow("expected a 0x-prefixed hex string");
    });

    it("rejects non-string types and uses custom paramName", () => {
        expect(() => validateHexString(123, "blockHash")).toThrow("Invalid blockHash");
    });
});

describe("validateAmount", () => {
    it("accepts non-negative numbers and bigints", () => {
        expect(() => validateAmount(0)).not.toThrow();
        expect(() => validateAmount(100)).not.toThrow();
        expect(() => validateAmount(10n)).not.toThrow();
        expect(() => validateAmount(18446744073709551615n)).not.toThrow(); // > 2^53, valid as bigint
    });

    it("rejects negative amounts", () => {
        expect(() => validateAmount(-1)).toThrow("non-negative");
        expect(() => validateAmount(-1n)).toThrow("non-negative");
    });

    it("rejects fractional numbers", () => {
        expect(() => validateAmount(1.5)).toThrow("non-negative integer");
    });

    it("rejects numbers above the safe integer range (must use bigint)", () => {
        expect(() => validateAmount(Number.MAX_SAFE_INTEGER + 1)).toThrow("bigint");
    });

    it("rejects non-numeric types", () => {
        expect(() => validateAmount("100")).toThrow("Invalid amount");
        expect(() => validateAmount(null)).toThrow("Invalid amount");
    });
});

describe("validateBlockHeight", () => {
    it("accepts non-negative integers", () => {
        expect(() => validateBlockHeight(0)).not.toThrow();
        expect(() => validateBlockHeight(12345)).not.toThrow();
    });

    it("rejects negatives, fractions, and non-numbers", () => {
        expect(() => validateBlockHeight(-1)).toThrow("non-negative integer");
        expect(() => validateBlockHeight(1.5)).toThrow("non-negative integer");
        expect(() => validateBlockHeight("1")).toThrow("non-negative integer");
    });
});
