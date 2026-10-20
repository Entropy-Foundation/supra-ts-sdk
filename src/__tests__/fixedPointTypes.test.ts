import { expectTypeOf } from "expect-type";
import type { ContractsFromABI, MoveResultToTS, MoveToTS } from "../types/contract";

/** Type-level checks of the mapping of the fixed-point structs for arguments and view results. */

const _ABI = [
    {
        address: "0x1",
        name: "fixed",
        friends: [],
        exposed_functions: [
            {
                name: "store",
                visibility: "public",
                is_entry: true,
                is_view: false,
                generic_type_params: [],
                params: [
                    "&signer",
                    "0x1::fixed_point32::FixedPoint32",
                    "0x1::fixed_point64::FixedPoint64",
                    "vector<0x1::fixed_point32::FixedPoint32>",
                    "0x1::option::Option<0x1::fixed_point64::FixedPoint64>",
                ],
                return: [],
            },
            {
                name: "read",
                visibility: "public",
                is_entry: false,
                is_view: true,
                generic_type_params: [],
                params: ["0x1::fixed_point32::FixedPoint32"],
                return: [
                    "0x1::fixed_point32::FixedPoint32",
                    "0x1::fixed_point64::FixedPoint64",
                    "vector<0x1::fixed_point64::FixedPoint64>",
                    "0x1::option::Option<0x1::fixed_point32::FixedPoint32>",
                    "u64",
                    "vector<u8>",
                    "0x1::option::Option<u8>",
                ],
            },
        ],
        structs: [],
    },
] as const;

type Contracts = ContractsFromABI<typeof _ABI>;

describe("fixed-point types", () => {
    it("types arguments as the raw value", () => {
        expectTypeOf<MoveToTS<"0x1::fixed_point32::FixedPoint32">>().toEqualTypeOf<bigint | string>();
        expectTypeOf<MoveToTS<"0x1::fixed_point64::FixedPoint64">>().toEqualTypeOf<bigint | string>();
        expectTypeOf<MoveToTS<"vector<0x1::fixed_point32::FixedPoint32>">>().toEqualTypeOf<(bigint | string)[]>();
        expectTypeOf<MoveToTS<"0x1::option::Option<0x1::fixed_point64::FixedPoint64>">>().toEqualTypeOf<
            bigint | string | null
        >();
    });

    it("types view results as { value: bigint }", () => {
        expectTypeOf<MoveResultToTS<"0x1::fixed_point32::FixedPoint32">>().toEqualTypeOf<{ value: bigint }>();
        expectTypeOf<MoveResultToTS<"0x1::fixed_point64::FixedPoint64">>().toEqualTypeOf<{ value: bigint }>();
        expectTypeOf<MoveResultToTS<"vector<0x1::fixed_point64::FixedPoint64>">>().toEqualTypeOf<{ value: bigint }[]>();
        expectTypeOf<MoveResultToTS<"0x1::option::Option<0x1::fixed_point32::FixedPoint32>">>().toEqualTypeOf<{
            value: bigint;
        } | null>();
    });

    it("leaves the other result types as they were", () => {
        expectTypeOf<MoveResultToTS<"u64">>().toEqualTypeOf<MoveToTS<"u64">>();
        expectTypeOf<MoveResultToTS<"vector<u8>">>().toEqualTypeOf<MoveToTS<"vector<u8>">>();
        expectTypeOf<MoveResultToTS<"0x1::option::Option<u8>">>().toEqualTypeOf<MoveToTS<"0x1::option::Option<u8>">>();
        expectTypeOf<MoveResultToTS<"vector<vector<u8>>">>().toEqualTypeOf<MoveToTS<"vector<vector<u8>>">>();
    });

    it("applies the mapping to the contract proxy", () => {
        type Store = Parameters<Contracts["fixed"]["entry"]["store"]>[0]["functionArguments"];
        expectTypeOf<Store[1]>().toEqualTypeOf<bigint | string>();
        expectTypeOf<Store[2]>().toEqualTypeOf<bigint | string>();
        expectTypeOf<Store[3]>().toEqualTypeOf<(bigint | string)[]>();
        expectTypeOf<Store[4]>().toEqualTypeOf<bigint | string | null>();

        type ReadArgs = Parameters<Contracts["fixed"]["view"]["read"]>[0]["functionArguments"];
        expectTypeOf<ReadArgs[0]>().toEqualTypeOf<bigint | string>();

        type ReadResult = Awaited<ReturnType<Contracts["fixed"]["view"]["read"]>>;
        expectTypeOf<ReadResult[0]>().toEqualTypeOf<{ value: bigint }>();
        expectTypeOf<ReadResult[1]>().toEqualTypeOf<{ value: bigint }>();
        expectTypeOf<ReadResult[2]>().toEqualTypeOf<{ value: bigint }[]>();
        expectTypeOf<ReadResult[3]>().toEqualTypeOf<{ value: bigint } | null>();
        expectTypeOf<ReadResult[4]>().toEqualTypeOf<bigint>();
    });
});
