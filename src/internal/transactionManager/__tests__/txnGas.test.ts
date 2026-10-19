import { BCS, SupraAccount, TypeTagParser } from "supra-l1-sdk-core";
import { SupraClient } from "../../../api/supraClient";
import { SupraSimulationFailedError } from "../../../errors/transactionError";
import type { MoveModule } from "../../../types/move";
import { TransactionStatus } from "../../../types/transaction";
import type { OptionalTransactionPayloadArgs } from "../../../types/transactionManager/transactionBuild";
import type { SupraConfig } from "../../../types/supraClient";
import {
    DEFAULT_MAX_GAS_UNITS,
    MAX_GAS_UNITS_PER_TRANSACTION,
    MIN_ESTIMATED_MAX_GAS_UNITS,
} from "../../../utils/constants";

/**
 * Gas settings of the methods that build a transaction: per-call settings reach the submitted raw transaction, the
 * caller's options object is not modified, and a max gas that nobody sets is estimated or defaulted. `fetch` is
 * stubbed and answers like a node.
 */

const RPC_URL = "http://node.test";
const HASH = "0x" + "5e".repeat(32);
const PRICE = 100_000n;

const COIN_ABI = {
    address: "0x1",
    name: "coin",
    friends: [],
    exposed_functions: [
        {
            name: "transfer",
            visibility: "public",
            is_entry: true,
            is_view: false,
            generic_type_params: [{ constraints: [] }],
            params: ["&signer", "address", "u64"],
            return: [],
        },
        {
            name: "balance",
            visibility: "public",
            is_entry: false,
            is_view: true,
            generic_type_params: [{ constraints: [] }],
            params: ["address"],
            return: ["u64"],
        },
    ],
    structs: [],
} as const satisfies MoveModule;

type Answer = { status: number; body: unknown };

interface Node {
    /** SUPRA balance of every account, in quants, or an error answer. */
    balance: () => Answer;
    simulate: () => Answer;
}

interface RecordedRequest {
    method: string;
    path: string;
    body: unknown;
}

let node: Node;
let requests: RecordedRequest[];
const originalFetch = global.fetch;

function json(body: unknown, status = 200): Answer {
    return { status, body };
}

function moveTxn(status: TransactionStatus, vmStatus: string, gasUsed: number) {
    return {
        hash: HASH,
        status,
        txn_type: "user",
        output: { Move: { gas_used: gasUsed, events: [], vm_status: vmStatus } },
        block_header: null,
    };
}

function simulated(gasUsed: number): Answer {
    return json(moveTxn(TransactionStatus.Success, "Executed successfully", gasUsed));
}

function stubFetch(): void {
    global.fetch = jest.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        const path = url.pathname.replace(/^\/rpc\/v3/, "");
        const method = init?.method ?? "GET";
        const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
        requests.push({ method, path, body });

        let answer: Answer;
        if (method === "POST" && path === "/view") {
            answer = node.balance();
        } else if (method === "POST" && path === "/transactions/simulate") {
            answer = node.simulate();
        } else if (method === "POST" && path === "/transactions/submit") {
            answer = json(HASH);
        } else if (method === "GET" && path.startsWith("/transactions/")) {
            answer = json(moveTxn(TransactionStatus.Success, "Executed successfully", 7));
        } else if (method === "GET" && /^\/accounts\/0x[0-9a-f]+$/.test(path)) {
            answer = json({ sequence_number: 3, authentication_key: "0x" + "00".repeat(32) });
        } else if (method === "GET" && path === `/accounts/0x${"0".repeat(63)}1/modules/coin`) {
            answer = json({ bytecode: "0x", abi: COIN_ABI });
        } else {
            answer = json({ message: `unexpected ${method} ${path}` }, 500);
        }
        return Promise.resolve(
            new Response(JSON.stringify(answer.body), {
                status: answer.status,
                headers: { "Content-Type": "application/json" },
            }),
        );
    }) as typeof fetch;
}

interface RawTxnBody {
    Move: { raw_txn: { max_gas_amount: number; gas_unit_price: number; expiration_timestamp_secs: number } };
}

function rawTxnOf(path: string): RawTxnBody["Move"]["raw_txn"][] {
    return requests.filter((r) => r.path === path).map((r) => (r.body as RawTxnBody).Move.raw_txn);
}

function submitted(): RawTxnBody["Move"]["raw_txn"] {
    const all = rawTxnOf("/transactions/submit");
    expect(all).toHaveLength(1);
    return all[0]!;
}

function viewRequests(): RecordedRequest[] {
    return requests.filter((r) => r.path === "/view");
}

function newClient(config: Partial<SupraConfig> = {}): SupraClient {
    return new SupraClient({ ...config, rpcUrl: RPC_URL, chainId: 255 } as SupraConfig);
}

