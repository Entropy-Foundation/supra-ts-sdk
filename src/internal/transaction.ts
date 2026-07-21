import { BCS, HexString, SupraAccount, TxnBuilderTypes, type AnyRawTransaction } from "supra-l1-sdk-core";
import { get } from "../client/get";
import { SupraAPIError } from "../errors/apiError";
import { standardizeAddress } from "../helper/account";
import { TransactionStatus, type CommittedTransactionResponse, type TransactionQueryType, type TransactionResponse, type WaitForTransactionOptions } from "../types/transaction";
import type { NetworkConfig } from "../utils/apiEndpoints";
import { DEFAULT_TXN_TIMEOUT_SEC, RAW_TRANSACTION_SALT, RAW_TRANSACTION_WITH_DATA_SALT, SUPRA_FRAMEWORK_ADDRESS } from "../utils/constants";
import { sleep } from "../utils/functions";
import type { OptionalTransactionArgs } from "../types/transactionManager/transactionSubmit";
import { rawTxnObjectInternal, sendTxnPayloadInternal } from "./transactionManager/txnBuild";
import { getAccountInfoInternal } from "./account";
import { submitTxnInternal } from "./transactionManager/txnSubmit";
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
 * Queries on-chain transactions by their transaction hash, returning both pending and committed transactions.
 */
export async function isPendingTransactionInternal(args: { transactionHash: string }, config: NetworkConfig): Promise<boolean> {
    return (await getTransactionByHashInternal(args, config)).status === TransactionStatus.Pending
}


export async function waitForTransactionInternal(
    args: {
        transactionHash: string;
        options?: WaitForTransactionOptions
    },
    config: NetworkConfig
): Promise<CommittedTransactionResponse> {
    const timeoutSecs = args.options?.timeoutSecs ?? DEFAULT_TXN_TIMEOUT_SEC;
    const checkSuccess = args.options?.checkSuccess ?? true;

    let isPending = true;
    let timeElapsed = 0;
    let lastTxn: TransactionResponse | undefined;
    let backoffIntervalMs = 200;
    const backoffMultiplier = 1.5;
    const maxBackoffMs = 5000;

    while (isPending && timeElapsed < timeoutSecs) {
        let txn = await getTransactionByHashInternal({ transactionHash: args.transactionHash }, config);
        lastTxn = txn;
        isPending = txn.status === TransactionStatus.Pending;

        if (isPending) {
            await sleep(backoffIntervalMs);
            timeElapsed += backoffIntervalMs / 1000;
            backoffIntervalMs = Math.min(backoffIntervalMs * backoffMultiplier, maxBackoffMs);
        }
    }

    if (isPending) {
        throw new SupraAPIError({
            status: 500,
            statusText: "Transaction timed out",
            url: `/transactions/${args.transactionHash}`,
            data: lastTxn,

        });
    }

    if (!checkSuccess) {
        return lastTxn as CommittedTransactionResponse;
    }

    if (!lastTxn || lastTxn.status !== TransactionStatus.Success) {
        throw new SupraAPIError({
            status: 500,
            statusText: "Transaction failed",
            url: `/transactions/${args.transactionHash}`,
            data: lastTxn,

        });
    }

    return lastTxn as CommittedTransactionResponse;
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


export function signTransactionInternal(
    args: {
        senderAccount: SupraAccount,
        rawTxn: AnyRawTransaction,
    }
): HexString | TxnBuilderTypes.AccountAuthenticatorEd25519 {

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
): Promise<TransactionResponse> {
    let codeSerializer = new BCS.Serializer();
    let modulesTypeCode: TxnBuilderTypes.Module[] = [];

    args.modulesCode.map((module) => {
        modulesTypeCode.push(
            new TxnBuilderTypes.Module(Uint8Array.from(module)),
        );
    });

    BCS.serializeVector(modulesTypeCode, codeSerializer);

    let sendTxPayload = sendTxnPayloadInternal({
        senderAccount: args.senderAccount,
        rawTxn: await rawTxnObjectInternal({
            senderAddress: args.senderAccount.address(),
            senderSequenceNumber: (await getAccountInfoInternal({ accountAddress: args.senderAccount.address() }, config)).sequence_number,
            function: `${SUPRA_FRAMEWORK_ADDRESS}::code::publish_package_txn`,
            functionTypeArgs: [],
            functionArgs: [BCS.bcsSerializeBytes(args.packageMetadata), codeSerializer.getBytes()],
            optionalTransactionPayloadArgs: args.optionalTransactionArgs?.optionalTransactionPayloadArgs ?? {},
        }, config)
    });

    return await submitTxnInternal({
        sendTxJsonPayload: sendTxPayload,
        enableTransactionWaitAndSimulationArgs: args.optionalTransactionArgs?.enableTransactionWaitAndSimulationArgs ?? {},
    }, config);
}


