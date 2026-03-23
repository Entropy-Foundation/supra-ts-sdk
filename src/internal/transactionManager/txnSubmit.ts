import { BCS, HexString, TxnBuilderTypes, type SupraAccount } from "supra-l1-sdk-core";
import { post } from "../../client/post";
import type { TransactionResponse } from "../../types/transaction";
import type { SendTxnPayload } from "../../types/transactionManager/transactionBuild";
import type { EnableTransactionWaitAndSimulationArgs } from "../../types/transactionManager/transactionSubmit";
import type { NetworkConfig } from "../../utils/apiEndpoints";
import { DEFAULT_ENABLE_SIMULATION, DEFAULT_TXN_TIMEOUT_SEC } from "../../utils/constants";
import { getTransactionByHashInternal, waitForTransactionInternal } from "../transaction";
import { simulateTxnInternal } from "./txnSimulate";
import { getRawTxnJSONInternal, sendTxnPayloadInternal } from "./txnBuild";
import type { AccountAddressInput } from "../../types/account";
import type { Ed25519Signature } from "../../types/move";

export async function submitTxnInternal(
    args: {
        sendTxJsonPayload: SendTxnPayload,
        enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs,
    },
    config: NetworkConfig
): Promise<TransactionResponse> {
    if (
        (args.enableTransactionWaitAndSimulationArgs?.enableTransactionSimulation ??
            DEFAULT_ENABLE_SIMULATION) === true
    ) {
        // eslint-disable-next-line no-console
        console.log("Simulating transaction...");
        await simulateTxnInternal({ sendTxPayload: args.sendTxJsonPayload }, config);
    }

    // eslint-disable-next-line no-console
    console.log("Submitting transaction...");

    let txHash = await post<SendTxnPayload, string>({
        path: "/transactions/submit",
        data: args.sendTxJsonPayload,
    }, config).then(res => res);

    // wait for transaction
    if (!args.enableTransactionWaitAndSimulationArgs?.enableWaitForTransaction) {
        return await getTransactionByHashInternal({ transactionHash: txHash, exclude_uncommitted: false }, config);
    }

    return await waitForTransactionInternal({
        transactionHash: txHash,
        options: {
            timeoutSecs: DEFAULT_TXN_TIMEOUT_SEC,
            checkSuccess: false,
        },
    }, config);
}


export async function submitSerializedRawTransactionInternal(
    args: {
        senderAccount: SupraAccount,
        serializedRawTransaction: Uint8Array,
        enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs,
    },
    config: NetworkConfig
): Promise<TransactionResponse> {
    let sendTxPayload = sendTxnPayloadInternal(
        {
            senderAccount: args.senderAccount,
            rawTxn: TxnBuilderTypes.RawTransaction.deserialize(
                new BCS.Deserializer(args.serializedRawTransaction),
            )
        }
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
): Promise<TransactionResponse> {
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
): Promise<TransactionResponse> {
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
): Promise<TransactionResponse> {
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
            public_key: Buffer.from(authenticator.public_key.value).toString("hex"),
            signature: Buffer.from(authenticator.signature.value).toString("hex"),
        },
    };
}