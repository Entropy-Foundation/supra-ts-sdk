import { BCS, HexString, SupraAccount, TxnBuilderTypes } from "supra-l1-sdk-core";
import { SupraClient } from "../../../api/supraClient";
import { SupraAPIError, SupraServiceUnavailableError } from "../../../errors/apiError";
import { SupraError } from "../../../errors/supraError";
import { SupraGasUnitPriceBelowMinimumError, SupraSimulationFailedError } from "../../../errors/transactionError";
import { MockNode } from "./helpers/mockNode";
import { newClient, RECEIVER, RPC_URL, transfer } from "./helpers/transfers";

/**
 * The gas unit price of a transaction: the call's, else the client's, else the node's estimate
 * (`max(median, minimum)`), read for each transaction; the read starts before the account's lock is requested and is
 * awaited under it. A price the caller set that the node refuses as below its minimum throws
 * `SupraGasUnitPriceBelowMinimumError`, with the original error as its cause.
 */

const originalFetch = global.fetch;
let node: MockNode;

beforeEach(() => {
    // The mock node does not verify signatures; a fixed signature keeps the runs fast.
    jest.spyOn(SupraAccount.prototype, "signBuffer").mockReturnValue(new HexString("00".repeat(64)));
    node = new MockNode();
    global.fetch = node.fetch;
});

afterEach(() => {
    node.stop();
    global.fetch = originalFetch;
    jest.restoreAllMocks();
});

const estimateReads = () => node.counts["estimate_gas_price"] ?? 0;

