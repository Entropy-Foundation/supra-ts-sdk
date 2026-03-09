import { BCS, TxnBuilderTypes } from "supra-l1-sdk-core";
import { post } from "../../client/post";
import type { Ed25519Signature, MoveInnerAuthenticator, MultiAgentSignature, MultiEd25519Signature } from "../../types/move";
import { TransactionStatus, type MoveTransactionOutput, type TransactionResponse } from "../../types/transaction";
import type { SendTxnPayload } from "../../types/transactionManager/transactionBuild";
import type { NetworkConfig } from "../../utils/apiEndpoints";
import { getRawTxnJSONInternal } from "./txnBuild";
import { SupraAPIError } from "../../errors/apiError";

export async function simulateTxnInternal(
    args: { sendTxPayload: SendTxnPayload },
    config: NetworkConfig
): Promise<TransactionResponse> {
    let txAuthenticatorWithValidSignatures = args.sendTxPayload.Move.authenticator;
    let txAuthenticatorClone = JSON.parse(JSON.stringify(txAuthenticatorWithValidSignatures));

    args.sendTxPayload.Move.authenticator = txAuthenticatorClone;

    unsetAuthenticatorSignatures(args.sendTxPayload.Move.authenticator);

    let simulatedTxnResponse = await post<SendTxnPayload, TransactionResponse>({
        path: "/transactions/simulate",
        data: args.sendTxPayload,
    }, config);

    // Converted authenticator to original format
    args.sendTxPayload.Move.authenticator = txAuthenticatorWithValidSignatures;

    // added as simulation api does not return error
    if (simulatedTxnResponse.status == TransactionStatus.Fail) {
        throw new SupraAPIError({
            status: 400,
            statusText: (simulatedTxnResponse.output as MoveTransactionOutput).Move.vm_status,
            request: undefined,
            url: "",
            data: simulatedTxnResponse
        })
    }

    return simulatedTxnResponse;
}


export function unsetAuthenticatorSignatures(txAuthenticator: MoveInnerAuthenticator) {
    let nullSignature = "0x" + "0".repeat(128);
    if ("Ed25519" in txAuthenticator) {
        txAuthenticator.Ed25519.signature = nullSignature;
    } else if ("FeePayer" in txAuthenticator) {
        (txAuthenticator.FeePayer.sender as Ed25519Signature).Ed25519.signature = nullSignature;
        (txAuthenticator.FeePayer.fee_payer_signer as Ed25519Signature).Ed25519.signature = nullSignature;
        txAuthenticator.FeePayer.secondary_signers.forEach(
            (ed25519Authenticator) => {
                (ed25519Authenticator as Ed25519Signature).Ed25519.signature = nullSignature;
            },
        );
    } else {
        ((txAuthenticator as MultiAgentSignature).MultiAgent.sender as Ed25519Signature).Ed25519.signature = nullSignature;
        (txAuthenticator as MultiAgentSignature).MultiAgent.secondary_signers.forEach(
            (ed25519Authenticator) => {
                (ed25519Authenticator as Ed25519Signature).Ed25519.signature = nullSignature;
            },
        );
    }
}


export async function simulateSerializedTxnInternal(
    args: {
        txAuthenticator: MoveInnerAuthenticator,
        serializedRawTransaction: Uint8Array,
    },
    config: NetworkConfig
): Promise<any> {
    let sendTxPayload = {
        Move: {
            raw_txn: getRawTxnJSONInternal(
                TxnBuilderTypes.RawTransaction.deserialize(
                    new BCS.Deserializer(args.serializedRawTransaction),
                ),
            ),
            authenticator: args.txAuthenticator,
        },
    };

    return await simulateTxnInternal({ sendTxPayload: sendTxPayload }, config);
}