import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SupraAPIError } from "../../errors/apiError";
import type { NetworkConfig } from "../../utils/apiEndpoints";
import {
    getAccountAutoTransactionsInternal,
    getAccountCoinTransactionsInternal,
    getAccountFaTransactionsInternal,
    getAccountHistoryInternal,
    getAccountTransactionsInternal,
} from "../account";
import { getBlockByHashInternal, getBlockByHeightInternal, getLatestBlockInternal } from "../block";
import { getNativeSupplyInternal } from "../fungibleAsset";
import {
    getSettlementInternal,
    getSettlementsInternal,
    getTransactionByHashInternal,
    getTransactionsByHashesInternal,
} from "../transaction";

/**
 * Runs each reader of a response with an exact u64 field against the response text, as the node sends it (the number
 * form) and as a later node release sends it (the decimal string form), including values above 2^53.
 *
 * The native supply, the block header and the settlement stages are responses of the `supra_node_v12.0.0.rc7`
 * localnet (`src/__tests__/fixtures/v4Routes.json` and the block below). The localnet had applied no settlement
 * transaction with a non-zero `burn_amount`, so the settlement transaction is built from the node's OpenAPI schema
 * (`SettlementTransactionInfoV3/V4` with `SettlementApplierSummary`).
 */

const config: NetworkConfig = { name: "devnet", chainId: 255, rpcUrl: "http://localhost:27001" };

const routes = JSON.parse(
    readFileSync(join(__dirname, "..", "..", "__tests__", "fixtures", "v4Routes.json"), "utf8"),
) as {
    nativeSupply: object;
    settlementsPending: { data: Array<Record<string, unknown>> };
    settlementsSettled: { data: Array<Record<string, unknown>> };
};

/** `GET /rpc/v3/block` on the rc7 localnet at height 30014. */
const rc7Block = {
    header: {
        author: "0xe19873f39a183d8ad15dd20b1bc4a0922cbd35f9fa8a962965608ab7ecf44780",
        hash: "0x6e036822c78b7c8c8045f9154d277c330c644a1f0f7bae1ad7bc855d235c128b",
        height: 30014,
        parent: "0x5fbc34d808703ef2c68a99de605a118461e4b799e765d42737c66f0fdd5a5e7f",
        timestamp: {
            microseconds_since_unix_epoch: 1793697748556923,
            utc_date_time: "2026-11-03T09:22:28.556923+00:00",
        },
        view: { epoch_id: { chain_id: 255, epoch: 230 }, round: 4 },
    },
    execution_statistics: {
        automated_txn_gas_unit_price: 100000,
        block_total_automated_gas_used: 0,
        block_total_evm_block_metadata_gas_used: 7298,
        evm_base_fee_per_gas: 333333300000,
    },
};

const HASH = `0x${"11".repeat(32)}`;

/** The value of a u64 field under test, which {@link render} replaces. */
const FIELD = "@@u64@@";

const moveEventData = { burn_amount: 11, amount: 12, evm_base_fee_per_gas: 13 };

function settlementTransaction(): object {
    return {
        txn_type: "settlement",
        hash: HASH,
        data: {
            vm: "move",
            inbound: [],
            cleared: [],
            burn_block_height: 3986,
            burn_amount: FIELD,
        },
        block_header: null,
        output: {
            Move: {
                gas_used: 0,
                events: [{ type: "0x1::m::Burned", data: moveEventData }],
                vm_status: "Executed successfully",
            },
        },
        status: "Success",
    };
}

interface Form {
    name: string;
    literal: string;
    quoted: boolean;
    expected: bigint;
}

const FORMS: Form[] = [
    { name: "number", literal: "12345", quoted: false, expected: 12345n },
    { name: "decimal string", literal: "12345", quoted: true, expected: 12345n },
    { name: "number above 2^53", literal: "9007199254740993", quoted: false, expected: 9007199254740993n },
    { name: "decimal string above 2^53", literal: "9007199254740993", quoted: true, expected: 9007199254740993n },
    {
        name: "largest u64 as a number",
        literal: "18446744073709551615",
        quoted: false,
        expected: 18446744073709551615n,
    },
    { name: "largest u64 as a string", literal: "18446744073709551615", quoted: true, expected: 18446744073709551615n },
];