describe("the default gas unit price", () => {
    it.each([
        [120_000, 150_000, 150_000n],
        [200_000, 100_000, 200_000n],
        [100_000, 100_000, 100_000n],
    ])("is max(median %p, minimum %p) = %p", async (median, min, expected) => {
        node.gasPrice = { median, min };

        await transfer(newClient(), new SupraAccount(), { maxGas: 5_000n });

        expect(node.gasUnitPrices).toStrictEqual([expected]);
    });

    it("is read for each transaction: three transactions, three requests", async () => {
        const supra = newClient();
        const sender = new SupraAccount();

        node.gasPrice = { median: 100_000, min: 100_000 };
        await transfer(supra, sender, { maxGas: 5_000n });
        node.gasPrice = { median: 130_000, min: 100_000 };
        await transfer(supra, sender, { maxGas: 5_000n });
        node.gasPrice = { median: 90_000, min: 120_000 };
        await transfer(supra, sender, { maxGas: 5_000n });

        expect(estimateReads()).toBe(3);
        expect(node.gasUnitPrices).toStrictEqual([100_000n, 130_000n, 120_000n]);
    });

    it("is read once for a transaction whose max gas is estimated, and used by the balance cap and the transaction", async () => {
        node.gasPrice = { median: 500_000, min: 100_000 };
        const simulated: Array<{ max_gas_amount: number; gas_unit_price: number }> = [];
        global.fetch = ((input: string | URL | Request, init?: RequestInit) => {
            if (new URL(String(input)).pathname.endsWith("/transactions/simulate")) {
                simulated.push(
                    (JSON.parse(String(init?.body)) as { Move: { raw_txn: (typeof simulated)[number] } }).Move.raw_txn,
                );
            }
            return node.fetch(input, init);
        }) as typeof fetch;

        await transfer(newClient(), new SupraAccount(), {});

        expect(estimateReads()).toBe(1);
        // The mock node's balance is 500 SUPRA: 50,000,000,000 quants pay for 100,000 units at 500,000 quants.
        expect(simulated[0]).toMatchObject({ max_gas_amount: 100_000, gas_unit_price: 500_000 });
        expect(node.gasUnitPrices).toStrictEqual([500_000n]);
    });

    it("is not read when the call sets the price", async () => {
        await transfer(newClient(), new SupraAccount(), { gasUnitPrice: 123_456n });

        expect(estimateReads()).toBe(0);
        expect(node.gasUnitPrices).toStrictEqual([123_456n]);
    });

    it("is not read when the client sets the price, and the call's price replaces it", async () => {
        const supra = newClient({ gasUnitPrice: 222_222n });
        const sender = new SupraAccount();

        await transfer(supra, sender, { maxGas: 5_000n });
        await transfer(supra, sender, { maxGas: 5_000n, gasUnitPrice: 333_333n });

        expect(estimateReads()).toBe(0);
        expect(node.gasUnitPrices).toStrictEqual([222_222n, 333_333n]);
    });

    it("a failed read throws its error, submits nothing, and the next call uses the number", async () => {
        const supra = newClient();
        const sender = new SupraAccount();
        node.failEstimateReads = 1;

        const error: unknown = await transfer(supra, sender, { maxGas: 5_000n }).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(SupraServiceUnavailableError);
        expect(node.submitted).toStrictEqual([]);

        await transfer(supra, sender, { maxGas: 5_000n });
        expect(node.submitted).toStrictEqual([5]);
    });

    describe("in the order of the calls", () => {
        /** Holds the answer to the first read of the estimate until the returned function is called. */
        function holdFirstEstimate(): () => void {
            let release: (() => void) | undefined;
            const held = new Promise<void>((resolve) => (release = resolve));
            let holdNext = true;
            global.fetch = ((input: string | URL | Request, init?: RequestInit) => {
                if (new URL(String(input)).pathname.endsWith("/transactions/estimate_gas_price") && holdNext) {
                    holdNext = false;
                    return held.then(() => node.fetch(input, init));
                }
                return node.fetch(input, init);
            }) as typeof fetch;
            return () => release?.();
        }

        const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

        it("gives the lower sequence number to the first of two calls whose first read is slower", async () => {
            const supra = newClient();
            const sender = new SupraAccount();
            const release = holdFirstEstimate();

            const first = transfer(supra, sender, { maxGas: 5_000n });
            const second = transfer(supra, sender, { maxGas: 5_000n });
            await pause(100);
            // The second call's read has finished (the first call's answer is held); its number waits for the first
            // call's.
            expect(estimateReads()).toBe(1);
            expect(node.submitted).toStrictEqual([]);

            release();
            const [firstResult, secondResult] = await Promise.all([first, second]);

            expect(node.submitted).toStrictEqual([5, 6]);
            expect(firstResult.hash).toBe(node.submissionHash(5));
            expect(secondResult.hash).toBe(node.submissionHash(6));
        });

        it("hands the number of a call whose read fails to the next call and records nothing for it", async () => {
            const supra = newClient();
            const sender = new SupraAccount();
            node.failEstimateReads = 1;

            const first = transfer(supra, sender, { maxGas: 5_000n }).catch((e: unknown) => e);
            const second = transfer(supra, sender, { maxGas: 5_000n });
            const [firstResult, secondResult] = await Promise.all([first, second]);

            expect(firstResult).toBeInstanceOf(SupraServiceUnavailableError);
            expect(node.submitted).toStrictEqual([5]);
            expect(secondResult.hash).toBe(node.submissionHash(5));

            // No record holds a number for the failed call: the next call takes the next number.
            await transfer(supra, sender, { maxGas: 5_000n });
            expect(node.submitted).toStrictEqual([5, 6]);
            expect(node.pooled()).toStrictEqual([5, 6]);
        });

        it("makes a call with an explicit price wait for the calls ahead of it", async () => {
            const supra = newClient();
            const sender = new SupraAccount();
            const release = holdFirstEstimate();

            const first = transfer(supra, sender, { maxGas: 5_000n });
            const second = transfer(supra, sender, { maxGas: 5_000n, gasUnitPrice: 100_000n });
            await pause(100);
            expect(node.submitted).toStrictEqual([]);

            release();
            const [firstResult, secondResult] = await Promise.all([first, second]);

            expect(node.submitted).toStrictEqual([5, 6]);
            expect(firstResult.hash).toBe(node.submissionHash(5));
            expect(secondResult.hash).toBe(node.submissionHash(6));
        });
    });
});

