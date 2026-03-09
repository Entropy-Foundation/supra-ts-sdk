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
import { Coin } from "./coin";
import { Events } from "./events";
import { Block } from "./block";
import { FungibleAsset } from "./fungibleAsset";
import { DEFAULT_GAS_PRICE, DEFAULT_MAX_GAS_UNITS } from "../utils/constants";


/**
 * The SupraClient class is the main entry point for interacting with the SupraClient sdk.
 * It takes a SupraConfig object as a parameter and use the NetworkConfig property to interact with the Supra rest api.
 * @group SupraClient 
*/
export class SupraClient {

    /**
     * SupraConfig is the configuration object for the SupraClient class. It contains the network property which can be either "mainnet" or "testnet".
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
    * ```  
    * @group SupraClient
    */
    constructor(config: SupraConfig) {

        this.config = config;

        // Set network
        // use default network configuration if network is testnet or mainnet
        if ('rpcUrl' in config && 'chainId' in config) {
            // Custom network
            this.networkInformation = {
                name: Network.CUSTOM,
                chainId: config.chainId,
                rpcUrl: config.rpcUrl
            };

        } else {
            // Predefined network
            this.networkInformation = NetworkInfo[config.network];
        }

        // Optional gas
        this.networkInformation.maxGas = config.maxGas ?? DEFAULT_MAX_GAS_UNITS;
        this.networkInformation.minGasUnitPrice = config.minGasUnitPrice ?? DEFAULT_GAS_PRICE;


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
     * Get Chain Id Of Supra Network
     * @returns Chain Id of network
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     * 
     * const supra = new SupraClient({ network: Network.TESTNET });
     * 
     * async function runExample() {
     *    const chainId = await supra.getChainId();
     *    console.log(chainId);
     * }
     * 
     * runExample().catch(console.error);
     * ```
     * @group SupraClient
     */
    getChainId(): TxnBuilderTypes.ChainId {
        return new TxnBuilderTypes.ChainId(
            Number(this.networkInformation.chainId),
        );
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



export interface SupraClient extends Account, Transaction, Contract, Methods, Faucet, Table, Coin, Events, Block, FungibleAsset { };


function applyMixins(derivedCtor: any, constructors: any[]) {
    constructors.forEach((baseCtor) => {
        Object.getOwnPropertyNames(baseCtor.prototype).forEach((name) => {
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