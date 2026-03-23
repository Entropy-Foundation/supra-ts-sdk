import {
    getFunctionParts,
    convertArgsValueToJSONParsable,
    convertValueToReturnTypedValue,
    convertValueToAbiReturnTypedValue,
    convertPayloadTypeArgsToJSONParsable,
    convertPayloadArgsToJSONParsable,
    convertTypeArgsValueToJSONParsable,
    isOption,
    extractOptionInner,
    extractVectorInner,
    isMoveStruct,
} from "../general";
import type { MoveFunction } from "../../types/move";

function createMockFunction(overrides: Partial<MoveFunction> = {}): MoveFunction {
    return {
        name: "test_fn",
        visibility: "public",
        is_entry: false,
        is_view: true,
        generic_type_params: [],
        params: [],
        return: [],
        ...overrides,
    };
}

describe("getFunctionParts", () => {
    it("should parse valid 3-part function ID", () => {
        const result = getFunctionParts("0x1::coin::balance" as `${string}::${string}::${string}`);
        expect(result).toEqual({
            moduleAddress: "0x1",
            moduleName: "coin",
            functionName: "balance",
        });
    });

    it("should parse full hex address", () => {
        const addr = "0x0000000000000000000000000000000000000000000000000000000000000001";
        const result = getFunctionParts(`${addr}::module::func` as `${string}::${string}::${string}`);
        expect(result.moduleAddress).toBe(addr);
    });

    it("should throw for 2-part input", () => {
        expect(() => getFunctionParts("0x1::coin" as any)).toThrow("Invalid function");
    });

    it("should throw for 4-part input", () => {
        expect(() => getFunctionParts("0x1::coin::balance::extra" as any)).toThrow("Invalid function");
    });

    it("should throw for single string", () => {
        expect(() => getFunctionParts("just_a_name" as any)).toThrow("Invalid function");
    });
});

describe("convertArgsValueToJSONParsable", () => {
    // Null/undefined with Option
    it("should return { vec: '' } for null Option<u8>", () => {
        expect(convertArgsValueToJSONParsable("0x1::option::Option<u8>", null)).toEqual({ vec: "" });
    });

    it("should return { vec: [] } for null Option<vector<u8>>", () => {
        expect(convertArgsValueToJSONParsable("0x1::option::Option<vector<u8>>", null)).toEqual({ vec: [] });
    });

    it("should return { vec: [] } for null Option<u64>", () => {
        expect(convertArgsValueToJSONParsable("0x1::option::Option<u64>", null)).toEqual({ vec: [] });
    });

    it("should return null for null non-Option type", () => {
        expect(convertArgsValueToJSONParsable("u64", null)).toBeNull();
    });

    // Option<u8> with value
    it("should wrap Option<u8> value as { vec: String(value) }", () => {
        expect(convertArgsValueToJSONParsable("0x1::option::Option<u8>", 42)).toEqual({ vec: "42" });
    });

    // Option<vector<u8>> with string value
    it("should wrap Option<vector<u8>> string value", () => {
        expect(convertArgsValueToJSONParsable("0x1::option::Option<vector<u8>>", "0xdeadbeef")).toEqual({ vec: ["0xdeadbeef"] });
    });

    // Option<vector<u8>> with Uint8Array
    it("should convert Option<vector<u8>> Uint8Array to hex", () => {
        const result = convertArgsValueToJSONParsable("0x1::option::Option<vector<u8>>", new Uint8Array([0xde, 0xad]));
        expect(result).toEqual({ vec: ["dead"] });
    });

    // Option<u64> with value
    it("should wrap Option<u64> value", () => {
        expect(convertArgsValueToJSONParsable("0x1::option::Option<u64>", 100n)).toEqual({ vec: ["100"] });
    });

    // vector<u8> with string
    it("should pass string through for vector<u8>", () => {
        expect(convertArgsValueToJSONParsable("vector<u8>", "0xdeadbeef")).toBe("0xdeadbeef");
    });

    // vector<u8> with Uint8Array
    it("should convert Uint8Array to hex for vector<u8>", () => {
        const result = convertArgsValueToJSONParsable("vector<u8>", new Uint8Array([255, 0, 10]));
        expect(result).toBe("ff000a");
    });

    // vector<u8> with ArrayBuffer
    it("should convert ArrayBuffer to hex for vector<u8>", () => {
        const buffer = new Uint8Array([1, 2]).buffer;
        const result = convertArgsValueToJSONParsable("vector<u8>", buffer);
        expect(result).toBe("0102");
    });

    // vector<u8> with number array
    it("should convert number array to hex for vector<u8>", () => {
        const result = convertArgsValueToJSONParsable("vector<u8>", [255, 0, 16]);
        expect(result).toBe("ff0010");
    });

    // vector<u8> with invalid value in array
    it("should throw for invalid u8 value in vector<u8>", () => {
        expect(() => convertArgsValueToJSONParsable("vector<u8>", [256])).toThrow("Invalid u8 value");
    });

    // vector<T>
    it("should recursively convert vector<u64>", () => {
        const result = convertArgsValueToJSONParsable("vector<u64>", [100n, 200n]);
        expect(result).toEqual(["100", "200"]);
    });

    it("should throw for non-array vector<T> value", () => {
        expect(() => convertArgsValueToJSONParsable("vector<u64>", "not an array")).toThrow("Expected array");
    });

    // Primitives
    it("should convert u8 to Number", () => {
        expect(convertArgsValueToJSONParsable("u8", 42)).toBe(42);
    });

    it("should convert u16 to Number", () => {
        expect(convertArgsValueToJSONParsable("u16", 1000)).toBe(1000);
    });

    it("should convert u32 to Number", () => {
        expect(convertArgsValueToJSONParsable("u32", 100000)).toBe(100000);
    });

    it("should convert u64 to string", () => {
        expect(convertArgsValueToJSONParsable("u64", 100n)).toBe("100");
    });

    it("should convert u128 to string", () => {
        expect(convertArgsValueToJSONParsable("u128", 999n)).toBe("999");
    });

    it("should convert u256 to string", () => {
        expect(convertArgsValueToJSONParsable("u256", 12345n)).toBe("12345");
    });

    it("should convert bool", () => {
        expect(convertArgsValueToJSONParsable("bool", true)).toBe(true);
        expect(convertArgsValueToJSONParsable("bool", false)).toBe(false);
    });

    it("should convert address to string", () => {
        expect(convertArgsValueToJSONParsable("address", "0x1")).toBe("0x1");
    });

    // Struct passthrough
    it("should pass through struct values", () => {
        const structValue = { inner: "0x1" };
        expect(convertArgsValueToJSONParsable("0x1::object::Object<0x1::supra_coin::SupraCoin>", structValue)).toBe(structValue);
    });
});