/** The text of `value`, with each {@link FIELD} written as `form` says. */
function render(value: unknown, form: Form): string {
    return JSON.stringify(value).replaceAll(`"${FIELD}"`, form.quoted ? `"${form.literal}"` : form.literal);
}

let requested: string[];

function respond(text: string, headers: Record<string, string> = {}): void {
    global.fetch = jest.fn(async (url: string | URL | Request) => {
        requested.push(String(url));
        return new Response(text, { status: 200, headers });
    }) as unknown as typeof fetch;
}

const originalFetch = global.fetch;

beforeEach(() => {
    requested = [];
});

afterAll(() => {
    global.fetch = originalFetch;
});

describe.each(FORMS)("a u64 field sent as a $name", (form) => {
    it("getNativeSupply returns bigint quants and null for an unreadable escrow", async () => {
        const supply = { ...routes.nativeSupply, burn_owed_quants: FIELD, escrow_settled_quants: FIELD };
        respond(render({ ...supply, escrow_balance_quants: FIELD }, form));
        const read = await getNativeSupplyInternal(config);
        expect(requested[0]).toBe("http://localhost:27001/rpc/v4/supply/native");
        expect(read.burn_owed_quants).toBe(form.expected);
        expect(read.escrow_settled_quants).toBe(form.expected);
        expect(read.escrow_balance_quants).toBe(form.expected);
        expect(read.as_of_height).toEqual(expect.any(Number));

        respond(render({ ...supply, escrow_balance_quants: null, escrow_shortfall_wei: null }, form));
        const unreadable = await getNativeSupplyInternal(config);
        expect(unreadable.escrow_balance_quants).toBeNull();
        expect(unreadable.burn_owed_quants).toBe(form.expected);
    });

    it("getSettlement returns bigint for the pending amount and every stage", async () => {
        const [pendingItem] = routes.settlementsPending.data;
        const [settledItem] = routes.settlementsSettled.data;
        const withAmounts = (item: Record<string, unknown>) => ({
            ...item,
            pending: item["pending"] === null ? null : { ...(item["pending"] as object), amount: FIELD },
            stages: (item["stages"] as object[]).map((stage) => ({ ...stage, amount: FIELD })),
        });

        respond(render(withAmounts(pendingItem!), form));
        const pending = await getSettlementInternal({ settlementId: "0xaa" }, config);
        expect(pending.pending?.amount).toBe(form.expected);
        expect(pending.stages.map((stage) => stage.amount)).toEqual([form.expected]);
        expect(pending.as_of_height).toEqual(expect.any(Number));
        expect(pending.pending?.recorded_at_height).toEqual(expect.any(Number));

        respond(render(withAmounts(settledItem!), form));
        const settled = await getSettlementInternal({ settlementId: "0xaa" }, config);
        expect(settled.pending).toBeNull();
        expect(settled.stages.map((stage) => stage.amount)).toEqual([form.expected, form.expected, form.expected]);
    });

    it("getSettlements returns bigint for every item of the page", async () => {
        const items = [...routes.settlementsPending.data, ...routes.settlementsSettled.data].map((item) => ({
            ...item,
            pending: item["pending"] === null ? null : { ...(item["pending"] as object), amount: FIELD },
            stages: (item["stages"] as object[]).map((stage) => ({ ...stage, amount: FIELD })),
        }));
        respond(render({ data: items }, form), { "x-supra-cursor": "abc" });
        const page = await getSettlementsInternal({ address: "0x1", domain: "move" }, config);
        expect(page.cursor).toBe("abc");
        expect(page.response).toHaveLength(2);
        expect(page.response[0]?.pending?.amount).toBe(form.expected);
        for (const item of page.response) {
            for (const stage of item.stages) {
                expect(stage.amount).toBe(form.expected);
            }
        }
    });

    it("getTransactionByHash returns a bigint burn_amount and leaves the Move event data alone", async () => {
        respond(render(settlementTransaction(), form));
        const txn = await getTransactionByHashInternal({ transactionHash: HASH }, config);
        expect(requested[0]).toContain("/rpc/v3/transactions/");
        if (txn.txn_type !== "settlement" || txn.data.vm !== "move") {
            throw new Error("expected a Move settlement");
        }
        expect(txn.data.burn_amount).toBe(form.expected);
        expect(txn.data.burn_block_height).toBe(3986);
        const output = txn.output as { Move: { events: Array<{ data: unknown }> } };
        expect(output.Move.events[0]?.data).toEqual(moveEventData);
    });

    it("getTransactionsByHashes returns a bigint burn_amount for every transaction found", async () => {
        const body = {
            transactions: [
                { hash: HASH, transaction: settlementTransaction() },
                { hash: `0x${"22".repeat(32)}`, transaction: null },
            ],
        };
        respond(render(body, form));
        const response = await getTransactionsByHashesInternal({ transactionHashes: [HASH] }, config);
        const found = response.transactions[0]?.transaction;
        if (found?.txn_type !== "settlement" || found.data.vm !== "move") {
            throw new Error("expected a Move settlement");
        }
        expect(found.data.burn_amount).toBe(form.expected);
        expect(response.transactions[1]?.transaction).toBeNull();
    });

    it.each([
        ["getAccountTransactions", getAccountTransactionsInternal as FeedReader],
        ["getAccountCoinTransactions", getAccountCoinTransactionsInternal as FeedReader],
        [
            "getAccountFaTransactions",
            ((args, c) => getAccountFaTransactionsInternal({ storeAddress: args.accountAddress }, c)) as FeedReader,
        ],
        ["getAccountAutomatedTransactions", getAccountAutoTransactionsInternal as FeedReader],
    ])("%s returns a bigint burn_amount for every item", async (_name, read) => {
        respond(render([settlementTransaction(), settlementTransaction()], form));
        const page = await read({ accountAddress: "0x1" }, config);
        expect(page.response).toHaveLength(2);
        for (const txn of page.response) {
            expect((txn as { data: { burn_amount: unknown } }).data.burn_amount).toBe(form.expected);
        }
    });

    it("getAccountHistory returns a bigint burn_amount for every entry", async () => {
        respond(render([{ categories: ["sent"], transaction: settlementTransaction() }], form));
        const page = await getAccountHistoryInternal({ accountAddress: "0x1" }, config);
        const txn = page.response[0]?.transaction;
        if (txn?.txn_type !== "settlement" || txn.data.vm !== "move") {
            throw new Error("expected a Move settlement");
        }
        expect(txn.data.burn_amount).toBe(form.expected);
    });

    it("the block readers return a bigint evm_base_fee_per_gas, and null stays null", async () => {
        const block = {
            ...rc7Block,
            execution_statistics: {
                ...rc7Block.execution_statistics,
                evm_base_fee_per_gas: FIELD,
                evm_automated_txn_gas_unit_price: FIELD,
            },
        };
        respond(render(block, form));
        const latest = await getLatestBlockInternal(config);
        expect(latest.execution_statistics?.evm_base_fee_per_gas).toBe(form.expected);
        expect(latest.execution_statistics?.evm_automated_txn_gas_unit_price).toBe(form.expected);
        expect(latest.execution_statistics?.block_total_evm_block_metadata_gas_used).toBe(7298);
        expect(latest.header.height).toBe(30014);

        respond(render(block, form));
        expect(
            (await getBlockByHashInternal({ blockHash: rc7Block.header.hash }, config)).execution_statistics,
        ).toMatchObject({
            evm_base_fee_per_gas: form.expected,
            evm_automated_txn_gas_unit_price: form.expected,
        });

        const withTransactions = { ...block, transactions: [settlementTransaction()] };
        respond(render(withTransactions, form));
        const byHeight = await getBlockByHeightInternal(
            { height: 30014, options: { withFinalizedTransactions: true } },
            config,
        );
        expect(byHeight.execution_statistics?.evm_base_fee_per_gas).toBe(form.expected);
        expect(byHeight.execution_statistics?.evm_automated_txn_gas_unit_price).toBe(form.expected);
        const txn = byHeight.transactions?.[0];
        if (txn?.txn_type !== "settlement" || txn.data.vm !== "move") {
            throw new Error("expected a Move settlement");
        }
        expect(txn.data.burn_amount).toBe(form.expected);

        respond(
            JSON.stringify({
                ...rc7Block,
                execution_statistics: { evm_base_fee_per_gas: null, evm_automated_txn_gas_unit_price: null },
            }),
        );
        const nulls = (await getLatestBlockInternal(config)).execution_statistics;
        expect(nulls?.evm_base_fee_per_gas).toBeNull();
        expect(nulls?.evm_automated_txn_gas_unit_price).toBeNull();
        respond(JSON.stringify({ ...rc7Block, execution_statistics: {} }));
        const absent = (await getLatestBlockInternal(config)).execution_statistics;
        expect(absent?.evm_base_fee_per_gas).toBeUndefined();
        expect(absent?.evm_automated_txn_gas_unit_price).toBeUndefined();
    });
});

