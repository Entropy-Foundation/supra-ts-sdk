import { BCS, HexString, TxnBuilderTypes, type SupraAccount } from "supra-l1-sdk-core";
import { post } from "../../client/post";
import { addressToBytes, standardizeAddress } from "../../helper/account";
import { isSequenceNumberTooNew, MAX_TOO_NEW_CHECKS, resolveSequenceNumberTooNewInternal } from "./behindPending";
import type { CommittedTransactionResponse, WaitForTransactionOptions } from "../../types/transaction";
import { SupraAPIError } from "../../errors/apiError";
import { SupraSubmissionOutcomeUnknownError, SupraTransactionTimeoutError } from "../../errors/transactionError";
import { ed25519TransactionAuthenticator, transactionHashOf, withTransactionHash } from "./txnHash";
import {
    bindReservation,
    reservationOf,
    sequenceNumberTrackerOf,
    settleFailedSubmissionInternal,
    settleUnsubmittedSequenceNumberInternal,
    withSequenceNumberInternal,
    type ReservationBinding,
} from "../sequenceNumber";
import type {
    OptionalTransactionPayloadArgs,
    RawTxnJSON,
    SendTxnPayload,
} from "../../types/transactionManager/transactionBuild";
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

const simulationForms = new WeakMap<SendTxnPayload, SendTxnPayload>();

/**
 * Records `form` as the transaction that the simulation before the submission of `payload` simulates, for a transaction
 * that the node simulates only in another form than the one that is sent. `payload` is what is submitted.
 */
