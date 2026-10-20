import {
    getFunctionParts,
    convertArgsValueToJSONParsable,
    convertValueToReturnTypedValue,
    convertValueToAbiReturnTypedValue,
    convertPayloadTypeArgsToJSONParsable,
    convertPayloadArgsToJSONParsable,
    convertTypeArgsValueToJSONParsable,
    convertTypeArgsValueToMoveTypeValue,
    isOption,
    extractOptionInner,
    extractVectorInner,
    isMoveStruct,
} from "../general";
import { HexString, TxnBuilderTypes, TypeTagParser } from "supra-l1-sdk-core";
import { parseTypeArgument, typeTagToString } from "../typeTag";
import type { MoveFunction, MoveModule } from "../../types/move";
import type { NetworkConfig } from "../../utils/apiEndpoints";
import { generateViewFunctionPayload } from "../view";

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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(() => getFunctionParts("0x1::coin" as any)).toThrow("Invalid function");
    });

    it("should throw for 4-part input", () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(() => getFunctionParts("0x1::coin::balance::extra" as any)).toThrow("Invalid function");
    });

    it("should throw for single string", () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    it("should encode the Option<u8> value as vector<u8> hex", () => {
        expect(convertArgsValueToJSONParsable("0x1::option::Option<u8>", 42)).toEqual({ vec: "2a" });
    });

    // Option<vector<u8>> with string value
    it("should wrap Option<vector<u8>> string value", () => {
        expect(convertArgsValueToJSONParsable("0x1::option::Option<vector<u8>>", "0xdeadbeef")).toEqual({
            vec: ["0xdeadbeef"],
        });
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

    it("should convert the strings true and false to booleans", () => {
        expect(convertArgsValueToJSONParsable("bool", "true")).toBe(true);
        expect(convertArgsValueToJSONParsable("bool", "false")).toBe(false);
        expect(convertArgsValueToJSONParsable("vector<bool>", ["false", true])).toEqual([false, true]);
        expect(convertArgsValueToJSONParsable("0x1::option::Option<bool>", "false")).toEqual({ vec: [false] });
    });

    it("should refuse other bool values", () => {
        for (const value of ["0", "1", "", "False", "yes", 0, 1, {}]) {
            expect(() => convertArgsValueToJSONParsable("bool", value as string)).toThrow(
                'Expected a boolean, "true" or "false" for bool',
            );
        }
    });

    it("should convert address to string", () => {
        expect(convertArgsValueToJSONParsable("address", "0x1")).toBe("0x1");
    });

    // Struct passthrough
    it("should pass through struct values", () => {
        const structValue = { field: "0x1" };
        expect(convertArgsValueToJSONParsable("0x1::m::S", structValue)).toBe(structValue);
    });
});

describe("address and Object<T> view arguments", () => {
    const OBJECT = "0x1::object::Object<T0>";

    it.each(["address", OBJECT])("sends a %s string as given", (type) => {
        for (const address of ["0x1", "0xa", "a", "0xABCdef", `0x${"1".repeat(64)}`]) {
            expect(convertArgsValueToJSONParsable(type, address)).toBe(address);
        }
    });

    it.each(["address", OBJECT])("sends a HexString %s argument as its string", (type) => {
        expect(convertArgsValueToJSONParsable(type, new HexString("0xa"))).toBe("0xa");
        expect(convertArgsValueToJSONParsable(`vector<${type}>`, [new HexString("0x1"), "0x2"])).toEqual([
            "0x1",
            "0x2",
        ]);
        expect(convertArgsValueToJSONParsable(`0x1::option::Option<${type}>`, new HexString("0x3"))).toEqual({
            vec: ["0x3"],
        });
    });

    it.each(["address", OBJECT])("refuses a %s argument without a hex digit, or malformed", (type) => {
        for (const value of ["", "0x", "0X1", " 0x1", "0xzz", `0x${"1".repeat(65)}`, 1, {}, { inner: "0x1" }]) {
            expect(() => convertArgsValueToJSONParsable(type, value as string)).toThrow(/Expected an address/);
        }
    });
});

describe("convertValueToReturnTypedValue", () => {
    // Object<T>
    it("should extract .inner from Object<T>", () => {
        expect(convertValueToReturnTypedValue("0x1::object::Object<0x1::coin::CoinStore>", { inner: "0xabc" })).toBe(
            "0xabc",
        );
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
        const result = convertValueToAbiReturnTypedValue(["u64", "bool", "address"], ["100", true, "0x1"]);
        expect(result).toEqual([100n, true, "0x1"]);
    });
});

describe("isOption", () => {
    it("should return true for Option type", () => {
        expect(isOption("0x1::option::Option<u8>")).toBe(true);
    });

    it("should return true for Option with full hex address", () => {
        expect(
            isOption("0x0000000000000000000000000000000000000000000000000000000000000001::option::Option<u64>"),
        ).toBe(true);
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
        expect(
            convertPayloadTypeArgsToJSONParsable(fn, {
                function: "0x1::coin::balance" as `${string}::${string}::${string}`,
            }),
        ).toEqual([]);
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
        expect(
            convertPayloadArgsToJSONParsable(fn, {
                function: "0x1::coin::balance" as `${string}::${string}::${string}`,
            }),
        ).toEqual([]);
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

    it.each([
        "u64",
        "address",
        "vector<u8>",
        "vector<0x1::string::String>",
        "0x1::coin::CoinStore<0x1::supra_coin::SupraCoin>",
    ])("should give a TypeTag the same string as the string form of %s", (type) => {
        expect(convertTypeArgsValueToJSONParsable(new TypeTagParser(type).parseTypeTag())).toBe(type);
    });

    it("sends a valid string unchanged, including an Object type", () => {
        for (const type of [
            "0x1::object::Object<0x1::fungible_asset::Metadata>",
            "vector<0x1::object::Object<0x1::object::ObjectCore>>",
            "0x1::coin::CoinStore< 0x1::supra_coin::SupraCoin >",
        ]) {
            expect(convertTypeArgsValueToJSONParsable(type)).toBe(type);
        }
    });

    it.each(["u64 junk", "0x1::supra_coin::SupraCoin, u8", "T0", "string", ""])(
        "refuses the malformed string %j",
        (type) => {
            expect(() => convertTypeArgsValueToJSONParsable(type)).toThrow(/Invalid type argument/);
        },
    );
});

describe("convertTypeArgsValueToMoveTypeValue", () => {
    it("parses 0x1::object::Object<T> as the struct Object, not as address", () => {
        const tag = convertTypeArgsValueToMoveTypeValue("0x1::object::Object<0x1::fungible_asset::Metadata>");
        expect(tag).toBeInstanceOf(TxnBuilderTypes.TypeTagStruct);
        expect(typeTagToString(tag)).toBe("0x1::object::Object<0x1::fungible_asset::Metadata>");
        expect(typeTagToString(convertTypeArgsValueToMoveTypeValue("vector<0x1::object::Object<0x1::m::S>>"))).toBe(
            "vector<0x1::object::Object<0x1::m::S>>",
        );
    });

    it("refuses text after the type and generic type parameters", () => {
        expect(() => convertTypeArgsValueToMoveTypeValue("u64 junk")).toThrow(/after the type/);
        expect(() => convertTypeArgsValueToMoveTypeValue("u64>")).toThrow(/after the type/);
        expect(() => convertTypeArgsValueToMoveTypeValue("T1")).toThrow(/generic type parameter/);
    });

    it("returns a TypeTag as given", () => {
        const tag = new TxnBuilderTypes.TypeTagU64();
        expect(convertTypeArgsValueToMoveTypeValue(tag)).toBe(tag);
    });

    it.each([
        "0x1::object::Object<0x1::fungible_asset::Metadata>",
        "0xabc::usdt0::USDT0",
        "0x1::coin::CoinStore<0x1::supra_coin::SupraCoin>",
        "vector<u8>",
    ])("gives an entry function the type a view function sends for %s", (type) => {
        const entry = typeTagToString(convertTypeArgsValueToMoveTypeValue(type));
        const view = convertTypeArgsValueToJSONParsable(type);
        expect(entry).toBe(typeTagToString(parseTypeArgument(view)));
    });
});

describe("type arguments of a view function", () => {
    const abi: MoveModule = {
        address: "0x1",
        name: "m",
        friends: [],
        exposed_functions: [
            createMockFunction({ name: "f", generic_type_params: [{ constraints: [] }], params: ["u64"] }),
        ],
        structs: [],
    };

    it.each(["u64", "vector<u8>", "0x1::coin::CoinStore<0x1::supra_coin::SupraCoin>"])(
        "should send the same request body for a TypeTag and a string, for %s",
        async (type) => {
            const common = { function: "0x1::m::f" as const, functionArguments: [5n], abi };
            const fromString = await generateViewFunctionPayload(
                { ...common, typeArguments: [type] },
                {} as NetworkConfig,
            );
            const fromTag = await generateViewFunctionPayload(
                { ...common, typeArguments: [new TypeTagParser(type).parseTypeTag()] },
                {} as NetworkConfig,
            );
            expect(fromTag).toEqual(fromString);
            expect(fromTag.typeArguments).toEqual([type]);
        },
    );
});

describe("Option<T> view arguments", () => {
    const option = (inner: string) => `0x1::option::Option<${inner}>`;

    it("encodes Some(T) of u8 as the hex of the byte, which the node reads as vector<u8>", () => {
        expect(convertArgsValueToJSONParsable(option("u8"), 16)).toEqual({ vec: "10" });
        expect(convertArgsValueToJSONParsable(option("u8"), 5)).toEqual({ vec: "05" });
        expect(convertArgsValueToJSONParsable(option("u8"), "255")).toEqual({ vec: "ff" });
        expect(convertArgsValueToJSONParsable(option("u8"), 0)).toEqual({ vec: "00" });
    });

    it("encodes None of u8 as an empty byte string", () => {
        expect(convertArgsValueToJSONParsable(option("u8"), null)).toEqual({ vec: "" });
        expect(convertArgsValueToJSONParsable(option("u8"), undefined)).toEqual({ vec: "" });
    });

    it("rejects a u8 value that is out of range or malformed", () => {
        expect(() => convertArgsValueToJSONParsable(option("u8"), 256)).toThrow();
        expect(() => convertArgsValueToJSONParsable(option("u8"), "")).toThrow();
    });

    it("encodes Option<u64> as a one-element array of the decimal string", () => {
        expect(convertArgsValueToJSONParsable(option("u64"), 5n)).toEqual({ vec: ["5"] });
        expect(convertArgsValueToJSONParsable(option("u64"), 5)).toEqual({ vec: ["5"] });
        expect(convertArgsValueToJSONParsable(option("u64"), null)).toEqual({ vec: [] });
    });

    it("encodes Option<address> as a one-element array", () => {
        expect(convertArgsValueToJSONParsable(option("address"), "0x2")).toEqual({ vec: ["0x2"] });
        expect(convertArgsValueToJSONParsable(option("address"), null)).toEqual({ vec: [] });
    });

    it("encodes Option<vector<u8>> as a one-element array of hex", () => {
        expect(convertArgsValueToJSONParsable(option("vector<u8>"), [1, 2])).toEqual({ vec: ["0102"] });
        expect(convertArgsValueToJSONParsable(option("vector<u8>"), new Uint8Array([1, 2]))).toEqual({ vec: ["0102"] });
        expect(convertArgsValueToJSONParsable(option("vector<u8>"), "0x0102")).toEqual({ vec: ["0x0102"] });
        expect(convertArgsValueToJSONParsable(option("vector<u8>"), null)).toEqual({ vec: [] });
    });
});

describe("integer view arguments", () => {
    it("rejects empty, whitespace-only and malformed strings", () => {
        for (const type of ["u8", "u32", "u64", "u256", "i64"]) {
            for (const value of ["", " ", "1.5", "0x", "abc"]) {
                expect(() => convertArgsValueToJSONParsable(type, value)).toThrow(`Expected an integer for ${type}`);
            }
        }
        expect(() => convertArgsValueToJSONParsable("u64", "-1")).toThrow();
    });

    it("accepts decimal strings, numbers and bigints, and a sign for signed types", () => {
        expect(convertArgsValueToJSONParsable("u8", "16")).toBe(16);
        expect(convertArgsValueToJSONParsable("u64", 7n)).toBe("7");
        expect(convertArgsValueToJSONParsable("i64", "-7")).toBe("-7");
    });

    const BOUNDS: Array<[string, bigint, bigint]> = [
        ["u8", 0n, 255n],
        ["u16", 0n, 65535n],
        ["u32", 0n, 4294967295n],
        ["u64", 0n, 2n ** 64n - 1n],
        ["u128", 0n, 2n ** 128n - 1n],
        ["u256", 0n, 2n ** 256n - 1n],
        ["i8", -128n, 127n],
        ["i16", -32768n, 32767n],
        ["i32", -(2n ** 31n), 2n ** 31n - 1n],
        ["i64", -(2n ** 63n), 2n ** 63n - 1n],
        ["i128", -(2n ** 127n), 2n ** 127n - 1n],
        ["i256", -(2n ** 255n), 2n ** 255n - 1n],
    ];

    it.each(BOUNDS)("accepts the bounds of %s and refuses the values beyond them", (type, min, max) => {
        const expected = (value: bigint) =>
            ["u8", "u16", "u32", "i8", "i16", "i32"].includes(type) ? Number(value) : value.toString();
        for (const value of [min, max]) {
            expect(convertArgsValueToJSONParsable(type, value)).toBe(expected(value));
            expect(convertArgsValueToJSONParsable(type, value.toString())).toBe(expected(value));
        }
        for (const value of [min - 1n, max + 1n]) {
            expect(() => convertArgsValueToJSONParsable(type, value)).toThrow(`${type} value out of range`);
        }
        expect(() => convertArgsValueToJSONParsable(type, (max + 1n).toString())).toThrow(`${type} value out of range`);
    });

    it("refuses out-of-range numbers", () => {
        expect(() => convertArgsValueToJSONParsable("u8", 300)).toThrow("u8 value out of range");
        expect(() => convertArgsValueToJSONParsable("u8", -1)).toThrow("u8 value out of range");
        expect(() => convertArgsValueToJSONParsable("u64", -1)).toThrow("u64 value out of range");
        expect(() => convertArgsValueToJSONParsable("i8", -129)).toThrow("i8 value out of range");
    });

    it("refuses a u8 to u32 value above 2^53 instead of rounding it", () => {
        expect(() => convertArgsValueToJSONParsable("u8", "1152921504606846976")).toThrow("u8 value out of range");
        expect(() => convertArgsValueToJSONParsable("u32", 2n ** 60n)).toThrow("u32 value out of range");
    });

    it("refuses numbers that are not safe integers and accepts the same values as bigints and strings", () => {
        for (const type of ["u64", "u128", "u256", "i64", "i128", "i256"]) {
            for (const value of [2 ** 53, 2 ** 53 + 2, 2 ** 60]) {
                expect(() => convertArgsValueToJSONParsable(type, value)).toThrow(/use a bigint or a decimal string/);
            }
            expect(convertArgsValueToJSONParsable(type, Number.MAX_SAFE_INTEGER)).toBe("9007199254740991");
            expect(convertArgsValueToJSONParsable(type, 2n ** 53n + 1n)).toBe("9007199254740993");
            expect(convertArgsValueToJSONParsable(type, "9007199254740993")).toBe("9007199254740993");
        }
        expect(() => convertArgsValueToJSONParsable("i64", -(2 ** 53))).toThrow(/not a safe integer/);
    });

    it("checks integers inside a vector and an Option", () => {
        expect(() => convertArgsValueToJSONParsable("vector<u8>", [256])).toThrow();
        expect(() => convertArgsValueToJSONParsable("vector<u16>", [1, 65536])).toThrow("u16 value out of range");
        expect(() => convertArgsValueToJSONParsable("0x1::option::Option<u64>", 2 ** 53)).toThrow(/not a safe integer/);
        expect(convertArgsValueToJSONParsable("0x1::option::Option<u8>", 5n)).toEqual({ vec: "05" });
        expect(() => convertArgsValueToJSONParsable("0x1::option::Option<u8>", -1)).toThrow("u8 value out of range");
    });
});

describe("vector<u8> view arguments", () => {
    it("encodes number[], Uint8Array and hex strings", () => {
        expect(convertArgsValueToJSONParsable("vector<u8>", [1, 255])).toBe("01ff");
        expect(convertArgsValueToJSONParsable("vector<u8>", new Uint8Array([1, 255]))).toBe("01ff");
        expect(convertArgsValueToJSONParsable("vector<u8>", "0x01ff")).toBe("0x01ff");
        expect(() => convertArgsValueToJSONParsable("vector<u8>", "0x1")).toThrow();
    });
});
