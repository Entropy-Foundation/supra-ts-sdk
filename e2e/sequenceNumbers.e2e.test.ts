import type { MoveModule, SubmitTransactionResponse, SupraAccount } from "../src/index";
import { SupraClient, SupraSimulationFailedError, TypeTagParser } from "../src/index";
import { isStaleSequenceNumberError } from "../src/internal/sequenceNumber";
import { createFundedAccount, createUnfundedAccount } from "./helpers/accounts";
import { describeE2E } from "./helpers/describe";
import { getE2EContext, type E2EContext } from "./helpers/env";
import { pollUntil, rawGet, rawWaitForCommit, type RawTransaction } from "./helpers/raw";
import { fixtureModuleFor, fixturePackageMetadata } from "./helpers/fixturePackage";
import { explicitGas } from "./helpers/transfers";

const TRANSFERS = 10;
const AMOUNT = 1_000n;

describeE2E("sequence numbers", () => {
    let ctx: E2EContext;

    beforeAll(async () => {
        ctx = await getE2EContext();
    });

    /** A client of its own, so that its counter does not depend on the other tests. */
    function newClient(): SupraClient {
        return new SupraClient({ rpcUrl: ctx.rpcUrl, chainId: ctx.chainId });
    }

    async function chainSequenceNumber(account: SupraAccount): Promise<bigint> {
        return BigInt((await ctx.supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number);
    }

    async function transfer(
        supra: SupraClient,
        sender: SupraAccount,
        options: { sequenceNumber?: bigint; wait?: boolean } = {},
    ): Promise<SubmitTransactionResponse> {
        const gas = await explicitGas(ctx);
        return supra.coin.transferSupraCoin({
            senderAccount: sender,
            receiverAccountAddress: createUnfundedAccount().address().toString(),
            amount: AMOUNT,
            optionalTransactionArgs: {
                optionalTransactionPayloadArgs:
                    options.sequenceNumber === undefined ? gas : { ...gas, sequenceNumber: options.sequenceNumber },
                enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: options.wait ?? false },
            },
        });
    }

    /** Waits for every hash to commit and returns the sequence numbers of the transactions. */
    async function commitAll(responses: SubmitTransactionResponse[]): Promise<bigint[]> {
        const committed: RawTransaction[] = await Promise.all(
            responses.map((response) => rawWaitForCommit(ctx, response.hash)),
        );
        committed.forEach((txn) => expect(txn.status).toBe("Success"));
        return committed.map((txn) => BigInt(txn.header?.sequence_number ?? -1));
    }

    function expectConsecutive(numbers: bigint[], first: bigint): void {
        const sorted = [...numbers].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        expect(sorted).toEqual(Array.from({ length: numbers.length }, (_, index) => first + BigInt(index)));
    }

    test("transfers issued together from one account are all accepted and committed", async () => {
        const sender = await createFundedAccount(ctx);
        const supra = newClient();
        const first = await chainSequenceNumber(sender);

        const responses = await Promise.all(Array.from({ length: TRANSFERS }, () => transfer(supra, sender)));

        expect(new Set(responses.map((response) => response.hash)).size).toBe(TRANSFERS);
        expectConsecutive(await commitAll(responses), first);
        await pollUntil(
            "the account's sequence number to advance",
            () => chainSequenceNumber(sender),
            (value) => value === first + BigInt(TRANSFERS),
        );
    });

    test("transfers issued one after another without waiting are all accepted and committed", async () => {
        const sender = await createFundedAccount(ctx);
        const supra = newClient();
        const first = await chainSequenceNumber(sender);

        const responses: SubmitTransactionResponse[] = [];
        for (let index = 0; index < TRANSFERS; index += 1) {
            responses.push(await transfer(supra, sender));
        }

        expectConsecutive(await commitAll(responses), first);
    });

    test("a counter that another client made stale recovers within the call", async () => {
        const sender = await createFundedAccount(ctx);
        const first = newClient();
        const second = newClient();

        await transfer(first, sender, { wait: true });
        await transfer(second, sender, { wait: true });
        await transfer(second, sender, { wait: true });
        const start = await chainSequenceNumber(sender);
        expect(start).toBe(3n);

        const fetchSpy = jest.spyOn(global, "fetch");
        let recovered: SubmitTransactionResponse;
        let submissions: Response[];
        try {
            recovered = await transfer(first, sender, { wait: true });
            submissions = await Promise.all(
                fetchSpy.mock.results
                    .filter((_, index) => String(fetchSpy.mock.calls[index]?.[0]).endsWith("/transactions/submit"))
                    .map(async (result) => (await result.value) as Response),
            );
        } finally {
            fetchSpy.mockRestore();
        }
        const next = await transfer(first, sender, { wait: true });

        // The node refused the stale number with a 400 and the call sent the transfer again with the chain's number.
        expect(submissions.map((response) => response.status)).toEqual([400, 200]);
        expect(recovered.status).toBe("Success");
        expect(next.status).toBe("Success");
        expect(await chainSequenceNumber(sender)).toBe(start + 2n);
    });

    test("a number that already has a pending transaction is recognised as in use and the counter recovers", async () => {
        const sender = await createFundedAccount(ctx);
        const first = newClient();
        const second = newClient();

        await transfer(first, sender, { wait: true });
        // The counter of `first` is at 1. `second` sends another transaction with number 1 and does not wait.
        const pending = await transfer(second, sender, { sequenceNumber: 1n });
        const outcome = await transfer(first, sender, { wait: true }).then(
            (response) => response,
            (error: unknown) => error,
        );

        // The call either recovers within itself, or the node still refuses the number and the refusal is
        // recognised as one about the sequence number.
        if (outcome instanceof Error) {
            expect(isStaleSequenceNumberError(outcome)).toBe(true);
        } else {
            expect((outcome as SubmitTransactionResponse).status).toBe("Success");
        }
        await rawWaitForCommit(ctx, pending.hash);
        const recovered = await transfer(first, sender, { wait: true });

        expect(recovered.status).toBe("Success");
    });

    test("the counter continues from the chain after resetSequenceNumber", async () => {
        const sender = await createFundedAccount(ctx);
        const supra = newClient();
        await transfer(supra, sender, { wait: true });

        // An explicit number does not touch the counter, which stays at 1 while the chain moves to 2.
        const committed = await transfer(supra, sender, { sequenceNumber: 1n, wait: true });
        expect(committed.status).toBe("Success");
        supra.resetSequenceNumber(sender.address());
        const afterReset = await transfer(supra, sender, { wait: true });

        expect(afterReset.status).toBe("Success");
        expect(await chainSequenceNumber(sender)).toBe(3n);
    });

    test("an explicit sequence number is used as given", async () => {
        const sender = await createFundedAccount(ctx);
        const supra = newClient();
        const explicit = await chainSequenceNumber(sender);

        const response = await transfer(supra, sender, { sequenceNumber: explicit, wait: true });

        const raw = await rawGet<RawTransaction>(ctx, `/rpc/v3/transactions/${response.hash}`);
        expect(BigInt(raw.body.header?.sequence_number ?? -1)).toBe(explicit);
    });

    describe("with the default gas settings (the max gas is estimated)", () => {
        const PIPELINED = 5;

        function defaultGasTransfer(supra: SupraClient, sender: SupraAccount): Promise<SubmitTransactionResponse> {
            return supra.coin.transferSupraCoin({
                senderAccount: sender,
                receiverAccountAddress: createUnfundedAccount().address().toString(),
                amount: AMOUNT,
                optionalTransactionArgs: {
                    enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: false },
                },
            });
        }

        test("transfers issued one after another without waiting are all accepted with consecutive numbers", async () => {
            const sender = await createFundedAccount(ctx);
            const supra = newClient();
            const first = await chainSequenceNumber(sender);

            const responses: SubmitTransactionResponse[] = [];
            for (let index = 0; index < PIPELINED; index += 1) {
                responses.push(await defaultGasTransfer(supra, sender));
            }

            expectConsecutive(await commitAll(responses), first);
        });

        test("transfers issued together are all accepted with consecutive numbers", async () => {
            const sender = await createFundedAccount(ctx);
            const supra = newClient();
            const first = await chainSequenceNumber(sender);

            const responses = await Promise.all(
                Array.from({ length: PIPELINED }, () => defaultGasTransfer(supra, sender)),
            );

            expectConsecutive(await commitAll(responses), first);
        });

        describe("a call that depends on a transaction that has not committed", () => {
            const taggedAbi = (address: string) =>
                ({
                    address,
                    name: "tagged",
                    friends: [],
                    exposed_functions: [
                        {
                            name: "tagged",
                            visibility: "public",
                            is_entry: true,
                            is_view: false,
                            generic_type_params: [{ constraints: [] }],
                            params: ["&signer"],
                            return: [],
                        },
                    ],
                    structs: [],
                }) as const satisfies MoveModule;

            /** Publishes the fixture module without waiting and calls its entry function straight after. */
            async function publishThenCall(
                maxGas: bigint | undefined,
            ): Promise<{ publisher: SupraAccount; call: Promise<SubmitTransactionResponse>; submitted: () => number }> {
                const publisher = await createFundedAccount(ctx);
                const supra = newClient();
                const publishing = await supra.transaction.publishPackage({
                    senderAccount: publisher,
                    packageMetadata: fixturePackageMetadata(),
                    modulesCode: [fixtureModuleFor(publisher.address().toString())],
                    optionalTransactionArgs: {
                        enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: false },
                    },
                });
                expect(publishing.hash).toBeDefined();
                const abi = taggedAbi(publisher.address().toString());
                const call = supra.contract.fromABI([abi] as const).contracts.tagged.entry.tagged({
                    functionArguments: [publisher],
                    typeArguments: [new TypeTagParser("0x1::supra_coin::SupraCoin").parseTypeTag()],
                    ...(maxGas === undefined ? {} : { optionalTransactionPayloadArgs: { maxGas } }),
                });
                return { publisher, call, submitted: () => 0 };
            }

            test("throws SupraSimulationFailedError and submits nothing without maxGas", async () => {
                const { publisher, call } = await publishThenCall(undefined);

                await expect(call).rejects.toBeInstanceOf(SupraSimulationFailedError);

                // Only the publish is in the account's history, and the number of the refused call is free.
                await pollUntil(
                    "the publish to commit",
                    () => chainSequenceNumber(publisher),
                    (value) => value === 1n,
                );
            });

            test("is accepted and committed with maxGas", async () => {
                const { publisher, call } = await publishThenCall(5_000n);

                const response = await call;

                expect(await commitAll([response])).toEqual([1n]);
                await pollUntil(
                    "the account's sequence number to advance",
                    () => chainSequenceNumber(publisher),
                    (value) => value === 2n,
                );
            });
        });
    });
});
