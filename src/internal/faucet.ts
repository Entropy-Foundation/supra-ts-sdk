import { get } from "../client/get";
import { SupraFaucetResponseError, SupraFaucetUnavailableError } from "../errors/faucetError";
import { standardizeAddress } from "../helper/account";
import type { AccountAddressInput } from "../types/account";
import type { FaucetTransactionResponse } from "../types/faucet";
import type { SupraTransactionResponse } from "../types/transaction";
import type { NetworkConfig } from "../utils/apiEndpoints";


/**
 * Funds an account with the faucet.
 * The request is sent on any network; a network that does not serve the faucet answers with an error status.
 * @throws SupraFaucetUnavailableError when the node answers `"TryLater"`.
 * @throws SupraFaucetResponseError when the node answers with any other body that does not carry a hash.
 */
export async function fundAccountWithFaucetInternal(
    args: {
        accountAddress: AccountAddressInput;
    },
    config: NetworkConfig
): Promise<FaucetTransactionResponse> {

    const response = await get<unknown>({
        path: `/wallet/faucet/${standardizeAddress(args.accountAddress)}`,
    }, config);

    const body = response.data;

    if (body === "TryLater") {
        throw new SupraFaucetUnavailableError();
    }

    if (typeof body === "object" && body !== null && "Accepted" in body) {
        const accepted = (body as { Accepted: unknown }).Accepted;
        if (typeof accepted === "string" && accepted.length > 0) {
            return { hash: accepted };
        }
    }

    throw new SupraFaucetResponseError(body);
}


/**
 * Reads the faucet transaction with the given hash.
 */
export async function getFaucetTransactionInternal(
    args: {
        transactionHash: string;
    },
    config: NetworkConfig
): Promise<SupraTransactionResponse> {

    const response = await get<SupraTransactionResponse>({
        path: `/wallet/faucet/transactions/${standardizeAddress(args.transactionHash)}`,
    }, config);

    return response.data;
}
