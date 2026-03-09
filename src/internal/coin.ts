import { BCS, HexString, TypeTagParser, type SupraAccount } from "supra-l1-sdk-core";
import type { AccountAddressInput } from "../types/account";
import type { OptionalTransactionArgs } from "../types/transactionManager/transactionSubmit";
import type { NetworkConfig } from "../utils/apiEndpoints";
import { DEFAULT_MAX_GAS_FOR_SUPRA_TRANSFER_WHEN_RECEIVER_EXISTS, DEFAULT_MAX_GAS_FOR_SUPRA_TRANSFER_WHEN_RECEIVER_NOT_EXISTS, SUPRA_FRAMEWORK_ADDRESS } from "../utils/constants";
import { getAccountInfoInternal, getAccountResourceInternal, isAccountExistsInternal } from "./account";
import type { MoveFunctionId } from "../types/move";
import { rawTxnObjectInternal, sendTxnPayloadInternal } from "./transactionManager/txnBuild";
import { submitTxnInternal } from "./transactionManager/txnSubmit";
import type { TransactionResponse } from "../types/transaction";
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
): Promise<TransactionResponse> {

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

    // Coin Transfer Payload
    let supraTransferPayload = {
        senderAddress: args.senderAccount.address(),
        senderSequenceNumber: (await getAccountInfoInternal({ accountAddress: args.senderAccount.address() }, config)).sequence_number,
        function: `${SUPRA_FRAMEWORK_ADDRESS}::supra_account::transfer_coins` as MoveFunctionId,
        functionTypeArgs: [new TypeTagParser(args.coinType).parseTypeTag()],
        functionArgs: [receiverAccountAddress.toUint8Array(), BCS.bcsSerializeUint64(args.amount)]
    }

    let raw_txn = rawTxnObjectInternal(supraTransferPayload, config);

    let sendTxPayload = sendTxnPayloadInternal({ senderAccount: args.senderAccount, rawTxn: raw_txn });

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