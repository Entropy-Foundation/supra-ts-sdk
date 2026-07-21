import type { NetworkConfig } from "../utils/apiEndpoints";
import type { InputViewFunctionData, InputViewRawFunctionData } from "../types/methods";
import { viewInternal, viewRawInternal } from "../internal/methods";
import type { MoveValue } from "../types/move";
import { validateFunctionId } from "../helper/validation";


/**
 * The Methods class provides general methods for interacting with the Supra network.
 * @group Methods
 */
export class Methods {

    /**
    * The networkInformation property is A NetworkConfig object that contains information about the network on which the Supra client is running.
    */
    protected readonly networkInformation: NetworkConfig;


    /**
     * The constructor function takes a NetworkConfig object as a parameter and assigns it to the networkInformation property.
     * @param networkInformation - A NetworkConfig object that contains information about the network on which the Supra client is running.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-l1-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * ```
     * @group Methods
     */
    constructor(networkInformation: NetworkConfig) {
        this.networkInformation = networkInformation;
    }


    /**
     *  Queries for a Move view function
     * @template T - The type of the MoveValue array to be returned.
     * @param args.function - The name of the function to query.
     * @param args.typeArguments - An array of type arguments for the function.
     * @param args.functionArguments - An array of arguments for the function.
     * @returns A Promise that resolves to an array of MoveValue objects.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     *    const accountAddress = "0x1";
     *    const supraCoin = new TypeTagParser("0x1::supra_coin::SupraCoin").parseTypeTag();
     *    const accountSupraBalance = await supra.methods.view({
     *        function: "0x1::coin::balance",
     *        functionArguments: [accountAddress],
     *        typeArguments: [supraCoin]
     *    });
     *    console.log("Account supra balance:", accountSupraBalance[0]);
     * }
     * 
     * runExample().catch(console.error);
     * ```
     * @group Methods
     */
    async view<T extends Array<MoveValue>>(args: InputViewFunctionData): Promise<T> {
        validateFunctionId(args.function, "function");
        return viewInternal(args, this.networkInformation);
    }


    /**
     * Queries for a Move view function without type conversion or parsing
     * @template T - The type of the array to be returned.
     * @param args.function - The name of the function to query.
     * @param args.typeArguments - An array of type arguments for the function.
     * @param args.functionArguments - An array of arguments for the function.
     * @returns A Promise that resolves to an array of values.
     * @note This is for raw data without type conversion or parsing.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     *    const accountAddress = "0x1";
     *    const accountSupraBalance = await supra.methods.viewRaw({
     *        function: "0x1::coin::balance",
     *        functionArguments: [accountAddress],
     *        typeArguments: ["0x1::supra_coin::SupraCoin"]
     *    });
     *    console.log("Account supra balance:", accountSupraBalance[0]);
     * }
     * 
     * runExample().catch(console.error);
     * ```
     * @group Methods
     */
    async viewRaw<T extends Array<unknown>>(args: InputViewRawFunctionData): Promise<T> {
        validateFunctionId(args.function, "function");
        return viewRawInternal(args, this.networkInformation);
    }
}