/** The largest `u128`, which the node renders for `evm_automated_txn_gas_unit_price`. */
const LARGEST_U128 = "340282366920938463463374607431768211455";

describe("evm_automated_txn_gas_unit_price, a u128", () => {
    it.each([
        ["a decimal string above 2^64", `"${LARGEST_U128}"`, 340282366920938463463374607431768211455n],
        ["a number above 2^64", LARGEST_U128, 340282366920938463463374607431768211455n],
        ["a decimal string above 2^64 and below the largest", `"18446744073709551616"`, 18446744073709551616n],
        ["a number above 2^53", "9007199254740993", 9007199254740993n],
    ])("is read exactly from %s by every block reader", async (_name, literal, expected) => {
        const text = JSON.stringify({
            ...rc7Block,
            execution_statistics: { evm_automated_txn_gas_unit_price: FIELD },
        }).replace(`"${FIELD}"`, literal);

        respond(text);
        expect((await getLatestBlockInternal(config)).execution_statistics?.evm_automated_txn_gas_unit_price).toBe(
            expected,
        );
        respond(text);
        expect(
            (await getBlockByHashInternal({ blockHash: rc7Block.header.hash }, config)).execution_statistics
                ?.evm_automated_txn_gas_unit_price,
        ).toBe(expected);
        respond(text);
        expect(
            (await getBlockByHeightInternal({ height: 30014 }, config)).execution_statistics
                ?.evm_automated_txn_gas_unit_price,
        ).toBe(expected);
    });
});

