import { BCS, TxnBuilderTypes, TypeTagParser } from "supra-l1-sdk-core";
import * as packageRoot from "../../index";
import { parseTypeArgument, typeTagToJSON, typeTagToString } from "../typeTag";

const LONG_ONE = "0x0000000000000000000000000000000000000000000000000000000000000001";
const LONG_OTHER = "0x00000000000000000000000000000000000000000000000000000000000000ab";
const LONG_ABC = "0x0000000000000000000000000000000000000000000000000000000000000abc";
const LONG_ARBITRARY = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";

const PRIMITIVES: ReadonlyArray<[string, TxnBuilderTypes.TypeTag]> = [
    ["bool", new TxnBuilderTypes.TypeTagBool()],
    ["u8", new TxnBuilderTypes.TypeTagU8()],
    ["u16", new TxnBuilderTypes.TypeTagU16()],
    ["u32", new TxnBuilderTypes.TypeTagU32()],
    ["u64", new TxnBuilderTypes.TypeTagU64()],
    ["u128", new TxnBuilderTypes.TypeTagU128()],
    ["u256", new TxnBuilderTypes.TypeTagU256()],
    ["address", new TxnBuilderTypes.TypeTagAddress()],
    ["signer", new TxnBuilderTypes.TypeTagSigner()],
];

const parse = (type: string) => new TypeTagParser(type).parseTypeTag();

describe("typeTagToString", () => {
    it.each(PRIMITIVES)("writes %s", (expected, tag) => {
        expect(typeTagToString(tag)).toBe(expected);
    });

    it("writes a vector of a primitive", () => {
        expect(typeTagToString(new TxnBuilderTypes.TypeTagVector(new TxnBuilderTypes.TypeTagU8()))).toBe("vector<u8>");
    });

    it("writes nested vectors", () => {
        expect(typeTagToString(parse("vector<vector<u64>>"))).toBe("vector<vector<u64>>");
    });

    it("writes a struct without type parameters with the framework address in short form", () => {
        expect(typeTagToString(parse("0x1::supra_coin::SupraCoin"))).toBe("0x1::supra_coin::SupraCoin");
    });

    it("writes a vector of structs", () => {
        expect(typeTagToString(parse("vector<0x1::string::String>"))).toBe("vector<0x1::string::String>");
    });

    it("writes the type parameters of a struct", () => {
        expect(typeTagToString(parse("0x1::coin::CoinStore<0x1::supra_coin::SupraCoin>"))).toBe(
            "0x1::coin::CoinStore<0x1::supra_coin::SupraCoin>",
        );
    });

    it("writes nested type parameters, separated by a comma without a space", () => {
        const type = "0x1::a::B<0x1::c::D<u8,vector<address>>,u256,vector<0x1::e::F<bool>>>";
        expect(typeTagToString(parse(type))).toBe(type);
    });

    it("keeps the full address for addresses outside 0x0 to 0xf", () => {
        expect(typeTagToString(parse(`${LONG_OTHER}::m::S`))).toBe(`${LONG_OTHER}::m::S`);
        expect(typeTagToString(parse(`${LONG_ARBITRARY}::m::S`))).toBe(`${LONG_ARBITRARY}::m::S`);
    });

    it("writes the same string for the short and the long form of an address", () => {
        expect(typeTagToString(parse(`${LONG_ONE}::m::S`))).toBe("0x1::m::S");
        expect(typeTagToString(parse("0xf::m::S"))).toBe("0xf::m::S");
        expect(typeTagToString(parse("0x10::m::S"))).toBe(`0x${"0".repeat(62)}10::m::S`);
    });

    it("round-trips through TypeTagParser", () => {
        const types = [
            "u64",
            "vector<u8>",
            "0x1::coin::CoinStore<0x1::supra_coin::SupraCoin>",
            `${LONG_ARBITRARY}::m::S<vector<${LONG_OTHER}::n::T>>`,
        ];
        for (const type of types) {
            expect(typeTagToString(parse(typeTagToString(parse(type))))).toBe(typeTagToString(parse(type)));
        }
    });

    it("throws for an object that is not a TypeTag variant", () => {
        expect(() => typeTagToString({} as TxnBuilderTypes.TypeTag)).toThrow("Unknown variant of `TypeTag`");
    });
});