type Helper = (
    supra: SupraClient,
    optionalTransactionPayloadArgs: OptionalTransactionPayloadArgs | undefined,
) => Promise<unknown>;

const receiver = () => new SupraAccount().address().toString();

/** Every method that builds, signs and submits a transaction with a signing account. */
const HELPERS: Array<[string, Helper]> = [
    [
        "coin.transferSupraCoin",
        (supra, optionalTransactionPayloadArgs) =>
            supra.coin.transferSupraCoin({
                senderAccount: new SupraAccount(),
                receiverAccountAddress: receiver(),
                amount: 1n,
                optionalTransactionArgs:
                    optionalTransactionPayloadArgs === undefined ? {} : { optionalTransactionPayloadArgs },
            }),
    ],
    [
        "coin.transferCoin",
        (supra, optionalTransactionPayloadArgs) =>
            supra.coin.transferCoin({
                senderAccount: new SupraAccount(),
                receiverAccountAddress: receiver(),
                amount: 1n,
                coinType: "0x1::supra_coin::SupraCoin",
                optionalTransactionArgs:
                    optionalTransactionPayloadArgs === undefined ? {} : { optionalTransactionPayloadArgs },
            }),
    ],
    [
        "fungibleAsset.transferSupraFungibleAsset",
        (supra, optionalTransactionPayloadArgs) =>
            supra.fungibleAsset.transferSupraFungibleAsset({
                senderAccount: new SupraAccount(),
                receiverAccountAddress: receiver(),
                amount: 1n,
                optionalTransactionArgs:
                    optionalTransactionPayloadArgs === undefined ? {} : { optionalTransactionPayloadArgs },
            }),
    ],
    [
        "fungibleAsset.transferFungibleAsset",
        (supra, optionalTransactionPayloadArgs) =>
            supra.fungibleAsset.transferFungibleAsset({
                senderAccount: new SupraAccount(),
                receiverAccountAddress: receiver(),
                amount: 1n,
                assetAddress: "0x" + "0".repeat(63) + "a",
                optionalTransactionArgs:
                    optionalTransactionPayloadArgs === undefined ? {} : { optionalTransactionPayloadArgs },
            }),
    ],
    [
        "transaction.publishPackage",
        (supra, optionalTransactionPayloadArgs) =>
            supra.transaction.publishPackage({
                senderAccount: new SupraAccount(),
                packageMetadata: Uint8Array.from([1, 2, 3]),
                modulesCode: [Uint8Array.from([4, 5, 6])],
                optionalTransactionArgs:
                    optionalTransactionPayloadArgs === undefined ? {} : { optionalTransactionPayloadArgs },
            }),
    ],
    [
        "contract entry function from ABI",
        (supra, optionalTransactionPayloadArgs) =>
            supra.contract.fromABI([COIN_ABI] as const).contracts.coin.entry.transfer({
                functionArguments: [new SupraAccount(), receiver(), 1n],
                typeArguments: [new TypeTagParser("0x1::supra_coin::SupraCoin").parseTypeTag()],
                ...(optionalTransactionPayloadArgs === undefined ? {} : { optionalTransactionPayloadArgs }),
            }),
    ],
];

