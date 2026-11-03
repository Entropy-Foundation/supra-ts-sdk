import { TxnBuilderTypes } from "supra-l1-sdk-core";
import { viewInternal } from "../methods";
import { SupraError } from "../../errors/supraError";
import type { MoveFunction, MoveModule, SimpleEntryFunctionArgumentTypes, TypeArgument } from "../../types/move";
import type { NetworkConfig } from "../../utils/apiEndpoints";

jest.mock("../../client/post", () => ({
    post: jest.fn(),
}));
jest.mock("../../client/get", () => ({
    get: jest.fn(),
}));

import { post } from "../../client/post";
import { get } from "../../client/get";
const mockPost = post as jest.MockedFunction<typeof post>;
const mockGet = get as jest.MockedFunction<typeof get>;

/** `GET /rpc/v3/version` of a node from `supra_node_v12.0.0`. */
const V12_VERSION = {
    version: "1.0.0",
    release: "supra_node_v12.0.0.rc7",
    branch: "",
    commit_hash: "a89b26e61",
    build_time: "",
    build_env: "",
};
/** `GET /rpc/v3/version` of a v11 node, which has no `release`. */
const V11_VERSION = { version: "1.0.0", branch: "", commit_hash: "f52cb25b7", build_time: "", build_env: "" };

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
        viewFunction("unused", 1, ["u64"], ["u64"]),
    ],
    structs: [],
};

/** The client configuration of a test; each test has its own, so that the version read is not shared. */
let config: NetworkConfig;

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
        config,
    );
    const call = mockPost.mock.calls[mockPost.mock.calls.length - 1]!;
    return { body: (call[0] as { data: unknown }).data, returned };
}

/** The `arguments` of the request body of the last view call. */
function sentArguments(body: unknown): unknown {
    return (body as { arguments: unknown }).arguments;
}

/** The number of `GET /version` requests sent. */
function versionReads(): number {
    return mockGet.mock.calls.filter(([request]) => request.path === "/version").length;
}

beforeEach(() => {
    jest.clearAllMocks();
    config = { name: "testnet", chainId: 6, rpcUrl: "https://rpc-testnet.supra.com" };
    mockGet.mockResolvedValue({ data: V12_VERSION, headers: new Headers() } as never);
});

