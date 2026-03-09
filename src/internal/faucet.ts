import { get } from "../client/get";
import { post } from "../client/post";
import { standardizeAddress } from "../helper/account";
import type { AccountAddressInput } from "../types/account";
import type { FaucetTransactionResponse } from "../types/faucet";
import { Network, type NetworkConfig } from "../utils/apiEndpoints";
import { RPC_VERSION_V1 } from "../utils/constants";


/**
 * Funds an account with the faucet
 */
export async function fundAccountWithFaucetInternal(
    args: {
        accountAddress: AccountAddressInput;
    },
    config: NetworkConfig
): Promise<FaucetTransactionResponse> {

    if (config.name != Network.TESTNET) {
        throw new Error("Faucet is only available on testnet");
    }

    let response = await get<{ Accepted: string }>({
        path: `/wallet/faucet/${standardizeAddress(args.accountAddress)}`,
    }, config, RPC_VERSION_V1);

    return {
        hash: response.data.Accepted
    };

}