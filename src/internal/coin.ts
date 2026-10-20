import { BCS, HexString, type SupraAccount } from "supra-l1-sdk-core";
import type { AccountAddressInput } from "../types/account";
import type { OptionalTransactionArgs, SubmitTransactionResponse } from "../types/transactionManager/transactionSubmit";
import type { NetworkConfig } from "../utils/apiEndpoints";
import { SUPRA_FRAMEWORK_ADDRESS } from "../utils/constants";
import { addressToBytes } from "../helper/account";
import { parseTypeArgument } from "../helper/typeTag";
import { getAccountResourceInternal } from "./account";
import type { MoveFunctionId } from "../types/move";
import { buildAndSubmitEntryFunctionInternal } from "./transactionManager/txnSubmit";
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

    // Coin Transfer Payload
    let supraTransferPayload = {
        function: `${SUPRA_FRAMEWORK_ADDRESS}::supra_account::transfer_coins` as MoveFunctionId,
        functionTypeArgs: [parseTypeArgument(args.coinType)],
        functionArgs: [addressToBytes(args.receiverAccountAddress), BCS.bcsSerializeUint64(args.amount)]
    }

    return await buildAndSubmitEntryFunctionInternal({
        senderAccount: args.senderAccount,
        payload: supraTransferPayload,
        optionalTransactionArgs: args.optionalTransactionArgs,
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