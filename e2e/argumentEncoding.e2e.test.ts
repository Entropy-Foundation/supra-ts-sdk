import { randomBytes } from "node:crypto";
import type { MoveFunctionId, SupraAccount } from "../src/index";
import { HexString, TransactionStatus, TxnBuilderTypes } from "../src/index";
import { createFundedAccount, createMigratedAccount, createUnfundedAccount } from "./helpers/accounts";
import { describeE2E } from "./helpers/describe";
import { getE2EContext, type E2EContext } from "./helpers/env";
import { rawSupraBalance, SUPRA_COIN_TYPE } from "./helpers/raw";
import { publishTaggedModule } from "./helpers/taggedModule";

/**
 * Encoding of address, `vector<u8>`, `Option` and integer arguments, and entry functions with several
 * signer parameters. The functions are in the module `sdk_e2e::tagged` of `fixtures/move`.
 */

const AMOUNT = 777n;

/**
 * A random address with `leadingZeros` zero hex digits followed by a non-zero digit. A transfer creates
 * the account, so the address needs no key pair.
 */
function addressWithLeadingZeros(leadingZeros: number): string {
    const tail = randomBytes(32).toString("hex").slice(leadingZeros + 1);
    return `0x${"0".repeat(leadingZeros)}a${tail}`;
}

