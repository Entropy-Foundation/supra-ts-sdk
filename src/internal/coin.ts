import { BCS, HexString, TypeTagParser, type SupraAccount } from "supra-l1-sdk-core";
import type { AccountAddressInput } from "../types/account";
import type { OptionalTransactionArgs, SubmitTransactionResponse } from "../types/transactionManager/transactionSubmit";
import type { NetworkConfig } from "../utils/apiEndpoints";
import { DEFAULT_MAX_GAS_FOR_SUPRA_TRANSFER_WHEN_RECEIVER_EXISTS, DEFAULT_MAX_GAS_FOR_SUPRA_TRANSFER_WHEN_RECEIVER_NOT_EXISTS, SUPRA_FRAMEWORK_ADDRESS } from "../utils/constants";
import { getAccountResourceInternal, isAccountExistsInternal } from "./account";
import { bindReservation, releaseSequenceNumberInternal, reserveSequenceNumberInternal } from "./sequenceNumber";
import type { MoveFunctionId } from "../types/move";
import type { SendTxnPayload } from "../types/transactionManager/transactionBuild";
import { rawTxnObjectInternal, sendTxnPayloadInternal } from "./transactionManager/txnBuild";
import { submitTxnInternal, validateSubmitOptions } from "./transactionManager/txnSubmit";
import type { CoinInfo } from "../types/coin";

export async function transferCoinInternal(
    args: {
        senderAccount: SupraAccount,
        receiverAccountAddress: AccountAddressInput,
        amount: number | bigint,
        coinType: MoveFunctionId,
        optionalTransactionArgs?: OptionalTransactionArgs,
    },
    config: NetworkConfig
): Promise<SubmitTransactionResponse> {

    let receiverAccountAddress = typeof args.receiverAccountAddress === "string" ? new HexString(args.receiverAccountAddress.toString()) : args.receiverAccountAddress;

    if (args.coinType == "0x1::supra_coin::SupraCoin" && args.optionalTransactionArgs?.optionalTransactionPayloadArgs &&
        !args.optionalTransactionArgs?.optionalTransactionPayloadArgs?.maxGas) {

        let maxGas = BigInt(
            DEFAULT_MAX_GAS_FOR_SUPRA_TRANSFER_WHEN_RECEIVER_EXISTS,
        );
        if ((await isAccountExistsInternal({ accountAddress: receiverAccountAddress }, config)) === false) {
            maxGas = BigInt(
                DEFAULT_MAX_GAS_FOR_SUPRA_TRANSFER_WHEN_RECEIVER_NOT_EXISTS,
            );
        }
        args.optionalTransactionArgs.optionalTransactionPayloadArgs.maxGas = maxGas;

    }

    const explicitSequenceNumber = args.optionalTransactionArgs?.optionalTransactionPayloadArgs?.sequenceNumber;
    validateSubmitOptions(args.optionalTransactionArgs?.enableTransactionWaitAndSimulationArgs ?? {});
    const { sequenceNumber: senderSequenceNumber, reservation } = await reserveSequenceNumberInternal({ address: args.senderAccount.address(), sequenceNumber: explicitSequenceNumber }, config);

    // Coin Transfer Payload
    let supraTransferPayload = {
        senderAddress: args.senderAccount.address(),
        senderSequenceNumber,
        function: `${SUPRA_FRAMEWORK_ADDRESS}::supra_account::transfer_coins` as MoveFunctionId,
        functionTypeArgs: [new TypeTagParser(args.coinType).parseTypeTag()],
        functionArgs: [receiverAccountAddress.toUint8Array(), BCS.bcsSerializeUint64(args.amount)]
    }

    let sendTxPayload: SendTxnPayload;
    try {
        let raw_txn = rawTxnObjectInternal(supraTransferPayload, config);
        sendTxPayload = await sendTxnPayloadInternal({ senderAccount: args.senderAccount, rawTxn: raw_txn }, config);
    } catch (error) {
        // The transaction was not submitted, so a number from the counter is not used.
        if (reservation !== undefined) {
            releaseSequenceNumberInternal(reservation, config);
        }
        throw error;
    }
    if (reservation !== undefined) {
        bindReservation(sendTxPayload, reservation);
    }

    return await submitTxnInternal({
        sendTxJsonPayload: sendTxPayload,
        enableTransactionWaitAndSimulationArgs: args.optionalTransactionArgs?.enableTransactionWaitAndSimulationArgs ?? {},
    }, config);
}


export async function getCoinInfoInternal(args: { coinType: MoveFunctionId }, config: NetworkConfig): Promise<CoinInfo> {
    return await getAccountResourceInternal({
        accountAddress: new HexString(args.coinType.split("::")[0]!),
        resourceType: `${SUPRA_FRAMEWORK_ADDRESS}::coin::CoinInfo<${args.coinType}>`,
    }, config).then(res => {
        return {
            name: res.data.name,
            symbol: res.data.symbol,
            decimals: res.data.decimals,
        }
    });
}