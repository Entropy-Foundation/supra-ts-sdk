import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BCS, SupraAccount, TxnBuilderTypes } from "supra-l1-sdk-core";
import { SupraClient } from "../../../api/supraClient";
import { getTransactionPayloadJSONInternal, sendTxnPayloadInternal } from "../txnBuild";
import { transactionHashOf } from "../txnHash";

/**
 * The execution of a multisig proposal whose payload is stored on chain carries no payload. The fixture is a signed
 * execution recorded from a Supra node that executed it and reported the transaction hash.
 */
interface Fixture {
    chainId: number;
    signer: { seed: string; address: string; publicKey: string };
    multisigAddress: string;
    raw: { sequenceNumber: string; maxGasAmount: string; gasUnitPrice: string; expirationTimestampSecs: string };
    expected: { rawTransactionBcs: string; signature: string; signedTransactionBcs: string; transactionHash: string };
}

const fixture = JSON.parse(
    readFileSync(join(__dirname, "fixtures", "multisigExecutionWithoutPayload.json"), "utf8"),
) as Fixture;

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const supra = new SupraClient({ rpcUrl: "http://127.0.0.1:1", chainId: fixture.chainId, verifyChainId: false });
const signer = new SupraAccount(new Uint8Array(Buffer.from(fixture.signer.seed, "hex")));

function build() {
    return supra.transaction.build.multisigRawTxnObject({
        senderAddress: signer.address(),
        senderSequenceNumber: BigInt(fixture.raw.sequenceNumber),
        multisigAddress: fixture.multisigAddress,
        optionalTransactionPayloadArgs: {
            maxGas: BigInt(fixture.raw.maxGasAmount),
            gasUnitPrice: BigInt(fixture.raw.gasUnitPrice),
            txExpiryTime: BigInt(fixture.raw.expirationTimestampSecs),
        },
    });
}

describe("a multisig execution without a payload", () => {
    test("the recorded signer is the seed's account", () => {
        expect(signer.address().toString()).toBe(fixture.signer.address);
        expect(hex(signer.pubKey().toUint8Array())).toBe(fixture.signer.publicKey);
    });

    test("the raw transaction has the recorded BCS and no payload", () => {
        const rawTxn = build();
        expect(hex(BCS.bcsToBytes(rawTxn))).toBe(fixture.expected.rawTransactionBcs);
        const payload = rawTxn.payload as TxnBuilderTypes.TransactionPayloadMultisig;
        expect(payload).toBeInstanceOf(TxnBuilderTypes.TransactionPayloadMultisig);
        expect(payload.value.transaction_payload).toBeUndefined();
    });

    test("the recorded bytes deserialize to the same transaction", () => {
        const parsed = TxnBuilderTypes.RawTransaction.deserialize(
            new BCS.Deserializer(new Uint8Array(Buffer.from(fixture.expected.rawTransactionBcs, "hex"))),
        );
        expect(hex(BCS.bcsToBytes(parsed))).toBe(fixture.expected.rawTransactionBcs);
        const payload = parsed.payload as TxnBuilderTypes.TransactionPayloadMultisig;
        expect(payload.value.transaction_payload).toBeUndefined();
    });

    test("the JSON of the payload names the multisig account and carries no transaction_payload", () => {
        const json = getTransactionPayloadJSONInternal(build().payload);
        expect(json).toStrictEqual({ Multisig: { multisig_address: fixture.multisigAddress } });
    });

    test("the signed transaction has the recorded signature and bytes", async () => {
        const signed = await build().signedTransaction(signer);
        expect(hex(BCS.bcsToBytes(signed))).toBe(fixture.expected.signedTransactionBcs);
        const authenticator = signed.authenticator as TxnBuilderTypes.TransactionAuthenticatorEd25519;
        expect(hex(authenticator.signature.value)).toBe(fixture.expected.signature);
    });

    test("the derived hash is the hash the node reported", async () => {
        const signed = await build().signedTransaction(signer);
        expect(supra.transaction.deriveTransactionHash({ signedTransaction: signed })).toBe(
            fixture.expected.transactionHash,
        );
        const payload = await sendTxnPayloadInternal(
            { senderAccount: signer, rawTxn: build() },
            supra.networkInformation,
        );
        expect(transactionHashOf(payload)).toBe(fixture.expected.transactionHash);
        expect(payload.Move.raw_txn.payload).toStrictEqual({ Multisig: { multisig_address: fixture.multisigAddress } });
    });

    test("a function without type arguments and arguments is refused", () => {
        expect(() =>
            supra.transaction.build.multisigRawTxnObject({
                senderAddress: signer.address(),
                senderSequenceNumber: 0n,
                multisigAddress: fixture.multisigAddress,
                functionArgs: [new Uint8Array([1])],
                optionalTransactionPayloadArgs: { maxGas: 1n, gasUnitPrice: 1n },
            } as never),
        ).toThrow(TypeError);
    });
});
