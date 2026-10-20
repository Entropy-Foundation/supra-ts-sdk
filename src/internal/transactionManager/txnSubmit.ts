import { BCS, HexString, TxnBuilderTypes, type SupraAccount } from "supra-l1-sdk-core";
import { post } from "../../client/post";
import { standardizeAddress } from "../../helper/account";
import { isSequenceNumberTooNew, MAX_TOO_NEW_CHECKS, resolveSequenceNumberTooNewInternal } from "./behindPending";
import type { WaitForTransactionOptions } from "../../types/transaction";
import {
    bindReservation,
    reservationOf,
    sequenceNumberTrackerOf,
    settleFailedSubmissionInternal,
    settleUnsubmittedSequenceNumberInternal,
    withSequenceNumberInternal,
    type ReservationBinding,
} from "../sequenceNumber";
import type { SendTxnPayload } from "../../types/transactionManager/transactionBuild";
import type {
    EnableTransactionWaitAndSimulationArgs,
    OptionalTransactionArgs,
    SubmitTransactionResponse,
} from "../../types/transactionManager/transactionSubmit";
import type { NetworkConfig } from "../../utils/apiEndpoints";
import { DEFAULT_ENABLE_SIMULATION, DEFAULT_WAIT_FOR_TX_COMPLETION } from "../../utils/constants";
import { getTransactionByHashInternal, validateWaitTimeoutMs, waitForTransactionInternal } from "../transaction";
import { uint8ArrayToHexString } from "../../helper/general";
import { simulateUnmappedTxnInternal } from "./txnSimulate";
import {
    mapCallGasUnitPriceRefusalInternal,
    mapGasUnitPriceRefusalInternal,
    withResolvedGasUnitPriceInternal,
} from "./gasPrice";
import {
    buildWithResolvedMaxGasInternal,
    getRawTxnJSONInternal,
    rawTxnObjectInternal,
    sendTxnPayloadInternal,
    withSequenceNumber,
} from "./txnBuild";
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
 * `Success`. Returns the payload to submit: `payload`, or the transaction signed again with a lower number.
 *
 * When the simulation reports `SEQUENCE_NUMBER_TOO_NEW`, `resolveSequenceNumberTooNewInternal` reads the account and
 * the latest block, as the max gas estimate does. When every number from the chain's up to the transaction's has a
 * record of a submission of this client, the transaction is simulated with the chain's number and the submission keeps
 * its own number. Otherwise, with `binding` (a number from the client's counter), the transaction is signed again with
 * the lowest number without a record (`binding.resign`) and simulated again, at most twice; without `binding` the
 * `SEQUENCE_NUMBER_TOO_NEW` failure is thrown. A failed read of the account is thrown. The simulation at the chain's
 * number throws its own failures and request errors.
 */
async function simulateBeforeSubmission(
    payload: SendTxnPayload,
    binding: ReservationBinding | undefined,
    config: NetworkConfig,
): Promise<SendTxnPayload> {
    let current = payload;
    for (let checks = 0; ; checks += 1) {
        try {
            await simulateUnmappedTxnInternal({ sendTxPayload: current }, config);
            return current;
        } catch (error) {
            if (!isSequenceNumberTooNew(error) || checks >= MAX_TOO_NEW_CHECKS) {
                throw error;
            }
            const signed = current;
            const rawTxn = signed.Move.raw_txn;
            let address: string;
            try {
                address = standardizeAddress(rawTxn.sender);
            } catch {
                throw error;
            }
            const outcome = await resolveSequenceNumberTooNewInternal(
                {
                    address,
                    sequenceNumber: BigInt(rawTxn.sequence_number),
                    reservation: binding?.reservation,
                    tooNew: error,
                    simulateAt: (chainSequenceNumber) =>
                        simulateUnmappedTxnInternal(
                            {
                                sendTxPayload: {
                                    ...signed,
                                    Move: {
                                        ...signed.Move,
                                        raw_txn: { ...rawTxn, sequence_number: chainSequenceNumber },
                                    },
                                },
                            },
                            config,
                        ),
                },
                config,
            );
            if (outcome.kind === "simulated") {
                return current;
            }
            if (binding === undefined) {
                throw error;
            }
            current = await binding.resign(outcome.sequenceNumber);
        }
    }
}

/**
 * Submits a signed transaction, simulating it first with `enableTransactionSimulation`, and waits as the options say.
 * A refusal for a gas unit price below the node's minimum, by the simulation or the submission, throws
 * `SupraGasUnitPriceBelowMinimumError`; the read of the node's minimum for it is made here. The helpers that call this
 * while they hold the account's lock set `deferGasPriceRefusalMapping` and map the error after they have released the
 * lock (`mapCallGasUnitPriceRefusalInternal`).
 */
export async function submitTxnInternal(
    args: {
        sendTxJsonPayload: SendTxnPayload;
        enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs;
        deferGasPriceRefusalMapping?: boolean;
    },
    config: NetworkConfig,
): Promise<SubmitTransactionResponse> {
    try {
        return await submitUnmappedTxnInternal(args, config);
    } catch (error) {
        if (args.deferGasPriceRefusalMapping === true) {
            throw error;
        }
        throw await mapGasUnitPriceRefusalInternal(error, args.sendTxJsonPayload.Move.raw_txn.gas_unit_price, config);
    }
}

async function submitUnmappedTxnInternal(
    args: {
        sendTxJsonPayload: SendTxnPayload;
        enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs;
    },
    config: NetworkConfig,
): Promise<SubmitTransactionResponse> {
    const options = args.enableTransactionWaitAndSimulationArgs ?? {};
    validateSubmitOptions(options);

    // A sequence number taken from the client's counter is settled by the node's answer to the submission, which
    // releases the account's lock before the wait for the final status.
    const binding = reservationOf(args.sendTxJsonPayload);
    const reservation = binding?.reservation;
    const tracker = sequenceNumberTrackerOf(config);

    let payload = args.sendTxJsonPayload;
    // A failed simulation throws, so the transaction is not submitted.
    if ((options.enableTransactionSimulation ?? DEFAULT_ENABLE_SIMULATION) === true) {
        try {
            payload = await simulateBeforeSubmission(payload, binding, config);
        } catch (error) {
            if (reservation !== undefined) {
                settleUnsubmittedSequenceNumberInternal(reservation, error, config);
            }
            throw error;
        }
    }

    const rawTxn = payload.Move.raw_txn;
    let txHash: string;
    try {
        txHash = await post<SendTxnPayload, string>(
            {
                path: "/transactions/submit",
                data: payload,
            },
            config,
        );
    } catch (error) {
        // The refusal for a price below the node's minimum is a known outcome: the number is handed out again.
        throw settleFailedSubmissionInternal({ rawTxn, reservation }, error, config);
    }
    // The record keeps the number from the counter until the transaction has committed or can no longer commit.
    tracker.record(rawTxn.sender, rawTxn.sequence_number, rawTxn.expiration_timestamp_secs, txHash);
    if (reservation !== undefined) {
        tracker.release(reservation);
    }

    // From here on the node has accepted the transaction: the errors of the wait carry `txHash`, and a failed read
    // returns it. A read that returns `Invalid` drops the record (`getTransactionByHashInternal`).
    if ((options.enableWaitForTransaction ?? DEFAULT_WAIT_FOR_TX_COMPLETION) === true) {
        const waitOptions: WaitForTransactionOptions = { checkSuccess: options.checkSuccess ?? true };
        if (options.waitTimeoutMs !== undefined) {
            waitOptions.timeoutMs = options.waitTimeoutMs;
        }
        return await waitForTransactionInternal({ transactionHash: txHash, options: waitOptions }, config);
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
 * transaction with that number, and the submission uses it, unless the estimate or the simulation before submission
 * gave the reservation a lower number that has no submission of this client (the transaction is then built and signed
 * again with it). The gas unit price is the call's, else the client's, else the node's estimate, which is read once;
 * the read starts before the lock is requested and is awaited under the lock, before building, and a failed read
 * throws like a failed build. When building, estimating or signing throws,
 * the number is handed out next, or the chain is read before the next number when the error reports a stale number.
 */
export async function buildAndSubmitEntryFunctionInternal(
    args: {
        senderAccount: SupraAccount;
        payload: Pick<Parameters<typeof rawTxnObjectInternal>[0], "function" | "functionTypeArgs" | "functionArgs">;
        optionalTransactionArgs?: OptionalTransactionArgs | undefined;
    },
    config: NetworkConfig,
): Promise<SubmitTransactionResponse> {
    const senderAddress = args.senderAccount.address();
    validateSubmitOptions(args.optionalTransactionArgs?.enableTransactionWaitAndSimulationArgs ?? {});
    const callOptions = args.optionalTransactionArgs?.optionalTransactionPayloadArgs;
    // The read of the node's gas unit price estimate starts before the account's lock is requested and is awaited
    // inside the lock, so the lock is requested in the order of the calls and the read overlaps the calls ahead. The
    // no-op catch keeps a rejection from being reported as unhandled before it is awaited.
    const priceRead = withResolvedGasUnitPriceInternal(callOptions, config);
    priceRead.catch(() => undefined);
    // A refusal for a gas unit price below the node's minimum is mapped after the lock is released, as the read of the
    // node's minimum is not made under it.
    return withSequenceNumberInternal(
        { address: senderAddress, sequenceNumber: callOptions?.sequenceNumber },
        config,
        async (senderSequenceNumber, reservation) => {
            const optionalTransactionPayloadArgs = await priceRead;
            const rawTxn = await buildWithResolvedMaxGasInternal(
                {
                    senderAddress,
                    senderAccount: args.senderAccount,
                    reservation,
                    optionalTransactionPayloadArgs,
                    buildRawTxn: (options) =>
                        rawTxnObjectInternal(
                            {
                                ...args.payload,
                                senderAddress,
                                senderSequenceNumber,
                                optionalTransactionPayloadArgs: options,
                            },
                            config,
                        ),
                },
                config,
            );
            const sendTxPayload = await sendTxnPayloadInternal({ senderAccount: args.senderAccount, rawTxn }, config);
            if (reservation !== undefined) {
                bindReservation(sendTxPayload, reservation, (sequenceNumber) =>
                    sendTxnPayloadInternal(
                        { senderAccount: args.senderAccount, rawTxn: withSequenceNumber(rawTxn, sequenceNumber) },
                        config,
                    ),
                );
            }
            return await submitTxnInternal(
                {
                    sendTxJsonPayload: sendTxPayload,
                    enableTransactionWaitAndSimulationArgs:
                        args.optionalTransactionArgs?.enableTransactionWaitAndSimulationArgs ?? {},
                    deferGasPriceRefusalMapping: true,
                },
                config,
            );
        },
    ).catch(async (error: unknown) => {
        throw await mapCallGasUnitPriceRefusalInternal(error, priceRead, config);
    });
}

export async function submitSerializedRawTransactionInternal(
    args: {
        senderAccount: SupraAccount;
        serializedRawTransaction: Uint8Array;
        enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs;
    },
    config: NetworkConfig,
): Promise<SubmitTransactionResponse> {
    let sendTxPayload = await sendTxnPayloadInternal(
        {
            senderAccount: args.senderAccount,
            rawTxn: TxnBuilderTypes.RawTransaction.deserialize(new BCS.Deserializer(args.serializedRawTransaction)),
        },
        config,
    );

    return await submitTxnInternal(
        {
            sendTxJsonPayload: sendTxPayload,
            enableTransactionWaitAndSimulationArgs: args.enableTransactionWaitAndSimulationArgs ?? {},
        },
        config,
    );
}

export async function submitSerializedRawTransactionAndSignatureInternal(
    args: {
        senderPubkey: HexString;
        signature: HexString;
        serializedRawTransaction: Uint8Array;
        enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs;
    },
    config: NetworkConfig,
): Promise<SubmitTransactionResponse> {
    let sendTxPayload = {
        Move: {
            raw_txn: getRawTxnJSONInternal(
                TxnBuilderTypes.RawTransaction.deserialize(new BCS.Deserializer(args.serializedRawTransaction)),
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
        config,
    );
}

export async function submitSponsorTransactionInternal(
    args: {
        feePayerAddress: AccountAddressInput;
        secondarySignersAccountAddress: Array<string>;
        rawTxn: TxnBuilderTypes.RawTransaction;
        senderAuthenticator: TxnBuilderTypes.AccountAuthenticatorEd25519;
        feePayerAuthenticator: TxnBuilderTypes.AccountAuthenticatorEd25519;
        secondarySignersAuthenticator: Array<TxnBuilderTypes.AccountAuthenticatorEd25519>;
        enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs;
    },
    config: NetworkConfig,
): Promise<SubmitTransactionResponse> {
    let secondarySignersAuthenticatorJSON: Array<Ed25519Signature> = [];
    args.secondarySignersAuthenticator.forEach((authenticator) => {
        secondarySignersAuthenticatorJSON.push(getED25519AuthenticatorJSON(authenticator));
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
                    fee_payer_signer: getED25519AuthenticatorJSON(args.feePayerAuthenticator),
                },
            },
        },
    };

    return await submitTxnInternal(
        {
            sendTxJsonPayload: sendTxPayload,
            enableTransactionWaitAndSimulationArgs: args.enableTransactionWaitAndSimulationArgs ?? {},
        },
        config,
    );
}

export async function submitMultiAgentTransactionInternal(
    args: {
        secondarySignersAccountAddress: Array<string>;
        rawTxn: TxnBuilderTypes.RawTransaction;
        senderAuthenticator: TxnBuilderTypes.AccountAuthenticatorEd25519;
        secondarySignersAuthenticator: Array<TxnBuilderTypes.AccountAuthenticatorEd25519>;
        enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs;
    },
    config: NetworkConfig,
): Promise<SubmitTransactionResponse> {
    let secondarySignersAuthenticatorJSON: Array<Ed25519Signature> = [];
    args.secondarySignersAuthenticator.forEach((authenticator) => {
        secondarySignersAuthenticatorJSON.push(getED25519AuthenticatorJSON(authenticator));
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
        },
        config,
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
