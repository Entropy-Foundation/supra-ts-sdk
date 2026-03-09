import { viewInternal } from "../internal/methods";
import type { DeepReadonly, ContractsFromABI } from "../types/contract";
import type { MoveModule } from "../types/move";
import type { NetworkConfig } from "../utils/apiEndpoints";
import { callContractInternal } from "../internal/contract";


/**
 * The Contract class provides methods for interacting with the Supra network.
 * @beta 
 * @group Contract
 */
export class Contract {

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
     * The fromABI function takes an array of MoveModule (Contract ABI) objects as input.
     * @beta
     * @param abis - An array of MoveModule (Contract ABI) objects.
     * @returns An object with a contracts property which contains view and entry properties.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     *    const instance = supra.contract.fromABI([COIN_ABI] as const);
     *    let balance = await instance.contracts.coin.view.balance({
     *        functionArguments: ["0x10cdf6e0c4c5c762bb23be3eac5c7eaa272c1b4abe0573cd1386c5632b7992ca"],
     *        typeArguments: ["0x1::supra_coin::SupraCoin"]
     *    })
     *    console.log("Balance:", balance[0]);
     * }
     * 
     * runExample().catch(console.error);
     * 
     * ```  
     * @group Contract
     */
    fromABI<T extends DeepReadonly<MoveModule[]>>(abis: T) {
        return {
            contracts: new Proxy(abis as ContractsFromABI<T>, {

                get: (_, prop: string) => {

                    let abi = abis.find(a => a.name === prop);

                    if (!abi) throw new Error(`Contract ${prop} not found in ABI`);

                    return {
                        view: new Proxy(abi, {
                            get: (target, prop: string) => {

                                return async (args: any = {}) => {

                                    return await viewInternal({
                                        function: `${target.address}::${target.name}::${prop}`,
                                        typeArguments: args.typeArguments ?? [],
                                        functionArguments: args.functionArguments ?? [],
                                        abi: abi as MoveModule
                                    }, this.networkInformation);

                                };

                            }
                        }),
                        entry: new Proxy(abi, {
                            get: (target, prop: string) => {

                                return async (args: any = {}) => {

                                    return await callContractInternal({
                                        ...args,
                                        function: `${target.address}::${target.name}::${prop}`,
                                        abi: abi as MoveModule
                                    }, this.networkInformation);

                                };

                            }
                        })

                    }


                }
            })
        }

    };

}