// Portions of this file are derived from @aptos-labs/ts-sdk (https://github.com/aptos-labs/aptos-ts-sdk),
// Copyright © Aptos Foundation, licensed under the Apache License, Version 2.0. See NOTICE.
import { BCS, HexString, SupraAccount, TxnBuilderTypes, type AnyRawTransaction } from "supra-l1-sdk-core";
import { U64_FIELDS } from "../client/exactU64";
import { get } from "../client/get";
import { post } from "../client/post";
import { SupraError } from "../errors/supraError";
import { SupraTransactionFailedError, SupraTransactionTimeoutError } from "../errors/transactionError";
import { standardizeAddress } from "../helper/account";
import type { AccountAddressInput } from "../types/account";
import {
    TransactionStatus,
    type CommittedTransactionResponse,
    type Settlement,
    type SettlementDomain,
    type SettlementRole,
    type SettlementsPage,
    type TransactionQueryType,
    type TransactionResponse,
    type TransactionsByHashesResponse,
    type WaitForTransactionOptions,
} from "../types/transaction";
import type { NetworkConfig } from "../utils/apiEndpoints";
import {
    DEFAULT_TXN_WAIT_TIMEOUT_MS,
    RAW_TRANSACTION_SALT,
    RAW_TRANSACTION_WITH_DATA_SALT,
    SUPRA_FRAMEWORK_ADDRESS,
} from "../utils/constants";
import { sleep } from "../utils/functions";
import type { OptionalTransactionArgs, SubmitTransactionResponse } from "../types/transactionManager/transactionSubmit";
import { buildAndSubmitEntryFunctionInternal } from "./transactionManager/txnSubmit";
import { checkChainIdBeforeSigningInternal } from "./chainId";
import { checkExpiryBeforeSigningInternal } from "./txExpiry";
import { sequenceNumberTrackerOf } from "./sequenceNumber";
import { V4_RPC_VERSION, withV4RouteSupport } from "./routeSupport";
import sha3 from "js-sha3";

/**
 * Queries on-chain transactions by their transaction hash, returning both pending and committed transactions.
 *
 * The status read is reported to the client's sequence-number counter: `Invalid` for a transaction that this client
 * submitted drops its record, so its number is handed out again; `Success` or `Fail` shows the sender's sequence number
 * on the chain above its number.
 */
export async function getTransactionByHashInternal(
    args: { transactionHash: string; type?: TransactionQueryType; exclude_uncommitted?: boolean },
    config: NetworkConfig,
): Promise<TransactionResponse> {
    const transactionHash = standardizeAddress(args.transactionHash);
    const transaction = await get<TransactionResponse>(
        {
            path: `/transactions/${transactionHash}`,
            query: {
                type: args.type,
                exclude_uncommitted: args.exclude_uncommitted,
            },
            u64Fields: U64_FIELDS.transaction,
        },
        config,
    ).then((res) => res.data);
    sequenceNumberTrackerOf(config).observeTransaction(transactionHash, transaction.status);
    return transaction;
}

/**
 * Looks up several transactions with `POST /rpc/v4/transactions/by_hashes`. A 404 is thrown as
 * `SupraRouteUnsupportedError`.
 *
 * Each transaction found is reported to the client's sequence-number counter as `getTransactionByHashInternal`
 * reports one.
 */
export async function getTransactionsByHashesInternal(
    args: {
        transactionHashes: string[];
        type?: TransactionQueryType;
        exclude_uncommitted?: boolean;
        include_proof?: boolean;
    },
    config: NetworkConfig,
): Promise<TransactionsByHashesResponse> {
    const query = new URLSearchParams();
    if (args.type !== undefined) {
        query.set("type", args.type);
    }
    if (args.exclude_uncommitted !== undefined) {
        query.set("exclude_uncommitted", String(args.exclude_uncommitted));
    }
    if (args.include_proof !== undefined) {
        query.set("include_proof", String(args.include_proof));
    }
    const queryString = query.toString();

    const response = await withV4RouteSupport({ method: "getTransactionsByHashes" }, () =>
        post<{ hashes: string[] }, TransactionsByHashesResponse>(
            {
                path: `/transactions/by_hashes${queryString === "" ? "" : `?${queryString}`}`,
                data: { hashes: args.transactionHashes.map((hash) => standardizeAddress(hash)) },
                u64Fields: U64_FIELDS.transactionsByHashes,
            },
            config,
            V4_RPC_VERSION,
        ),
    );
    const tracker = sequenceNumberTrackerOf(config);
    for (const entry of response.transactions) {
        if (entry.transaction !== null) {
            tracker.observeTransaction(entry.hash, entry.transaction.status);
        }
    }
    return response;
}

