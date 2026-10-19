import type {
    MoveFunctionId,
    OptionalTransactionPayloadArgs,
    SubmitTransactionResponse,
    SupraAccount,
} from "../src/index";
import { MoveVmError, SupraSimulationFailedError, TransactionStatus, TypeTagParser } from "../src/index";
import { COIN_ABI } from "./helpers/abi";
import { createFundedAccount, createMigratedAccount, createUnfundedAccount, waitForBalance } from "./helpers/accounts";
import { describeE2E } from "./helpers/describe";
import { getE2EContext, type E2EContext } from "./helpers/env";
import { fixtureModuleFor, fixturePackageMetadata } from "./helpers/fixturePackage";
import { SUPRA_COIN_TYPE, rawPost, rawSupraBalance, type RawTransaction } from "./helpers/raw";

/**
 * Gas settings with the client's defaults (no `maxGas` anywhere): the max gas is estimated by simulation, or defaulted
 * by `transaction.build.simple`, and covers transfers that create the receiver, a publish and a multisig account
 * creation. Per-call settings reach the committed transaction.
 */

const SUPRA_FA = "0x000000000000000000000000000000000000000000000000000000000000000a";
const WAIT = { enableWaitForTransaction: true } as const;

/** Calls a view function with a plain request and returns its result. */
async function view<T extends unknown[] = unknown[]>(fn: string, args: unknown[]): Promise<T> {
    const ctx = await getE2EContext();
    const response = await rawPost<{ result: T }>(ctx, "/rpc/v3/view", {
        function: fn,
        type_arguments: [],
        arguments: args,
    });
    if (response.status !== 200) {
        throw new Error(`view ${fn} returned HTTP ${response.status}: ${JSON.stringify(response.body)}`);
    }
    return response.body.result;
}

function committed(txn: SubmitTransactionResponse): RawTransaction {
    if (txn.status === "NotReadBack") {
        throw new Error(`Transaction ${txn.hash} was not read back`);
    }
    return txn as unknown as RawTransaction;
}

