import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expectTypeOf } from "expect-type";
import { HexString, SupraAccount, TxnBuilderTypes, type AnyRawTransaction } from "supra-l1-sdk-core";
import { SupraClient } from "../api/supraClient";
import type { AccountData, PaginatedResponse } from "../types/account";
import type { FinalizedBlockHeader } from "../types/block";
import type { FungibleAssetMetadata } from "../types/fungibleAsset";
import type { MoveResource } from "../types/move";
import type { TransactionQueryType, TransactionResponse } from "../types/transaction";

/**
 * Checks, for each method whose declared type was corrected, that the declared type is the type of the value the
 * method returns when the node sends the responses recorded in `fixtures/nodeResponses.json` (from a v12 node,
 * `supra_node_v12.0.0.rc6`, and a v11 node, `supra_node_v11.7.0`). The type assertions are compiled by `pnpm
 * typecheck` and by ts-jest; the runtime assertions run the SDK against the recorded responses.
 */

jest.mock("../client/get", () => ({
    get: jest.fn(),
}));

import { get } from "../client/get";
const mockGet = get as jest.MockedFunction<typeof get>;

interface RecordedResponses {
    accountInfo: { sequence_number: number; authentication_key: string };
    accountNotFound: { status: number; body: unknown };
    fungibleAssetMetadata: MoveResource<FungibleAssetMetadata>;
    transactionByHash: TransactionResponse;
    latestBlock: FinalizedBlockHeader;
}

const recorded = JSON.parse(readFileSync(join(__dirname, "fixtures", "nodeResponses.json"), "utf8")) as Record<
    "v12" | "v11",
    RecordedResponses
>;

function buildRawTransaction(account: SupraAccount): TxnBuilderTypes.RawTransaction {
    return new TxnBuilderTypes.RawTransaction(
        AccountAddress.fromHex(account.address()),
        0n,
        new TxnBuilderTypes.TransactionPayloadEntryFunction(
            TxnBuilderTypes.EntryFunction.natural("0x1::supra_account", "transfer", [], []),
        ),
        5_000n,
        100n,
        4_102_444_800n,
        new TxnBuilderTypes.ChainId(255),
    );
}

const supra = new SupraClient({ rpcUrl: "http://localhost:1", chainId: 255 });
// Signs without reading the node's chain ID, so the signing tests send no request.
const offlineSigner = new SupraClient({ rpcUrl: "http://localhost:1", chainId: 255, verifyChainId: false });
const { AccountAddress } = TxnBuilderTypes;
const SUPRA_FA ="0x000000000000000000000000000000000000000000000000000000000000000a";

describe.each(["v12", "v11"] as const)("declared types against responses recorded from a %s node", (version) => {
    const node = recorded[version];

    beforeEach(() => {
        mockGet.mockReset();
    });

    test("the node sends the sequence number as a number, and AccountData.sequence_number is a bigint", async () => {
        expect(typeof node.accountInfo.sequence_number).toBe("number");
        mockGet.mockResolvedValue({ data: node.accountInfo });

        const info = await supra.account.getAccountInfo({ accountAddress: "0x1" });

        expectTypeOf(info).toEqualTypeOf<AccountData>();
        expectTypeOf(info.sequence_number).toEqualTypeOf<bigint>();
        expect(typeof info.sequence_number).toBe("bigint");
        expect(info.sequence_number).toBe(BigInt(node.accountInfo.sequence_number));
        expect(info.sequence_number + 1n).toBe(BigInt(node.accountInfo.sequence_number) + 1n);
        expect(info.authentication_key).toBe(node.accountInfo.authentication_key);
    });

    test("getFungibleAssetMetadata returns FungibleAssetMetadata, the data of the node's resource", async () => {
        mockGet.mockResolvedValue({ data: node.fungibleAssetMetadata });

        const metadata = await supra.fungibleAsset.getFungibleAssetMetadata({ assetAddress: SUPRA_FA });

        expectTypeOf(metadata).toEqualTypeOf<FungibleAssetMetadata>();
        expect(metadata).toEqual(node.fungibleAssetMetadata.data);
        expect(Object.keys(metadata).sort()).toEqual(["decimals", "icon_uri", "name", "project_uri", "symbol"]);
        expect(typeof metadata.decimals).toBe("number");
    });

    test("getTransactionByHash returns TransactionResponse, narrowed by txn_type", async () => {
        mockGet.mockResolvedValue({ data: node.transactionByHash });

        const txn = await supra.transaction.getTransactionByHash({ transactionHash: `0x${"ab".repeat(32)}` });

        expectTypeOf(txn).toEqualTypeOf<TransactionResponse>();
        expect(txn).toEqual(node.transactionByHash);
        if ("header" in txn) {
            expectTypeOf(txn.header.sequence_number).toBeNumber();
        }
    });

    test("a latest block without finalized transactions has no transactions property", async () => {
        mockGet.mockResolvedValue({ data: node.latestBlock });

        const block = await supra.block.getLatestBlock();

        expectTypeOf(block).toEqualTypeOf<FinalizedBlockHeader>();
        expectTypeOf(block.transactions).toEqualTypeOf<FinalizedBlockHeader["transactions"]>();
        expectTypeOf<undefined>().toExtend<FinalizedBlockHeader["transactions"]>();
        expect(block.transactions).toBeUndefined();
    });
});

