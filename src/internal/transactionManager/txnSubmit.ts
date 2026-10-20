import { BCS, HexString, TxnBuilderTypes, type SupraAccount } from "supra-l1-sdk-core";
import { post } from "../../client/post";
import { SupraSimulationFailedError, SupraTransactionFailedError } from "../../errors/transactionError";
import { standardizeAddress } from "../../helper/account";
import { simulateBehindPendingInternal } from "./behindPending";
import { TransactionStatus, type WaitForTransactionOptions } from "../../types/transaction";
import {
    bindReservation,
    reservationOf,
    sequenceNumberTrackerOf,
    settleRefusedSubmission,
    withSequenceNumberInternal,
    type SequenceNumberReservation,
} from "../sequenceNumber";
import type { SendTxnPayload } from "../../types/transactionManager/transactionBuild";
import type { EnableTransactionWaitAndSimulationArgs, OptionalTransactionArgs, SubmitTransactionResponse } from "../../types/transactionManager/transactionSubmit";
import type { NetworkConfig } from "../../utils/apiEndpoints";
import { DEFAULT_ENABLE_SIMULATION, DEFAULT_WAIT_FOR_TX_COMPLETION } from "../../utils/constants";
import { getTransactionByHashInternal, validateWaitTimeoutMs, waitForTransactionInternal } from "../transaction";
import { uint8ArrayToHexString } from "../../helper/general";
import { simulateTxnInternal } from "./txnSimulate";
import { buildWithResolvedMaxGasInternal, getRawTxnJSONInternal, rawTxnObjectInternal, sendTxnPayloadInternal } from "./txnBuild";
import type { AccountAddressInput } from "../../types/account";
import type { Ed25519Signature } from "../../types/move";

/**
 * Validates the options of a submission. The helpers that reserve a sequence number call it before reserving, so
 * that an invalid option does not use a number.
 */
export function validateSubmitOptions(options: EnableTransactionWaitAndSimulationArgs): void {
    if (options.waitTimeoutMs !== undefined) {
        validateWaitTimeoutMs(options.waitTimeoutMs, "waitTimeoutMs");
    }
}

/**
 * Simulates a payload before its submission and throws the `SupraSimulationFailedError` of a status other than
 * `Success`.
 *
 * When the simulation reports `SEQUENCE_NUMBER_TOO_NEW`, the transaction is simulated with the sender's sequence number
 * on the chain if every number from the chain's up to the transaction's belongs to a transaction that the node accepted
 * from this client and the one at the chain's number is still pending (`simulateBehindPendingInternal`); the
 * submission keeps its own number. Otherwise the `SEQUENCE_NUMBER_TOO_NEW` failure is thrown, which reports a stale
 * number; with `reservation`, the client's counter resumes at the lowest number that has no pending transaction of
 * this client. The simulation at the chain's number throws its own failures and request errors.
 */
async function simulateBeforeSubmission(
    payload: SendTxnPayload,
    reservation: SequenceNumberReservation | undefined,
    config: NetworkConfig,
): Promise<void> {
    try {
        await simulateTxnInternal({ sendTxPayload: payload }, config);
        return;
    } catch (error) {
        if (!(error instanceof SupraSimulationFailedError) || error.major_status !== "SEQUENCE_NUMBER_TOO_NEW") {
            throw error;
        }
        const rawTxn = payload.Move.raw_txn;
        let address: string;
        try {
            address = standardizeAddress(rawTxn.sender);
        } catch {
            throw error;
        }
        const outcome = await simulateBehindPendingInternal({
            address,
            sequenceNumber: BigInt(rawTxn.sequence_number),
            reservation,
            simulateAt: (chainSequenceNumber) => simulateTxnInternal({
                sendTxPayload: { ...payload, Move: { ...payload.Move, raw_txn: { ...rawTxn, sequence_number: chainSequenceNumber } } },
            }, config),
        }, config);
        if (outcome.kind !== "simulated") {
            throw error;
        }
    }
}