describeE2E("gas settings", () => {
    let ctx: E2EContext;
    let sender: SupraAccount;

    beforeAll(async () => {
        ctx = await getE2EContext();
        sender = await createFundedAccount(ctx);
    });

    test("coin.transferCoin with SUPRA to a new address succeeds with the default settings", async () => {
        const receiver = createUnfundedAccount().address().toString();

        const txn = await ctx.supra.coin.transferCoin({
            senderAccount: sender,
            receiverAccountAddress: receiver,
            amount: 1_000n,
            coinType: SUPRA_COIN_TYPE,
            optionalTransactionArgs: { enableTransactionWaitAndSimulationArgs: WAIT },
        });

        expect(txn.status).toBe(TransactionStatus.Success);
        expect(await rawSupraBalance(ctx, receiver)).toBe(1_000n);
    });

    test("coin.transferSupraCoin to a new address succeeds with the default settings", async () => {
        const receiver = createUnfundedAccount().address().toString();

        const txn = await ctx.supra.coin.transferSupraCoin({
            senderAccount: sender,
            receiverAccountAddress: receiver,
            amount: 1_001n,
            optionalTransactionArgs: { enableTransactionWaitAndSimulationArgs: WAIT },
        });

        expect(txn.status).toBe(TransactionStatus.Success);
        expect(await rawSupraBalance(ctx, receiver)).toBe(1_001n);
    });

    test("publishPackage publishes a one-module package with the default settings", async () => {
        const publisher = await createFundedAccount(ctx);

        const txn = await ctx.supra.transaction.publishPackage({
            senderAccount: publisher,
            packageMetadata: fixturePackageMetadata(),
            modulesCode: [fixtureModuleFor(publisher.address().toString())],
            optionalTransactionArgs: { enableTransactionWaitAndSimulationArgs: WAIT },
        });

        expect(txn.status).toBe(TransactionStatus.Success);
        const module = await ctx.supra.account.getAccountModule({
            accountAddress: publisher.address().toString(),
            moduleName: "tagged",
        });
        expect(module.abi?.name).toBe("tagged");
    });

    test("a 2-of-2 multisig account built with transaction.build.simple is created with the default settings", async () => {
        const owner = await createFundedAccount(ctx);
        const otherOwner = createUnfundedAccount().address().toString();
        const [multisig] = await view<[string]>("0x1::multisig_account::get_next_multisig_account_address", [
            owner.address().toString(),
        ]);

        const rawTxn = await ctx.supra.transaction.build.simple({
            senderAddress: owner.address(),
            senderSequenceNumber: BigInt(
                (await ctx.supra.account.getAccountInfo({ accountAddress: owner.address() })).sequence_number,
            ),
            function: "0x1::multisig_account::create_with_owners" as MoveFunctionId,
            functionTypeArgs: [],
            functionArgs: [[otherOwner], 2n, [], [], 3_600n],
        });
        const txn = await rawTxn.submitTransaction({
            senderAccount: owner,
            enableTransactionWaitAndSimulationArgs: WAIT,
        });

        expect(txn.status).toBe(TransactionStatus.Success);
        expect(await view("0x1::multisig_account::num_signatures_required", [multisig])).toStrictEqual(["2"]);
        const [owners] = await view<[string[]]>("0x1::multisig_account::owners", [multisig]);
        expect(new Set(owners.map((address) => BigInt(address)))).toStrictEqual(
            new Set([owner.address().toString(), otherOwner].map((address) => BigInt(address))),
        );
    });

    test("an account with a small balance sends a transfer with the default settings", async () => {
        const poor = await createFundedAccount(ctx);
        const gasUnitPrice = await ctx.supra.getMinGasUnitPrice();
        const keep = 5_000_000n; // 0.05 SUPRA
        const drainMaxGas = 100n;
        const balance = await rawSupraBalance(ctx, poor.address().toString());

        // Moves everything except `keep` and the gas deposit of this transfer to an existing account.
        const drain = await ctx.supra.coin.transferSupraCoin({
            senderAccount: poor,
            receiverAccountAddress: sender.address().toString(),
            amount: balance - keep - drainMaxGas * gasUnitPrice,
            optionalTransactionArgs: {
                optionalTransactionPayloadArgs: { maxGas: drainMaxGas, gasUnitPrice },
                enableTransactionWaitAndSimulationArgs: WAIT,
            },
        });
        expect(drain.status).toBe(TransactionStatus.Success);
        const left = await waitForBalance(ctx, poor.address().toString(), (value) => value < balance);
        // The remaining balance does not pay for DEFAULT_MAX_GAS_UNITS.
        expect(left).toBeLessThan(20_000n * gasUnitPrice);

        const txn = await ctx.supra.coin.transferSupraCoin({
            senderAccount: poor,
            receiverAccountAddress: sender.address().toString(),
            amount: 1n,
            optionalTransactionArgs: { enableTransactionWaitAndSimulationArgs: WAIT },
        });

        expect(txn.status).toBe(TransactionStatus.Success);
        expect(BigInt(committed(txn).header?.max_gas_amount ?? 0) * gasUnitPrice).toBeLessThanOrEqual(left);
    });

    test("a SUPRA transfer that exceeds the balance throws SupraSimulationFailedError without submitting", async () => {
        const account = await createFundedAccount(ctx);
        const sequenceBefore = (await ctx.supra.account.getAccountInfo({ accountAddress: account.address() }))
            .sequence_number;
        const balance = await rawSupraBalance(ctx, account.address().toString());

        const originalFetch = globalThis.fetch;
        let submits = 0;
        globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
            const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            if (url.includes("/transactions/submit")) {
                submits++;
            }
            return originalFetch(input, init);
        };
        let error: unknown;
        try {
            await ctx.supra.coin.transferSupraCoin({
                senderAccount: account,
                receiverAccountAddress: createUnfundedAccount().address().toString(),
                amount: balance + 1n,
                optionalTransactionArgs: { enableTransactionWaitAndSimulationArgs: WAIT },
            });
        } catch (caught) {
            error = caught;
        } finally {
            globalThis.fetch = originalFetch;
        }

        expect(error).toBeInstanceOf(SupraSimulationFailedError);
        const failed = error as SupraSimulationFailedError;
        expect(failed.major_status).toBe(MoveVmError.ABORTED);
        expect(failed.sub_status).toBe(0x10006);
        expect(submits).toBe(0);
        expect((await ctx.supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number).toBe(
            sequenceBefore,
        );
    });

    describe("per-call settings reach the committed transaction", () => {
        let settings: Required<Pick<OptionalTransactionPayloadArgs, "maxGas" | "gasUnitPrice" | "txExpiryTime">>;

        beforeAll(async () => {
            settings = {
                maxGas: 4_321n,
                gasUnitPrice: (await ctx.supra.getMinGasUnitPrice()) + 1n,
                // A v12 node refuses an expiration more than 600 seconds after the submission.
                txExpiryTime: BigInt(Math.floor(Date.now() / 1000) + 540),
            };
        });

        function expectSettings(txn: SubmitTransactionResponse): void {
            const header = committed(txn).header;
            expect(BigInt(header?.max_gas_amount ?? 0)).toBe(settings.maxGas);
            expect(BigInt(header?.gas_unit_price ?? 0)).toBe(settings.gasUnitPrice);
            expect(BigInt(header?.expiration_timestamp.microseconds_since_unix_epoch ?? 0)).toBe(
                settings.txExpiryTime * 1_000_000n,
            );
        }

        test("coin.transferSupraCoin", async () => {
            const options = { ...settings };
            const txn = await ctx.supra.coin.transferSupraCoin({
                senderAccount: sender,
                receiverAccountAddress: createUnfundedAccount().address().toString(),
                amount: 1n,
                optionalTransactionArgs: {
                    optionalTransactionPayloadArgs: options,
                    enableTransactionWaitAndSimulationArgs: WAIT,
                },
            });
            expectSettings(txn);
            expect(options).toStrictEqual(settings);
        });

        test("coin.transferCoin", async () => {
            const txn = await ctx.supra.coin.transferCoin({
                senderAccount: sender,
                receiverAccountAddress: createUnfundedAccount().address().toString(),
                amount: 1n,
                coinType: SUPRA_COIN_TYPE,
                optionalTransactionArgs: {
                    optionalTransactionPayloadArgs: settings,
                    enableTransactionWaitAndSimulationArgs: WAIT,
                },
            });
            expectSettings(txn);
        });

        test("fungibleAsset.transferSupraFungibleAsset", async () => {
            const txn = await ctx.supra.fungibleAsset.transferSupraFungibleAsset({
                senderAccount: await createMigratedAccount(ctx),
                receiverAccountAddress: createUnfundedAccount().address().toString(),
                amount: 1n,
                optionalTransactionArgs: {
                    optionalTransactionPayloadArgs: settings,
                    enableTransactionWaitAndSimulationArgs: WAIT,
                },
            });
            expectSettings(txn);
        });

        test("fungibleAsset.transferFungibleAsset", async () => {
            const txn = await ctx.supra.fungibleAsset.transferFungibleAsset({
                senderAccount: await createMigratedAccount(ctx),
                receiverAccountAddress: createUnfundedAccount().address().toString(),
                amount: 1n,
                assetAddress: SUPRA_FA,
                optionalTransactionArgs: {
                    optionalTransactionPayloadArgs: settings,
                    enableTransactionWaitAndSimulationArgs: WAIT,
                },
            });
            expectSettings(txn);
        });

        test("fungibleAsset.migrateCoinToFungibleStore", async () => {
            const txn = await ctx.supra.fungibleAsset.migrateCoinToFungibleStore({
                senderAccount: await createFundedAccount(ctx),
                optionalTransactionArgs: {
                    optionalTransactionPayloadArgs: settings,
                    enableTransactionWaitAndSimulationArgs: WAIT,
                },
            });
            expectSettings(txn);
        });

        test("transaction.publishPackage", async () => {
            const publisher = await createFundedAccount(ctx);
            const txn = await ctx.supra.transaction.publishPackage({
                senderAccount: publisher,
                packageMetadata: fixturePackageMetadata(),
                modulesCode: [fixtureModuleFor(publisher.address().toString())],
                optionalTransactionArgs: {
                    optionalTransactionPayloadArgs: settings,
                    enableTransactionWaitAndSimulationArgs: WAIT,
                },
            });
            expectSettings(txn);
        });

        test("contract entry function from ABI", async () => {
            const receiver = (await createFundedAccount(ctx)).address().toString();
            const txn = await ctx.supra.contract.fromABI([COIN_ABI] as const).contracts.coin.entry.transfer({
                functionArguments: [sender, receiver, 1n],
                typeArguments: [new TypeTagParser(SUPRA_COIN_TYPE).parseTypeTag()],
                optionalTransactionPayloadArgs: settings,
                enableTransactionWaitAndSimulationArgs: WAIT,
            });
            expectSettings(txn);
        });

        test("transaction.build.simple", async () => {
            const rawTxn = await ctx.supra.transaction.build.simple({
                senderAddress: sender.address(),
                senderSequenceNumber: BigInt(
                    (await ctx.supra.account.getAccountInfo({ accountAddress: sender.address() })).sequence_number,
                ),
                function: "0x1::supra_account::transfer" as MoveFunctionId,
                functionTypeArgs: [],
                functionArgs: [createUnfundedAccount().address().toString(), 1n],
                optionalTransactionPayloadArgs: settings,
            });
            const txn = await rawTxn.submitTransaction({
                senderAccount: sender,
                enableTransactionWaitAndSimulationArgs: WAIT,
            });
            expectSettings(txn);
        });
    });
});