export function bindSimulationForm(payload: SendTxnPayload, form: SendTxnPayload): void {
    simulationForms.set(payload, form);
}

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
        // The transaction that is simulated: the one that is sent, or its recorded simulation form.
        const signed = simulationForms.get(current) ?? current;
        try {
            await simulateUnmappedTxnInternal({ sendTxPayload: signed }, config);
            return current;
        } catch (error) {
            if (!isSequenceNumberTooNew(error) || checks >= MAX_TOO_NEW_CHECKS) {
                throw error;
            }
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
 * The outcome of a submission whose request failed in a way that leaves it open whether the node accepted the
 * transaction (`cause`: a timeout, a connection failure, or a 5xx other than 503; see
 * `settleFailedSubmissionInternal`). The transaction has been recorded with `hash`, the hash derived from the signed
 * transaction.
 *
 * Without `waitOptions`, throws `SupraSubmissionOutcomeUnknownError`. With `waitOptions` (`enableWaitForTransaction`),
 * waits for `hash` as after an accepted submission: a final status is returned or thrown as
 * `waitForTransactionInternal` does, and a wait that ends without one (`SupraTransactionTimeoutError`) throws
 * `SupraSubmissionOutcomeUnknownError` with that error as `waitError`.
 */
async function unknownSubmissionOutcomeInternal(
    args: {
        rawTxn: RawTxnJSON;
        hash: string;
        cause: unknown;
        waitOptions: WaitForTransactionOptions | undefined;
    },
    config: NetworkConfig,
): Promise<CommittedTransactionResponse> {
    const unknown = (waitError?: SupraTransactionTimeoutError) =>
        new SupraSubmissionOutcomeUnknownError({
            hash: args.hash,
            sender: args.rawTxn.sender,
            sequenceNumber: BigInt(args.rawTxn.sequence_number),
            expirationTimestampSecs: BigInt(args.rawTxn.expiration_timestamp_secs),
            cause: args.cause,
            waitError,
        });
    if (args.waitOptions === undefined) {
        throw unknown();
    }
    try {
        return await waitForTransactionInternal({ transactionHash: args.hash, options: args.waitOptions }, config);
    } catch (waitError) {
        if (waitError instanceof SupraTransactionTimeoutError) {
            throw unknown(waitError);
        }
        throw waitError;
    }
}

/**
 * Submits a signed transaction, simulating it first with `enableTransactionSimulation`, and waits as the options say.
 * A refusal for a gas unit price below the node's minimum, by the simulation or the submission, throws
 * `SupraGasUnitPriceBelowMinimumError`; the read of the node's minimum for it is made here. The helpers that call this
 * while they hold the account's lock set `deferGasPriceRefusalMapping` and map the error after they have released the
 * lock (`mapCallGasUnitPriceRefusalInternal`). A submission whose outcome is unknown
 * (`SupraSubmissionOutcomeUnknownError`) and the errors of the wait after an accepted submission are not refusals and
 * are thrown as they are.
 */
export async function submitTxnInternal(
    args: {
        sendTxJsonPayload: SendTxnPayload;
        enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs;
        deferGasPriceRefusalMapping?: boolean;
        /**
         * Called with the raw transaction that is about to be sent, after the simulation before submission, which can
         * sign the transaction again with a lower sequence number.
         */
        onSubmission?: ((rawTxn: RawTxnJSON) => void) | undefined;
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
        onSubmission?: ((rawTxn: RawTxnJSON) => void) | undefined;
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
    // The hash of the signed transaction the payload was made from (after a re-sign, of the new one), known before the
    // submission request.
    const derivedHash = transactionHashOf(payload);
    if (derivedHash === undefined) {
        throw new Error("A submitted payload carries the hash of its signed transaction (withTransactionHash)");
    }
    const wait = (options.enableWaitForTransaction ?? DEFAULT_WAIT_FOR_TX_COMPLETION) === true;
    const waitOptions: WaitForTransactionOptions = { checkSuccess: options.checkSuccess ?? true };
    if (options.waitTimeoutMs !== undefined) {
        waitOptions.timeoutMs = options.waitTimeoutMs;
    }

    args.onSubmission?.(rawTxn);

    let answer: unknown;
    try {
        answer = await post<SendTxnPayload, unknown>(
            {
                path: "/transactions/submit",
                data: payload,
            },
            config,
        );
    } catch (error) {
        if (isUnreadableAcceptance(error)) {
            // The node accepted the transaction with a 2xx status, and its body is not JSON.
            answer = undefined;
        } else {
            const settled = settleFailedSubmissionInternal({ rawTxn, reservation, hash: derivedHash }, error, config);
            if (!settled.mayHaveAccepted) {
                // A refusal, including one for a price below the node's minimum: the number is handed out again.
                throw settled.error;
            }
            // The node may have accepted the transaction, which is recorded with the derived hash.
            return await unknownSubmissionOutcomeInternal(
                { rawTxn, hash: derivedHash, cause: settled.error, waitOptions: wait ? waitOptions : undefined },
                config,
            );
        }
    }
    // The node accepted the transaction. Its answer is the transaction's hash; an answer that is not a hash (an empty
    // or non-string body) is replaced by the derived hash.
    const txHash = isTransactionHash(answer) ? answer : derivedHash;
    // The record keeps the number from the counter until the transaction has committed or can no longer commit.
    tracker.record(rawTxn.sender, rawTxn.sequence_number, rawTxn.expiration_timestamp_secs, txHash);
    if (reservation !== undefined) {
        tracker.release(reservation);
    }

    // From here on the node has accepted the transaction: the errors of the wait carry `txHash`, and a failed read
    // returns it. A read that returns `Invalid` drops the record (`getTransactionByHashInternal`).
    if (wait) {
        return await waitForTransactionInternal({ transactionHash: txHash, options: waitOptions }, config);
    }

    try {
        return await getTransactionByHashInternal({ transactionHash: txHash, exclude_uncommitted: false }, config);
    } catch (readError) {
        return { hash: txHash, status: "NotReadBack", readError };
    }
}

/**
 * Whether the error of a submission request is the node's acceptance with a 2xx status whose body is not JSON:
 * `parseJsonResponse` reports such a body as a `SupraAPIError` with the 2xx status.
 */
function isUnreadableAcceptance(error: unknown): boolean {
    return error instanceof SupraAPIError && error.status >= 200 && error.status < 300;
}

/** Whether the node's answer to a submission is a transaction hash: `0x` followed by 64 hex digits. */
function isTransactionHash(answer: unknown): answer is string {
    return typeof answer === "string" && /^0x[0-9a-fA-F]{64}$/.test(answer);
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
    return buildAndSubmitInternal(
        {
            senderAccount: args.senderAccount,
            buildRawTxn: (senderSequenceNumber, optionalTransactionPayloadArgs) =>
                rawTxnObjectInternal(
                    {
                        ...args.payload,
                        senderAddress: args.senderAccount.address(),
                        senderSequenceNumber,
                        optionalTransactionPayloadArgs,
                    },
                    config,
                ),
            optionalTransactionArgs: args.optionalTransactionArgs,
        },
        config,
    );
}

/**
 * Builds, signs and submits the transaction that `buildRawTxn` makes, for the helpers of `senderAccount`, with the
 * sequence number, lock, gas, simulation and wait behaviour described for `buildAndSubmitEntryFunctionInternal`.
 * `buildRawTxn` is called with the sequence number and the resolved gas settings, and again with another max gas when
 * the estimate simulates the transaction. `onSubmission` is called with the raw transaction that is sent.
 */
export async function buildAndSubmitInternal(
    args: {
        senderAccount: SupraAccount;
        buildRawTxn: (
            senderSequenceNumber: bigint,
            optionalTransactionPayloadArgs: OptionalTransactionPayloadArgs,
        ) => TxnBuilderTypes.RawTransaction;
        /** Builds the transaction the max gas estimate simulates, when that is not the one that is sent. */
        buildEstimateRawTxn?:
            | ((
                  senderSequenceNumber: bigint,
                  optionalTransactionPayloadArgs: OptionalTransactionPayloadArgs,
              ) => TxnBuilderTypes.RawTransaction)
            | undefined;
        optionalTransactionArgs?: OptionalTransactionArgs | undefined;
        onSubmission?: ((rawTxn: RawTxnJSON) => void) | undefined;
    },
    config: NetworkConfig,
): Promise<SubmitTransactionResponse> {
    const senderAddress = args.senderAccount.address();
    const buildEstimate = args.buildEstimateRawTxn;
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
                    buildRawTxn: (options) => args.buildRawTxn(senderSequenceNumber, options),
                    buildEstimateRawTxn:
                        buildEstimate === undefined
                            ? undefined
                            : (options) => buildEstimate(senderSequenceNumber, options),
                },
                config,
            );
            // The payload that is sent, with the simulation form of the transaction when it has one.
            const signWithSimulationForm = async (signedRawTxn: TxnBuilderTypes.RawTransaction) => {
                const payload = await sendTxnPayloadInternal(
                    { senderAccount: args.senderAccount, rawTxn: signedRawTxn },
                    config,
                );
                if (buildEstimate !== undefined) {
                    const form = buildEstimate(signedRawTxn.sequence_number, {
                        ...optionalTransactionPayloadArgs,
                        maxGas: signedRawTxn.max_gas_amount,
                        gasUnitPrice: signedRawTxn.gas_unit_price,
                        txExpiryTime: signedRawTxn.expiration_timestamp_secs,
                    });
                    bindSimulationForm(
                        payload,
                        await sendTxnPayloadInternal({ senderAccount: args.senderAccount, rawTxn: form }, config),
                    );
                }
                return payload;
            };
            const sendTxPayload = await signWithSimulationForm(rawTxn);
            if (reservation !== undefined) {
                bindReservation(sendTxPayload, reservation, (sequenceNumber) =>
                    signWithSimulationForm(withSequenceNumber(rawTxn, sequenceNumber)),
                );
            }
            return await submitTxnInternal(
                {
                    sendTxJsonPayload: sendTxPayload,
                    enableTransactionWaitAndSimulationArgs:
                        args.optionalTransactionArgs?.enableTransactionWaitAndSimulationArgs ?? {},
                    deferGasPriceRefusalMapping: true,
                    onSubmission: args.onSubmission,
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
    const publicKey = hexBytesOf(args.senderPubkey, "senderPubkey");
    const signature = hexBytesOf(args.signature, "signature");
    const rawTxn = TxnBuilderTypes.RawTransaction.deserialize(new BCS.Deserializer(args.serializedRawTransaction));
    const sendTxPayload = withTransactionHash(
        {
            Move: {
                raw_txn: getRawTxnJSONInternal(rawTxn),
                authenticator: {
                    Ed25519: {
                        public_key: args.senderPubkey.toString(),
                        signature: args.signature.toString(),
                    },
                },
            },
        },
        rawTxn,
        ed25519TransactionAuthenticator(publicKey, signature),
    );

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

    const sendTxPayload = withTransactionHash(
        {
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
        },
        args.rawTxn,
        new TxnBuilderTypes.TransactionAuthenticatorFeePayer(
            args.senderAuthenticator,
            args.secondarySignersAccountAddress.map(accountAddressOf),
            args.secondarySignersAuthenticator,
            { address: accountAddressOf(args.feePayerAddress), authenticator: args.feePayerAuthenticator },
        ),
    );

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

    const sendTxPayload = withTransactionHash(
        {
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
        },
        args.rawTxn,
        new TxnBuilderTypes.TransactionAuthenticatorMultiAgent(
            args.senderAuthenticator,
            args.secondarySignersAccountAddress.map(accountAddressOf),
            args.secondarySignersAuthenticator,
        ),
    );

    return await submitTxnInternal(
        {
            sendTxJsonPayload: sendTxPayload,
            enableTransactionWaitAndSimulationArgs: args.enableTransactionWaitAndSimulationArgs ?? {},
        },
        config,
    );
}

/**
 * The bytes of a public key or signature passed as hex, for the hash of the signed transaction.
 * @throws {RangeError} If the value, after its `0x` prefix, is not hex digits in pairs
 */
function hexBytesOf(value: HexString, name: string): Uint8Array {
    const digits = String(value).replace(/^0x/, "");
    if (!/^(?:[0-9a-fA-F]{2})*$/.test(digits)) {
        throw new RangeError(`${name} must be hex digits in pairs after an optional 0x, got ${String(value)}`);
    }
    return new HexString(digits).toUint8Array();
}

/**
 * The address of a secondary signer or a fee payer, for the hash of the signed transaction.
 * @throws {RangeError} If the address, after an optional `0x` or `0X` prefix, is not 1 to 64 hex digits
 */
function accountAddressOf(address: AccountAddressInput): TxnBuilderTypes.AccountAddress {
    return new TxnBuilderTypes.AccountAddress(addressToBytes(address));
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