describe("declared types that do not depend on a recorded response", () => {
    test("getAccountTransactions accepts a number, a bigint or a string as start and returns a cursor", () => {
        type Args = Parameters<typeof supra.account.getAccountTransactions>[0];
        expectTypeOf<NonNullable<Args["options"]>["start"]>().toEqualTypeOf<string | number | bigint | undefined>();
        expectTypeOf<ReturnType<typeof supra.account.getAccountTransactions>>().resolves.toExtend<
            PaginatedResponse<TransactionResponse[]>
        >();
        expectTypeOf<PaginatedResponse<unknown>["cursor"]>().toEqualTypeOf<string | undefined>();
    });

    test("the block type option accepts every transaction query type, including record", () => {
        type Args = Parameters<typeof supra.block.getBlockByHeight>[0];
        expectTypeOf<NonNullable<Args["options"]>["type"]>().toEqualTypeOf<TransactionQueryType | undefined>();
        expectTypeOf<"record">().toExtend<TransactionQueryType>();
    });

    test("getTransactionByHash takes no type argument", () => {
        const _withTypeArgument = () =>
            // @ts-expect-error the method is not generic
            supra.transaction.getTransactionByHash<TransactionResponse>({ transactionHash: "0x1" });
        expectTypeOf(supra.transaction.getTransactionByHash).returns.resolves.toEqualTypeOf<TransactionResponse>();
    });

    test("signTransaction resolves to the signature for a RawTransaction and the authenticator for the other kinds", async () => {
        const account = new SupraAccount();
        const rawTxn = buildRawTransaction(account);
        const sender = AccountAddress.fromHex(account.address());

        const signature = offlineSigner.transaction.signTransaction({ senderAccount: account, rawTxn });
        expectTypeOf(signature).toEqualTypeOf<Promise<HexString>>();
        expect(await signature).toBeInstanceOf(HexString);

        const feePayerAuthenticator = offlineSigner.transaction.signTransaction({
            senderAccount: account,
            rawTxn: new TxnBuilderTypes.FeePayerRawTransaction(rawTxn, [], sender),
        });
        expectTypeOf(feePayerAuthenticator).toEqualTypeOf<Promise<TxnBuilderTypes.AccountAuthenticatorEd25519>>();
        expect(await feePayerAuthenticator).toBeInstanceOf(TxnBuilderTypes.AccountAuthenticatorEd25519);

        const multiAgentAuthenticator = offlineSigner.transaction.signTransaction({
            senderAccount: account,
            rawTxn: new TxnBuilderTypes.MultiAgentRawTransaction(rawTxn, []),
        });
        expectTypeOf(multiAgentAuthenticator).toEqualTypeOf<Promise<TxnBuilderTypes.AccountAuthenticatorEd25519>>();
        expect(await multiAgentAuthenticator).toBeInstanceOf(TxnBuilderTypes.AccountAuthenticatorEd25519);

        const signAnyKind = (rawTxn: AnyRawTransaction) =>
            offlineSigner.transaction.signTransaction({ senderAccount: account, rawTxn });
        expectTypeOf(signAnyKind).returns.toEqualTypeOf<Promise<HexString | TxnBuilderTypes.AccountAuthenticatorEd25519>>();
    });

    test("deriveTransactionHash returns a 0x-prefixed hash that the hash validators accept", async () => {
        const account = new SupraAccount();
        const rawTxn = buildRawTransaction(account);
        const signed = new TxnBuilderTypes.SignedTransaction(
            rawTxn,
            new TxnBuilderTypes.AccountAuthenticatorEd25519(
                new TxnBuilderTypes.Ed25519PublicKey(account.pubKey().toUint8Array()),
                new TxnBuilderTypes.Ed25519Signature(
                    (await offlineSigner.transaction.signTransaction({ senderAccount: account, rawTxn })).toUint8Array(),
                ),
            ),
        );

        const hash = supra.transaction.deriveTransactionHash({ signedTransaction: signed });

        expect(hash).toMatch(/^0x[0-9a-f]{64}$/);

        mockGet.mockReset();
        mockGet.mockResolvedValue({ data: { status: "Pending" } });
        await expect(supra.transaction.getTransactionByHash({ transactionHash: hash })).resolves.toBeDefined();
    });
});