describe("viewInternal of a generic view function on a v12 node", () => {
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
    });

    describe("values the type argument does not hold are refused before any request", () => {
        it.each<[string, SimpleEntryFunctionArgumentTypes, string]>([
            ["u64", -1n, "u64 value out of range"],
            ["u64", "18446744073709551616", "u64 value out of range"],
            ["u64", "1.5", "Expected an integer for u64"],
            ["u64", ADDRESS, "Expected an integer for u64"],
            ["u8", "300", "u8 value out of range"],
            ["u256", ADDRESS, "Expected an integer for u256"],
            ["bool", "1", "Expected a boolean"],
            ["address", 12n, "Expected an address"],
            [METADATA, 5n, "Expected an address"],
        ])("T = %s with %p", async (typeArgument, value, message) => {
            await expect(callView("echo", [typeArgument], [value], [])).rejects.toThrow(message);
            expect(mockPost).not.toHaveBeenCalled();
            expect(versionReads()).toBe(0);
        });

        it("checks each element of vector<T>", async () => {
            await expect(callView("echo_vector", ["u64"], [["x"]], [])).rejects.toThrow("Expected an integer for u64");
            expect(mockPost).not.toHaveBeenCalled();
        });
    });

    describe("T = address", () => {
        it("sends and returns the address", async () => {
            const { body, returned } = await callView("echo", ["address"], [ADDRESS], [ADDRESS]);
            expect(sentArguments(body)).toEqual([ADDRESS]);
            expect(returned).toEqual([ADDRESS]);
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
        });

        it("sends an Object inside vector<T> and Option<T> as { inner } and returns its address", async () => {
            const vector = await callView("echo_vector", [METADATA], [["0xa", ADDRESS]], [[{ inner: "0xa" }]]);
            expect(sentArguments(vector.body)).toEqual([[{ inner: "0xa" }, { inner: ADDRESS }]]);
            expect(vector.returned).toEqual([["0xa"]]);
            const option = await callView("echo_option", [METADATA], ["0xa"], [{ vec: [{ inner: "0xa" }] }]);
            expect(sentArguments(option.body)).toEqual([{ vec: [{ inner: "0xa" }] }]);
            expect(option.returned).toEqual(["0xa"]);
            expect(versionReads()).toBe(1);
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
});

describe("the node version read of a generic view function", () => {
    it("is not made for address-like type arguments or a type parameter only inside Object<T>", async () => {
        await callView("echo", ["address"], [ADDRESS], [ADDRESS]);
        await callView("echo", [METADATA], ["0xa"], ["0xa"]);
        await callView("echo_vector", ["address"], [[ADDRESS]], [[ADDRESS]]);
        await callView("swap", ["address", METADATA], [ADDRESS, "0xa"], ["0xa", ADDRESS]);
        await callView("object", ["0x1::fungible_asset::Metadata"], ["0xa"], ["0xa"]);
        await callView("unused", ["u64"], [1n], ["1"]);
        expect(versionReads()).toBe(0);
        expect(mockPost).toHaveBeenCalledTimes(6);
    });

    it("is made once per client, and concurrent calls share it", async () => {
        await Promise.all([
            callView("echo", ["u64"], [1n], ["1"]),
            callView("echo", ["bool"], [true], [true]),
            callView("echo_vector", ["u256"], [[1n]], [["1"]]),
        ]);
        await callView("echo", ["u64"], [2n], ["2"]);
        expect(versionReads()).toBe(1);

        config = { name: "testnet", chainId: 6, rpcUrl: "https://rpc-testnet.supra.com" };
        await callView("echo", ["u64"], [3n], ["3"]);
        expect(versionReads()).toBe(2);
    });

    it("is made again after a node without a release, until the node reports one", async () => {
        mockGet.mockResolvedValue({ data: V11_VERSION, headers: new Headers() } as never);
        await expect(callView("echo", ["u64"], [1n], [])).rejects.toThrow("needs a node from supra_node_v12.0.0");
        await expect(callView("echo", ["u64"], [1n], [])).rejects.toThrow("needs a node from supra_node_v12.0.0");
        expect(versionReads()).toBe(2);

        mockGet.mockResolvedValue({ data: V12_VERSION, headers: new Headers() } as never);
        expect((await callView("echo", ["u64"], [1n], ["1"])).returned).toEqual([1n]);
        expect((await callView("echo", ["u64"], [2n], ["2"])).returned).toEqual([2n]);
        expect(versionReads()).toBe(3);
    });

    it("is not kept when it fails", async () => {
        mockGet.mockRejectedValueOnce(new SupraError("connection refused"));
        await expect(callView("echo", ["u64"], [1n], ["1"])).rejects.toThrow("connection refused");
        expect(mockPost).not.toHaveBeenCalled();
        expect((await callView("echo", ["u64"], [1n], ["1"])).returned).toEqual([1n]);
        expect(versionReads()).toBe(2);
    });
});

describe("viewInternal of a generic view function on a node before v12", () => {
    beforeEach(() => {
        mockGet.mockResolvedValue({ data: V11_VERSION, headers: new Headers() } as never);
    });

    it.each<[string, string, SimpleEntryFunctionArgumentTypes]>([
        ["echo", "u256", 1n],
        ["echo", "u64", 12345n],
        ["echo", "bool", true],
        ["echo", "vector<u8>", "0x0102"],
        ["echo", "0x1::string::String", "hello"],
        ["echo_vector", "u256", [1n]],
        ["echo_option", "u256", 1n],
        ["boxed", "u64", 7n],
        ["echo_vector", METADATA, ["0xa"]],
        ["echo_option", METADATA, "0xa"],
    ])("refuses %s<%s> before the view request", async (name, typeArgument, value) => {
        const call = callView(name, [typeArgument], [value], []);
        await expect(call).rejects.toThrow(SupraError);
        await expect(call).rejects.toThrow(
            `The view function ${MODULE}::m::${name} with the type argument ${typeArgument} needs a node from ` +
                "supra_node_v12.0.0",
        );
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("names the first type argument that needs v12", async () => {
        await expect(callView("swap", ["address", "u64"], [ADDRESS, 1n], [])).rejects.toThrow(
            "with the type argument u64",
        );
    });

    it("sends address-like type arguments without a version read", async () => {
        expect((await callView("echo", ["address"], [ADDRESS], [ADDRESS])).returned).toEqual([ADDRESS]);
        expect((await callView("echo", [METADATA], ["0xa"], ["0xa"])).returned).toEqual(["0xa"]);
        expect(versionReads()).toBe(0);
    });
});
