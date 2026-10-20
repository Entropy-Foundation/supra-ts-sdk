import { BCS, TxnBuilderTypes } from "supra-l1-sdk-core";
import sha3 from "js-sha3";
import type { SendTxnPayload } from "../../types/transactionManager/transactionBuild";

/**
 * The hash of a signed Move transaction: `0x` followed by the Keccak-256 of the BCS bytes of the
 * `SignedTransaction` (the raw transaction followed by its transaction authenticator), in lower-case hex. Nodes of
 * the v11.7.0 and v12 lines report this hash for a Move transaction.
 */
export function transactionHashInternal(signedTransaction: TxnBuilderTypes.SignedTransaction): string {
    return `0x${sha3.keccak256(BCS.bcsToBytes(signedTransaction))}`;
}

/**
 * The transaction authenticator of a single Ed25519 signature, serialized as `TransactionAuthenticatorEd25519` is
 * (variant 0, the public key bytes, the signature bytes) without checking the lengths of the key and the signature,
 * so that a hash is derived for any key and signature a caller passes. The node refuses a key or signature of the
 * wrong length.
 */
class Ed25519TransactionAuthenticatorBytes extends TxnBuilderTypes.TransactionAuthenticator {
    constructor(
        private readonly publicKey: Uint8Array,
        private readonly signature: Uint8Array,
    ) {
        super();
    }

    serialize(serializer: BCS.Serializer): void {
        serializer.serializeU32AsUleb128(0);
        serializer.serializeBytes(this.publicKey);
        serializer.serializeBytes(this.signature);
    }
}

/** The transaction authenticator of a raw transaction signed with one Ed25519 key. */
export function ed25519TransactionAuthenticator(
    publicKey: Uint8Array,
    signature: Uint8Array,
): TxnBuilderTypes.TransactionAuthenticator {
    return new Ed25519TransactionAuthenticatorBytes(publicKey, signature);
}

const payloadHashes = new WeakMap<SendTxnPayload, string>();

/**
 * Records on `payload`, the JSON form of `rawTxn` signed with `authenticator`, the hash of that signed transaction
 * (`transactionHashInternal`), and returns `payload`. Every payload the SDK submits is made by a function that calls
 * this, so its hash is known before the submission request.
 */
export function withTransactionHash(
    payload: SendTxnPayload,
    rawTxn: TxnBuilderTypes.RawTransaction,
    authenticator: TxnBuilderTypes.TransactionAuthenticator,
): SendTxnPayload {
    payloadHashes.set(payload, transactionHashInternal(new TxnBuilderTypes.SignedTransaction(rawTxn, authenticator)));
    return payload;
}

/** The hash recorded on `payload` by `withTransactionHash`, or `undefined` for a payload made elsewhere. */
export function transactionHashOf(payload: SendTxnPayload): string | undefined {
    return payloadHashes.get(payload);
}
