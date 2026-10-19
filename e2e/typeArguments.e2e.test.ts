import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MoveFunctionId, SupraAccount } from "../src/index";
import { BCS, HexString, TransactionStatus, TxnBuilderTypes, TypeTagParser } from "../src/index";
import { createFundedAccount } from "./helpers/accounts";
import { describeE2E } from "./helpers/describe";
import { getE2EContext, type E2EContext } from "./helpers/env";
import { rawSupraBalance } from "./helpers/raw";

/**
 * Entry functions with type arguments that are not structs, struct type arguments with type
 * parameters, and scripts with `u16`, `u32` and `u256` arguments. The module and the script are the
 * ones in `fixtures/move`, compiled into `fixtures/compiled.json`.
 */

interface Compiled {
    moduleAddress: string;
    metadata: string;
    module: string;
    script: string;
}

const compiled = JSON.parse(readFileSync(join(__dirname, "fixtures", "compiled.json"), "utf8")) as Compiled;

const TYPE_ARGUMENTS = [
    "u64",
    "address",
    "vector<u8>",
    "vector<0x1::string::String>",
    "0x1::coin::CoinStore<0x1::supra_coin::SupraCoin>",
];

const MAX_U256 = (1n << 256n) - 1n;

/** The compiled module with the address it was compiled for replaced by `address`. */
function moduleBytecodeFor(address: string): Uint8Array {
    const bytecode = Buffer.from(compiled.module, "hex");
    const from = Buffer.from(compiled.moduleAddress.slice(2), "hex");
    const to = Buffer.from(new HexString(address).toUint8Array());
    const at = bytecode.indexOf(from);
    if (at < 0) {
        throw new Error("The compiled module does not contain its compile-time address");
    }
    to.copy(bytecode, at);
    return new Uint8Array(bytecode);
}