describe("typeTagToJSON", () => {
    it.each(PRIMITIVES)("writes %s as its name", (expected, tag) => {
        expect(typeTagToJSON(tag)).toBe(expected);
    });

    it("writes a vector", () => {
        expect(typeTagToJSON(parse("vector<u8>"))).toEqual({ vector: "u8" });
    });

    it("writes nested vectors", () => {
        expect(typeTagToJSON(parse("vector<vector<address>>"))).toEqual({ vector: { vector: "address" } });
    });

    it("writes a struct with the address in long form and empty type_args", () => {
        expect(typeTagToJSON(parse("0x1::supra_coin::SupraCoin"))).toEqual({
            struct: { address: LONG_ONE, module: "supra_coin", name: "SupraCoin", type_args: [] },
        });
    });

    it("writes the type parameters of a struct, recursively", () => {
        expect(typeTagToJSON(parse("0x1::coin::CoinStore<vector<0x1::string::String>>"))).toEqual({
            struct: {
                address: LONG_ONE,
                module: "coin",
                name: "CoinStore",
                type_args: [
                    {
                        vector: {
                            struct: { address: LONG_ONE, module: "string", name: "String", type_args: [] },
                        },
                    },
                ],
            },
        });
    });

    it("throws for an object that is not a TypeTag variant", () => {
        expect(() => typeTagToJSON({} as TxnBuilderTypes.TypeTag)).toThrow("Unknown variant of `TypeTag`");
    });
});

