import { TxnBuilderTypes } from "supra-l1-sdk-core";
import type { SupraConfig } from "../types/supraClient";
import { Network, NetworkInfo, type NetworkConfig } from "../utils/apiEndpoints";
import { Account } from "./account";
import { Contract } from "./contract";
import { Faucet } from "./faucet";
import { Methods } from "./methods";
import { Table } from "./table";
import { Transaction } from "./transaction";
import { getGasPriceInternal, getMinGasUnitPriceInternal } from "../internal/supraClient";
import { getNodeChainIdInternal } from "../internal/chainId";
import { parseChainId } from "../client/chainIdCache";
import { SupraChainIdMismatchError } from "../errors/chainIdError";
import { Coin } from "./coin";
import { Events } from "./events";
import { Block } from "./block";
import { FungibleAsset } from "./fungibleAsset";
import { DEFAULT_GAS_PRICE, DEFAULT_MAX_GAS_UNITS } from "../utils/constants";
import { resolveRetry, validateTimeoutMs } from "../client/request";
import { validateRpcUrl } from "../client/url";
import { validateWaitTimeoutMs } from "../internal/transaction";


/**
 * The SupraClient class is the main entry point for interacting with the SupraClient sdk.
 * It takes a SupraConfig object as a parameter and use the NetworkConfig property to interact with the Supra rest api.
 * @group SupraClient 
*/
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class SupraClient {

    /**
     * SupraConfig is the configuration object for the SupraClient class. It contains the network property which can be "mainnet", "testnet" or "devnet".
     */
    readonly config: SupraConfig;

    /**
     * The networkInformation property is A NetworkConfig object that contains information about the network on which the Supra client is running.
     */
    readonly networkInformation: NetworkConfig;

    /**
     * Account instance provides methods for interacting with accounts related operations on the Supra network.
     */
    readonly account: Account;

    /**
     * Transaction instance provides methods for interacting with transactions related operations on the Supra network.
     */
    readonly transaction: Transaction;

    /**
     * Contract instance provides methods for interacting with contracts related operations on the Supra network. 
     */
    readonly contract: Contract;

    /**
     * Faucet instance provides methods for interacting with faucets related operations on the Supra network.
     */
    readonly faucet: Faucet;

    /**
     * Methods instance provides general functions for interacting with the Supra network.
     */
    readonly methods: Methods;

    /**
     * Table instance provides methods for interacting with tables related operations on the Supra network.
     */
    readonly table: Table;

    /**
     * Coin instance provides methods for interacting with coin related operations on the Supra network.
     */
    readonly coin: Coin;

    /**
     * Events instance provides methods for interacting with events related operations on the Supra network.
     */
    readonly events: Events;

    /**
     * Block instance provides methods for interacting with block related operations on the Supra network.
     */
    readonly block: Block;

    /**
     * FungibleAsset instance provides methods for interacting with fungible asset related operations on the Supra network.
     */
    readonly fungibleAsset: FungibleAsset;

    /**
    * The constructor function takes a SupraConfig object as a parameter and assigns it to the config property.
    * @param config - A SupraConfig object that contains information about the network on which the Supra client is running.
    * @note - You don't need to pass the rpc url or chain id it will be set automatically.
    * @example
    * ```typescript
    * import { SupraClient,Network } from "supra-ts-sdk";
    * 
    * // Options:1 (Default configuration)
    * const supra = new SupraClient({ network: Network.TESTNET }); 
    * 
    * 
    * // Options:2 (Custom configuration)
    * const supra = new SupraClient({ network: Network.CUSTOM, rpcUrl: "https://rpc-testnet.supra.com", chainId: 6 });
    * 
    * 
    * // Options:3 (Custom configuration)
    * const supra = new SupraClient({ rpcUrl: "https://rpc-testnet.supra.com", chainId: 6 });
    *
    * // Offline signing: no request reads the node's chain ID
    * const offline = new SupraClient({ network: Network.MAINNET, verifyChainId: false });
    *
    * ```
    * The constructor sends no request. The node's chain ID is read before the first signature and checked against
    * the configured one; see {@link SupraConfig}.
    * @group SupraClient
    */
    constructor(config: SupraConfig) {

        // The client keeps its own copy of the configuration.
        this.config = { ...config };

        // Set network
        // use default network configuration if network is mainnet, testnet or devnet
        if ('rpcUrl' in config && 'chainId' in config) {
            // Custom network
            if (typeof config.chainId !== "number" || parseChainId(config.chainId) === undefined) {
                throw new RangeError(`chainId must be an integer from 0 to 255, got ${String(config.chainId)}`);
            }
            this.networkInformation = {
                name: Network.CUSTOM,
                chainId: config.chainId,
                rpcUrl: validateRpcUrl(config.rpcUrl)
            };

        } else {
            // Predefined network; copied so that the settings of this client do not reach other clients
            this.networkInformation = { ...NetworkInfo[config.network] };
        }

        // Optional gas
        this.networkInformation.maxGas = config.maxGas ?? DEFAULT_MAX_GAS_UNITS;
        this.networkInformation.minGasUnitPrice = config.minGasUnitPrice ?? DEFAULT_GAS_PRICE;

        // Optional request timeout and retry policy
        if (config.timeoutMs !== undefined) {
            this.networkInformation.timeout = validateTimeoutMs(config.timeoutMs);
        }
        if (config.retry !== undefined) {
            this.networkInformation.retry = resolveRetry(config.retry);
        }
        if (config.waitTimeoutMs !== undefined) {
            this.networkInformation.waitTimeoutMs = validateWaitTimeoutMs(config.waitTimeoutMs, "waitTimeoutMs");
        }

        // Optional opt-out of the chain ID check
        if (config.verifyChainId !== undefined) {
            if (typeof config.verifyChainId !== "boolean") {
                throw new TypeError(`verifyChainId must be a boolean, got ${String(config.verifyChainId)}`);
            }
            this.networkInformation.verifyChainId = config.verifyChainId;
        }


        /**
         * Initialize all the classes that will be used to interact with the Supra API.
         */
        this.account = new Account(this.networkInformation);
        this.transaction = new Transaction(this.networkInformation);
        this.contract = new Contract(this.networkInformation);
        this.methods = new Methods(this.networkInformation);
        this.faucet = new Faucet(this.networkInformation);
        this.table = new Table(this.networkInformation);
        this.coin = new Coin(this.networkInformation);
        this.events = new Events(this.networkInformation);
        this.block = new Block(this.networkInformation);
        this.fungibleAsset = new FungibleAsset(this.networkInformation);
    }


    /**
     * Checks the configured chain ID against the node's. The node's chain ID is the one the client keeps for its
     * signatures: read from the `x-supra-chain-id` header of an earlier response or with
     * `GET /rpc/v3/transactions/chain_id`, once per client. Every signature performs the same check, so calling this
     * method is optional; it reports a mismatch before any transaction is built. It reads the node's chain ID also
     * when `verifyChainId` is `false`.
     * @throws {SupraChainIdMismatchError} If the configured chain ID is not the node's.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *    await supra.validateChainId();
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group SupraClient
     */
    async validateChainId(): Promise<void> {
        const nodeChainId = await getNodeChainIdInternal(this.networkInformation);

        if (nodeChainId !== this.networkInformation.chainId) {
            throw new SupraChainIdMismatchError({ configuredChainId: this.networkInformation.chainId, nodeChainId });
        }
    }


    /**
     * Returns the chain ID of the node the client is configured for. It is read from the `x-supra-chain-id` header of
     * an earlier response or with `GET /rpc/v3/transactions/chain_id`, once per client, and it is the chain ID that
     * signatures are checked against. It is not compared with the configured chain ID; `validateChainId()` does that.
     * With `verifyChainId: false` the configured chain ID is returned and no request is sent.
     * @returns Chain ID of the node
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *    const chainId = await supra.getChainId();
     *    console.log(chainId.value);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group SupraClient
     */
    async getChainId(): Promise<TxnBuilderTypes.ChainId> {
        const chainId = this.networkInformation.verifyChainId === false
            ? this.networkInformation.chainId
            : await getNodeChainIdInternal(this.networkInformation);
        return new TxnBuilderTypes.ChainId(chainId);
    }


    /**
   * Get current `median_gas_price`
   * @returns Current `median_gas_price`
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   *    const gasPrice = await supra.getGasPrice();
   *    console.log(gasPrice);
   * }
   * 
   * runExample().catch(console.error);
   * ```
   * @group SupraClient
   */
    async getGasPrice(): Promise<bigint> {
        return getGasPriceInternal(this.networkInformation);
    }

    /**
     * Get current `min_price_per_gas_unit`
     * @returns Current `min_price_per_gas_unit`
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     *    const gasPrice = await supra.getMinGasUnitPrice();
     *    console.log(gasPrice);
     * }
     * runExample().catch(console.error);
     * 
     * ```
     * @group SupraClient
     */
    async getMinGasUnitPrice(): Promise<bigint> {
        return getMinGasUnitPriceInternal(this.networkInformation);
    }

}



// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface SupraClient extends Account, Omit<Transaction, TransactionInstanceMembers>, Contract, Methods, Faucet, Table, Coin, Events, Block, FungibleAsset { };

/**
 * Members of `Transaction` that are instance properties: `build`, `simulate` and `submit` are reached through
 * `supra.transaction`. Only prototype methods are mixed into the client.
 */
type TransactionInstanceMembers = "build" | "simulate" | "submit";


// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyMixins(derivedCtor: any, constructors: any[]) {
    constructors.forEach((baseCtor) => {
        Object.getOwnPropertyNames(baseCtor.prototype).forEach((name) => {
            if (name === "constructor") {
                return;
            }
            Object.defineProperty(
                derivedCtor.prototype,
                name,
                Object.getOwnPropertyDescriptor(baseCtor.prototype, name) ||
                Object.create(null)
            );
        });
    });
}

applyMixins(SupraClient, [Account, Transaction, Contract, Methods, Faucet, Table, Coin, Events, Block, FungibleAsset]);