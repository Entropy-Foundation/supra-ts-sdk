import { TxnBuilderTypes } from "supra-l1-sdk-core";
import { viewInternal } from "../methods";
import type { MoveFunction, MoveModule, SimpleEntryFunctionArgumentTypes, TypeArgument } from "../../types/move";
import type { NetworkConfig } from "../../utils/apiEndpoints";

jest.mock("../../client/post", () => ({
    post: jest.fn(),
}));

import { post } from "../../client/post";
const mockPost = post as jest.MockedFunction<typeof post>;

const testConfig: NetworkConfig = {
    name: "testnet",
    chainId: 6,
    rpcUrl: "https://rpc-testnet.supra.com",
};

const MODULE = "0x0000000000000000000000000000000000000000000000000000000000000abc";
const ADDRESS = "0x000000000000000000000000000000000000000000000000000000000000beef";
const METADATA = "0x1::object::Object<0x1::fungible_asset::Metadata>";

/** A view function `MODULE::m::<name>` with `typeParameters` type parameters. */
function viewFunction(name: string, typeParameters: number, params: string[], returns: string[]): MoveFunction {
    return {
        name,
        visibility: "public",
        is_entry: false,
        is_view: true,
        generic_type_params: Array.from({ length: typeParameters }, () => ({ constraints: ["copy", "drop"] })),
        params,
        return: returns,
    };
}

const abi: MoveModule = {
    address: MODULE,
    name: "m",
    friends: [],
    exposed_functions: [
        viewFunction("echo", 1, ["T0"], ["T0"]),
        viewFunction("echo_vector", 1, ["vector<T0>"], ["vector<T0>"]),
        viewFunction("echo_option", 1, ["0x1::option::Option<T0>"], ["0x1::option::Option<T0>"]),
        viewFunction("nested", 1, ["vector<0x1::option::Option<T0>>"], ["vector<0x1::option::Option<T0>>"]),
        viewFunction("swap", 2, ["T0", "T1"], ["T1", "T0"]),
        viewFunction("boxed", 1, ["T0"], [`${MODULE}::m::Boxed<T0>`]),
        viewFunction("object", 1, ["0x1::object::Object<T0>"], ["0x1::object::Object<T0>"]),
    ],
    structs: [],
};

/**
 * Calls `MODULE::m::<name>` through `viewInternal` with the node's result `result`, and returns the request body and
 * the converted result.
 */
async function callView(
    name: string,
    typeArguments: TypeArgument[],
    functionArguments: SimpleEntryFunctionArgumentTypes[],
    result: unknown[],
): Promise<{ body: unknown; returned: unknown[] }> {
    mockPost.mockResolvedValue({ result });
    const returned = await viewInternal(
        { function: `${MODULE}::m::${name}`, typeArguments, functionArguments, abi },
        testConfig,
    );
    const call = mockPost.mock.calls[mockPost.mock.calls.length - 1]!;
    return { body: (call[0] as { data: unknown }).data, returned };
}

/** The `arguments` of the request body of the last view call. */
function sentArguments(body: unknown): unknown {
    return (body as { arguments: unknown }).arguments;
}