describe("parseTypeArgument", () => {
    const bcs = (tag: TxnBuilderTypes.TypeTag) => Array.from(BCS.bcsToBytes(tag));
    const nested = (levels: number) => `${"vector<".repeat(levels)}u8${">".repeat(levels)}`;

    it("is exported from the package root", () => {
        expect(packageRoot.parseTypeArgument).toBe(parseTypeArgument);
        const tag = packageRoot.parseTypeArgument("0x1::object::Object<0x1::fungible_asset::Metadata>");
        expect(tag).toBeInstanceOf(TxnBuilderTypes.TypeTagStruct);
    });

    it.each(PRIMITIVES)("parses %s", (type, tag) => {
        expect(parseTypeArgument(type)).toBeInstanceOf(tag.constructor);
    });

    it.each([
        "vector<u8>",
        "vector<vector<address>>",
        "0x1::supra_coin::SupraCoin",
        "0x1::coin::CoinStore<0x1::supra_coin::SupraCoin>",
        "0x1::coin::CoinStore<vector<0x1::string::String>>",
        `${LONG_ARBITRARY}::m::S<u8,${LONG_OTHER}::n::T<bool>>`,
    ])("gives %s the same BCS as TypeTagParser", (type) => {
        expect(bcs(parseTypeArgument(type))).toEqual(bcs(parse(type)));
    });

    it("keeps 0x1::object::Object<T> as the struct Object with its type parameter", () => {
        const type = "0x1::object::Object<0x1::fungible_asset::Metadata>";
        const tag = parseTypeArgument(type);
        expect(tag).toBeInstanceOf(TxnBuilderTypes.TypeTagStruct);
        expect(typeTagToString(tag)).toBe(type);
        expect(typeTagToJSON(tag)).toEqual({
            struct: {
                address: LONG_ONE,
                module: "object",
                name: "Object",
                type_args: [
                    { struct: { address: LONG_ONE, module: "fungible_asset", name: "Metadata", type_args: [] } },
                ],
            },
        });
    });

    it("keeps an Object inside a vector and inside another struct", () => {
        expect(typeTagToString(parseTypeArgument("vector<0x1::object::Object<0x1::object::ObjectCore>>"))).toBe(
            "vector<0x1::object::Object<0x1::object::ObjectCore>>",
        );
        expect(typeTagToString(parseTypeArgument("0x1::option::Option<0x1::object::Object<0x1::m::S>>"))).toBe(
            "0x1::option::Option<0x1::object::Object<0x1::m::S>>",
        );
    });

    it.each([
        ["0xabc::usdt0::USDT0", `${LONG_ABC}::usdt0::USDT0`],
        ["0xabc::m::T1", `${LONG_ABC}::m::T1`],
        ["0xabc::T1::S", `${LONG_ABC}::T1::S`],
        ["0x1::m::S<0xabc::usdt0::USDT0>", `0x1::m::S<${LONG_ABC}::usdt0::USDT0>`],
    ])("accepts the module and struct names of %s", (type, expected) => {
        expect(typeTagToString(parseTypeArgument(type))).toBe(expected);
    });

    it("allows whitespace between tokens, a comma after the last type parameter, and 0X", () => {
        const expected = "0x1::coin::CoinStore<0x1::supra_coin::SupraCoin>";
        for (const type of [
            "0x1::coin::CoinStore< 0x1::supra_coin::SupraCoin >",
            " 0x1 :: coin :: CoinStore <0x1::supra_coin::SupraCoin,>\n",
            "0X1::coin::CoinStore<0x1::supra_coin::SupraCoin>",
        ]) {
            expect(typeTagToString(parseTypeArgument(type))).toBe(expected);
        }
    });

    it("accepts addresses of 1 to 64 hex digits and refuses longer ones", () => {
        expect(typeTagToString(parseTypeArgument(`${LONG_ONE}::m::S`))).toBe("0x1::m::S");
        expect(() => parseTypeArgument(`0x0${LONG_ONE.slice(2)}::m::S`)).toThrow(/more than 64 hex digits/);
    });

    it.each([
        ["u64 junk", /unexpected "junk" after the type/],
        ["u64>", /unexpected ">" after the type/],
        ["0x1::supra_coin::SupraCoin, u8", /unexpected "," after the type/],
        ["0x1::supra_coin::SupraCoin>", /unexpected ">" after the type/],
        ["vector<u8>>", /unexpected ">" after the type/],
    ])("refuses text after the type: %s", (type, message) => {
        expect(() => parseTypeArgument(type)).toThrow(message);
    });

    it.each(["T0", "T12", "vector<T1>", "0x1::coin::CoinStore<T0>"])(
        "refuses the generic type parameter in %s",
        (type) => {
            expect(() => parseTypeArgument(type)).toThrow(/generic type parameter T\d+ is not a concrete type/);
        },
    );

    it.each([
        ["", /expected a type, found the end of the string/],
        ["   ", /expected a type, found the end of the string/],
        ["string", /unknown type "string"/],
        ["U64", /unknown type "U64"/],
        ["vector", /expected "<"/],
        ["vector<>", /expected a type, found ">"/],
        ["vector<u8", /expected ">", found the end of the string/],
        ["0x1", /expected "::"/],
        ["0x1::m", /expected "::"/],
        ["0x1::m::", /expected a struct name/],
        ["0x1:m::S", /unexpected character ":"/],
        ["0x1::vector::S", /expected a module name, found "vector"/],
        ["0x1::m::u8", /expected a struct name, found "u8"/],
        ["0x1::m::S<u8", /expected ",", found the end of the string/],
        ["0x1::m::S<u8 u16>", /expected ",", found "u16"/],
        ["0x::m::S", /unexpected character "0"/],
        ["1::m::S", /unexpected character "1"/],
        ["_m", /unexpected character "_"/],
        ["&u8", /unexpected character "&"/],
    ])("refuses the malformed type %j", (type, message) => {
        expect(() => parseTypeArgument(type)).toThrow(message);
    });

    it("names the input in its error", () => {
        expect(() => parseTypeArgument("u64 junk")).toThrow('Invalid type argument "u64 junk"');
    });

    it("accepts eight nested vector levels and refuses nine", () => {
        expect(typeTagToString(parseTypeArgument(nested(8)))).toBe(nested(8));
        expect(() => parseTypeArgument(nested(9))).toThrow(/at most 8 nested struct and vector levels/);
    });

    it("accepts eight nested struct levels and refuses nine", () => {
        const structs = (levels: number) => `${"0x1::a::A<".repeat(levels - 1)}0x1::a::A${">".repeat(levels - 1)}`;
        expect(typeTagToString(parseTypeArgument(structs(8)))).toBe(structs(8));
        expect(() => parseTypeArgument(structs(9))).toThrow(/at most 8 nested struct and vector levels/);
    });

    it("counts mixed struct and vector levels together", () => {
        const mixed = (pairs: number) => `${"vector<0x1::a::A<".repeat(pairs)}u8${">>".repeat(pairs)}`;
        expect(() => parseTypeArgument(mixed(4))).not.toThrow();
        expect(() => parseTypeArgument(mixed(5))).toThrow(/at most 8 nested struct and vector levels/);
    });

    it("counts levels in a later type parameter", () => {
        expect(() => parseTypeArgument(`0x1::a::A<u8, ${nested(8)}>`)).toThrow(/at most 8 nested/);
        expect(() => parseTypeArgument(`0x1::a::A<u8, ${nested(7)}>`)).not.toThrow();
    });
});
