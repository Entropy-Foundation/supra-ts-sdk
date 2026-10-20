import { HexString, TxnBuilderTypes, TypeTagParser } from "supra-l1-sdk-core";
import { transactionHashInternal } from "../../txnHash";

interface SubmittedBody {
    Move: {
        raw_txn: {
            sender: string;
            sequence_number: number;
            payload: {
                EntryFunction: {
                    module: { address: string; name: string };
                    function: string;
                    ty_args: unknown[];
                    args: number[][];
                };
            };
            max_gas_amount: number;
            gas_unit_price: number;
            expiration_timestamp_secs: number;
            chain_id: number;
        };
        authenticator: { Ed25519: { public_key: string; signature: string } };
    };
}

/**
 * The hash a node gives the transaction of a submission request, rebuilt from the request's JSON body: the Keccak-256
 * of the BCS of the signed transaction. Covers the transactions of the tests: an entry function whose type arguments
 * are structs without type arguments, signed with one Ed25519 key.
 */
export function hashOfSubmittedBody(body: string): string {
    const { raw_txn: raw, authenticator } = (JSON.parse(body) as SubmittedBody).Move;
    const entry = raw.payload.EntryFunction;
    const typeArguments = entry.ty_args.map((typeArgument) => {
        const { address, module, name, type_args } = (
            typeArgument as { struct: { address: string; module: string; name: string; type_args: unknown[] } }
        ).struct;
        if (type_args.length > 0) {
            throw new Error("hashOfSubmittedBody covers struct type arguments without type arguments of their own");
        }
        return new TypeTagParser(`${address}::${module}::${name}`).parseTypeTag();
    });
    const rawTxn = new TxnBuilderTypes.RawTransaction(
        TxnBuilderTypes.AccountAddress.fromHex(raw.sender),
        BigInt(raw.sequence_number),
        new TxnBuilderTypes.TransactionPayloadEntryFunction(
            new TxnBuilderTypes.EntryFunction(
                new TxnBuilderTypes.ModuleId(
                    TxnBuilderTypes.AccountAddress.fromHex(entry.module.address),
                    new TxnBuilderTypes.Identifier(entry.module.name),
                ),
                new TxnBuilderTypes.Identifier(entry.function),
                typeArguments,
                entry.args.map((arg) => Uint8Array.from(arg)),
            ),
        ),
        BigInt(raw.max_gas_amount),
        BigInt(raw.gas_unit_price),
        BigInt(raw.expiration_timestamp_secs),
        new TxnBuilderTypes.ChainId(raw.chain_id),
    );
    return transactionHashInternal(
        new TxnBuilderTypes.SignedTransaction(
            rawTxn,
            new TxnBuilderTypes.TransactionAuthenticatorEd25519(
                new TxnBuilderTypes.Ed25519PublicKey(new HexString(authenticator.Ed25519.public_key).toUint8Array()),
                new TxnBuilderTypes.Ed25519Signature(new HexString(authenticator.Ed25519.signature).toUint8Array()),
            ),
        ),
    );
}