/** Reads `GET /rpc/v4/transactions/settlements/{settlement_id}`. */
export async function getSettlementInternal(
    args: { settlementId: string },
    config: NetworkConfig,
): Promise<Settlement> {
    return withV4RouteSupport({ method: "getSettlement", handlerNotFoundFor: args.settlementId }, () =>
        get<Settlement>(
            { path: `/transactions/settlements/${args.settlementId}`, u64Fields: U64_FIELDS.settlement },
            config,
            V4_RPC_VERSION,
        ).then((res) => res.data),
    );
}

/**
 * The address of a settlements query in the form the node takes: `0x` and the hexadecimal digits, left-padded with
 * zeros to the domain's width (32 bytes for `"move"`, 20 for `"evm"`) and in lower case.
 */
export function settlementAddressOf(address: AccountAddressInput, domain: SettlementDomain): string {
    const digits = String(address).replace(/^0x/i, "").toLowerCase();
    return `0x${digits.padStart(domain === "move" ? 64 : 40, "0")}`;
}

/**
 * Reads `GET /rpc/v4/transactions/settlements`. The feed ends only when the response has no `x-supra-cursor`
 * header: a page can be empty and carry a cursor.
 */
export async function getSettlementsInternal(
    args: {
        address: AccountAddressInput;
        domain: SettlementDomain;
        options?: { role?: SettlementRole; count?: number; start?: string | undefined };
    },
    config: NetworkConfig,
): Promise<SettlementsPage> {
    const start = args.options?.start;
    const { data, cursor, headers } = await withV4RouteSupport({ method: "getSettlements" }, () =>
        get<{ data: Settlement[] }>(
            {
                path: "/transactions/settlements",
                query: {
                    address: settlementAddressOf(args.address, args.domain),
                    domain: args.domain,
                    role: args.options?.role,
                    count: args.options?.count,
                    start: start === undefined || start === "" ? undefined : start,
                },
                u64Fields: U64_FIELDS.settlements,
            },
            config,
            V4_RPC_VERSION,
        ),
    );
    const oldest = headers?.get("x-supra-oldest-block");
    return {
        response: data.data,
        cursor: cursor === undefined || cursor === "" ? undefined : cursor,
        oldestBlock: oldest !== undefined && oldest !== null && /^\d+$/.test(oldest) ? Number(oldest) : undefined,
    };
}

/**
 * Whether a transaction status is final. `Success`, `Fail` and `Invalid` are final; `Pending` (accepted by the RPC
 * node, not executed yet) and `PendingAfterExecution` (executed with a status that may change in a later execution)
 * are not.
 */
export function isFinalTransactionStatus(status: TransactionStatus): boolean {
    return (
        status === TransactionStatus.Success ||
        status === TransactionStatus.Fail ||
        status === TransactionStatus.Invalid
    );
}

/**
 * Whether the transaction has no final status yet: its status is `Pending` or `PendingAfterExecution`.
 */
