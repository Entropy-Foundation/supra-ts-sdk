import type { NetworkConfig } from "../../utils/apiEndpoints";
import type { SendTxnPayload } from "../../types/transactionManager/transactionBuild";
import { simulateSerializedTxnInternal, simulateTxnInternal } from "../../internal/transactionManager/txnSimulate";
import type { MoveInnerAuthenticator } from "../../types/move";
import type { TransactionResponse } from "../../types/transaction";


/**
 * The Simulate class provides methods for simulating transactions on the Supra network.
 * @group Transaction
 */
export class Simulate {

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
     * @group Transaction
     */
    constructor(networkInformation: NetworkConfig) {
        this.networkInformation = networkInformation;
    }



    /**
     * Simulate a transaction using the provided transaction payload
     * @param args.sendTxPayload -  Transaction payload 
     * @returns Transaction simulation result
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     *   // Simulate a transaction use sendTxPayload
     *   const response = await supra.transaction.simulate.simple({ sendTxPayload: { ... } }); // replace with a real transaction payload
     * 
     *   console.log(response);
     * }
     * runExample().catch(console.error);
     * ```
     * @group Transaction
     */
    async simple(args: { sendTxPayload: SendTxnPayload }): Promise<TransactionResponse> {
        return simulateTxnInternal(args, this.networkInformation);
    }



    /**
     * Simulate a transaction using the provided Serialized raw transaction data
     * @param args.txAuthenticator - Transaction authenticator
     * @param args.serializedRawTransaction - Serialized raw transaction data
     * @returns Transaction simulation result
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     *   // Simulate a transaction use serializedRawTransaction
     *   const response = await supra.transaction.simulate.serialized({ txAuthenticator: { ... }, serializedRawTransaction: Uint8Array.from([1,2,3]) }); // replace with a real transaction payload
     * 
     *   console.log(response);
     * }
     * runExample().catch(console.error);
     * ```
     * @group Transaction
     */
    async serialized(
        args: {
            txAuthenticator: MoveInnerAuthenticator,
            serializedRawTransaction: Uint8Array
        }
    ): Promise<TransactionResponse> {

        return simulateSerializedTxnInternal(args, this.networkInformation);
    }





}