import { fundAccountWithFaucetInternal, getFaucetTransactionInternal } from "../internal/faucet";
import type { AccountAddressInput } from "../types/account";
import type { FaucetTransactionResponse } from "../types/faucet";
import type { SupraTransactionResponse } from "../types/transaction";
import type { NetworkConfig } from "../utils/apiEndpoints";

/**
 * The Faucet class provides methods for funding accounts on the Supra network.
 * @group Faucet
 */
export class Faucet {


    /**
    * The networkInformation property is A NetworkConfig object that contains information about the network on which the Supra client is running.
    */
    protected readonly networkInformation: NetworkConfig;


    /**
    * The constructor function takes a NetworkConfig object as a parameter and assigns it to the networkInformation property.
    * @param networkInformation - A NetworkConfig object that contains information about the network on which the Supra client is running.
    * @example
    * ```typescript
    * import { SupraClient,Network } from "supra-ts-sdk";
    * 
    * const supra = new SupraClient({ network: Network.TESTNET });
    * ```  
    * @group Faucet
    */
    constructor(networkInformation: NetworkConfig) {
        this.networkInformation = networkInformation;
    }


    /**
     * Fund an account with the node's faucet. The request is sent on any network; a node that does not serve
     * the faucet answers with an error status, which is thrown as a SupraAPIError. The faucet answers before its
     * transaction executes: pass the returned hash to `supra.transaction.waitForTransaction` before spending the funds.
     * @param args.accountAddress - The address to fund.
     * @returns A Promise that resolves to a FaucetTransactionResponse object, the hash of the faucet transaction.
     * @throws SupraFaucetUnavailableError when the node has no free faucet account (answer `"TryLater"`).
     * @throws SupraFaucetResponseError when the node answers with an unexpected body.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     *    const accountAddress = "0x1";
     *    const faucetResponse = await supra.faucet.fundAccountWithFaucet({ accountAddress: accountAddress });
     *    console.log(faucetResponse);
     * }
     * 
     * runExample().catch(console.error); 
     * ```
     * @group Faucet
     */
    async fundAccountWithFaucet(args: {
        accountAddress: AccountAddressInput;
    }): Promise<FaucetTransactionResponse> {
        return fundAccountWithFaucetInternal(args, this.networkInformation)
    }

    /**
     * Read a faucet transaction by its hash.
     * @param args.transactionHash - The hash returned by fundAccountWithFaucet.
     * @returns A Promise that resolves to the faucet transaction.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     *    const { hash } = await supra.faucet.fundAccountWithFaucet({ accountAddress: "0x1" });
     *    const transaction = await supra.faucet.getFaucetTransaction({ transactionHash: hash });
     *    console.log(transaction.status);
     * }
     * 
     * runExample().catch(console.error); 
     * ```
     * @group Faucet
     */
    async getFaucetTransaction(args: {
        transactionHash: string;
    }): Promise<SupraTransactionResponse> {
        return getFaucetTransactionInternal(args, this.networkInformation)
    }
}