export async function isPendingTransactionInternal(
    args: { transactionHash: string },
    config: NetworkConfig,
): Promise<boolean> {
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
        options?: WaitForTransactionOptions;
    },
    config: NetworkConfig,
): Promise<CommittedTransactionResponse> {
    const timeoutMs = waitTimeoutMsOf(args.options, config);
    const checkSuccess = args.options?.checkSuccess ?? true;
    const deadline = Date.now() + timeoutMs;

    let lastTxn: TransactionResponse | undefined;
    let lastError: unknown;
    let backoffIntervalMs = 200;
    const backoffMultiplier = 1.5;
    const maxBackoffMs = 5000;

    for (;;) {
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

export function getTransactionSignatureMessageInternal(args: { rawTxn: AnyRawTransaction }): Uint8Array {
    let preHash = Uint8Array.from(
        sha3.sha3_256.array(
            args.rawTxn instanceof TxnBuilderTypes.RawTransaction
                ? RAW_TRANSACTION_SALT
                : RAW_TRANSACTION_WITH_DATA_SALT,
        ),
    );

    let rawTxSerializedData = new Uint8Array(BCS.bcsToBytes(args.rawTxn));
    let signatureMessage = new Uint8Array(preHash.length + rawTxSerializedData.length);
    signatureMessage.set(preHash);
    signatureMessage.set(rawTxSerializedData, preHash.length);
    return signatureMessage;
}

/**
 * Signs a raw, multi-agent or fee-payer transaction. Every signature of the SDK is made here, after
 * {@link checkChainIdBeforeSigningInternal} and {@link checkExpiryBeforeSigningInternal}.
 * @throws {SupraChainIdMismatchError} Before signing, if the configured chain ID or the transaction's chain ID is not
 * the node's.
 * @throws {RangeError} Before signing, if the transaction's expiration time is more than the node's maximum time to
 * live after the client's clock.
 */
export function signTransactionInternal(
    args: {
        senderAccount: SupraAccount;
        rawTxn: TxnBuilderTypes.RawTransaction;
    },
    config: NetworkConfig,
): Promise<HexString>;
export function signTransactionInternal(
    args: {
        senderAccount: SupraAccount;
        rawTxn: TxnBuilderTypes.MultiAgentRawTransaction | TxnBuilderTypes.FeePayerRawTransaction;
    },
    config: NetworkConfig,
): Promise<TxnBuilderTypes.AccountAuthenticatorEd25519>;
export function signTransactionInternal(
    args: {
        senderAccount: SupraAccount;
        rawTxn: AnyRawTransaction;
    },
    config: NetworkConfig,
): Promise<HexString | TxnBuilderTypes.AccountAuthenticatorEd25519>;
export async function signTransactionInternal(
    args: {
        senderAccount: SupraAccount;
        rawTxn: AnyRawTransaction;
    },
    config: NetworkConfig,
): Promise<HexString | TxnBuilderTypes.AccountAuthenticatorEd25519> {
    // The reads of the node's chain ID and maximum time to live run together; a chain ID mismatch is reported first.
    const expiryCheck = checkExpiryBeforeSigningInternal(args.rawTxn, config);
    expiryCheck.catch(() => undefined);
    await checkChainIdBeforeSigningInternal(args.rawTxn, config);
    await expiryCheck;

    let signatureBuffer = args.senderAccount.signBuffer(
        getTransactionSignatureMessageInternal({ rawTxn: args.rawTxn }),
    );

    // multi transaction
    if (
        args.rawTxn instanceof TxnBuilderTypes.MultiAgentRawTransaction ||
        args.rawTxn instanceof TxnBuilderTypes.FeePayerRawTransaction
    ) {
        const signerSignature = new TxnBuilderTypes.Ed25519Signature(signatureBuffer.toUint8Array());
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
        senderAccount: SupraAccount;
        packageMetadata: Uint8Array;
        modulesCode: Uint8Array[];
        optionalTransactionArgs?: OptionalTransactionArgs;
    },
    config: NetworkConfig,
): Promise<SubmitTransactionResponse> {
    let codeSerializer = new BCS.Serializer();
    let modulesTypeCode: TxnBuilderTypes.Module[] = [];

    args.modulesCode.map((module) => {
        modulesTypeCode.push(new TxnBuilderTypes.Module(Uint8Array.from(module)));
    });

    BCS.serializeVector(modulesTypeCode, codeSerializer);

    const publishPayload = {
        function: `${SUPRA_FRAMEWORK_ADDRESS}::code::publish_package_txn` as const,
        functionTypeArgs: [],
        functionArgs: [BCS.bcsSerializeBytes(args.packageMetadata), codeSerializer.getBytes()],
    };

    return await buildAndSubmitEntryFunctionInternal(
        {
            senderAccount: args.senderAccount,
            payload: publishPayload,
            optionalTransactionArgs: args.optionalTransactionArgs,
        },
        config,
    );
}
