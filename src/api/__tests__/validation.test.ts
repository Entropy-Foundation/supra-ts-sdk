/**
 * API-boundary validation tests: each public method must reject invalid input
 * BEFORE any network call is made (i.e. without invoking the *Internal function).
 */
import type { NetworkConfig } from "../../utils/apiEndpoints";

jest.mock("../../internal/coin", () => ({
    getCoinInfoInternal: jest.fn().mockResolvedValue({}),
    transferCoinInternal: jest.fn().mockResolvedValue({}),
}));
jest.mock("../../internal/fungibleAsset", () => ({
    getFungibleAssetMetadataInternal: jest.fn().mockResolvedValue({}),
    transferFungibleAssetInternal: jest.fn().mockResolvedValue({}),
}));
jest.mock("../../internal/block", () => ({
    getLatestBlockInternal: jest.fn().mockResolvedValue({}),
    getBlockByHeightInternal: jest.fn().mockResolvedValue({}),
    getBlockByHashInternal: jest.fn().mockResolvedValue({}),
    getTransactionsByBlockHashInternal: jest.fn().mockResolvedValue([]),
}));
jest.mock("../../internal/events", () => ({
    getEventsByTypeInternal: jest.fn().mockResolvedValue({ response: [], cursor: undefined }),
}));
jest.mock("../../internal/table", () => ({
    getTableItemInternal: jest.fn().mockResolvedValue({}),
}));
jest.mock("../../internal/methods", () => ({
    viewInternal: jest.fn().mockResolvedValue([]),
    viewRawInternal: jest.fn().mockResolvedValue([]),
}));

import { Coin } from "../coin";
import { FungibleAsset } from "../fungibleAsset";
import { Block } from "../block";
import { Events } from "../events";
import { Table } from "../table";
import { Methods } from "../methods";
import { getCoinInfoInternal, transferCoinInternal } from "../../internal/coin";
import { getFungibleAssetMetadataInternal, transferFungibleAssetInternal } from "../../internal/fungibleAsset";
import { getBlockByHeightInternal, getBlockByHashInternal } from "../../internal/block";
import { getEventsByTypeInternal } from "../../internal/events";
import { getTableItemInternal } from "../../internal/table";
import { viewInternal } from "../../internal/methods";

const config: NetworkConfig = { name: "testnet", chainId: 6, rpcUrl: "https://rpc-testnet.supra.com" };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyAccount = {} as any;

beforeEach(() => jest.clearAllMocks());

describe("Coin validation", () => {
    const coin = new Coin(config);

    it("rejects a bad coinType without calling the network", async () => {
        await expect(coin.getCoinInfo({ coinType: "not_a_type" as never })).rejects.toThrow("Invalid coinType");
        expect(getCoinInfoInternal).not.toHaveBeenCalled();
    });

    it("rejects a bad receiver address on transferCoin", async () => {
        await expect(
            coin.transferCoin({
                senderAccount: anyAccount,
                receiverAccountAddress: "xyz",
                amount: 1,
                coinType: "0x1::supra_coin::SupraCoin",
            }),
        ).rejects.toThrow("Invalid receiverAccountAddress");
        expect(transferCoinInternal).not.toHaveBeenCalled();
    });

    it("rejects a negative amount on transferCoin", async () => {
        await expect(
            coin.transferCoin({
                senderAccount: anyAccount,
                receiverAccountAddress: "0x2",
                amount: -5,
                coinType: "0x1::supra_coin::SupraCoin",
            }),
        ).rejects.toThrow("Invalid amount");
        expect(transferCoinInternal).not.toHaveBeenCalled();
    });

    it("passes valid input through to the internal", async () => {
        await coin.transferSupraCoin({ senderAccount: anyAccount, receiverAccountAddress: "0x2", amount: 100n });
        expect(transferCoinInternal).toHaveBeenCalledTimes(1);
    });
});

describe("FungibleAsset validation", () => {
    const fa = new FungibleAsset(config);

    it("rejects a bad asset address", async () => {
        await expect(fa.getFungibleAssetMetadata({ assetAddress: "nope" })).rejects.toThrow("Invalid assetAddress");
        expect(getFungibleAssetMetadataInternal).not.toHaveBeenCalled();
    });

    it("rejects a bad receiver on transferFungibleAsset", async () => {
        await expect(
            fa.transferFungibleAsset({
                senderAccount: anyAccount,
                receiverAccountAddress: "bad",
                amount: 1,
                assetAddress: "0xa",
            }),
        ).rejects.toThrow("Invalid receiverAccountAddress");
        expect(transferFungibleAssetInternal).not.toHaveBeenCalled();
    });
});

describe("Block validation", () => {
    const block = new Block(config);

    it("rejects a negative height", async () => {
        await expect(block.getBlockByHeight({ height: -1 })).rejects.toThrow("Invalid height");
        expect(getBlockByHeightInternal).not.toHaveBeenCalled();
    });

    it("rejects a non-hex block hash", async () => {
        await expect(block.getBlockByHash({ blockHash: "zzz" })).rejects.toThrow("Invalid blockHash");
        expect(getBlockByHashInternal).not.toHaveBeenCalled();
    });
});

describe("Events validation", () => {
    const events = new Events(config);

    it("rejects a bad eventType", async () => {
        await expect(
            events.getEventsByType({ eventType: "bad" as never, options: {} }),
        ).rejects.toThrow("Invalid eventType");
        expect(getEventsByTypeInternal).not.toHaveBeenCalled();
    });

    it("rejects an out-of-range limit", async () => {
        await expect(
            events.getEventsByType({ eventType: "0x1::coin::CoinDeposit", options: { limit: 500 } }),
        ).rejects.toThrow("Invalid limit");
        expect(getEventsByTypeInternal).not.toHaveBeenCalled();
    });
});

describe("Table validation", () => {
    const table = new Table(config);

    it("rejects a bad handle", async () => {
        await expect(
            table.getTableItem({ handle: "bad", data: { key_type: "address", value_type: "u64", key: "0x1" } }),
        ).rejects.toThrow("Invalid handle");
        expect(getTableItemInternal).not.toHaveBeenCalled();
    });
});

describe("Methods validation", () => {
    const methods = new Methods(config);

    it("rejects a bad function id on view", async () => {
        await expect(methods.view({ function: "0x1::coin" as never })).rejects.toThrow("Invalid function");
        expect(viewInternal).not.toHaveBeenCalled();
    });
});