describe("convertValueToReturnTypedValue", () => {
    // Object<T>
    it("should extract .inner from Object<T>", () => {
        expect(convertValueToReturnTypedValue("0x1::object::Object<0x1::coin::CoinStore>", { inner: "0xabc" })).toBe("0xabc");
    });

    // Option
    it("should return .vec for Option<u8>", () => {
        expect(convertValueToReturnTypedValue("0x1::option::Option<u8>", { vec: "42" })).toBe("42");
    });

    it("should return null for empty Option", () => {
        expect(convertValueToReturnTypedValue("0x1::option::Option<u64>", { vec: [] })).toBeNull();
    });

    it("should recursively convert non-empty Option", () => {
        expect(convertValueToReturnTypedValue("0x1::option::Option<u64>", { vec: ["100"] })).toBe(100n);
    });

    // vector<u8>
    it("should pass through string for vector<u8>", () => {
        expect(convertValueToReturnTypedValue("vector<u8>", "0xdeadbeef")).toBe("0xdeadbeef");
    });

    // vector<T>
    it("should recursively convert vector<u64>", () => {
        expect(convertValueToReturnTypedValue("vector<u64>", ["100", "200"])).toEqual([100n, 200n]);
    });

    // Primitives
    it("should convert u8 to Number", () => {
        expect(convertValueToReturnTypedValue("u8", "42")).toBe(42);
    });

    it("should convert u16 to Number", () => {
        expect(convertValueToReturnTypedValue("u16", "1000")).toBe(1000);
    });

    it("should convert u32 to Number", () => {
        expect(convertValueToReturnTypedValue("u32", 100000)).toBe(100000);
    });

    it("should convert u64 to BigInt", () => {
        expect(convertValueToReturnTypedValue("u64", "100")).toBe(100n);
    });

    it("should convert u128 to BigInt", () => {
        expect(convertValueToReturnTypedValue("u128", "999")).toBe(999n);
    });

    it("should convert u256 to BigInt", () => {
        expect(convertValueToReturnTypedValue("u256", "12345")).toBe(12345n);
    });

    it("should convert bool to Boolean", () => {
        expect(convertValueToReturnTypedValue("bool", true)).toBe(true);
    });

    it("should convert address to String", () => {
        expect(convertValueToReturnTypedValue("address", "0x1")).toBe("0x1");
    });

    // Struct passthrough
    it("should pass through struct values", () => {
        const value = { field: "data" };
        expect(convertValueToReturnTypedValue("0x1::module::Type", value)).toBe(value);
    });
});

describe("convertValueToAbiReturnTypedValue", () => {
    it("should return empty array for empty return types", () => {
        expect(convertValueToAbiReturnTypedValue([], [])).toEqual([]);
    });

    it("should convert single return type", () => {
        const result = convertValueToAbiReturnTypedValue(["u64"], ["100"]);
        expect(result).toEqual([100n]);
    });

    it("should convert multiple return types", () => {
        const result = convertValueToAbiReturnTypedValue(
            ["u64", "bool", "address"],
            ["100", true, "0x1"],
        );
        expect(result).toEqual([100n, true, "0x1"]);
    });
});

