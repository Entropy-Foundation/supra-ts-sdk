import { TxnBuilderTypes, TypeTagParser } from "supra-l1-sdk-core";
import { getTransactionPayloadJSONInternal } from "../txnBuild";

const ONE = "0x0000000000000000000000000000000000000000000000000000000000000001";
const MODULE = new TxnBuilderTypes.ModuleId(
    TxnBuilderTypes.AccountAddress.fromHex("0x1"),
    new TxnBuilderTypes.Identifier("m"),
);
const tags = ["u64", "vector<u8>", "0x1::coin::CoinStore<0x1::supra_coin::SupraCoin>"].map((type) =>
    new TypeTagParser(type).parseTypeTag(),
);
const EXPECTED = [
    "u64",
    { vector: "u8" },
    {
        struct: {
            address: ONE,
            module: "coin",
            name: "CoinStore",
            type_args: [{ struct: { address: ONE, module: "supra_coin", name: "SupraCoin", type_args: [] } }],
        },
    },
];

describe("type arguments in transaction payloads", () => {
    it("are written for an entry function", () => {
        const payload = new TxnBuilderTypes.TransactionPayloadEntryFunction(
            new TxnBuilderTypes.EntryFunction(MODULE, new TxnBuilderTypes.Identifier("f"), tags, []),
        );
        expect(getTransactionPayloadJSONInternal(payload)).toMatchObject({ EntryFunction: { ty_args: EXPECTED } });
    });

    it("are written for a script, next to its u16, u32 and u256 arguments", () => {
        const payload = new TxnBuilderTypes.TransactionPayloadScript(
            new TxnBuilderTypes.Script(
                new Uint8Array([1]),
                tags,
                [
                    new TxnBuilderTypes.TransactionArgumentU16(65535),
                    new TxnBuilderTypes.TransactionArgumentU32(4294967295),
                    new TxnBuilderTypes.TransactionArgumentU256(1n),
                ],
            ),
        );
        expect(getTransactionPayloadJSONInternal(payload)).toEqual({
            Script: {
                code: [1],
                ty_args: EXPECTED,
                args: [{ U16: 65535 }, { U32: 4294967295 }, { U256: [1, ...new Array(31).fill(0)] }],
            },
        });
    });

    it("are written for a multisig entry function", () => {
        const payload = new TxnBuilderTypes.TransactionPayloadMultisig(
            new TxnBuilderTypes.MultiSig(
                TxnBuilderTypes.AccountAddress.fromHex("0x2"),
                new TxnBuilderTypes.MultiSigTransactionPayload(
                    new TxnBuilderTypes.EntryFunction(MODULE, new TxnBuilderTypes.Identifier("f"), tags, []),
                ),
            ),
        );
        expect(getTransactionPayloadJSONInternal(payload)).toMatchObject({
            Multisig: { transaction_payload: { EntryFunction: { ty_args: EXPECTED } } },
        });
    });
});
