import { getAccountCoinTransactionsInternal } from "../account";
import { getBlockByHeightInternal } from "../block";
import { getTransactionByHashInternal, waitForTransactionInternal } from "../transaction";
import {
    TransactionType,
    type CommittedTransactionResponse,
    type SettlementTransactionResponse,
    type TransactionResponse,
} from "../../types/transaction";
import type { FinalizedBlockHeader } from "../../types/block";
import type { NetworkConfig } from "../../utils/apiEndpoints";

jest.mock("../../client/get", () => ({
    get: jest.fn(),
}));

import { get } from "../../client/get";
const mockGet = get as jest.MockedFunction<typeof get>;

const testConfig: NetworkConfig = {
    name: "devnet",
    chainId: 6,
    rpcUrl: "https://rpc-devnet.supra.com",
};

const blockHeader = {
    author: "0x10da1ea1a84d16cc9e8cbd10a2e472ec10215274a6e2a36e9702d399dabb1de0",
    hash: "0x9564fba716fe360bc7eab202b0fd8fd4a902e7b65706edd2c59d2bd045abc4b8",
    height: 3987,
    parent: "0xee64a81f5f049221cfd83f4fa4441abe43d8fc14945b4b2ecc6c38af18993b91",
    timestamp: { microseconds_since_unix_epoch: 1792406658423031, utc_date_time: "2026-10-19T10:44:18+00:00" },
    view: { epoch_id: { chain_id: 6, epoch: 36 }, round: 4 },
};

// Shaped after `SettlementTransactionInfoV3` in the v12 node's OpenAPI document: no `header`, `payload` or
// `authenticator`.
const moveSettlement = {
    txn_type: "settlement",
    hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    data: {
        vm: "move",
        inbound: [
            { settlement_id: "0xaa", status: 0 },
            { settlement_id: "0xab", status: 2, refund: "0xac" },
        ],
        cleared: ["0xba"],
        burn_block_height: 3986,
        burn_amount: 0,
    },
    block_header: blockHeader,
    output: { Move: { gas_used: 0, events: [], vm_status: "Executed successfully" } },
    status: "Success",
};

const evmSettlement = {
    txn_type: "settlement",
    hash: "0x2222222222222222222222222222222222222222222222222222222222222222",
    data: {
        vm: "evm",
        settlement_id: "0xcc",
        recipient: "0x00000000000000000000000000000000000000dd",
        amount_wei: "1000000000000000000",
        recorded_at_height: 3980,
    },
    output: "Empty",
    status: "Success",
};

const userTransaction = {
    txn_type: "user",
    hash: "0x3333333333333333333333333333333333333333333333333333333333333333",
    authenticator: { Move: { Ed25519: { public_key: "0x01", signature: "0x02" } } },
    block_header: null,
    header: {
        chain_id: 6,
        expiration_timestamp: {
            microseconds_since_unix_epoch: 1792406837000000,
            utc_date_time: "2026-10-19T10:47:17+00:00",
        },
        sender: { Move: "0x2c5a636dc4558f880e62f3d53e7ffce91cbeba8c39b533b6cd29389b7f2593ca" },
        sequence_number: 138,
        gas_unit_price: 100000,
        max_gas_amount: 2000,
    },
    payload: {
        Move: {
            type: "entry_function_payload",
            function: "0x1::supra_account::transfer",
            type_arguments: [],
            arguments: ["0x1", "1"],
        },
    },
    output: { Move: { gas_used: 9, events: [], vm_status: "Executed successfully" } },
    status: "Success",
};

const blockMetadata = {
    txn_type: "block_metadata",
    hash: "0x4444444444444444444444444444444444444444444444444444444444444444",
    block_header: null,
    output: { Move: { gas_used: 0, events: [], vm_status: "Executed successfully" } },
    status: "Success",
};

/** Reads the sender of every item that has one, narrowing on `txn_type` first. */
function senders(transactions: readonly TransactionResponse[]): string[] {
    const result: string[] = [];
    for (const txn of transactions) {
        if (txn.txn_type === TransactionType.User || txn.txn_type === TransactionType.Auto) {
            result.push(txn.header.sender.Move);
        }
    }
    return result;
}

/** Describes a settlement item from its `data`, narrowing on `vm`. */
function describeSettlement(txn: SettlementTransactionResponse): string {
    const data = txn.data;
    if (data.vm === "move") {
        return `move: ${data.inbound.length} inbound, ${data.cleared.length} cleared, burn ${data.burn_amount}`;
    }
    return `evm: ${data.amount_wei} wei to ${data.recipient}`;
}

describe("settlement transactions", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("getTransactionByHash returns a settlement item that narrows by txn_type", async () => {
        mockGet.mockResolvedValue({ data: moveSettlement });

        const txn = await getTransactionByHashInternal(
            { transactionHash: moveSettlement.hash, type: "settlement" },
            testConfig,
        );

        expect(txn.txn_type).toBe(TransactionType.Settlement);
        if (txn.txn_type !== TransactionType.Settlement) {
            throw new Error("expected a settlement item");
        }
        expect(describeSettlement(txn)).toBe("move: 2 inbound, 1 cleared, burn 0");
        expect("header" in txn).toBe(false);
        expect(senders([txn])).toEqual([]);
        expect(mockGet.mock.calls[0]?.[0].query?.["type"]).toBe("settlement");
    });

    it("getBlockByHeight returns settlement items alongside the other types", async () => {
        const block = {
            header: blockHeader,
            execution_statistics: { user_txn_count: 1, block_total_evm_user_gas_used: 0 },
            transactions: [blockMetadata, userTransaction, moveSettlement, evmSettlement],
        };
        mockGet.mockResolvedValue({ data: block });

        const result: FinalizedBlockHeader = await getBlockByHeightInternal(
            { height: 3987, options: { withFinalizedTransactions: true, type: "settlement" } },
            testConfig,
        );

        const transactions: CommittedTransactionResponse[] = result.transactions ?? [];
        expect(transactions.map((txn) => txn.txn_type)).toEqual(["block_metadata", "user", "settlement", "settlement"]);
        expect(senders(transactions)).toEqual([userTransaction.header.sender.Move]);
        const settlements = transactions.filter(
            (txn): txn is SettlementTransactionResponse => txn.txn_type === TransactionType.Settlement,
        );
        expect(settlements.map(describeSettlement)).toEqual([
            "move: 2 inbound, 1 cleared, burn 0",
            "evm: 1000000000000000000 wei to 0x00000000000000000000000000000000000000dd",
        ]);
    });

    it("getAccountCoinTransactions returns settlement items in the feed", async () => {
        mockGet.mockResolvedValue({ data: [userTransaction, evmSettlement], cursor: "1792406658423031" });

        const page = await getAccountCoinTransactionsInternal(
            { accountAddress: "0x1", options: { type: "settlement" } },
            testConfig,
        );

        expect(page.cursor).toBe("1792406658423031");
        expect(senders(page.response)).toEqual([userTransaction.header.sender.Move]);
        expect(page.response[1]?.output).toBe("Empty");
    });

    it("waitForTransaction returns a committed settlement item", async () => {
        mockGet.mockResolvedValue({ data: evmSettlement });

        const txn = await waitForTransactionInternal({ transactionHash: evmSettlement.hash }, testConfig);

        expect(txn.txn_type).toBe(TransactionType.Settlement);
    });
});