type FeedReader = (args: { accountAddress: string }, config: NetworkConfig) => Promise<{ response: unknown[] }>;

describe("a value at a u64 path that is not an unsigned decimal integer", () => {
    it.each(['"abc"', "1.5", "-1", "true", "{}", '"0x10"'])("is reported as a SupraAPIError: %s", async (literal) => {
        respond(
            JSON.stringify({ ...routes.nativeSupply, burn_owed_quants: FIELD, escrow_settled_quants: 1 }).replace(
                `"${FIELD}"`,
                literal,
            ),
        );
        const failure = await getNativeSupplyInternal(config).catch((e: unknown) => e);
        expect(failure).toBeInstanceOf(SupraAPIError);
        expect(failure).toMatchObject({ status: 200 });
        expect((failure as Error).message).toContain("burn_owed_quants");
    });
});

describe("a node that does not send the fields", () => {
    it("returns a v11 style transaction and block unchanged", async () => {
        const user = {
            txn_type: "user",
            hash: HASH,
            header: { sequence_number: 5, gas_unit_price: 100 },
            output: { Move: { gas_used: 9, events: [{ type: "0x1::m::E", data: moveEventData }] } },
            status: "Success",
        };
        respond(JSON.stringify(user));
        expect(await getTransactionByHashInternal({ transactionHash: HASH }, config)).toEqual(user);

        respond(JSON.stringify({ ...rc7Block, execution_statistics: { user_txn_count: 1 } }));
        expect((await getLatestBlockInternal(config)).execution_statistics).toEqual({ user_txn_count: 1 });
    });
});