describeE2E("type arguments and script arguments", () => {
    let ctx: E2EContext;
    let publisher: SupraAccount;
    let moduleAddress: string;
    let tagged: MoveFunctionId;
    let gas: { maxGas: bigint; gasUnitPrice: bigint };

    async function nextSequenceNumber(account: SupraAccount): Promise<bigint> {
        return BigInt((await ctx.supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number);
    }

    beforeAll(async () => {
        ctx = await getE2EContext();
        gas = { maxGas: 100_000n, gasUnitPrice: await ctx.supra.getMinGasUnitPrice() };
        publisher = await createFundedAccount(ctx);
        moduleAddress = publisher.address().toString();
        tagged = `${moduleAddress}::tagged::tagged` as MoveFunctionId;

        const code = new BCS.Serializer();
        code.serializeU32AsUleb128(1);
        code.serializeBytes(moduleBytecodeFor(moduleAddress));
        const publish = ctx.supra.transaction.build.rawTxnObject({
            senderAddress: publisher.address(),
            senderSequenceNumber: await nextSequenceNumber(publisher),
            function: "0x1::code::publish_package_txn" as MoveFunctionId,
            functionTypeArgs: [],
            functionArgs: [
                BCS.bcsSerializeBytes(new HexString(compiled.metadata).toUint8Array()),
                code.getBytes(),
            ],
            optionalTransactionPayloadArgs: gas,
        });
        const published = await publish.submitTransaction({
            senderAccount: publisher,
            enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true },
        });
        expect(published.status).toBe(TransactionStatus.Success);
    });

    describe.each(TYPE_ARGUMENTS)("entry function with the type argument %s", (type) => {
        test("builds the same transaction from a TypeTag and from a string", async () => {
            const common = {
                senderAddress: publisher.address(),
                senderSequenceNumber: await nextSequenceNumber(publisher),
                function: tagged,
                functionArgs: [],
                optionalTransactionPayloadArgs: { ...gas, txExpiryTime: 4_000_000_000n },
            };
            const fromTag = await ctx.supra.transaction.build.simple({
                ...common,
                functionTypeArgs: [new TypeTagParser(type).parseTypeTag()],
            });
            const fromString = await ctx.supra.transaction.build.simple({ ...common, functionTypeArgs: [type] });
            expect(fromTag.toHexString().toString()).toBe(fromString.toHexString().toString());
        });

        test("simulates with the same result from a TypeTag and from a string", async () => {
            const sequenceNumber = await nextSequenceNumber(publisher);
            const simulate = async (functionTypeArgs: Array<string | TxnBuilderTypes.TypeTag>) => {
                const rawTxn = await ctx.supra.transaction.build.simple({
                    senderAddress: publisher.address(),
                    senderSequenceNumber: sequenceNumber,
                    function: tagged,
                    functionTypeArgs,
                    functionArgs: [],
                    optionalTransactionPayloadArgs: gas,
                });
                return rawTxn.simulate(publisher);
            };

            const fromTag = await simulate([new TypeTagParser(type).parseTypeTag()]);
            const fromString = await simulate([type]);
            expect(fromTag.status).toBe(TransactionStatus.Success);
            expect(fromString.status).toBe(TransactionStatus.Success);
            expect(fromTag.status).toBe(fromString.status);
        });

        test("submits from rawTxnObject with a TypeTag", async () => {
            const rawTxn = ctx.supra.transaction.build.rawTxnObject({
                senderAddress: publisher.address(),
                senderSequenceNumber: await nextSequenceNumber(publisher),
                function: tagged,
                functionTypeArgs: [new TypeTagParser(type).parseTypeTag()],
                functionArgs: [],
                optionalTransactionPayloadArgs: gas,
            });
            const submitted = await rawTxn.submitTransaction({
                senderAccount: publisher,
                enableTransactionWaitAndSimulationArgs: {
                    enableTransactionSimulation: true,
                    enableWaitForTransaction: true,
                },
            });
            expect(submitted.status).toBe(TransactionStatus.Success);
        });

        test("submits from build.simple with a string", async () => {
            const rawTxn = await ctx.supra.transaction.build.simple({
                senderAddress: publisher.address(),
                senderSequenceNumber: await nextSequenceNumber(publisher),
                function: tagged,
                functionTypeArgs: [type],
                functionArgs: [],
                optionalTransactionPayloadArgs: gas,
            });
            const submitted = await rawTxn.submitTransaction({
                senderAccount: publisher,
                enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true },
            });
            expect(submitted.status).toBe(TransactionStatus.Success);
        });

        test("submits through the payload built by sendTxnPayload", async () => {
            const rawTxn = ctx.supra.transaction.build.rawTxnObject({
                senderAddress: publisher.address(),
                senderSequenceNumber: await nextSequenceNumber(publisher),
                function: tagged,
                functionTypeArgs: [new TypeTagParser(type).parseTypeTag()],
                functionArgs: [],
                optionalTransactionPayloadArgs: gas,
            });
            const submitted = await ctx.supra.transaction.submit.submitRawTransaction({
                senderAccount: publisher,
                rawTransaction: rawTxn,
                enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true },
            });
            expect(submitted.status).toBe(TransactionStatus.Success);
        });
    });

    describe.each(TYPE_ARGUMENTS)("view function with the type argument %s", (type) => {
        test("gives equal results for a TypeTag and for a string", async () => {
            const view = (typeArguments: Array<string | TxnBuilderTypes.TypeTag>) =>
                ctx.supra.methods.view<[bigint]>({
                    function: `${moduleAddress}::tagged::echo` as MoveFunctionId,
                    typeArguments,
                    functionArguments: [42n],
                });
            const fromString = await view([type]);
            const fromTag = await view([new TypeTagParser(type).parseTypeTag()]);
            expect(fromString).toEqual([42n]);
            expect(fromTag).toEqual(fromString);
        });
    });

    test("view of a framework function accepts a struct TypeTag with type parameters", async () => {
        const address = (await createFundedAccount(ctx)).address().toString();
        const type = "0x1::supra_coin::SupraCoin";
        const [balance] = await ctx.supra.methods.view<[bigint]>({
            function: "0x1::coin::balance",
            functionArguments: [address],
            typeArguments: [new TypeTagParser(type).parseTypeTag()],
        });
        expect(balance).toBe(await rawSupraBalance(ctx, address));
    });

    describe("script with u16, u32 and u256 arguments", () => {
        async function scriptTxn(a: number, b: number, c: bigint) {
            return ctx.supra.transaction.build.scriptRawTxnObject({
                senderAddress: publisher.address(),
                senderSequenceNumber: await nextSequenceNumber(publisher),
                scriptCode: new HexString(compiled.script).toUint8Array(),
                scriptTypeArgs: [],
                scriptArgs: [
                    new TxnBuilderTypes.TransactionArgumentU16(a),
                    new TxnBuilderTypes.TransactionArgumentU32(b),
                    new TxnBuilderTypes.TransactionArgumentU256(c),
                ],
                optionalTransactionPayloadArgs: gas,
            });
        }

        test("simulates", async () => {
            const simulated = await (await scriptTxn(65535, 4294967295, MAX_U256)).simulate(publisher);
            expect(simulated.status).toBe(TransactionStatus.Success);
        });

        test("reaches the script with the values it was given", async () => {
            // The script aborts with a different code for each argument that is not the expected value.
            await expect((await scriptTxn(65534, 4294967295, MAX_U256)).simulate(publisher)).rejects.toThrow(
                "Move abort: code 0x1",
            );
            await expect((await scriptTxn(65535, 4294967294, MAX_U256)).simulate(publisher)).rejects.toThrow(
                "Move abort: code 0x2",
            );
            await expect((await scriptTxn(65535, 4294967295, MAX_U256 - 1n)).simulate(publisher)).rejects.toThrow(
                "Move abort: code 0x3",
            );
        });

        test("submits", async () => {
            const submitted = await (
                await scriptTxn(65535, 4294967295, MAX_U256)
            ).submitTransaction({
                senderAccount: publisher,
                enableTransactionWaitAndSimulationArgs: {
                    enableTransactionSimulation: true,
                    enableWaitForTransaction: true,
                },
            });
            expect(submitted.status).toBe(TransactionStatus.Success);
        });
    });
});