describe("isOption", () => {
    it("should return true for Option type", () => {
        expect(isOption("0x1::option::Option<u8>")).toBe(true);
    });

    it("should return true for Option with full hex address", () => {
        expect(isOption("0x0000000000000000000000000000000000000000000000000000000000000001::option::Option<u64>")).toBe(true);
    });

    it("should return false for non-Option type", () => {
        expect(isOption("u8")).toBe(false);
    });

    it("should return false for vector type", () => {
        expect(isOption("vector<u8>")).toBe(false);
    });
});

describe("extractOptionInner", () => {
    it("should extract inner type from Option", () => {
        expect(extractOptionInner("0x1::option::Option<u8>")).toBe("u8");
    });

    it("should extract complex inner type", () => {
        expect(extractOptionInner("0x1::option::Option<vector<u8>>")).toBe("vector<u8>");
    });

    it("should return null for non-Option", () => {
        expect(extractOptionInner("u8")).toBeNull();
    });
});

describe("extractVectorInner", () => {
    it("should extract inner type from vector", () => {
        expect(extractVectorInner("vector<u8>")).toBe("u8");
    });

    it("should extract nested vector type", () => {
        expect(extractVectorInner("vector<vector<u8>>")).toBe("vector<u8>");
    });

    it("should return null for non-vector", () => {
        expect(extractVectorInner("u8")).toBeNull();
    });
});

describe("isMoveStruct", () => {
    it("should return true for valid struct type", () => {
        expect(isMoveStruct("0x1::coin::CoinStore")).toBe(true);
    });

    it("should return false for primitive type", () => {
        expect(isMoveStruct("u8")).toBe(false);
    });

    it("should return false for vector type", () => {
        expect(isMoveStruct("vector<u8>")).toBe(false);
    });

    it("should return false for generic struct (has angle brackets)", () => {
        expect(isMoveStruct("0x1::coin::CoinStore<0x1::supra_coin::SupraCoin>")).toBe(false);
    });
});

describe("convertPayloadTypeArgsToJSONParsable", () => {
    it("should return empty array when no type arguments", () => {
        const fn = createMockFunction();
        expect(convertPayloadTypeArgsToJSONParsable(fn, {
            function: "0x1::coin::balance" as `${string}::${string}::${string}`,
        })).toEqual([]);
    });

    it("should throw on length mismatch", () => {
        const fn = createMockFunction({ generic_type_params: [{ constraints: [] }] });
        expect(() =>
            convertPayloadTypeArgsToJSONParsable(fn, {
                function: "0x1::coin::balance" as `${string}::${string}::${string}`,
                typeArguments: ["0x1::supra_coin::SupraCoin", "0x1::other::Type"],
            }),
        ).toThrow();
    });

    it("should convert string type arguments", () => {
        const fn = createMockFunction({ generic_type_params: [{ constraints: [] }] });
        const result = convertPayloadTypeArgsToJSONParsable(fn, {
            function: "0x1::coin::balance" as `${string}::${string}::${string}`,
            typeArguments: ["0x1::supra_coin::SupraCoin"],
        });
        expect(result).toEqual(["0x1::supra_coin::SupraCoin"]);
    });
});

describe("convertPayloadArgsToJSONParsable", () => {
    it("should return empty array when no arguments", () => {
        const fn = createMockFunction();
        expect(convertPayloadArgsToJSONParsable(fn, {
            function: "0x1::coin::balance" as `${string}::${string}::${string}`,
        })).toEqual([]);
    });

    it("should throw on argument count mismatch", () => {
        const fn = createMockFunction({ params: ["address", "u64"] });
        expect(() =>
            convertPayloadArgsToJSONParsable(fn, {
                function: "0x1::coin::balance" as `${string}::${string}::${string}`,
                functionArguments: ["0x1"],
            }),
        ).toThrow();
    });

    it("should convert arguments according to param types", () => {
        const fn = createMockFunction({ params: ["address", "u64"] });
        const result = convertPayloadArgsToJSONParsable(fn, {
            function: "0x1::coin::transfer" as `${string}::${string}::${string}`,
            functionArguments: ["0x1", 100n],
        });
        expect(result).toEqual(["0x1", "100"]);
    });
});

describe("convertTypeArgsValueToJSONParsable", () => {
    it("should pass through string values", () => {
        expect(convertTypeArgsValueToJSONParsable("0x1::supra_coin::SupraCoin")).toBe("0x1::supra_coin::SupraCoin");
    });

    it("should throw for undefined", () => {
        expect(() => convertTypeArgsValueToJSONParsable(undefined)).toThrow("Invalid type argument");
    });
});
