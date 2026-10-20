import {
    getBlockByHashInternal,
    getBlockByHeightInternal,
    getLatestBlockInternal,
    getTransactionsByBlockHashInternal,
} from "../internal/block";
import type { FinalizedBlockHeader } from "../types/block";
import type { TransactionQueryType } from "../types/transaction";
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
        return getLatestBlockInternal(this.networkInformation);
    }

    /**
     * Get information about the block that has been finalized at the given height.
     * @param args.height - The height of the block to retrieve.
     * @param args.options.withFinalizedTransactions - Whether to include the transactions in the block.
     * @param args.options.type - Include only the transactions of this type. `"settlement"` requires a node from
     * v12 onwards; older nodes reject it with HTTP 400.
     * @returns A Promise that resolves to a FinalizedBlockHeader object. Its `transactions` can contain any
     * `txn_type`, including `settlement` items, which have no `header`, `payload` or `authenticator`.
     * @throws {SupraAPIError} HTTP 404 when the node has no block at that height yet. A height that is not a number
     * is HTTP 400 on v12 and HTTP 404 on v11. See "HTTP status codes by node version" in the README.
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
    async getBlockByHeight(args: {
        height: number;
        options?: { withFinalizedTransactions?: boolean; type?: TransactionQueryType };
    }): Promise<FinalizedBlockHeader> {
        validateBlockHeight(args.height, "height");
        return getBlockByHeightInternal(args, this.networkInformation);
    }

    /**
     * Get the header and execution output statistics of the block with the given hash.
     * @param args.blockHash - The hash of the block to retrieve.
     * @returns A Promise that resolves to a FinalizedBlockHeader object.
     * @throws {SupraAPIError} HTTP 404 for an unknown block. A hash that is not hexadecimal is HTTP 400 on v12 and
     * HTTP 404 on v11. See "HTTP status codes by node version" in the README.
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
        return getBlockByHashInternal(args, this.networkInformation);
    }

    /**
     * Get a list containing the hashes of the transactions that were finalized in the block with the given hash in the order that they were executed.
     * @param args.blockHash - The hash of the block to retrieve.
     * @param args.options.type - Return only the hashes of transactions of this type. `"settlement"` requires a
     * node from v12 onwards; older nodes reject it with HTTP 400.
     * @returns A Promise that resolves to a string array.
     * @throws {SupraAPIError} HTTP 404 for an unknown block. A hash that is not hexadecimal is HTTP 400 on v12 and
     * HTTP 404 on v11. See "HTTP status codes by node version" in the README.
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
    async getTransactionsByBlockHash(args: {
        blockHash: string;
        options?: { type?: TransactionQueryType };
    }): Promise<string[]> {
        validateHexString(args.blockHash, "blockHash");
        return getTransactionsByBlockHashInternal(args, this.networkInformation);
    }
}
