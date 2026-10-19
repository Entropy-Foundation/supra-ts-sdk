import { BCS, HexString, SupraAccount, TxnBuilderTypes, type AnyRawTransaction } from "supra-l1-sdk-core";
import { get } from "../client/get";
import { SupraError } from "../errors/supraError";
import { SupraTransactionFailedError, SupraTransactionTimeoutError } from "../errors/transactionError";
import { standardizeAddress } from "../helper/account";
import { TransactionStatus, type CommittedTransactionResponse, type TransactionQueryType, type TransactionResponse, type WaitForTransactionOptions } from "../types/transaction";
import type { NetworkConfig } from "../utils/apiEndpoints";
import { DEFAULT_TXN_WAIT_TIMEOUT_MS, RAW_TRANSACTION_SALT, RAW_TRANSACTION_WITH_DATA_SALT, SUPRA_FRAMEWORK_ADDRESS } from "../utils/constants";
import { sleep } from "../utils/functions";
import type { OptionalTransactionArgs, SubmitTransactionResponse } from "../types/transactionManager/transactionSubmit";
import { rawTxnObjectInternal, sendTxnPayloadInternal } from "./transactionManager/txnBuild";
import { reserveSequenceNumberInternal } from "./sequenceNumber";
import { submitTxnInternal } from "./transactionManager/txnSubmit";
import { checkChainIdBeforeSigningInternal } from "./chainId";
import sha3 from 'js-sha3';

/**
 * Queries on-chain transactions by their transaction hash, returning both pending and committed transactions.
 */
export async function getTransactionByHashInternal<T extends TransactionResponse>(
    args: { transactionHash: string, type?: TransactionQueryType, exclude_uncommitted?: boolean },
    config: NetworkConfig
): Promise<T> {

    return await get<T>({
        path: `/transactions/${standardizeAddress(args.transactionHash)}`,
        query: {
            type: args.type,
            exclude_uncommitted: args.exclude_uncommitted
        }
    }, config).then(res => res.data);
}


/**
 * Whether a transaction status is final. `Success`, `Fail` and `Invalid` are final; `Pending` (accepted by the RPC
 * node, not executed yet) and `PendingAfterExecution` (executed with a status that may change in a later execution)
 * are not.
 */
export function isFinalTransactionStatus(status: TransactionStatus): boolean {
    return status === TransactionStatus.Success || status === TransactionStatus.Fail || status === TransactionStatus.Invalid;
}


/**
 * Whether the transaction has no final status yet: its status is `Pending` or `PendingAfterExecution`.
 */
export async function isPendingTransactionInternal(args: { transactionHash: string }, config: NetworkConfig): Promise<boolean> {
    return !isFinalTransactionStatus((await getTransactionByHashInternal(args, config)).status);
}


/** Validates a wait timeout: a finite number of milliseconds, zero or more. */
export function validateWaitTimeoutMs(timeoutMs: number, name: string): number {
    if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs < 0) {
        throw new RangeError(`${name} must be a finite, non-negative number of milliseconds, got ${timeoutMs}`);
    }
    return timeoutMs;
}


/** The wait timeout of a call: `timeoutMs`, else `timeoutSecs`, else the client's `waitTimeoutMs`, else the default. */
function waitTimeoutMsOf(options: WaitForTransactionOptions | undefined, config: NetworkConfig): number {
    if (options?.timeoutMs !== undefined) {
        return validateWaitTimeoutMs(options.timeoutMs, "timeoutMs");
    }
    if (options?.timeoutSecs !== undefined) {
        return validateWaitTimeoutMs(options.timeoutSecs * 1000, "timeoutSecs");
    }
    return config.waitTimeoutMs ?? DEFAULT_TXN_WAIT_TIMEOUT_MS;
}


/**
 * Reads the transaction until it has a final status or the timeout elapses.
 *
 * The transaction is read again while its status is `Pending` or `PendingAfterExecution` and while a read fails
 * (including HTTP 404 for a transaction the node has not seen yet). The timeout is measured in wall-clock time from
 * the start of the call; a read in progress when it elapses is not interrupted.
 *
 * - `Success`: the transaction is returned.
 * - `Fail` or `Invalid`: `SupraTransactionFailedError` is thrown, or the transaction is returned when `checkSuccess`
 *   is false.
 * - No final status within the timeout: `SupraTransactionTimeoutError` is thrown with the hash, the last transaction
 *   read, and the error of the last read as `cause` when that read failed.
 */