export async function submitTxnInternal(
    args: {
        sendTxJsonPayload: SendTxnPayload,
        enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs,
    },
    config: NetworkConfig
): Promise<SubmitTransactionResponse> {
    const options = args.enableTransactionWaitAndSimulationArgs ?? {};
    validateSubmitOptions(options);

    // A sequence number taken from the client's counter is settled by the node's answer to the submission, which
    // releases the account's lock before the wait for the final status.
    const reservation = reservationOf(args.sendTxJsonPayload);

    let txHash: string;
    try {
        // A failed simulation throws, so the transaction is not submitted.
        if ((options.enableTransactionSimulation ?? DEFAULT_ENABLE_SIMULATION) === true) {
            await simulateBeforeSubmission(args.sendTxJsonPayload, reservation, config);
        }

        txHash = await post<SendTxnPayload, string>({
            path: "/transactions/submit",
            data: args.sendTxJsonPayload,
        }, config);
    } catch (error) {
        if (reservation !== undefined) {
            settleRefusedSubmission(reservation, error, config);
        }
        throw error;
    }
    // The record of the accepted number lets a later transaction of the sender be estimated behind this one.
    const rawTxn = args.sendTxJsonPayload.Move.raw_txn;
    const tracker = sequenceNumberTrackerOf(config);
    tracker.recordAccepted(rawTxn.sender, rawTxn.sequence_number, txHash);
    if (reservation !== undefined) {
        tracker.accepted(reservation);
    }

    // From here on the node has accepted the transaction: the errors of the wait carry `txHash`, and a failed read
    // returns it.
    if ((options.enableWaitForTransaction ?? DEFAULT_WAIT_FOR_TX_COMPLETION) === true) {
        const waitOptions: WaitForTransactionOptions = { checkSuccess: options.checkSuccess ?? true };
        if (options.waitTimeoutMs !== undefined) {
            waitOptions.timeoutMs = options.waitTimeoutMs;
        }
        // A discarded transaction does not use its sequence number, so the counter may be ahead of the chain. The
        // outcome is `Invalid` whether the wait returns the transaction (`checkSuccess: false`) or throws.
        const invalidated = () => {
            if (reservation !== undefined) {
                sequenceNumberTrackerOf(config).invalidate(reservation.address);
            }
        };
        try {
            const transaction = await waitForTransactionInternal({ transactionHash: txHash, options: waitOptions }, config);
            if (transaction.status === TransactionStatus.Invalid) {
                invalidated();
            }
            return transaction;
        } catch (error) {
            if (error instanceof SupraTransactionFailedError && error.status === TransactionStatus.Invalid) {
                invalidated();
            }
            throw error;
        }
    }

    try {
        return await getTransactionByHashInternal({ transactionHash: txHash, exclude_uncommitted: false }, config);
    } catch (readError) {
        return { hash: txHash, status: "NotReadBack", readError };
    }
}


/**
 * Builds, signs and submits an entry function transaction of `senderAccount`, for the transfer, migration and publish
 * helpers.
 *
 * The sequence number is the call's `sequenceNumber`, else the next number of the client's counter
 * (`withSequenceNumberInternal`). A number from the counter is taken under the account's lock, which is held while the
 * transaction is built, its max gas estimated, signed, simulated (with `enableTransactionSimulation`) and submitted,
 * and released when the node answers the submission or one of those steps throws. The max gas estimate simulates the
 * transaction with that number, and the submission uses it. When building, estimating or signing throws, the number
 * is handed out next, or the counter is read from the chain again when the error reports a stale number.
 */
export async function buildAndSubmitEntryFunctionInternal(
    args: {
        senderAccount: SupraAccount,
        payload: Pick<Parameters<typeof rawTxnObjectInternal>[0], "function" | "functionTypeArgs" | "functionArgs">,
        optionalTransactionArgs?: OptionalTransactionArgs | undefined,
    },
    config: NetworkConfig
): Promise<SubmitTransactionResponse> {
    const senderAddress = args.senderAccount.address();
    const optionalTransactionPayloadArgs = args.optionalTransactionArgs?.optionalTransactionPayloadArgs;
    validateSubmitOptions(args.optionalTransactionArgs?.enableTransactionWaitAndSimulationArgs ?? {});
    return withSequenceNumberInternal(
        { address: senderAddress, sequenceNumber: optionalTransactionPayloadArgs?.sequenceNumber },
        config,
        async (senderSequenceNumber, reservation) => {
            const rawTxn = await buildWithResolvedMaxGasInternal({
                senderAddress,
                senderAccount: args.senderAccount,
                reservation,
                optionalTransactionPayloadArgs,
                buildRawTxn: (options) => rawTxnObjectInternal({
                    ...args.payload,
                    senderAddress,
                    senderSequenceNumber,
                    optionalTransactionPayloadArgs: options,
                }, config),
            }, config);
            const sendTxPayload = await sendTxnPayloadInternal({ senderAccount: args.senderAccount, rawTxn }, config);
            if (reservation !== undefined) {
                bindReservation(sendTxPayload, reservation);
            }
            return await submitTxnInternal({
                sendTxJsonPayload: sendTxPayload,
                enableTransactionWaitAndSimulationArgs: args.optionalTransactionArgs?.enableTransactionWaitAndSimulationArgs ?? {},
            }, config);
        },
    );
}


