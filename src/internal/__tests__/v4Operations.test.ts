import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FungibleAsset } from "../../api/fungibleAsset";
import { Methods } from "../../api/methods";
import { Transaction } from "../../api/transaction";
import { Simulate } from "../../api/transactionManager/txnSimulate";
import { SupraAPIError, SupraGoneError, SupraNotFoundError, SupraRouteUnsupportedError } from "../../errors/apiError";
import { HexString } from "supra-l1-sdk-core";
import { SupraGasUnitPriceBelowMinimumError, SupraSimulationFailedError } from "../../errors/transactionError";
import type { ViewBatchResponse } from "../../types/methods";
import type { MoveModuleBytecode } from "../../types/move";
import type { NativeSupply } from "../../types/fungibleAsset";
import {
    TransactionStatus,
    type SettlementsPage,
    type TransactionSimulationV4,
    type TransactionsByHashesResponse,
} from "../../types/transaction";
import type { SendTxnPayload } from "../../types/transactionManager/transactionBuild";
import type { NetworkConfig } from "../../utils/apiEndpoints";

jest.mock("../../client/get", () => ({
    get: jest.fn(),
}));

jest.mock("../../client/post", () => ({
    post: jest.fn(),
}));

import { get } from "../../client/get";
import { post } from "../../client/post";
const mockGet = get as jest.MockedFunction<typeof get>;
const mockPost = post as jest.MockedFunction<typeof post>;

/** Responses of the v12 localnet (`supra_node_v12.0.0.rc7`) and one of a v11 node; see the fixture's `_source`. */
const fixtures = JSON.parse(
    readFileSync(join(__dirname, "..", "..", "__tests__", "fixtures", "v4Routes.json"), "utf8"),
) as {
    viewBatch: { state_height: number; results: unknown[] };
    viewBatchAbis: { timestamp: object; chain_id: object; coin: object };
    byHashes: TransactionsByHashesResponse;
    simulate: TransactionSimulationV4 & { changes: unknown[]; prior_values: Record<string, unknown> };
    simulateOmittedFields: { omitted: unknown[]; omitted_counts: object; changes_truncated: boolean };
    v11SimulateAsV3: Record<string, unknown>;
    nativeSupply: NativeSupply;
    nativeSupplyInFlight: NativeSupply;
    settlementsPending: { data: unknown[] };
    settlementsSettled: { data: Array<{ settlement_id: string; stages: unknown[] }> };
    settlementsSettledCursor: string;
    settlementsEmpty: { data: unknown[] };
    settlementUnknown: { message: string };
};

const config: NetworkConfig = { name: "devnet", chainId: 255, rpcUrl: "http://localhost:27001" };

const methods = new Methods(config);
const transaction = new Transaction(config);
const simulate = new Simulate(config);
const fungibleAsset = new FungibleAsset(config);

const HASH_A = fixtures.byHashes.transactions[0]!.hash;
const HASH_B = "0xabababababababababababababababababababababababababababababababab";
const SETTLEMENT_ID = fixtures.settlementsSettled.data[0]!.settlement_id;

function notFound(data?: unknown) {
    return new SupraNotFoundError({
        status: 404,
        statusText: "Not Found",
        url: "http://localhost:37001/rpc/v4/x",
        data,
    });
}

/**
 * What the v11.7.2 localnet answers for a route it does not serve: HTTP 404 with an empty body, except the
 * settlements list route, which answers 404 `text/plain` "Path deserialize error: ..." because the path matches
 * `/transactions/{hash}`.
 */
const v11NotFound = () => notFound(undefined);

beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
});

