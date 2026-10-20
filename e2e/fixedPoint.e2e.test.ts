import type { MoveFunctionId, MoveStructId, SupraAccount } from "../src/index";
import { TransactionStatus } from "../src/index";
import { createFundedAccount } from "./helpers/accounts";
import { describeE2E } from "./helpers/describe";
import { getE2EContext, type E2EContext } from "./helpers/env";
import { publishTaggedModule } from "./helpers/taggedModule";

/**
 * `FixedPoint32` and `FixedPoint64` entry and view arguments, and view results, against the functions of
 * `sdk_e2e::tagged` in `fixtures/move`.
 */

const U64_MAX = 18446744073709551615n;
const U128_MAX = 340282366920938463463374607431768211455n;

interface StoredFixed {
    value32: { value: string };
    value64: { value: string };
    list32: string[];
    option64: { vec: string[] };
}

describeE2E("fixed-point arguments", () => {
    let ctx: E2EContext;
    let moduleAddress: string;
    let gas: { maxGas: bigint; gasUnitPrice: bigint };

    const fn = (name: string) => `${moduleAddress}::tagged::${name}` as MoveFunctionId;

    async function nextSequenceNumber(account: SupraAccount): Promise<bigint> {
        return BigInt((await ctx.supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number);
    }

    /** Calls `store_fixed` from a fresh account and returns what the resource of that account holds. */
    async function store(args: unknown[]): Promise<StoredFixed> {
        const account = await createFundedAccount(ctx);
        const rawTxn = await ctx.supra.transaction.build.simple({
            senderAddress: account.address(),
            senderSequenceNumber: await nextSequenceNumber(account),
            function: fn("store_fixed"),
            functionTypeArgs: [],
            functionArgs: args as never[],
            optionalTransactionPayloadArgs: gas,
        });
        const submitted = await rawTxn.submitTransaction({
            senderAccount: account,
            enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true },
        });
        expect(submitted.status).toBe(TransactionStatus.Success);
        const resource = await ctx.supra.account.getAccountResource<StoredFixed>({
            accountAddress: account.address(),
            resourceType: `${moduleAddress}::tagged::Fixed` as MoveStructId,
        });
        return resource.data;
    }

    beforeAll(async () => {
        ctx = await getE2EContext();
        gas = { maxGas: 100_000n, gasUnitPrice: await ctx.supra.getMinGasUnitPrice() };
        const publisher = await createFundedAccount(ctx);
        moduleAddress = await publishTaggedModule(ctx, publisher, gas);
    });

    describe("entry arguments", () => {
        test("raw values given as bigint are stored", async () => {
            const stored = await store([1n << 32n, 3n << 64n, [1n, 2n, 3n], 7n]);
            expect(stored.value32).toEqual({ value: "4294967296" });
            expect(stored.value64).toEqual({ value: (3n << 64n).toString() });
            expect(stored.list32).toEqual(["1", "2", "3"]);
            expect(stored.option64).toEqual({ vec: ["7"] });
        });

        test("raw values given as decimal strings are stored, and an Option can be None", async () => {
            const stored = await store(["5", "6", [], null]);
            expect(stored.value32).toEqual({ value: "5" });
            expect(stored.value64).toEqual({ value: "6" });
            expect(stored.list32).toEqual([]);
            expect(stored.option64).toEqual({ vec: [] });
        });

        test("zero and the maximum raw values are stored", async () => {
            const zero = await store([0n, 0n, [0n], 0n]);
            expect(zero.value32).toEqual({ value: "0" });
            expect(zero.value64).toEqual({ value: "0" });
            expect(zero.option64).toEqual({ vec: ["0"] });

            const max = await store([U64_MAX, U128_MAX, [U64_MAX], U128_MAX]);
            expect(max.value32).toEqual({ value: U64_MAX.toString() });
            expect(max.value64).toEqual({ value: U128_MAX.toString() });
            expect(max.list32).toEqual([U64_MAX.toString()]);
            expect(max.option64).toEqual({ vec: [U128_MAX.toString()] });
        });

        test("a raw value above the range of the type is refused before any request", async () => {
            const account = await createFundedAccount(ctx);
            const abi = (
                await ctx.supra.account.getAccountModule({ accountAddress: moduleAddress, moduleName: "tagged" })
            ).abi!;
            const build = (value32: bigint, value64: bigint) =>
                ctx.supra.transaction.build.simple({
                    senderAddress: account.address(),
                    senderSequenceNumber: 0n,
                    function: fn("store_fixed"),
                    functionTypeArgs: [],
                    functionArgs: [value32, value64, [], null],
                    optionalTransactionPayloadArgs: gas,
                    abi,
                });
            await expect(build(U64_MAX + 1n, 0n)).rejects.toThrow("u64 value out of range");
            await expect(build(0n, U128_MAX + 1n)).rejects.toThrow("u128 value out of range");
        });
    });

    describe("view arguments and results", () => {
        test("a view takes each type and returns the raw value", async () => {
            expect(await ctx.supra.methods.view({ function: fn("raw32"), functionArguments: [123n] })).toEqual([123n]);
            expect(await ctx.supra.methods.view({ function: fn("raw64"), functionArguments: ["456"] })).toEqual([456n]);
            expect(await ctx.supra.methods.view({ function: fn("raw32"), functionArguments: [U64_MAX] })).toEqual([
                U64_MAX,
            ]);
            expect(await ctx.supra.methods.view({ function: fn("raw64"), functionArguments: [U128_MAX] })).toEqual([
                U128_MAX,
            ]);
            expect(await ctx.supra.methods.view({ function: fn("raw32"), functionArguments: [0n] })).toEqual([0n]);
        });

        test("a view takes a vector of FixedPoint32", async () => {
            expect(
                await ctx.supra.methods.view({ function: fn("raw32_list"), functionArguments: [[1n, "2", 3]] }),
            ).toEqual([[1n, 2n, 3n]]);
        });

        test("a view returns each type as { value: bigint }", async () => {
            expect(await ctx.supra.methods.view({ function: fn("echo_fixed32"), functionArguments: [123n] })).toEqual([
                { value: 123n },
            ]);
            expect(
                await ctx.supra.methods.view({ function: fn("echo_fixed64"), functionArguments: [U128_MAX] }),
            ).toEqual([{ value: U128_MAX }]);
        });

        test("the contract proxy types and returns the arguments and results", async () => {
            const abi = {
                address: moduleAddress,
                name: "tagged",
                friends: [],
                exposed_functions: [
                    {
                        name: "echo_fixed64",
                        visibility: "public",
                        is_entry: false,
                        is_view: true,
                        generic_type_params: [],
                        params: ["0x1::fixed_point64::FixedPoint64"],
                        return: ["0x1::fixed_point64::FixedPoint64"],
                    },
                ],
                structs: [],
            } as const;
            const instance = ctx.supra.contract.fromABI([abi] as const);
            const [echoed] = await instance.contracts.tagged.view.echo_fixed64({
                functionArguments: [(1n << 64n) + 5n],
                typeArguments: [],
            });
            const raw: bigint = echoed.value;
            expect(raw).toBe((1n << 64n) + 5n);
        });

        test("a raw value above the range of the type, or a fraction, is refused", async () => {
            await expect(
                ctx.supra.methods.view({ function: fn("raw32"), functionArguments: [U64_MAX + 1n] }),
            ).rejects.toThrow("out of range");
            await expect(ctx.supra.methods.view({ function: fn("raw64"), functionArguments: ["1.5"] })).rejects.toThrow(
                "Expected an integer",
            );
        });
    });
});