export async function submitSerializedRawTransactionInternal(
    args: {
        senderAccount: SupraAccount,
        serializedRawTransaction: Uint8Array,
        enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs,
    },
    config: NetworkConfig
): Promise<SubmitTransactionResponse> {
    let sendTxPayload = await sendTxnPayloadInternal(
        {
            senderAccount: args.senderAccount,
            rawTxn: TxnBuilderTypes.RawTransaction.deserialize(
                new BCS.Deserializer(args.serializedRawTransaction),
            )
        },
        config
    );

    return await submitTxnInternal(
        {
            sendTxJsonPayload: sendTxPayload,
            enableTransactionWaitAndSimulationArgs: args.enableTransactionWaitAndSimulationArgs ?? {},
        },
        config
    );
}


export async function submitSerializedRawTransactionAndSignatureInternal(
    args: {
        senderPubkey: HexString,
        signature: HexString,
        serializedRawTransaction: Uint8Array,
        enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs,
    },
    config: NetworkConfig
): Promise<SubmitTransactionResponse> {
    let sendTxPayload = {
        Move: {
            raw_txn: getRawTxnJSONInternal(
                TxnBuilderTypes.RawTransaction.deserialize(
                    new BCS.Deserializer(args.serializedRawTransaction),
                ),
            ),
            authenticator: {
                Ed25519: {
                    public_key: args.senderPubkey.toString(),
                    signature: args.signature.toString(),
                },
            },
        },
    };

    return await submitTxnInternal(
        {
            sendTxJsonPayload: sendTxPayload,
            enableTransactionWaitAndSimulationArgs: args.enableTransactionWaitAndSimulationArgs ?? {},
        },
        config
    );
}


export async function submitSponsorTransactionInternal(
    args: {
        feePayerAddress: AccountAddressInput,
        secondarySignersAccountAddress: Array<string>,
        rawTxn: TxnBuilderTypes.RawTransaction,
        senderAuthenticator: TxnBuilderTypes.AccountAuthenticatorEd25519,
        feePayerAuthenticator: TxnBuilderTypes.AccountAuthenticatorEd25519,
        secondarySignersAuthenticator: Array<TxnBuilderTypes.AccountAuthenticatorEd25519>,
        enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs,
    },
    config: NetworkConfig
): Promise<SubmitTransactionResponse> {
    let secondarySignersAuthenticatorJSON: Array<Ed25519Signature> = [];
    args.secondarySignersAuthenticator.forEach((authenticator) => {
        secondarySignersAuthenticatorJSON.push(
            getED25519AuthenticatorJSON(authenticator),
        );
    });

    let sendTxPayload: SendTxnPayload = {
        Move: {
            raw_txn: getRawTxnJSONInternal(args.rawTxn),
            authenticator: {
                FeePayer: {
                    sender: getED25519AuthenticatorJSON(args.senderAuthenticator),
                    secondary_signer_addresses: args.secondarySignersAccountAddress,
                    secondary_signers: secondarySignersAuthenticatorJSON,
                    fee_payer_address: args.feePayerAddress.toString(),
                    fee_payer_signer: getED25519AuthenticatorJSON(args.feePayerAuthenticator)
                },
            },
        },
    };

    return await submitTxnInternal(
        {
            sendTxJsonPayload: sendTxPayload,
            enableTransactionWaitAndSimulationArgs: args.enableTransactionWaitAndSimulationArgs ?? {},
        },
        config
    );
}


export async function submitMultiAgentTransactionInternal(
    args: {
        secondarySignersAccountAddress: Array<string>,
        rawTxn: TxnBuilderTypes.RawTransaction,
        senderAuthenticator: TxnBuilderTypes.AccountAuthenticatorEd25519,
        secondarySignersAuthenticator: Array<TxnBuilderTypes.AccountAuthenticatorEd25519>,
        enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs,
    },
    config: NetworkConfig
): Promise<SubmitTransactionResponse> {
    let secondarySignersAuthenticatorJSON: Array<Ed25519Signature> = [];
    args.secondarySignersAuthenticator.forEach((authenticator) => {
        secondarySignersAuthenticatorJSON.push(
            getED25519AuthenticatorJSON(authenticator)
        );
    });

    let sendTxPayload: SendTxnPayload = {
        Move: {
            raw_txn: getRawTxnJSONInternal(args.rawTxn),
            authenticator: {
                MultiAgent: {
                    sender: getED25519AuthenticatorJSON(args.senderAuthenticator),
                    secondary_signer_addresses: args.secondarySignersAccountAddress,
                    secondary_signers: secondarySignersAuthenticatorJSON,
                },
            },
        },
    };

    return await submitTxnInternal(
        {
            sendTxJsonPayload: sendTxPayload,
            enableTransactionWaitAndSimulationArgs: args.enableTransactionWaitAndSimulationArgs ?? {},
        }, config
    );
}


export function getED25519AuthenticatorJSON(
    authenticator: TxnBuilderTypes.AccountAuthenticatorEd25519,
): Ed25519Signature {
    return {
        Ed25519: {
            public_key: uint8ArrayToHexString(authenticator.public_key.value),
            signature: uint8ArrayToHexString(authenticator.signature.value),
        },
    };
}