describe("viewInternal of a generic view function", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe("T = u64", () => {
        it("sends a bigint argument as a decimal string and returns a bigint", async () => {
            const { body, returned } = await callView("echo", ["u64"], [12345n], ["12345"]);
            expect(body).toEqual({ function: `${MODULE}::m::echo`, type_arguments: ["u64"], arguments: ["12345"] });
            expect(returned).toEqual([12345n]);
        });

        it("converts the same way for a TypeTag type argument", async () => {
            const { body, returned } = await callView("echo", [new TxnBuilderTypes.TypeTagU64()], [12345n], ["12345"]);
            expect(sentArguments(body)).toEqual(["12345"]);
            expect(returned).toEqual([12345n]);
        });

        it("refuses a value that is not a u64 before the request", async () => {
            await expect(callView("echo", ["u64"], [-1n], [])).rejects.toThrow("u64 value out of range");
            await expect(callView("echo", ["u64"], ["1.5"], [])).rejects.toThrow("Expected an integer for u64");
            expect(mockPost).not.toHaveBeenCalled();
        });
    });

    describe("T = address", () => {
        it("sends and returns the address", async () => {
            const { body, returned } = await callView("echo", ["address"], [ADDRESS], [ADDRESS]);
            expect(sentArguments(body)).toEqual([ADDRESS]);
            expect(returned).toEqual([ADDRESS]);
        });

        it("refuses a value that is not an address before the request", async () => {
            await expect(callView("echo", ["address"], [12n], [])).rejects.toThrow("Expected an address");
            expect(mockPost).not.toHaveBeenCalled();
        });
    });

    describe("T = a struct", () => {
        it("sends a 0x1::string::String argument and returns the result as the node sent it", async () => {
            const { body, returned } = await callView("echo", ["0x1::string::String"], ["hello"], ["hello"]);
            expect(sentArguments(body)).toEqual(["hello"]);
            expect(returned).toEqual(["hello"]);
        });

        it("reads an Object argument as an address, and an Object result as its address", async () => {
            const { body, returned } = await callView("echo", [METADATA], ["0xa"], [{ inner: "0xa" }]);
            expect(sentArguments(body)).toEqual(["0xa"]);
            expect(returned).toEqual(["0xa"]);
            await expect(callView("echo", [METADATA], [5n], [])).rejects.toThrow("Expected an address");
        });

        it("substitutes a struct type argument into Object<T>", async () => {
            const { body, returned } = await callView(
                "object",
                ["0x1::fungible_asset::Metadata"],
                ["0xa"],
                [{ inner: "0xa" }],
            );
            expect(sentArguments(body)).toEqual(["0xa"]);
            expect(returned).toEqual(["0xa"]);
        });

        it("returns a struct over T as the node sent it", async () => {
            const { returned } = await callView("boxed", ["u64"], [7n], [{ value: "7" }]);
            expect(returned).toEqual([{ value: "7" }]);
        });

        it("converts a FixedPoint32 type argument as its raw value", async () => {
            const fp32 = "0x1::fixed_point32::FixedPoint32";
            const { body, returned } = await callView("echo", [fp32], [1n << 32n], [{ value: "4294967296" }]);
            expect(sentArguments(body)).toEqual([{ value: "4294967296" }]);
            expect(returned).toEqual([{ value: 4294967296n }]);
        });
    });

    it("converts vector<T> element by element", async () => {
        const { body, returned } = await callView("echo_vector", ["u64"], [[1n, 2n]], [["1", "2"]]);
        expect(sentArguments(body)).toEqual([["1", "2"]]);
        expect(returned).toEqual([[1n, 2n]]);
    });

    it("sends vector<T> with T = u8 as hex", async () => {
        const { body, returned } = await callView("echo_vector", ["u8"], [[1, 2]], ["0x0102"]);
        expect(sentArguments(body)).toEqual(["0102"]);
        expect(returned).toEqual(["0x0102"]);
    });

    it("converts Option<T> as Some and None", async () => {
        const some = await callView("echo_option", ["u128"], [5n], [{ vec: ["5"] }]);
        expect(sentArguments(some.body)).toEqual([{ vec: ["5"] }]);
        expect(some.returned).toEqual([5n]);
        const none = await callView("echo_option", ["u128"], [null], [{ vec: [] }]);
        expect(sentArguments(none.body)).toEqual([{ vec: [] }]);
        expect(none.returned).toEqual([null]);
    });

    it("converts Option<T> with T = u8 as the node's hex form", async () => {
        const { body } = await callView("echo_option", ["u8"], [16], [{ vec: "0x10" }]);
        expect(sentArguments(body)).toEqual([{ vec: "10" }]);
    });

    it("converts a nested vector<Option<T>>", async () => {
        const { body, returned } = await callView(
            "nested",
            ["vector<u64>"],
            [[[1n, 2n], null]],
            [[{ vec: [["1", "2"]] }, { vec: [] }]],
        );
        expect(sentArguments(body)).toEqual([[{ vec: [["1", "2"]] }, { vec: [] }]]);
        expect(returned).toEqual([[[1n, 2n], null]]);
    });

    it("substitutes each of several type parameters at its index", async () => {
        const { body, returned } = await callView("swap", ["u64", "bool"], [9n, true], [true, "9"]);
        expect(sentArguments(body)).toEqual(["9", true]);
        expect(returned).toEqual([true, 9n]);
    });

    describe("a node before v12, which reads each type parameter as address", () => {
        it("sends an address given for a non-address T unchanged", async () => {
            const { body } = await callView("echo", ["u256"], [ADDRESS], [ADDRESS]);
            expect(sentArguments(body)).toEqual([ADDRESS]);
        });

        it("returns a type parameter answered as an address as the node sent it", async () => {
            expect((await callView("echo", ["u256"], [1n], [ADDRESS])).returned).toEqual([ADDRESS]);
            expect((await callView("echo", ["vector<bool>"], [[true]], [ADDRESS])).returned).toEqual([ADDRESS]);
            expect((await callView("echo", [METADATA], ["0xa"], ["0xa"])).returned).toEqual(["0xa"]);
            expect((await callView("echo", ["0x1::string::String"], ["a"], [ADDRESS])).returned).toEqual([ADDRESS]);
        });

        it("converts the containers of an answer that does not fit the type arguments, as before", async () => {
            const vector = await callView("echo_vector", ["u256"], [[1n]], [[ADDRESS, ADDRESS]]);
            expect(vector.returned).toEqual([[ADDRESS, ADDRESS]]);
            const option = await callView("echo_option", ["u256"], [1n], [{ vec: [ADDRESS] }]);
            expect(option.returned).toEqual([ADDRESS]);
        });

        it("keeps the error of the type argument for a value that is not an address either", async () => {
            await expect(callView("echo", ["u64"], ["1.5"], [])).rejects.toThrow("Expected an integer for u64");
            await expect(callView("echo_vector", ["u64"], [["x"]], [])).rejects.toThrow("Expected an integer for u64");
        });
    });
});
