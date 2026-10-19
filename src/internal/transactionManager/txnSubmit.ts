import { BCS, HexString, TxnBuilderTypes, type SupraAccount } from "supra-l1-sdk-core";
import { post } from "../../client/post";
import { SupraTransactionFailedError } from "../../errors/transactionError";
import { TransactionStatus, type WaitForTransactionOptions } from "../../types/transaction";
import { reservationOf, sequenceNumberTrackerOf, settleRefusedSubmission } from "../sequenceNumber";
import type { SendTxnPayload } from "../../types/transactionManager/transactionBuild";
import type { EnableTransactionWaitAndSimulationArgs, SubmitTransactionResponse } from "../../types/transactionManager/transactionSubmit";
import type { NetworkConfig } from "../../utils/apiEndpoints";
import { DEFAULT_ENABLE_SIMULATION, DEFAULT_WAIT_FOR_TX_COMPLETION } from "../../utils/constants";
import { getTransactionByHashInternal, validateWaitTimeoutMs, waitForTransactionInternal } from "../transaction";
import { uint8ArrayToHexString } from "../../helper/general";
import { simulateTxnInternal } from "./txnSimulate";
import { getRawTxnJSONInternal, sendTxnPayloadInternal } from "./txnBuild";
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

export async function submitTxnInternal(
    args: {
        sendTxJsonPayload: SendTxnPayload,
        enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs,
    },
    config: NetworkConfig
): Promise<SubmitTransactionResponse> {
    const options = args.enableTransactionWaitAndSimulationArgs ?? {};
    validateSubmitOptions(options);

    // A sequence number taken from the client's counter is settled by the outcome of the submission.
    const reservation = reservationOf(args.sendTxJsonPayload);

    let txHash: string;
    try {
        // A failed simulation throws, so the transaction is not submitted.
        if ((options.enableTransactionSimulation ?? DEFAULT_ENABLE_SIMULATION) === true) {
            await simulateTxnInternal({ sendTxPayload: args.sendTxJsonPayload }, config);
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
    if (reservation !== undefined) {
        sequenceNumberTrackerOf(config).accepted(reservation);
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