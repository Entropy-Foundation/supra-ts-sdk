import { TxnBuilderTypes, TypeTagParser } from "supra-l1-sdk-core";
import { typeTagToJSON, typeTagToString } from "../typeTag";

const LONG_ONE = "0x0000000000000000000000000000000000000000000000000000000000000001";
const LONG_OTHER = "0x00000000000000000000000000000000000000000000000000000000000000ab";
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
