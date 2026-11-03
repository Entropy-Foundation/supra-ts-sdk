import { post } from "../../client/post";
import type { Ed25519Signature, MoveInnerAuthenticator, MultiAgentSignature } from "../../types/move";
import { TransactionStatus, type TransactionResponse, type TransactionSimulationV4 } from "../../types/transaction";
import { V4_RPC_VERSION, withV4RouteSupport } from "../routeSupport";
import type { SendTxnPayload } from "../../types/transactionManager/transactionBuild";
import type { NetworkConfig } from "../../utils/apiEndpoints";
import { getRawTxnJSONInternal } from "./txnBuild";
import { SupraSimulationFailedError } from "../../errors/transactionError";
import { mapGasUnitPriceRefusalInternal } from "./gasPrice";
import { deserializeRawTransaction } from "./automationRegistration";

/**
 * Simulates a transaction and returns the simulated transaction when its status is `Success`.
 *
 * The request carries a copy of the payload whose signatures are zero; the caller's payload is not modified.
 * A simulation with any other status throws `SupraSimulationFailedError` carrying the simulated transaction, except one
 * refused for a gas unit price below the node's minimum, which throws `SupraGasUnitPriceBelowMinimumError` (read of the
 * node's minimum included). The helpers that simulate while they hold the account's lock use
 * `simulateUnmappedTxnInternal` and map the refusal after the lock is released.
 */
export async function simulateTxnInternal(
    args: { sendTxPayload: SendTxnPayload },
    config: NetworkConfig,
): Promise<TransactionResponse> {
    try {
        return await simulateUnmappedTxnInternal(args, config);
    } catch (error) {
        throw await mapGasUnitPriceRefusalInternal(error, args.sendTxPayload.Move.raw_txn.gas_unit_price, config);
    }
}

/** `simulateTxnInternal` without the mapping of a refusal for a gas unit price below the node's minimum. */
export async function simulateUnmappedTxnInternal(
    args: { sendTxPayload: SendTxnPayload },
    config: NetworkConfig,
): Promise<TransactionResponse> {
    const simulatedTxnResponse = await post<SendTxnPayload, TransactionResponse>(
        {
            path: "/transactions/simulate",
            data: zeroedSignaturePayload(args.sendTxPayload),
        },
        config,
    );

    // The node answers a simulation with HTTP 200 whatever the simulated status.
    if (simulatedTxnResponse.status !== TransactionStatus.Success) {
        throw new SupraSimulationFailedError(simulatedTxnResponse);
    }

    return simulatedTxnResponse;
}

/** A copy of the payload whose signatures are zero; the caller's payload is not modified. */
function zeroedSignaturePayload(sendTxPayload: SendTxnPayload): SendTxnPayload {
    const authenticator = JSON.parse(JSON.stringify(sendTxPayload.Move.authenticator)) as MoveInnerAuthenticator;
    unsetAuthenticatorSignatures(authenticator);
    return { ...sendTxPayload, Move: { ...sendTxPayload.Move, authenticator } };
}

/**
 * Simulates a transaction with `POST /rpc/v4/transactions/simulate`, which reports the changes the transaction would
 * make to Move state, and returns the simulated transaction when its status is `Success`. Errors are those of
 * {@link simulateTxnInternal}; a 404 is thrown as `SupraRouteUnsupportedError`.
 *
 * A node whose v4 route answers as v3 does returns the transaction without the state-change fields.
 */
export async function simulateWithStateChangesInternal(
    args: { sendTxPayload: SendTxnPayload },
    config: NetworkConfig,
): Promise<TransactionSimulationV4> {
    try {
        const simulated = await withV4RouteSupport({ method: "simulate.withStateChanges" }, () =>
            post<SendTxnPayload, TransactionSimulationV4>(
                { path: "/transactions/simulate", data: zeroedSignaturePayload(args.sendTxPayload) },
                config,
                V4_RPC_VERSION,
            ),
        );
        if (simulated.status !== TransactionStatus.Success) {
            throw new SupraSimulationFailedError(simulated);
        }
        return simulated;
    } catch (error) {
        throw await mapGasUnitPriceRefusalInternal(error, args.sendTxPayload.Move.raw_txn.gas_unit_price, config);
    }
}

/** Replaces every signature of the authenticator with zeros, in place. */
export function unsetAuthenticatorSignatures(txAuthenticator: MoveInnerAuthenticator) {
    let nullSignature = "0x" + "0".repeat(128);
    if ("Ed25519" in txAuthenticator) {
        txAuthenticator.Ed25519.signature = nullSignature;
    } else if ("FeePayer" in txAuthenticator) {
        (txAuthenticator.FeePayer.sender as Ed25519Signature).Ed25519.signature = nullSignature;
        (txAuthenticator.FeePayer.fee_payer_signer as Ed25519Signature).Ed25519.signature = nullSignature;
        txAuthenticator.FeePayer.secondary_signers.forEach((ed25519Authenticator) => {
            (ed25519Authenticator as Ed25519Signature).Ed25519.signature = nullSignature;
        });
    } else {
        ((txAuthenticator as MultiAgentSignature).MultiAgent.sender as Ed25519Signature).Ed25519.signature =
            nullSignature;
        (txAuthenticator as MultiAgentSignature).MultiAgent.secondary_signers.forEach((ed25519Authenticator) => {
            (ed25519Authenticator as Ed25519Signature).Ed25519.signature = nullSignature;
        });
    }
}

export async function simulateSerializedTxnInternal(
    args: {
        txAuthenticator: MoveInnerAuthenticator;
        serializedRawTransaction: Uint8Array;
    },
    config: NetworkConfig,
): Promise<TransactionResponse> {
    let sendTxPayload = {
        Move: {
            raw_txn: getRawTxnJSONInternal(deserializeRawTransaction(args.serializedRawTransaction)),
            authenticator: args.txAuthenticator,
        },
    };

    return await simulateTxnInternal({ sendTxPayload: sendTxPayload }, config);
}
