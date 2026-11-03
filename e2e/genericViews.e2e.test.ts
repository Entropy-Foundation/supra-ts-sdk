import type { MoveFunctionId, MoveValue, SimpleEntryFunctionArgumentTypes } from "../src/index";
import { SupraError, standardizeAddress } from "../src/index";
import { createFundedAccount } from "./helpers/accounts";
import { describeE2E, nodeGeneration } from "./helpers/describe";
import { getE2EContext, type E2EContext } from "./helpers/env";
import { publishTaggedModule } from "./helpers/taggedModule";

/**
 * View functions whose parameter and return types are type parameters (`identity<T>(T): T` and the other generic
 * views of `sdk_e2e::tagged` in `fixtures/move`), called through `methods.view`.
 *
 * A node from `supra_node_v12.0.0` converts arguments and results of a type parameter as the request's type argument.
 * A v11 node reads every type parameter as `address`: there only address type arguments, and `Object<T>`, which it
 * lays out as an address, can be called, and the SDK refuses any other type argument before the view request.
 */

/** `test` on a v12 node; skipped on a v11 node, which reads every type parameter as `address`. */
const testFromV12: jest.It = nodeGeneration() === "v11" ? test.skip : test;
/** `test` on a v11 node; skipped on a v12 node, which reads type parameters as their type arguments. */
const testOnV11: jest.It = nodeGeneration() === "v11" ? test : test.skip;

const METADATA_OBJECT = "0x1::object::Object<0x1::fungible_asset::Metadata>";

describeE2E("generic view functions", () => {
    let ctx: E2EContext;
    let moduleAddress: string;
    let other: string;

    function view<T extends MoveValue[]>(
        name: string,
        typeArguments: string[],
        functionArguments: SimpleEntryFunctionArgumentTypes[],
    ): Promise<T> {
        return ctx.supra.methods.view<T>({
            function: `${moduleAddress}::tagged::${name}` as MoveFunctionId,
            typeArguments,
            functionArguments,
        });
    }

    beforeAll(async () => {
        ctx = await getE2EContext();
        const gas = { maxGas: 100_000n, gasUnitPrice: await ctx.supra.getMinGasUnitPrice() };
        const publisher = await createFundedAccount(ctx);
        moduleAddress = await publishTaggedModule(ctx, publisher, gas);
        other = (await createFundedAccount(ctx)).address().toString();
    });

    describe("address type arguments, on every node", () => {
        test("identity<address> returns the address", async () => {
            const [result] = await view<[string]>("identity", ["address"], [other]);
            expect(standardizeAddress(result)).toBe(standardizeAddress(other));
        });

        test("identity<Object<Metadata>> takes and returns the object's address", async () => {
            const [result] = await view<[string]>("identity", [METADATA_OBJECT], ["0xa"]);
            expect(standardizeAddress(result)).toBe(standardizeAddress("0xa"));
        });

        test("identity_vector<address> and identity_option<address> convert each element", async () => {
            const [list] = await view<[string[]]>("identity_vector", ["address"], [[other, "0x1"]]);
            expect(list.map(standardizeAddress)).toEqual([standardizeAddress(other), standardizeAddress("0x1")]);
            const [some] = await view<[string | null]>("identity_option", ["address"], [other]);
            expect(standardizeAddress(some!)).toBe(standardizeAddress(other));
            const [none] = await view<[string | null]>("identity_option", ["address"], [null]);
            expect(none).toBeNull();
        });

        test("swap<address, address> substitutes each type parameter", async () => {
            const [first, second] = await view<[string, string]>("swap", ["address", "address"], [other, "0x1"]);
            expect(standardizeAddress(first)).toBe(standardizeAddress("0x1"));
            expect(standardizeAddress(second)).toBe(standardizeAddress(other));
        });
    });

    describe("other type arguments, from v12", () => {
        testFromV12("identity<u64> takes a bigint and returns a bigint", async () => {
            expect(await view("identity", ["u64"], [12345n])).toEqual([12345n]);
        });

        testFromV12("identity<u128> and identity<u8> convert by the type argument", async () => {
            expect(await view("identity", ["u128"], [1n << 64n])).toEqual([1n << 64n]);
            expect(await view("identity", ["u8"], [255])).toEqual([255]);
        });

        testFromV12("identity<bool>, identity<vector<u8>> and identity<String>", async () => {
            expect(await view("identity", ["bool"], [true])).toEqual([true]);
            expect(await view("identity", ["vector<u8>"], [[1, 2]])).toEqual(["0x0102"]);
            expect(await view("identity", ["0x1::string::String"], ["hello"])).toEqual(["hello"]);
        });

        testFromV12("identity_vector<u64> converts each element", async () => {
            expect(await view("identity_vector", ["u64"], [[1n, 2n]])).toEqual([[1n, 2n]]);
        });

        testFromV12("identity_option<u64> converts Some and None", async () => {
            expect(await view("identity_option", ["u64"], [5n])).toEqual([5n]);
            expect(await view("identity_option", ["u64"], [null])).toEqual([null]);
        });

        testFromV12("identity_vector<Option<u64>> converts the nested types", async () => {
            expect(await view("identity_vector", ["0x1::option::Option<u64>"], [[5n, null]])).toEqual([[5n, null]]);
        });

        testFromV12("swap<u64, bool> substitutes each type parameter", async () => {
            expect(await view("swap", ["u64", "bool"], [9n, true])).toEqual([true, 9n]);
        });

        testFromV12("boxed<u64> returns the struct as the node's JSON", async () => {
            expect(await view("boxed", ["u64"], [7n])).toEqual([{ value: "7" }]);
        });
    });

    describe("other type arguments, before v12", () => {
        testOnV11.each([
            ["identity", "u256", 1n],
            ["identity", "u64", 12345n],
            ["identity", "bool", true],
            ["identity_vector", "u256", [1n]],
        ] as [string, string, SimpleEntryFunctionArgumentTypes][])(
            "%s<%s> throws SupraError before the view request",
            async (name, typeArgument, value) => {
                const call = view(name, [typeArgument], [value]);
                await expect(call).rejects.toThrow(SupraError);
                await expect(call).rejects.toThrow("needs a node from supra_node_v12.0.0");
            },
        );
    });
});
