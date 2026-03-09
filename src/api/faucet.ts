import { fundAccountWithFaucetInternal } from "../internal/faucet";
import type { AccountAddressInput } from "../types/account";
import type { FaucetTransactionResponse } from "../types/faucet";
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
     * Fund an account with faucet for testnet.
     * @param args.accountAddress - The address to fund.
     * @returns A Promise that resolves to a FaucetTransactionResponse object.
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
}