describe("builders that make no request", () => {
    const sender = new SupraAccount().address();
    const functionArgs = [new SupraAccount().address().toUint8Array(), BCS.bcsSerializeUint64(1n)];
    const base = { senderAddress: sender, senderSequenceNumber: 0n };
    const entry = {
        ...base,
        function: "0x1::supra_account::transfer" as const,
        functionTypeArgs: [],
        functionArgs,
    };

    const builders: Array<[string, (supra: SupraClient, price?: bigint) => { gas_unit_price: bigint }]> = [
        [
            "rawTxnObject",
            (supra, price) =>
                supra.transaction.build.rawTxnObject({
                    ...entry,
                    ...(price === undefined ? {} : { optionalTransactionPayloadArgs: { gasUnitPrice: price } }),
                }),
        ],
        [
            "scriptRawTxnObject",
            (supra, price) =>
                supra.transaction.build.scriptRawTxnObject({
                    ...base,
                    scriptCode: new Uint8Array([1, 2, 3]),
                    scriptTypeArgs: [],
                    scriptArgs: [new TxnBuilderTypes.TransactionArgumentU64(1n)],
                    ...(price === undefined ? {} : { optionalTransactionPayloadArgs: { gasUnitPrice: price } }),
                }),
        ],
        [
            "automationRegistrationRawTxnObject",
            (supra, price) =>
                supra.transaction.build.automationRegistrationRawTxnObject({
                    ...entry,
                    automationMaxGasAmount: 500n,
                    automationGasPriceCap: 200_000n,
                    automationFeeCapForEpoch: 1_000n,
                    automationExpirationTimestampSecs: 4_000_000_000n,
                    automationAuxData: [],
                    ...(price === undefined ? {} : { optionalTransactionPayloadArgs: { gasUnitPrice: price } }),
                }),
        ],
        [
            "multisigRawTxnObject",
            (supra, price) =>
                supra.transaction.build.multisigRawTxnObject({
                    ...entry,
                    multisigAddress: new SupraAccount().address(),
                    ...(price === undefined ? {} : { optionalTransactionPayloadArgs: { gasUnitPrice: price } }),
                }),
        ],
        [
            "multisigProposalTxRawTxnObject",
            (supra, price) =>
                supra.transaction.build.multisigProposalTxRawTxnObject({
                    ...entry,
                    multisigAddress: new SupraAccount().address(),
                    ...(price === undefined ? {} : { optionalTransactionPayloadArgs: { gasUnitPrice: price } }),
                }),
        ],
    ];

    describe.each(builders)("%s", (_name, build) => {
        it("throws a RangeError naming both options when neither the call nor the client sets a price", () => {
            expect(() => build(newClient())).toThrow(RangeError);
            expect(() => build(newClient())).toThrow(/optionalTransactionPayloadArgs.*SupraConfig/s);
        });

        it("builds with the call's price", () => {
            expect(build(newClient(), 150_000n).gas_unit_price).toBe(150_000n);
        });

        it("builds with the client's price, and the call's price replaces it", () => {
            const supra = newClient({ gasUnitPrice: 250_000n });

            expect(build(supra).gas_unit_price).toBe(250_000n);
            expect(build(supra, 150_000n).gas_unit_price).toBe(150_000n);
        });

        it("makes no request", () => {
            build(newClient({ gasUnitPrice: 250_000n }));
            expect(Object.keys(node.counts)).toStrictEqual([]);
        });
    });
});

describe("transaction.build.simple", () => {
    it("reads the estimate when neither the call nor the client sets a price", async () => {
        node.gasPrice = { median: 90_000, min: 140_000 };

        const rawTxn = await newClient().transaction.build.simple({
            senderAddress: new SupraAccount().address(),
            senderSequenceNumber: 0n,
            function: "0x1::supra_account::transfer",
            functionTypeArgs: [],
            functionArgs: [RECEIVER, 1n],
            optionalTransactionPayloadArgs: { maxGas: 5_000n },
            abi: SUPRA_ACCOUNT_ABI,
        });

        expect(rawTxn.gas_unit_price).toBe(140_000n);
        expect(estimateReads()).toBe(1);
    });
});