describe("gas settings", () => {
    beforeEach(() => {
        requests = [];
        node = {
            balance: () => json({ result: [String(1_000n * 100_000_000n)] }),
            simulate: () => simulated(2_000),
        };
        stubFetch();
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    describe.each(HELPERS)("%s", (_name, helper) => {
        it("submits the per-call maxGas, gasUnitPrice and txExpiryTime and does not modify the options", async () => {
            const options = { maxGas: 5_000n, gasUnitPrice: 123_456n, txExpiryTime: 4_000_000_000n };
            const before = { ...options };

            await helper(newClient({ maxGas: 9_999n, minGasUnitPrice: 200_000n }), options);

            expect(submitted()).toMatchObject({
                max_gas_amount: 5_000,
                gas_unit_price: 123_456,
                expiration_timestamp_secs: 4_000_000_000,
            });
            expect(options).toStrictEqual(before);
            expect(requests.filter((r) => r.path === "/transactions/simulate")).toHaveLength(0);
            expect(viewRequests()).toHaveLength(0);
        });

        it("submits the client's maxGas when the call sets none, without estimating", async () => {
            await helper(newClient({ maxGas: 9_999n }), { gasUnitPrice: PRICE });

            expect(submitted().max_gas_amount).toBe(9_999);
            expect(requests.filter((r) => r.path === "/transactions/simulate")).toHaveLength(0);
        });

        it("estimates the max gas: simulates with what the balance pays for, then submits ceil(gas used × 1.5)", async () => {
            const options = {};

            await helper(newClient(), options);

            expect(options).toStrictEqual({});
            const [simulation] = rawTxnOf("/transactions/simulate");
            // 1,000 SUPRA at 100,000 quants per gas unit.
            expect(simulation?.max_gas_amount).toBe(1_000_000);
            expect(simulation?.gas_unit_price).toBe(Number(PRICE));
            expect(submitted()).toMatchObject({ max_gas_amount: 3_000, gas_unit_price: Number(PRICE) });
        });

        it("uses the per-call gasUnitPrice for the balance limit of the estimate", async () => {
            await helper(newClient(), { gasUnitPrice: 400_000n });

            expect(rawTxnOf("/transactions/simulate")[0]?.max_gas_amount).toBe(250_000);
            expect(submitted()).toMatchObject({ max_gas_amount: 3_000, gas_unit_price: 400_000 });
        });

        it("raises a small estimate to MIN_ESTIMATED_MAX_GAS_UNITS", async () => {
            node.simulate = () => simulated(7);

            await helper(newClient(), undefined);

            expect(submitted().max_gas_amount).toBe(Number(MIN_ESTIMATED_MAX_GAS_UNITS));
        });

        it("limits the estimate to what the sender's balance pays for", async () => {
            node.balance = () => json({ result: ["5000000"] });
            node.simulate = () => simulated(7);

            await helper(newClient(), undefined);

            expect(rawTxnOf("/transactions/simulate")[0]?.max_gas_amount).toBe(50);
            expect(submitted().max_gas_amount).toBe(50);
        });

        it("limits the simulation to MAX_GAS_UNITS_PER_TRANSACTION", async () => {
            node.balance = () => json({ result: ["1" + "0".repeat(30)] });

            await helper(newClient(), undefined);

            expect(rawTxnOf("/transactions/simulate")[0]?.max_gas_amount).toBe(Number(MAX_GAS_UNITS_PER_TRANSACTION));
            expect(submitted().max_gas_amount).toBe(3_000);
        });

        it("applies the client's maxGasEstimateMultiplier", async () => {
            await helper(newClient({ maxGasEstimateMultiplier: 2 }), undefined);

            expect(submitted().max_gas_amount).toBe(4_000);
        });

        it("uses DEFAULT_MAX_GAS_UNITS without a request when the call turns the estimate off", async () => {
            await helper(newClient(), { estimateMaxGas: false });

            expect(submitted().max_gas_amount).toBe(Number(DEFAULT_MAX_GAS_UNITS));
            expect(viewRequests()).toHaveLength(0);
            expect(requests.filter((r) => r.path === "/transactions/simulate")).toHaveLength(0);
        });

        it("uses DEFAULT_MAX_GAS_UNITS without a request when the client turns the estimate off", async () => {
            await helper(newClient({ estimateMaxGas: false }), undefined);

            expect(submitted().max_gas_amount).toBe(Number(DEFAULT_MAX_GAS_UNITS));
            expect(viewRequests()).toHaveLength(0);
        });

        it("estimates when the call turns the estimate on and the client turns it off", async () => {
            await helper(newClient({ estimateMaxGas: false }), { estimateMaxGas: true });

            expect(submitted().max_gas_amount).toBe(3_000);
        });

        it("uses DEFAULT_MAX_GAS_UNITS when the simulation fails for a reason other than gas", async () => {
            node.simulate = () =>
                json(moveTxn(TransactionStatus.Fail, "Move abort in 0x1::coin: EINSUFFICIENT_BALANCE(0x10006): x", 12));

            await helper(newClient(), undefined);

            expect(submitted().max_gas_amount).toBe(Number(DEFAULT_MAX_GAS_UNITS));
        });

        it("limits DEFAULT_MAX_GAS_UNITS to what the balance pays for when the simulation fails", async () => {
            node.balance = () => json({ result: ["500000000"] });
            node.simulate = () => json({ message: "unavailable" }, 503);

            await helper(newClient(), undefined);

            expect(submitted().max_gas_amount).toBe(5_000);
        });

        it("uses DEFAULT_MAX_GAS_UNITS without simulating when the balance read fails", async () => {
            node.balance = () => json({ message: "unavailable" }, 503);

            await helper(newClient(), undefined);

            expect(submitted().max_gas_amount).toBe(Number(DEFAULT_MAX_GAS_UNITS));
            expect(requests.filter((r) => r.path === "/transactions/simulate")).toHaveLength(0);
        });

        it("uses DEFAULT_MAX_GAS_UNITS without simulating when the balance is zero", async () => {
            node.balance = () => json({ result: ["0"] });

            await helper(newClient(), undefined);

            expect(submitted().max_gas_amount).toBe(Number(DEFAULT_MAX_GAS_UNITS));
            expect(requests.filter((r) => r.path === "/transactions/simulate")).toHaveLength(0);
        });

        it("throws SupraSimulationFailedError and submits nothing when the simulation runs out of gas", async () => {
            node.simulate = () => json(moveTxn(TransactionStatus.Fail, "Out of gas", 1_000_000));

            await expect(helper(newClient(), undefined)).rejects.toBeInstanceOf(SupraSimulationFailedError);

            expect(requests.filter((r) => r.path === "/transactions/submit")).toHaveLength(0);
        });
    });

    it("reads the balance of the sender with 0x1::coin::balance<SupraCoin>", async () => {
        const sender = new SupraAccount();

        await newClient().coin.transferSupraCoin({
            senderAccount: sender,
            receiverAccountAddress: receiver(),
            amount: 1n,
        });

        expect(viewRequests().map((r) => r.body)).toStrictEqual([
            {
                function: "0x1::coin::balance",
                type_arguments: ["0x1::supra_coin::SupraCoin"],
                arguments: [sender.address().toString()],
            },
        ]);
    });

    describe("transaction.build.simple", () => {
        const build = (supra: SupraClient, optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs) =>
            supra.transaction.build.simple({
                senderAddress: new SupraAccount().address(),
                senderSequenceNumber: 0n,
                function: "0x1::coin::transfer",
                functionTypeArgs: ["0x1::supra_coin::SupraCoin"],
                functionArgs: [receiver(), 1n],
                abi: COIN_ABI,
                ...(optionalTransactionPayloadArgs === undefined ? {} : { optionalTransactionPayloadArgs }),
            });

        it("uses the per-call settings and does not modify them", async () => {
            const options = { maxGas: 5_000n, gasUnitPrice: 123_456n, txExpiryTime: 4_000_000_000n };
            const before = { ...options };

            const rawTxn = await build(newClient(), options);

            expect(rawTxn.max_gas_amount).toBe(5_000n);
            expect(rawTxn.gas_unit_price).toBe(123_456n);
            expect(rawTxn.expiration_timestamp_secs).toBe(4_000_000_000n);
            expect(options).toStrictEqual(before);
            expect(requests).toHaveLength(0);
        });

        it("uses DEFAULT_MAX_GAS_UNITS without simulating when the balance pays for it", async () => {
            const rawTxn = await build(newClient());

            expect(rawTxn.max_gas_amount).toBe(DEFAULT_MAX_GAS_UNITS);
            expect(viewRequests()).toHaveLength(1);
            expect(requests.filter((r) => r.path === "/transactions/simulate")).toHaveLength(0);
        });

        it("limits DEFAULT_MAX_GAS_UNITS to what the balance pays for", async () => {
            node.balance = () => json({ result: ["300000000"] });

            const rawTxn = await build(newClient());

            expect(rawTxn.max_gas_amount).toBe(3_000n);
        });

        it("makes no request when the estimate is turned off", async () => {
            const rawTxn = await build(newClient(), { estimateMaxGas: false });

            expect(rawTxn.max_gas_amount).toBe(DEFAULT_MAX_GAS_UNITS);
            expect(requests).toHaveLength(0);
        });
    });

    it("builders that make no request use DEFAULT_MAX_GAS_UNITS, or the client's maxGas", () => {
        const args = {
            senderAddress: new SupraAccount().address(),
            senderSequenceNumber: 0n,
            function: "0x1::supra_account::transfer" as const,
            functionTypeArgs: [],
            functionArgs: [new SupraAccount().address().toUint8Array(), BCS.bcsSerializeUint64(1n)],
        };

        expect(newClient().transaction.build.rawTxnObject(args).max_gas_amount).toBe(DEFAULT_MAX_GAS_UNITS);
        expect(newClient({ maxGas: 777n }).transaction.build.rawTxnObject(args).max_gas_amount).toBe(777n);
        expect(requests).toHaveLength(0);
    });

    it("the max gas of one client does not reach another", async () => {
        newClient({ maxGas: 777n });
        const rawTxn = await newClient().transaction.build.simple({
            senderAddress: new SupraAccount().address(),
            senderSequenceNumber: 0n,
            function: "0x1::coin::transfer",
            functionTypeArgs: ["0x1::supra_coin::SupraCoin"],
            functionArgs: [receiver(), 1n],
            abi: COIN_ABI,
            optionalTransactionPayloadArgs: { estimateMaxGas: false },
        });

        expect(rawTxn.max_gas_amount).toBe(DEFAULT_MAX_GAS_UNITS);
    });

    it("methods.view does not add the fetched ABI to the caller's arguments", async () => {
        node.balance = () => json({ result: ["12"] });
        const args = {
            function: "0x1::coin::balance" as const,
            typeArguments: ["0x1::supra_coin::SupraCoin"],
            functionArguments: [new SupraAccount().address().toString()],
        };
        const before = {
            ...args,
            typeArguments: [...args.typeArguments],
            functionArguments: [...args.functionArguments],
        };

        await newClient().methods.view(args);

        expect(args).toStrictEqual(before);
    });
});
