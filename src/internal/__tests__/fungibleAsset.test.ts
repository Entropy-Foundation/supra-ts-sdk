import { SupraAccount } from "supra-l1-sdk-core";
import { SupraClient } from "../../api/supraClient";
import { SupraInsufficientFungibleAssetBalanceError } from "../../errors/fungibleAssetError";
import type { MoveModule } from "../../types/move";
import { TransactionStatus } from "../../types/transaction";
import type { SupraConfig } from "../../types/supraClient";

/**
 * SUPRA balances in both forms, the fungible asset transfer's balance check, the migration payload and the coin count.
 * `fetch` is stubbed and answers like a node whose SUPRA account holds `coin` quants in a `CoinStore` and `fungibleAsset`
 * quants in the primary fungible store.
 */

const RPC_URL = "http://node.test";
const HASH = "0x" + "5e".repeat(32);
const SUPRA_FA = "0x" + "0".repeat(63) + "a";

const COIN_ABI = {
    address: "0x1",
    name: "coin",
    friends: [],
    exposed_functions: [
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

const PFS_ABI = {
    address: "0x1",
    name: "primary_fungible_store",
    friends: [],
    exposed_functions: [
        {
            name: "balance",
            visibility: "public",
            is_entry: false,
            is_view: true,
            generic_type_params: [{ constraints: ["key"] }],
            params: ["address", "0x1::object::Object<T0>"],
            return: ["u64"],
        },
        {
            name: "primary_store_exists",
            visibility: "public",
            is_entry: false,
            is_view: true,
            generic_type_params: [{ constraints: ["key"] }],
            params: ["address", "0x1::object::Object<T0>"],
            return: ["bool"],
        },
    ],
    structs: [],
} as const satisfies MoveModule;

interface RecordedRequest {
    method: string;
    path: string;
    body: unknown;
}

interface ChainState {
    /** Balance of the `CoinStore`, in quants. */
    coin: bigint;
    /** Balance of the primary fungible store, in quants. */
    fungibleAsset: bigint;
    /** Whether the primary fungible store exists. */
    storeExists: boolean;
    /** Resources the account owns, as the resources endpoint lists them. */
    resources: Array<{ type: string; data: unknown }>;
}

let chain: ChainState;
let requests: RecordedRequest[];
const originalFetch = global.fetch;

function moveTxn(status: TransactionStatus) {
    return {
        hash: HASH,
        status,
        txn_type: "user",
        output: { Move: { gas_used: 7, events: [], vm_status: "Executed successfully" } },
        block_header: null,
    };
}

function answer(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function stubFetch(): void {
    global.fetch = jest.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        const path = url.pathname.replace(/^\/rpc\/v3/, "");
        const method = init?.method ?? "GET";
        const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
        requests.push({ method, path, body });

        let response: Response;
        if (method === "POST" && path === "/view") {
            const fn = (body as { function: string }).function;
            if (fn === "0x1::coin::balance") {
                response = answer({ result: [String(chain.coin + chain.fungibleAsset)] });
            } else if (fn === "0x1::primary_fungible_store::balance") {
                response = answer({ result: [String(chain.fungibleAsset)] });
            } else if (fn === "0x1::primary_fungible_store::primary_store_exists") {
                response = answer({ result: [chain.storeExists] });
            } else {
                response = answer({ message: `unexpected view ${fn}` }, 500);
            }
        } else if (method === "POST" && path === "/transactions/simulate") {
            response = answer(moveTxn(TransactionStatus.Success));
        } else if (method === "POST" && path === "/transactions/submit") {
            response = answer(HASH);
        } else if (method === "GET" && path === "/transactions/chain_id") {
            response = answer(255);
        } else if (method === "GET" && path.startsWith("/transactions/")) {
            response = answer(moveTxn(TransactionStatus.Success));
        } else if (method === "GET" && /^\/accounts\/0x[0-9a-f]+$/.test(path)) {
            response = answer({ sequence_number: 3, authentication_key: "0x" + "00".repeat(32) });
        } else if (method === "GET" && /^\/accounts\/0x[0-9a-f]+\/resources$/.test(path)) {
            response = answer(chain.resources);
        } else if (method === "GET" && path === `/accounts/0x${"0".repeat(63)}1/modules/coin`) {
            response = answer({ bytecode: "0x", abi: COIN_ABI });
        } else if (method === "GET" && path === `/accounts/0x${"0".repeat(63)}1/modules/primary_fungible_store`) {
            response = answer({ bytecode: "0x", abi: PFS_ABI });
        } else {
            response = answer({ message: `unexpected ${method} ${path}` }, 500);
        }
        return Promise.resolve(response);
    }) as typeof fetch;
}

function newClient(): SupraClient {
    return new SupraClient({ rpcUrl: RPC_URL, chainId: 255 } as SupraConfig);
}

function submitRequests(): RecordedRequest[] {
    return requests.filter((r) => r.path === "/transactions/submit" || r.path === "/transactions/simulate");
}

interface PayloadBody {
    Move: {
        raw_txn: {
            payload: {
                EntryFunction: { module: { address: string; name: string }; function: string; ty_args: unknown[]; args: unknown[] };
            };
        };
    };
}

function submittedEntryFunction() {
    const submits = requests.filter((r) => r.path === "/transactions/submit");
    expect(submits).toHaveLength(1);
    return (submits[0]!.body as PayloadBody).Move.raw_txn.payload.EntryFunction;
}

const QUANTS = 100_000_000n;

describe("SUPRA balances and fungible asset transfers", () => {
    beforeEach(() => {
        requests = [];
        chain = { coin: 0n, fungibleAsset: 0n, storeExists: false, resources: [] };
        stubFetch();
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    describe("getAccountSupraBalance", () => {
        it("reports the total once and splits it into coin and fungible asset", async () => {
            chain.coin = 7n * QUANTS;
            chain.fungibleAsset = 3n * QUANTS;

            await expect(
                newClient().account.getAccountSupraBalance({ accountAddress: new SupraAccount().address().toString() }),
            ).resolves.toEqual({ total: 10n * QUANTS, coin: 7n * QUANTS, fungibleAsset: 3n * QUANTS });
        });

        it("reports only the coin part for an account without a fungible asset store", async () => {
            chain.coin = 5n;

            await expect(
                newClient().account.getAccountSupraBalance({ accountAddress: new SupraAccount().address().toString() }),
            ).resolves.toEqual({ total: 5n, coin: 5n, fungibleAsset: 0n });
        });

        it("equals getAccountSupraCoinBalance in total and the fungible asset balance read through 0xa", async () => {
            chain.coin = 7n;
            chain.fungibleAsset = 3n;
            const supra = newClient();
            const accountAddress = new SupraAccount().address().toString();

            const balance = await supra.account.getAccountSupraBalance({ accountAddress });

            expect(await supra.account.getAccountSupraCoinBalance({ accountAddress })).toBe(balance.total);
            expect(await supra.account.getAccountCoinBalance({ accountAddress, asset: "0xa" })).toBe(
                balance.fungibleAsset,
            );
        });
    });

    describe("transferSupraFungibleAsset", () => {
        it("refuses before any simulate or submit request when the fungible asset balance is short", async () => {
            chain.coin = 9n;
            chain.fungibleAsset = 2n;
            const sender = new SupraAccount();

            const failure = await newClient()
                .fungibleAsset.transferSupraFungibleAsset({
                    senderAccount: sender,
                    receiverAccountAddress: new SupraAccount().address().toString(),
                    amount: 3n,
                })
                .catch((error: unknown) => error);

            expect(failure).toBeInstanceOf(SupraInsufficientFungibleAssetBalanceError);
            const error = failure as SupraInsufficientFungibleAssetBalanceError;
            expect(error.fungibleAssetBalance).toBe(2n);
            expect(error.coinBalance).toBe(9n);
            expect(error.amount).toBe(3n);
            expect(error.assetAddress).toBe(SUPRA_FA);
            expect(error.senderAddress).toBe(sender.address().toString());
            expect(error.message).toContain("migrateCoinToFungibleStore");
            expect(error.message).toContain("2");
            expect(error.message).toContain("9");
            expect(submitRequests()).toEqual([]);
        });

        it("refuses an account that holds SUPRA as a coin only", async () => {
            chain.coin = 100n;

            await expect(
                newClient().fungibleAsset.transferSupraFungibleAsset({
                    senderAccount: new SupraAccount(),
                    receiverAccountAddress: new SupraAccount().address().toString(),
                    amount: 1,
                }),
            ).rejects.toMatchObject({ fungibleAssetBalance: 0n, coinBalance: 100n });
            expect(submitRequests()).toEqual([]);
        });

        it("serialises the balances of the error as strings", async () => {
            chain.coin = 9n;

            const failure = await newClient()
                .fungibleAsset.transferSupraFungibleAsset({
                    senderAccount: new SupraAccount(),
                    receiverAccountAddress: new SupraAccount().address().toString(),
                    amount: 3n,
                })
                .catch((error: unknown) => error as SupraInsufficientFungibleAssetBalanceError);

            expect(JSON.parse(JSON.stringify(failure))).toMatchObject({
                name: "SupraInsufficientFungibleAssetBalanceError",
                amount: "3",
                fungibleAssetBalance: "0",
                coinBalance: "9",
            });
        });

        it("submits when the fungible asset balance covers the amount", async () => {
            chain.fungibleAsset = 3n;

            await newClient().fungibleAsset.transferSupraFungibleAsset({
                senderAccount: new SupraAccount(),
                receiverAccountAddress: new SupraAccount().address().toString(),
                amount: 3n,
                optionalTransactionArgs: { optionalTransactionPayloadArgs: { maxGas: 5_000n, gasUnitPrice: 123_456n } },
            });

            expect(submittedEntryFunction()).toMatchObject({
                module: { name: "primary_fungible_store" },
                function: "transfer",
            });
            const submit = requests.find((r) => r.path === "/transactions/submit")!;
            expect((submit.body as { Move: { raw_txn: unknown } }).Move.raw_txn).toMatchObject({
                max_gas_amount: 5_000,
                gas_unit_price: 123_456,
            });
        });
    });

    describe("transferFungibleAsset", () => {
        it.each(["0xa", "0xA", "0x" + "0".repeat(63) + "A"])(
            "applies the balance check to the SUPRA fungible asset address in any spelling: %s",
            async (assetAddress) => {
                chain.coin = 9n;

                await expect(
                    newClient().fungibleAsset.transferFungibleAsset({
                        senderAccount: new SupraAccount(),
                        receiverAccountAddress: new SupraAccount().address().toString(),
                        amount: 1n,
                        assetAddress,
                    }),
                ).rejects.toBeInstanceOf(SupraInsufficientFungibleAssetBalanceError);
                expect(submitRequests()).toEqual([]);
            },
        );

        it("does not read balances for another fungible asset", async () => {
            await newClient().fungibleAsset.transferFungibleAsset({
                senderAccount: new SupraAccount(),
                receiverAccountAddress: new SupraAccount().address().toString(),
                amount: 1n,
                assetAddress: "0x" + "0".repeat(63) + "b",
                optionalTransactionArgs: { optionalTransactionPayloadArgs: { maxGas: 5_000n } },
            });

            expect(requests.filter((r) => r.path === "/view")).toEqual([]);
            expect(submittedEntryFunction().function).toBe("transfer");
        });
    });

    describe("migrateCoinToFungibleStore", () => {
        it("submits 0x1::coin::migrate_to_fungible_store for SUPRA by default", async () => {
            const response = await newClient().fungibleAsset.migrateCoinToFungibleStore({
                senderAccount: new SupraAccount(),
                optionalTransactionArgs: { optionalTransactionPayloadArgs: { maxGas: 5_000n } },
            });

            expect(response.hash).toBe(HASH);
            const call = submittedEntryFunction();
            expect(call.module).toMatchObject({ name: "coin" });
            expect(call.function).toBe("migrate_to_fungible_store");
            expect(call.args).toEqual([]);
            expect(JSON.stringify(call.ty_args)).toContain("SupraCoin");
        });

        it("submits the given coin type", async () => {
            await newClient().fungibleAsset.migrateCoinToFungibleStore({
                senderAccount: new SupraAccount(),
                coinType: "0x2::custom::Token",
                optionalTransactionArgs: { optionalTransactionPayloadArgs: { maxGas: 5_000n } },
            });

            expect(JSON.stringify(submittedEntryFunction().ty_args)).toContain("Token");
        });

        it("rejects a coin type that is not a struct id before any request", async () => {
            await expect(
                newClient().fungibleAsset.migrateCoinToFungibleStore({
                    senderAccount: new SupraAccount(),
                    coinType: "SupraCoin" as `${string}::${string}::${string}`,
                }),
            ).rejects.toThrow();
            expect(requests).toEqual([]);
        });
    });

    describe("getAccountCoinsCount", () => {
        const coinStore = (coin: string) => ({
            type: `0x1::coin::CoinStore<${coin}>`,
            data: { coin: { value: "1" } },
        });
        const count = () =>
            newClient().account.getAccountCoinsCount({ accountAddress: new SupraAccount().address().toString() });

        it("counts the coin stores of an account", async () => {
            chain.resources = [coinStore("0x1::supra_coin::SupraCoin"), coinStore("0x2::custom::Token")];
            chain.storeExists = true;

            await expect(count()).resolves.toBe(2);
        });

        it("counts SUPRA held as a fungible asset only", async () => {
            chain.resources = [{ type: "0x1::account::Account", data: {} }];
            chain.storeExists = true;

            await expect(count()).resolves.toBe(1);
        });

        it("counts SUPRA once when the account has a coin store and a fungible asset store", async () => {
            chain.resources = [coinStore("0x1::supra_coin::SupraCoin")];
            chain.storeExists = true;

            await expect(count()).resolves.toBe(1);
        });

        it("is 0 for an account without any coin", async () => {
            chain.resources = [{ type: "0x1::account::Account", data: {} }];

            await expect(count()).resolves.toBe(0);
        });
    });
});