describe("a gas unit price below the node's minimum", () => {
    beforeEach(() => {
        node.gasPrice = { median: 100_000, min: 100_000 };
    });

    it("is refused on submission with SupraGasUnitPriceBelowMinimumError, which carries both prices and the SupraAPIError as cause", async () => {
        const error: unknown = await transfer(newClient(), new SupraAccount(), {
            maxGas: 5_000n,
            gasUnitPrice: 1n,
        }).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(SupraGasUnitPriceBelowMinimumError);
        expect(error).toBeInstanceOf(SupraError);
        expect(error).not.toBeInstanceOf(SupraAPIError);
        const refusal = error as SupraGasUnitPriceBelowMinimumError;
        expect(refusal.gasUnitPrice).toBe(1n);
        expect(refusal.minimumGasUnitPrice).toBe(100_000n);
        expect(refusal.cause).toBeInstanceOf(SupraAPIError);
        expect((refusal.cause as SupraAPIError).status).toBe(400);
        expect(refusal.message).toBe((refusal.cause as SupraAPIError).message);
        expect(refusal.major_status).toBe("GAS_UNIT_PRICE_BELOW_MIN_BOUND");
        expect(refusal.toJSON()).toMatchObject({ gasUnitPrice: "1", minimumGasUnitPrice: "100000" });
    });

    it("leaves minimumGasUnitPrice undefined, and still throws the refusal, when the read of the minimum fails", async () => {
        node.failEstimateReads = 1;

        const error: unknown = await transfer(newClient(), new SupraAccount(), {
            maxGas: 5_000n,
            gasUnitPrice: 1n,
        }).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(SupraGasUnitPriceBelowMinimumError);
        expect((error as SupraGasUnitPriceBelowMinimumError).gasUnitPrice).toBe(1n);
        expect((error as SupraGasUnitPriceBelowMinimumError).minimumGasUnitPrice).toBeUndefined();
    });

    it("hands the sequence number out again and is not sent again", async () => {
        const supra = newClient();
        const sender = new SupraAccount();

        await expect(transfer(supra, sender, { maxGas: 5_000n, gasUnitPrice: 1n })).rejects.toBeInstanceOf(
            SupraGasUnitPriceBelowMinimumError,
        );
        expect(node.submitted).toStrictEqual([5]);

        await transfer(supra, sender, { maxGas: 5_000n });
        expect(node.submitted).toStrictEqual([5, 5]);
        expect(node.pooled()).toStrictEqual([5]);
    });

    it("is refused by the simulation before submission with SupraGasUnitPriceBelowMinimumError and nothing is submitted", async () => {
        const supra = newClient();
        const sender = new SupraAccount();

        const error: unknown = await transfer(supra, sender, {
            maxGas: 5_000n,
            gasUnitPrice: 1n,
            simulate: true,
        }).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(SupraGasUnitPriceBelowMinimumError);
        expect(error).not.toBeInstanceOf(SupraSimulationFailedError);
        const refusal = error as SupraGasUnitPriceBelowMinimumError;
        expect(refusal.gasUnitPrice).toBe(1n);
        expect(refusal.minimumGasUnitPrice).toBe(100_000n);
        expect(refusal.cause).toBeInstanceOf(SupraSimulationFailedError);
        expect(refusal.major_status).toBe("GAS_UNIT_PRICE_BELOW_MIN_BOUND");
        expect(node.submitted).toStrictEqual([]);

        await transfer(supra, sender, { maxGas: 5_000n });
        expect(node.submitted).toStrictEqual([5]);
    });

    it("is refused by the max gas estimate's simulation with SupraGasUnitPriceBelowMinimumError and nothing is submitted", async () => {
        const supra = newClient();
        const sender = new SupraAccount();

        const error: unknown = await transfer(supra, sender, { gasUnitPrice: 1n }).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(SupraGasUnitPriceBelowMinimumError);
        expect((error as SupraGasUnitPriceBelowMinimumError).minimumGasUnitPrice).toBe(100_000n);
        expect(node.submitted).toStrictEqual([]);

        await transfer(supra, sender, { maxGas: 5_000n });
        expect(node.submitted).toStrictEqual([5]);
    });

    it("is refused for a client price below the minimum in the same way", async () => {
        const error: unknown = await transfer(newClient({ gasUnitPrice: 5n }), new SupraAccount(), {
            maxGas: 5_000n,
        }).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(SupraGasUnitPriceBelowMinimumError);
        expect((error as SupraGasUnitPriceBelowMinimumError).gasUnitPrice).toBe(5n);
    });

    it("is refused when a built transaction is simulated or submitted directly", async () => {
        const supra = new SupraClient({ rpcUrl: RPC_URL, chainId: 255 });
        const account = new SupraAccount();
        const rawTxn = supra.transaction.build.rawTxnObject({
            senderAddress: account.address(),
            senderSequenceNumber: 5n,
            function: "0x1::supra_account::transfer",
            functionTypeArgs: [],
            functionArgs: [new SupraAccount().address().toUint8Array(), BCS.bcsSerializeUint64(1n)],
            optionalTransactionPayloadArgs: { maxGas: 5_000n, gasUnitPrice: 2n },
        });

        await expect(rawTxn.simulate(account)).rejects.toBeInstanceOf(SupraGasUnitPriceBelowMinimumError);
        await expect(rawTxn.submitTransaction({ senderAccount: account })).rejects.toBeInstanceOf(
            SupraGasUnitPriceBelowMinimumError,
        );
    });
});

const SUPRA_ACCOUNT_ABI = {
    address: "0x1",
    name: "supra_account",
    friends: [],
    exposed_functions: [
        {
            name: "transfer",
            visibility: "public",
            is_entry: true,
            is_view: false,
            generic_type_params: [],
            params: ["&signer", "address", "u64"],
            return: [],
        },
    ],
    structs: [],
} as const;
