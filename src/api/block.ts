import { getBlockByHashInternal, getBlockByHeightInternal, getLatestBlockInternal, getTransactionsByBlockHashInternal } from "../internal/block";
import type { FinalizedBlockHeader } from "../types/block";
import type { NetworkConfig } from "../utils/apiEndpoints";
import { validateBlockHeight, validateHexString } from "../helper/validation";

/**
 * The Block class provides methods for querying block information on the Supra network.
 * @group Block
 */
export class Block {


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
    * @group Block
    */
    constructor(networkInformation: NetworkConfig) {
        this.networkInformation = networkInformation;
    }


    /**
     * Get the meta information of the most recently finalized and executed block.
     * @returns A Promise that resolves to a FinalizedBlockHeader object.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *    const block = await supra.block.getLatestBlock();
     *    console.log(block);
     * }
     * 
     * runExample().catch(console.error); 
     * ```
     * @group Block
     */
    async getLatestBlock(): Promise<FinalizedBlockHeader> {
        return getLatestBlockInternal(this.networkInformation)
    }


    /**
     * Get information about the block that has been finalized at the given height.
     * @param args.height - The height of the block to retrieve.
     * @param args.options.withFinalizedTransactions - Whether to include the transactions in the block.
     * @param args.options.type - The type of block to retrieve.
     * @returns A Promise that resolves to a FinalizedBlockHeader object.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     *    const height = 1;
     *    const block = await supra.block.getBlockByHeight({ height: height });
     *    console.log(block);
     * }
     * 
     * runExample().catch(console.error); 
     * ```
     * @group Block
     */
    async getBlockByHeight(args: { height: number, options?: { withFinalizedTransactions?: boolean, type?: "user" | "auto" | "meta" } }): Promise<FinalizedBlockHeader> {
        validateBlockHeight(args.height, "height");
        return getBlockByHeightInternal(args, this.networkInformation)
    }

    /**
     * Get the header and execution output statistics of the block with the given hash.
     * @param args.blockHash - The hash of the block to retrieve.
     * @returns A Promise that resolves to a FinalizedBlockHeader object.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     *    const blockHash = "0x1";
     *    const block = await supra.block.getBlockByHash({ blockHash: blockHash });
     *    console.log(block);
     * }
     * 
     * runExample().catch(console.error); 
     * ```
     * @group Block
     */
    async getBlockByHash(args: { blockHash: string }): Promise<FinalizedBlockHeader> {
        validateHexString(args.blockHash, "blockHash");
        return getBlockByHashInternal(args, this.networkInformation)
    }


    /**
     * Get a list containing the hashes of the transactions that were finalized in the block with the given hash in the order that they were executed.
     * @param args.blockHash - The hash of the block to retrieve.
     * @param args.options.type - The type of block to retrieve.
     * @returns A Promise that resolves to a string array.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     *    const blockHash = "0x1";
     *    const transactions = await supra.block.getTransactionsByBlockHash({ blockHash: blockHash });
     *    console.log(transactions);
     * }
     * 
     * runExample().catch(console.error); 
     * ```
     * @group Block
     */
    async getTransactionsByBlockHash(args: { blockHash: string, options?: { type?: "user" | "auto" | "meta" } }): Promise<string[]> {
        validateHexString(args.blockHash, "blockHash");
        return getTransactionsByBlockHashInternal(args, this.networkInformation)
    }
}