describe("viewBatch", () => {
    const requests = [
        { function: "0x1::timestamp::now_microseconds" as const },
        { function: "0x1::chain_id::get" as const },
        {
            function: "0x1::coin::balance" as const,
            typeArguments: ["0x1::supra_coin::SupraCoin"],
            functionArguments: ["0x1"],
        },
        {
            function: "0x1::coin::balance" as const,
            typeArguments: ["0x1::supra_coin::SupraCoin"],
            functionArguments: ["0x2"],
        },
    ];

    function mockAbis() {
        mockGet.mockImplementation(async ({ path }) => {
            const name = path.split("/").pop() as keyof typeof fixtures.viewBatchAbis;
            return { data: { bytecode: "0x", abi: fixtures.viewBatchAbis[name] } as MoveModuleBytecode };
        });
    }

    it("posts the encoded elements to /view/batch at v4 and converts each result by its ABI", async () => {
        mockAbis();
        mockPost.mockResolvedValue({
            state_height: 9639,
            results: [
                { result: ["1793687630199250"] },
                { result: [255] },
                { result: ["0"] },
                fixtures.viewBatch.results[3],
            ],
        });

        const response: ViewBatchResponse = await methods.viewBatch({ requests });

        expect(mockPost).toHaveBeenCalledTimes(1);
        const [request, , version] = mockPost.mock.calls[0]!;
        expect(request.path).toBe("/view/batch");
        expect(version).toBe("v4");
        expect(request.data).toEqual({
            requests: [
                { function: "0x1::timestamp::now_microseconds", type_arguments: [], arguments: [] },
                { function: "0x1::chain_id::get", type_arguments: [], arguments: [] },
                { function: "0x1::coin::balance", type_arguments: ["0x1::supra_coin::SupraCoin"], arguments: ["0x1"] },
                { function: "0x1::coin::balance", type_arguments: ["0x1::supra_coin::SupraCoin"], arguments: ["0x2"] },
            ],
        });
        expect(response.state_height).toBe(9639);
        expect(response.results[0]).toEqual({ result: [1793687630199250n] });
        expect(response.results[1]).toEqual({ result: [255] });
        expect(response.results[2]).toEqual({ result: [0n] });
        expect(response.results[3]).toEqual(fixtures.viewBatch.results[3]);
    });

    it("reads the ABI of each module once for the whole batch", async () => {
        mockAbis();
        mockPost.mockResolvedValue({ results: [] });

        await methods.viewBatch({ requests });

        const modulePaths = mockGet.mock.calls.map(([call]) => call.path).sort();
        expect(modulePaths).toEqual([
            "/accounts/0x0000000000000000000000000000000000000000000000000000000000000001/modules/chain_id",
            "/accounts/0x0000000000000000000000000000000000000000000000000000000000000001/modules/coin",
            "/accounts/0x0000000000000000000000000000000000000000000000000000000000000001/modules/timestamp",
        ]);
    });

    describe("an element of a generic view function", () => {
        const genericAbi = {
            address: "0x1",
            name: "m",
            friends: [],
            exposed_functions: ["echo", "object"].map((name) => ({
                name,
                visibility: "public",
                is_entry: false,
                is_view: true,
                generic_type_params: [{ constraints: ["copy", "drop"] }],
                params: [name === "echo" ? "T0" : "0x1::object::Object<T0>"],
                return: [name === "echo" ? "T0" : "0x1::object::Object<T0>"],
            })),
            structs: [],
        } as never;

        it("encodes the argument and converts the result as the type argument, with no version read", async () => {
            mockPost.mockResolvedValue({ results: [{ result: ["12345"] }, { result: [{ inner: "0xa" }] }] });

            const response = await methods.viewBatch({
                requests: [
                    { function: "0x1::m::echo", typeArguments: ["u64"], functionArguments: [12345n], abi: genericAbi },
                    {
                        function: "0x1::m::object",
                        typeArguments: ["0x1::fungible_asset::Metadata"],
                        functionArguments: ["0xa"],
                        abi: genericAbi,
                    },
                ],
            });

            expect(mockPost.mock.calls[0]![0].data).toEqual({
                requests: [
                    { function: "0x1::m::echo", type_arguments: ["u64"], arguments: ["12345"] },
                    {
                        function: "0x1::m::object",
                        type_arguments: ["0x1::fungible_asset::Metadata"],
                        arguments: ["0xa"],
                    },
                ],
            });
            expect(response.results).toEqual([{ result: [12345n] }, { result: ["0xa"] }]);
            expect(mockGet).not.toHaveBeenCalled();
        });

        it("throws SupraRouteUnsupportedError for a 404, without reading the node release", async () => {
            mockPost.mockRejectedValue(v11NotFound());

            const failure = await methods
                .viewBatch({
                    requests: [
                        { function: "0x1::m::echo", typeArguments: ["u64"], functionArguments: [1n], abi: genericAbi },
                    ],
                })
                .catch((error: unknown) => error);

            expect(failure).toBeInstanceOf(SupraRouteUnsupportedError);
            expect(mockGet).not.toHaveBeenCalled();
        });
    });

    it("reads no ABI for an element that carries one", async () => {
        mockPost.mockResolvedValue({ results: [{ result: ["5"] }] });

        const response = await methods.viewBatch({
            requests: [
                {
                    function: "0x1::timestamp::now_microseconds",
                    abi: fixtures.viewBatchAbis.timestamp as never,
                },
            ],
        });

        expect(mockGet).not.toHaveBeenCalled();
        expect(response.results).toEqual([{ result: [5n] }]);
        expect("state_height" in response).toBe(false);
    });

    it("returns the per-element errors the node reports without throwing", async () => {
        mockAbis();
        mockPost.mockResolvedValue({ state_height: null, results: fixtures.viewBatch.results.slice(3) });

        const response = await methods.viewBatch({ requests: requests.slice(2) });

        expect(response.state_height).toBeNull();
        expect(response.results).toEqual(fixtures.viewBatch.results.slice(3));
        expect(response.results.every((entry) => entry.error !== undefined && entry.result === undefined)).toBe(true);
    });

    it("throws SupraRouteUnsupportedError for a 404", async () => {
        mockAbis();
        mockPost.mockRejectedValue(v11NotFound());

        const failure = await methods.viewBatch({ requests }).catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(SupraRouteUnsupportedError);
        expect(failure).toMatchObject({ method: "viewBatch", minimumNodeRelease: "supra_node_v12.0.0", status: 404 });
    });

    it("passes the node's 400 for a batch outside its limits", async () => {
        mockAbis();
        const rejection = new SupraAPIError({
            status: 400,
            statusText: "Bad Request",
            url: "http://localhost:27001/rpc/v4/view/batch",
            data: { message: "Bad Request: Batch is empty. At least one item is required." },
        });
        mockPost.mockRejectedValue(rejection);

        await expect(methods.viewBatch({ requests })).rejects.toBe(rejection);
    });

    it("rejects an empty batch and an invalid function id before any request", async () => {
        await expect(methods.viewBatch({ requests: [] })).rejects.toThrow("non-empty array");
        await expect(methods.viewBatch({ requests: [{ function: "0x1::coin" as never }] })).rejects.toThrow(
            "Invalid function",
        );
        expect(mockGet).not.toHaveBeenCalled();
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("throws before any request when the ABI cannot be read", async () => {
        mockGet.mockRejectedValue(notFound({ message: "Module not found" }));

        await expect(methods.viewBatch({ requests })).rejects.toBeInstanceOf(SupraNotFoundError);
        expect(mockPost).not.toHaveBeenCalled();
    });
});

describe("getTransactionsByHashes", () => {
    it("posts the hashes to /transactions/by_hashes at v4 and returns the node's response", async () => {
        mockPost.mockResolvedValue(fixtures.byHashes);

        const response = await transaction.getTransactionsByHashes({ transactionHashes: [HASH_A, HASH_B] });

        const [request, , version] = mockPost.mock.calls[0]!;
        expect(request.path).toBe("/transactions/by_hashes");
        expect(request.data).toEqual({ hashes: [HASH_A, HASH_B] });
        expect(version).toBe("v4");
        expect(response).toEqual(fixtures.byHashes);
        expect(response.omitted).toEqual([]);
        expect(response.transactions[1]).toEqual({ hash: HASH_B, transaction: null });
        const found = response.transactions[0]!.transaction;
        expect(found?.status).toBe(TransactionStatus.Success);
        expect(found?.inclusion_proof).toBeNull();
    });

    it("sends type, exclude_uncommitted and include_proof as query parameters", async () => {
        mockPost.mockResolvedValue({ transactions: [], omitted: [] });

        await transaction.getTransactionsByHashes({
            transactionHashes: [HASH_A],
            type: "user",
            exclude_uncommitted: true,
            include_proof: false,
        });

        expect(mockPost.mock.calls[0]![0].path).toBe(
            "/transactions/by_hashes?type=user&exclude_uncommitted=true&include_proof=false",
        );
    });

    it("keeps the omitted hashes the node lists", async () => {
        mockPost.mockResolvedValue({
            transactions: fixtures.byHashes.transactions.slice(0, 1),
            omitted: [HASH_B, HASH_A],
        });

        const response = await transaction.getTransactionsByHashes({ transactionHashes: [HASH_A, HASH_B, HASH_A] });

        expect(response.transactions).toHaveLength(1);
        expect(response.omitted).toEqual([HASH_B, HASH_A]);
    });

    it("throws SupraRouteUnsupportedError for a 404", async () => {
        mockPost.mockRejectedValue(v11NotFound());

        const failure = await transaction
            .getTransactionsByHashes({ transactionHashes: [HASH_A] })
            .catch((e: unknown) => e);

        expect(failure).toBeInstanceOf(SupraRouteUnsupportedError);
        expect(failure).toMatchObject({ method: "getTransactionsByHashes" });
    });

    it("passes any other error", async () => {
        const tooLarge = new SupraAPIError({ status: 413, statusText: "Payload Too Large", url: "http://x" });
        mockPost.mockRejectedValue(tooLarge);

        await expect(transaction.getTransactionsByHashes({ transactionHashes: [HASH_A] })).rejects.toBe(tooLarge);
    });

    it("rejects no hashes and a malformed hash before any request", async () => {
        await expect(transaction.getTransactionsByHashes({ transactionHashes: [] })).rejects.toThrow("non-empty array");
        await expect(transaction.getTransactionsByHashes({ transactionHashes: [HASH_A, "0x123"] })).rejects.toThrow(
            "transactionHashes[1]",
        );
        expect(mockPost).not.toHaveBeenCalled();
    });
});

describe("simulate.withStateChanges", () => {
    const payload: SendTxnPayload = {
        Move: {
            raw_txn: {
                sender: "0x69e72ff2adabf1edca36714631e09012bc34ca36bbb2456f5bc84934211428c8",
                sequence_number: 0n,
                payload: {
                    EntryFunction: {
                        module: { address: "0x1", name: "supra_account" },
                        function: "transfer",
                        ty_args: [],
                        args: [],
                    },
                },
                max_gas_amount: 5000n,
                gas_unit_price: 100000n,
                expiration_timestamp_secs: 1793687783n,
                chain_id: 255,
            },
            authenticator: { Ed25519: { public_key: "0x" + "11".repeat(32), signature: "0x" + "22".repeat(64) } },
        },
    };

    it("posts a zero-signature copy to /transactions/simulate at v4 and returns the state changes", async () => {
        mockPost.mockResolvedValue(fixtures.simulate);

        const response = await simulate.withStateChanges({ sendTxPayload: payload });

        const [request, , version] = mockPost.mock.calls[0]!;
        expect(request.path).toBe("/transactions/simulate");
        expect(version).toBe("v4");
        const sent = request.data as SendTxnPayload;
        expect(sent.Move.authenticator).toEqual({
            Ed25519: { public_key: "0x" + "11".repeat(32), signature: "0x" + "0".repeat(128) },
        });
        expect((payload.Move.authenticator as { Ed25519: { signature: string } }).Ed25519.signature).toBe(
            "0x" + "22".repeat(64),
        );
        expect(response).toEqual(fixtures.simulate);
        expect(response.state_height).toBe(9830);
        expect(response.changes).toHaveLength(4);
        expect(response.changes_truncated).toBe(false);
        // Every change's state key has a prior value, `null` for a key that held none.
        for (const change of response.changes ?? []) {
            expect(Object.keys(response.prior_values ?? {})).toContain(change.state_key_hash);
        }
        expect(
            response.prior_values?.["0x9b79e854f7db63c8046c1b59d4ddb948ec51c4f1ef94e171eb6b3d30b774069e"],
        ).toBeNull();
    });

    it("returns the omitted state keys of a truncated response", async () => {
        mockPost.mockResolvedValue({ ...fixtures.simulate, ...fixtures.simulateOmittedFields });

        const response = await simulate.withStateChanges({ sendTxPayload: payload });

        expect(response.changes_truncated).toBe(true);
        expect(response.omitted?.[0]).toMatchObject({ kind: "module", tag: "0x1::code", address: "0x1" });
        expect(response.omitted_counts).toEqual({ resource: 0, resource_group: 0, module: 1, table_item: 0 });
    });

    it("parses a v11 answer that has none of the state-change fields", async () => {
        mockPost.mockResolvedValue(fixtures.v11SimulateAsV3);

        const response = await simulate.withStateChanges({ sendTxPayload: payload });

        expect(response.status).toBe(TransactionStatus.Success);
        for (const field of [
            "state_height",
            "changes",
            "prior_values",
            "omitted",
            "omitted_counts",
            "changes_truncated",
        ] as const) {
            expect(response[field]).toBeUndefined();
        }
    });

    it("throws SupraSimulationFailedError, carrying the response, for a status other than Success", async () => {
        const failed = {
            ...fixtures.simulate,
            status: "Fail",
            output: {
                Move: { gas_used: 3, events: [], vm_status: "Move abort in 0x1::coin: EINSUFFICIENT_BALANCE(0x10006)" },
            },
        };
        mockPost.mockResolvedValue(failed);

        const failure = await simulate.withStateChanges({ sendTxPayload: payload }).catch((e: unknown) => e);

        expect(failure).toBeInstanceOf(SupraSimulationFailedError);
        expect((failure as SupraSimulationFailedError).transaction).toBe(failed);
    });

    it("maps a refusal for a gas unit price below the node's minimum", async () => {
        mockPost.mockRejectedValue(
            new SupraAPIError({
                status: 400,
                statusText: "Bad Request",
                url: "http://localhost:27001/rpc/v4/transactions/simulate",
                data: {
                    message: "General err: MoveTransactionValidationFailed(aa, 0, GAS_UNIT_PRICE_BELOW_MIN_BOUND)",
                },
            }),
        );
        mockGet.mockResolvedValue({ data: { median_gas_price: 100000, min_configured_gas_price: 100000 } });

        const failure = await simulate.withStateChanges({ sendTxPayload: payload }).catch((e: unknown) => e);

        expect(failure).toBeInstanceOf(SupraGasUnitPriceBelowMinimumError);
        expect(failure).toMatchObject({ gasUnitPrice: 100000n, minimumGasUnitPrice: 100000n });
    });

    it("throws SupraRouteUnsupportedError for a 404", async () => {
        mockPost.mockRejectedValue(v11NotFound());

        const failure = await simulate.withStateChanges({ sendTxPayload: payload }).catch((e: unknown) => e);

        expect(failure).toBeInstanceOf(SupraRouteUnsupportedError);
        expect(failure).toMatchObject({ method: "simulate.withStateChanges" });
    });

    it("leaves simple on /rpc/v3", async () => {
        mockPost.mockResolvedValue(fixtures.v11SimulateAsV3);

        await simulate.simple({ sendTxPayload: payload });

        expect(mockPost.mock.calls[0]![2]).toBeUndefined();
    });
});

describe("getSettlements", () => {
    const MOVE_ADDRESS = "0x096fa454aa77435e6fa78f2c5cd8020b8630c50c71fa2268ae2b4284bf7c5bae";
    const EVM_ADDRESS = "0x1111111111111111111111111111111111111111";

    function respond(body: unknown, headers: Record<string, string> = {}, cursor?: string) {
        mockGet.mockResolvedValueOnce({ data: body, cursor, headers: new Headers(headers) });
    }

    it("requests /transactions/settlements at v4 with the query as given and unwraps data", async () => {
        respond(fixtures.settlementsPending, { "x-supra-oldest-block": "0" });

        const page: SettlementsPage = await transaction.getSettlements({
            address: MOVE_ADDRESS,
            domain: "move",
            options: { role: "sender", count: 5, start: "ab12" },
        });

        const [request, , version] = mockGet.mock.calls[0]!;
        expect(request.path).toBe("/transactions/settlements");
        expect(request.query).toEqual({
            address: MOVE_ADDRESS,
            domain: "move",
            role: "sender",
            count: 5,
            start: "ab12",
        });
        expect(version).toBe("v4");
        expect(page.response).toEqual(fixtures.settlementsPending.data);
        expect(page.response[0]).toMatchObject({ pending: { amount: 12345 } });
        expect(page.cursor).toBeUndefined();
        expect(page.oldestBlock).toBe(0);
    });

    it("sends a full-width address as given, in lower case", async () => {
        respond(fixtures.settlementsEmpty);
        respond(fixtures.settlementsEmpty);

        await transaction.getSettlements({ address: EVM_ADDRESS, domain: "evm" });
        await transaction.getSettlements({ address: MOVE_ADDRESS.toUpperCase().replace("0X", "0x"), domain: "move" });

        expect(mockGet.mock.calls[0]![0].query?.["address"]).toBe(EVM_ADDRESS);
        expect(mockGet.mock.calls[1]![0].query?.["address"]).toBe(MOVE_ADDRESS);
    });

    it("left-pads a short address to 32 bytes for move and 20 bytes for evm", async () => {
        respond(fixtures.settlementsEmpty);
        respond(fixtures.settlementsEmpty);
        respond(fixtures.settlementsEmpty);

        await transaction.getSettlements({ address: "0x1", domain: "move" });
        await transaction.getSettlements({ address: new HexString("0xab"), domain: "move" });
        await transaction.getSettlements({ address: "0x01", domain: "evm" });

        expect(mockGet.mock.calls[0]![0].query?.["address"]).toBe(`0x${"0".repeat(63)}1`);
        expect(mockGet.mock.calls[1]![0].query?.["address"]).toBe(`0x${"0".repeat(62)}ab`);
        expect(mockGet.mock.calls[2]![0].query?.["address"]).toBe(`0x${"0".repeat(39)}1`);
    });

    it("rejects an address longer than the domain's", async () => {
        await expect(transaction.getSettlements({ address: `0x1${"0".repeat(64)}`, domain: "move" })).rejects.toThrow(
            "1 to 64 hex digits",
        );
        await expect(transaction.getSettlements({ address: MOVE_ADDRESS, domain: "evm" })).rejects.toThrow(
            "1 to 40 hex digits",
        );
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("does not send an empty start, and takes the cursor from the header", async () => {
        respond(fixtures.settlementsSettled, {}, fixtures.settlementsSettledCursor);

        const page = await transaction.getSettlements({
            address: EVM_ADDRESS,
            domain: "evm",
            options: { count: 1, start: "" },
        });

        expect(mockGet.mock.calls[0]![0].query?.["start"]).toBeUndefined();
        expect(page.cursor).toBe(fixtures.settlementsSettledCursor);
        expect(page.oldestBlock).toBeUndefined();
    });

    it("keeps the cursor of an empty page and ends only without one", async () => {
        respond(fixtures.settlementsEmpty, {}, "00");
        respond(fixtures.settlementsEmpty);

        const first = await transaction.getSettlements({ address: EVM_ADDRESS, domain: "evm" });
        expect(first.response).toEqual([]);
        expect(first.cursor).toBe("00");
        const second = await transaction.getSettlements({
            address: EVM_ADDRESS,
            domain: "evm",
            options: { start: first.cursor },
        });
        expect(second.cursor).toBeUndefined();
    });

    it("throws SupraRouteUnsupportedError for a 404", async () => {
        mockGet.mockRejectedValue(notFound("Path deserialize error: HexDecode: Odd number of digits"));

        const failure = await transaction
            .getSettlements({ address: EVM_ADDRESS, domain: "evm" })
            .catch((e: unknown) => e);

        expect(failure).toBeInstanceOf(SupraRouteUnsupportedError);
        expect(failure).toMatchObject({ method: "getSettlements" });
    });

    it("rejects invalid arguments before any request", async () => {
        await expect(transaction.getSettlements({ address: "1", domain: "move" })).rejects.toThrow("hex digits");
        await expect(transaction.getSettlements({ address: EVM_ADDRESS, domain: "sevm" as never })).rejects.toThrow(
            '"move" or "evm"',
        );
        await expect(
            transaction.getSettlements({ address: EVM_ADDRESS, domain: "evm", options: { role: "payer" as never } }),
        ).rejects.toThrow('"sender" or "recipient"');
        await expect(
            transaction.getSettlements({ address: EVM_ADDRESS, domain: "evm", options: { count: 0 } }),
        ).rejects.toThrow("between 1 and 100");
        expect(mockGet).not.toHaveBeenCalled();
    });
});

describe("getSettlement", () => {
    it("requests /transactions/settlements/{id} at v4 and returns the crossing", async () => {
        mockGet.mockResolvedValue({ data: fixtures.settlementsSettled.data[0] });

        const settlement = await transaction.getSettlement({ settlementId: SETTLEMENT_ID });

        const [request, , version] = mockGet.mock.calls[0]!;
        expect(request.path).toBe(`/transactions/settlements/${SETTLEMENT_ID}`);
        expect(version).toBe("v4");
        expect(settlement.settlement_id).toBe(SETTLEMENT_ID);
        expect(settlement.stages.map((stage) => stage.stage)).toEqual(["recorded", "credited_on_evm", "cleared"]);
        expect(settlement.pending).toBeNull();
    });

    it("throws the node's SupraNotFoundError, not SupraRouteUnsupportedError, for an unknown crossing", async () => {
        mockGet.mockRejectedValue(notFound(fixtures.settlementUnknown));

        // The fixture is the node's answer for the id it names.
        const failure = await transaction
            .getSettlement({ settlementId: `0x${"00".repeat(31)}01` })
            .catch((e: unknown) => e);

        expect(failure).toBeInstanceOf(SupraNotFoundError);
        expect(failure).not.toBeInstanceOf(SupraRouteUnsupportedError);
    });

    it("throws SupraRouteUnsupportedError for a 404 without the node's error body", async () => {
        mockGet.mockRejectedValue(v11NotFound());

        const failure = await transaction.getSettlement({ settlementId: SETTLEMENT_ID }).catch((e: unknown) => e);

        expect(failure).toBeInstanceOf(SupraRouteUnsupportedError);
        expect(failure).toMatchObject({ method: "getSettlement" });
    });

    it("throws SupraRouteUnsupportedError for a gateway's JSON 404 that does not name the crossing", async () => {
        for (const body of [{ message: "Not Found" }, { message: "no Route matched with those values" }]) {
            mockGet.mockRejectedValueOnce(notFound(body));

            const failure = await transaction.getSettlement({ settlementId: SETTLEMENT_ID }).catch((e: unknown) => e);

            expect(failure).toBeInstanceOf(SupraRouteUnsupportedError);
        }
    });

    it("throws SupraRouteUnsupportedError for a 404 with a text or HTML body", async () => {
        for (const body of ["<html><body>404 Not Found</body></html>", "Path deserialize error: HexDecode"]) {
            mockGet.mockRejectedValueOnce(notFound(body));

            const failure = await transaction.getSettlement({ settlementId: SETTLEMENT_ID }).catch((e: unknown) => e);

            expect(failure).toBeInstanceOf(SupraRouteUnsupportedError);
        }
    });

    it("matches the crossing in the node's message without regard to case", async () => {
        mockGet.mockRejectedValue(
            notFound({ message: `Information not available for ${SETTLEMENT_ID.toUpperCase()}` }),
        );

        const failure = await transaction.getSettlement({ settlementId: SETTLEMENT_ID }).catch((e: unknown) => e);

        expect(failure).toBeInstanceOf(SupraNotFoundError);
        expect(failure).not.toBeInstanceOf(SupraRouteUnsupportedError);
    });

    it("passes the 410 of a pruned crossing", async () => {
        const gone = new SupraGoneError({ status: 410, statusText: "Gone", url: "http://x" });
        mockGet.mockRejectedValue(gone);

        await expect(transaction.getSettlement({ settlementId: SETTLEMENT_ID })).rejects.toBe(gone);
    });

    it("rejects a settlement id that is not 32 bytes before any request", async () => {
        await expect(transaction.getSettlement({ settlementId: "0x01" })).rejects.toThrow("settlementId");
        expect(mockGet).not.toHaveBeenCalled();
    });
});

describe("getNativeSupply", () => {
    it("requests /supply/native at v4 and returns the accounting", async () => {
        mockGet.mockResolvedValue({ data: fixtures.nativeSupplyInFlight });

        const supply = await fungibleAsset.getNativeSupply();

        const [request, , version] = mockGet.mock.calls[0]!;
        expect(request.path).toBe("/supply/native");
        expect(version).toBe("v4");
        expect(supply).toEqual(fixtures.nativeSupplyInFlight);
        expect(supply.in_flight.count).toBe(1);
        expect(supply.escrow_shortfall_wei).toBe("0");
    });

    it("returns an idle queue with null ages", async () => {
        mockGet.mockResolvedValue({ data: fixtures.nativeSupply });

        const supply = await fungibleAsset.getNativeSupply();

        expect(supply.in_flight.oldest_recorded_at_height).toBeNull();
        expect(supply.in_flight.oldest_age_blocks).toBeNull();
    });

    it("throws SupraRouteUnsupportedError for a 404", async () => {
        mockGet.mockRejectedValue(v11NotFound());

        const failure = await fungibleAsset.getNativeSupply().catch((e: unknown) => e);

        expect(failure).toBeInstanceOf(SupraRouteUnsupportedError);
        expect(failure).toMatchObject({ method: "getNativeSupply", minimumNodeRelease: "supra_node_v12.0.0" });
    });
});