export async function waitForTransactionInternal(
    args: {
        transactionHash: string;
        options?: WaitForTransactionOptions
    },
    config: NetworkConfig
): Promise<CommittedTransactionResponse> {
    const timeoutMs = waitTimeoutMsOf(args.options, config);
    const checkSuccess = args.options?.checkSuccess ?? true;
    const deadline = Date.now() + timeoutMs;

    let lastTxn: TransactionResponse | undefined;
    let lastError: unknown;
    let backoffIntervalMs = 200;
    const backoffMultiplier = 1.5;
    const maxBackoffMs = 5000;

    for (; ;) {
        try {
            lastTxn = await getTransactionByHashInternal({ transactionHash: args.transactionHash }, config);
            lastError = undefined;
        } catch (error) {
            // Every error of a request is a SupraError; anything else is not a failed read.
            if (!(error instanceof SupraError)) {
                throw error;
            }
            lastError = error;
        }

        if (lastError === undefined && lastTxn !== undefined && isFinalTransactionStatus(lastTxn.status)) {
            if (checkSuccess && lastTxn.status !== TransactionStatus.Success) {
                throw new SupraTransactionFailedError(lastTxn);
            }
            return lastTxn as CommittedTransactionResponse;
        }

        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
            throw new SupraTransactionTimeoutError({
                hash: args.transactionHash,
                timeoutMs,
                transaction: lastTxn,
                cause: lastError,
            });
        }

        await sleep(Math.min(backoffIntervalMs, remainingMs));
        backoffIntervalMs = Math.min(backoffIntervalMs * backoffMultiplier, maxBackoffMs);
    }
}


export function getTransactionSignatureMessageInternal(
    args: {
        rawTxn: AnyRawTransaction,
    }
): Uint8Array {
    let preHash = Uint8Array.from(
        sha3.sha3_256.array(
            args.rawTxn instanceof TxnBuilderTypes.RawTransaction
                ? RAW_TRANSACTION_SALT
                : RAW_TRANSACTION_WITH_DATA_SALT,
        ),
    );

    let rawTxSerializedData = new Uint8Array(BCS.bcsToBytes(args.rawTxn));
    let signatureMessage = new Uint8Array(
        preHash.length + rawTxSerializedData.length,
    );
    signatureMessage.set(preHash);
    signatureMessage.set(rawTxSerializedData, preHash.length);
    return signatureMessage;
}


/**
 * Signs a raw, multi-agent or fee-payer transaction. Every signature of the SDK is made here, after
 * {@link checkChainIdBeforeSigningInternal}.
 * @throws {SupraChainIdMismatchError} Before signing, if the configured chain ID or the transaction's chain ID is not
 * the node's.
 */
export async function signTransactionInternal(
    args: {
        senderAccount: SupraAccount,
        rawTxn: AnyRawTransaction,
    },
    config: NetworkConfig
): Promise<HexString | TxnBuilderTypes.AccountAuthenticatorEd25519> {
    await checkChainIdBeforeSigningInternal(args.rawTxn, config);

    let signatureBuffer = args.senderAccount.signBuffer(getTransactionSignatureMessageInternal({ rawTxn: args.rawTxn }));

    // multi transaction
    if (args.rawTxn instanceof TxnBuilderTypes.MultiAgentRawTransaction || args.rawTxn instanceof TxnBuilderTypes.FeePayerRawTransaction) {
        const signerSignature = new TxnBuilderTypes.Ed25519Signature(
            signatureBuffer.toUint8Array(),
        );
        return new TxnBuilderTypes.AccountAuthenticatorEd25519(
            new TxnBuilderTypes.Ed25519PublicKey(args.senderAccount.signingKey.publicKey),
            signerSignature,
        );
    }

    // raw transaction
    return signatureBuffer;
}


export async function publishPackageInternal(
    args: {
        senderAccount: SupraAccount,
        packageMetadata: Uint8Array,
        modulesCode: Uint8Array[],
        optionalTransactionArgs?: OptionalTransactionArgs,
    },
    config: NetworkConfig
): Promise<SubmitTransactionResponse> {
    let codeSerializer = new BCS.Serializer();
    let modulesTypeCode: TxnBuilderTypes.Module[] = [];

    args.modulesCode.map((module) => {
        modulesTypeCode.push(
            new TxnBuilderTypes.Module(Uint8Array.from(module)),
        );
    });

    BCS.serializeVector(modulesTypeCode, codeSerializer);

    let sendTxPayload = await sendTxnPayloadInternal({
        senderAccount: args.senderAccount,
        rawTxn: await rawTxnObjectInternal({
            senderAddress: args.senderAccount.address(),
            senderSequenceNumber: await reserveSequenceNumberInternal({ address: args.senderAccount.address(), sequenceNumber: args.optionalTransactionArgs?.optionalTransactionPayloadArgs?.sequenceNumber }, config),
            function: `${SUPRA_FRAMEWORK_ADDRESS}::code::publish_package_txn`,
            functionTypeArgs: [],
            functionArgs: [BCS.bcsSerializeBytes(args.packageMetadata), codeSerializer.getBytes()],
            optionalTransactionPayloadArgs: args.optionalTransactionArgs?.optionalTransactionPayloadArgs ?? {},
        }, config)
    }, config);

    return await submitTxnInternal({
        sendTxJsonPayload: sendTxPayload,
        enableTransactionWaitAndSimulationArgs: args.optionalTransactionArgs?.enableTransactionWaitAndSimulationArgs ?? {},
    }, config);
}