describeE2E("argument encoding", () => {
    let ctx: E2EContext;
    let sender: SupraAccount;
    let publisher: SupraAccount;
    let moduleAddress: string;
    let gas: { maxGas: bigint; gasUnitPrice: bigint };

    const fn = (name: string) => `${moduleAddress}::tagged::${name}` as MoveFunctionId;

    async function nextSequenceNumber(account: SupraAccount): Promise<bigint> {
        return BigInt((await ctx.supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number);
    }

    beforeAll(async () => {
        ctx = await getE2EContext();
        gas = { maxGas: 100_000n, gasUnitPrice: await ctx.supra.getMinGasUnitPrice() };
        sender = await createFundedAccount(ctx);
        publisher = await createFundedAccount(ctx);
        moduleAddress = await publishTaggedModule(ctx, publisher, gas);
    });

    describe("receiver addresses shorter than 64 hex characters", () => {
        const waitForCommit = { enableWaitForTransaction: true };

        test.each([
            ["62", 2],
            ["63", 1],
        ])("transferSupraCoin to an address of %s hex characters funds the 32-byte address", async (_, zeros) => {
            const receiver = addressWithLeadingZeros(zeros);
            const short = `0x${receiver.slice(2 + zeros)}`;
            expect(short).toHaveLength(2 + 64 - zeros);

            const txn = await ctx.supra.coin.transferSupraCoin({
                senderAccount: sender,
                receiverAccountAddress: short,
                amount: AMOUNT,
                optionalTransactionArgs: {
                    optionalTransactionPayloadArgs: { maxGas: 5_000n, gasUnitPrice: gas.gasUnitPrice },
                    enableTransactionWaitAndSimulationArgs: waitForCommit,
                },
            });
            expect(txn.status).toBe(TransactionStatus.Success);
            expect(await rawSupraBalance(ctx, receiver)).toBe(AMOUNT);
        });

        test("transferCoin to a short address funds the 32-byte address", async () => {
            const receiver = addressWithLeadingZeros(2);
            const txn = await ctx.supra.coin.transferCoin({
                senderAccount: sender,
                receiverAccountAddress: `0x${receiver.slice(4)}`,
                amount: AMOUNT,
                coinType: SUPRA_COIN_TYPE,
                optionalTransactionArgs: {
                    optionalTransactionPayloadArgs: { maxGas: 5_000n, gasUnitPrice: gas.gasUnitPrice },
                    enableTransactionWaitAndSimulationArgs: waitForCommit,
                },
            });
            expect(txn.status).toBe(TransactionStatus.Success);
            expect(await rawSupraBalance(ctx, receiver)).toBe(AMOUNT);
        });
    });

    describe("vector<u8> entry argument", () => {
        const forms: Array<[string, () => unknown]> = [
            ["number[]", () => [0, 1, 255, 127]],
            ["Uint8Array", () => new Uint8Array([0, 1, 255, 127])],
            ["0x-prefixed hex string", () => "0x0001ff7f"],
        ];

        async function build(bytes: unknown, tag: number, txExpiryTime?: bigint) {
            return ctx.supra.transaction.build.simple({
                senderAddress: sender.address(),
                senderSequenceNumber: await nextSequenceNumber(sender),
                function: fn("with_bytes"),
                functionTypeArgs: [],
                functionArgs: [bytes as never, tag],
                optionalTransactionPayloadArgs: txExpiryTime === undefined ? gas : { ...gas, txExpiryTime },
            });
        }

        test("the three forms build the same transaction", async () => {
            const built = await Promise.all(
                forms.map(async ([, bytes]) => (await build(bytes(), 7, 4_000_000_000n)).toHexString().toString()),
            );
            expect(new Set(built).size).toBe(1);
        });

        test.each(forms)("%s is accepted by the node and reaches the function intact", async (_, bytes) => {
            const rawTxn = await build(bytes(), 7);
            const submitted = await rawTxn.submitTransaction({
                senderAccount: sender,
                enableTransactionWaitAndSimulationArgs: {
                    enableTransactionSimulation: true,
                    enableWaitForTransaction: true,
                },
            });
            expect(submitted.status).toBe(TransactionStatus.Success);
        });

        test("other bytes reach the function as other bytes", async () => {
            const rawTxn = await build([0, 1, 255, 126], 7);
            await expect(rawTxn.simulate(sender)).rejects.toThrow(/E_BYTES|code 0x1/);
        });

        test.each(forms)("view with %s returns the bytes", async (_, bytes) => {
            const [result] = await ctx.supra.methods.view<[string]>({
                function: fn("echo_bytes"),
                functionArguments: [bytes() as never],
            });
            expect(result.replace(/^0x/, "")).toBe("0001ff7f");
        });
    });

    describe("integer strings", () => {
        test("an empty string for a u64 argument throws before any request", async () => {
            const abi = (
                await ctx.supra.account.getAccountModule({ accountAddress: moduleAddress, moduleName: "tagged" })
            ).abi!;
            const fetchSpy = jest.spyOn(globalThis, "fetch");
            try {
                const before = fetchSpy.mock.calls.length;
                await expect(
                    ctx.supra.transaction.build.simple({
                        senderAddress: sender.address(),
                        senderSequenceNumber: 0n,
                        function: fn("with_bytes"),
                        functionTypeArgs: [],
                        functionArgs: ["0x0001ff7f", ""],
                        optionalTransactionPayloadArgs: gas,
                        abi,
                    }),
                ).rejects.toThrow("Failed to serialize argument 1 (u64)");
                expect(fetchSpy.mock.calls.length).toBe(before);
            } finally {
                fetchSpy.mockRestore();
            }
        });
    });

    describe("Object<T> and address arguments", () => {
        const FA_TRANSFER = "0x1::primary_fungible_store::transfer" as MoveFunctionId;
        const FA_BALANCE = "0x1::primary_fungible_store::balance" as MoveFunctionId;
        const METADATA = "0x1::fungible_asset::Metadata";
        const forms: Array<[string, (address: string) => string | HexString]> = [
            ["strings", (address) => address],
            ["HexStrings", (address) => new HexString(address)],
        ];

        test.each(forms)(
            "an entry function and a view function take Object<T> and address arguments as %s",
            async (_, form) => {
                const owner = await createMigratedAccount(ctx);
                const receiver = createUnfundedAccount().address().toString();
                const rawTxn = await ctx.supra.transaction.build.simple({
                    senderAddress: owner.address(),
                    senderSequenceNumber: await nextSequenceNumber(owner),
                    function: FA_TRANSFER,
                    functionTypeArgs: [METADATA],
                    functionArgs: [form("0xa"), form(receiver), AMOUNT],
                    optionalTransactionPayloadArgs: gas,
                });
                const submitted = await rawTxn.submitTransaction({
                    senderAccount: owner,
                    enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true },
                });
                expect(submitted.status).toBe(TransactionStatus.Success);

                const [balance] = await ctx.supra.methods.view<[bigint]>({
                    function: FA_BALANCE,
                    typeArguments: [METADATA],
                    functionArguments: [form(receiver), form("0xa")],
                });
                expect(balance).toBe(AMOUNT);
            },
        );

        test.each(["", "0x"])("%j as an Object<T> or address argument throws before any request", async (empty) => {
            const abi = (
                await ctx.supra.account.getAccountModule({ accountAddress: "0x1", moduleName: "primary_fungible_store" })
            ).abi!;
            const receiver = createUnfundedAccount().address().toString();
            const fetchSpy = jest.spyOn(globalThis, "fetch");
            try {
                const before = fetchSpy.mock.calls.length;
                const build = (functionArgs: unknown[]) =>
                    ctx.supra.transaction.build.simple({
                        senderAddress: sender.address(),
                        senderSequenceNumber: 0n,
                        function: FA_TRANSFER,
                        functionTypeArgs: [METADATA],
                        functionArgs: functionArgs as never[],
                        optionalTransactionPayloadArgs: gas,
                        abi,
                    });
                await expect(build([empty, receiver, AMOUNT])).rejects.toThrow(
                    "Failed to serialize argument 0 (0x1::object::Object<T0>): Expected an address",
                );
                await expect(build(["0xa", empty, AMOUNT])).rejects.toThrow(
                    "Failed to serialize argument 1 (address): Expected an address",
                );
                await expect(
                    ctx.supra.methods.view({
                        function: FA_BALANCE,
                        typeArguments: [METADATA],
                        functionArguments: [receiver, empty],
                        abi,
                    }),
                ).rejects.toThrow("Expected an address");
                expect(fetchSpy.mock.calls.length).toBe(before);
            } finally {
                fetchSpy.mockRestore();
            }
        });
    });

    describe("Option view arguments", () => {
        const view = (name: string, value: unknown) =>
            ctx.supra.methods.view<[bigint | string]>({ function: fn(name), functionArguments: [value as never] });

        test.each([16, 5, 0, 255])("Option<u8> Some(%d) returns the value", async (value) => {
            expect(await view("option_u8", value)).toEqual([BigInt(value)]);
        });

        test("Option<u8> None returns the None marker", async () => {
            expect(await view("option_u8", null)).toEqual([1000n]);
        });

        test("Option<u64>", async () => {
            expect(await view("option_u64", 5n)).toEqual([5n]);
            expect(await view("option_u64", 16)).toEqual([16n]);
            expect(await view("option_u64", null)).toEqual([1000n]);
        });

        test("Option<address>", async () => {
            const address = "0x00000000000000000000000000000000000000000000000000000000000000ab";
            for (const input of [address, "0xab"]) {
                const [result] = await view("option_address", input);
                expect(BigInt(result as string)).toBe(0xabn);
            }
            const [none] = await view("option_address", null);
            expect(BigInt(none as string)).toBe(0n);
        });

        test("Option<vector<u8>>", async () => {
            for (const bytes of [[1, 2, 3], new Uint8Array([1, 2, 3]), "0x010203"]) {
                const [result] = await view("option_bytes", bytes);
                expect((result as string).replace(/^0x/, "")).toBe("010203");
            }
            const [none] = await view("option_bytes", null);
            expect((none as string).replace(/^0x/, "")).toBe("ffffff");
        });
    });

    describe("entry functions with several signer parameters", () => {
        async function submitMultiAgent(
            name: string,
            functionArgs: unknown[],
            secondaries: SupraAccount[],
        ): Promise<TransactionStatus | string> {
            const rawTxn = await ctx.supra.transaction.build.simple({
                senderAddress: sender.address(),
                senderSequenceNumber: await nextSequenceNumber(sender),
                function: fn(name),
                functionTypeArgs: [],
                functionArgs: functionArgs as never[],
                optionalTransactionPayloadArgs: gas,
            });
            const payload = new TxnBuilderTypes.MultiAgentRawTransaction(
                rawTxn,
                secondaries.map((account) => new TxnBuilderTypes.AccountAddress(account.address().toUint8Array())),
            );
            const sign = (account: SupraAccount) =>
                ctx.supra.transaction.signTransaction({
                    senderAccount: account,
                    rawTxn: payload,
                });
            const submitted = await ctx.supra.transaction.submit.submitMultiAgentTransaction({
                secondarySignersAccountAddress: secondaries.map((account) => account.address().toString()),
                rawTxn,
                senderAuthenticator: await sign(sender),
                secondarySignersAuthenticator: await Promise.all(secondaries.map(sign)),
                enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true },
            });
            return submitted.status;
        }

        test("build.simple builds two_signers(&signer, &signer) and the multi-agent transaction commits", async () => {
            const second = await createFundedAccount(ctx);
            expect(await submitMultiAgent("two_signers", [], [second])).toBe(TransactionStatus.Success);
        });

        test("build.simple builds three_signers with a value argument and the multi-agent transaction commits", async () => {
            const second = await createFundedAccount(ctx);
            const third = await createFundedAccount(ctx);
            expect(await submitMultiAgent("three_signers", [9], [second, third])).toBe(TransactionStatus.Success);
        });
    });
});
