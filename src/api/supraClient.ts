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
import { DEFAULT_GAS_PRICE } from "../utils/constants";
import { validateMaxGasEstimateMultiplier } from "../internal/transactionManager/maxGas";
import { resolveRetry, validateTimeoutMs } from "../client/request";
import { validateRpcUrl } from "../client/url";
import { validateTxExpirySecs } from "../internal/transactionManager/txnBuild";
import { validateWaitTimeoutMs } from "../internal/transaction";
import { resetSequenceNumberInternal } from "../internal/sequenceNumber";
import type { AccountAddressInput } from "../types/account";


/**
 * The SupraClient class is the main entry point for interacting with the SupraClient sdk.
 * It takes a SupraConfig object as a parameter and use the NetworkConfig property to interact with the Supra rest api.
 * @group SupraClient 
*/
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class SupraClient {

    /**
     * A copy of the SupraConfig the client was constructed with: either a predefined `network` (Mainnet, Testnet or
     * Devnet) or the `rpcUrl` and `chainId` of a custom node, with the optional settings described by {@link SupraConfig}.
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
    * @note - A predefined network (`Network.MAINNET`, `Network.TESTNET` or `Network.DEVNET`) sets the RPC URL and the
    * chain ID; any other node needs both `rpcUrl` and `chainId`.
    * @throws {RangeError} When `chainId` is not an integer from 0 to 255.
    * @throws {TypeError} When `rpcUrl` is not an absolute `http:` or `https:` URL, or `verifyChainId` is not a boolean.
    * @example
    * ```typescript
    * import { Network, SupraClient } from "supra-ts-sdk";
    *
    * // Options:1 (Predefined network: Network.MAINNET, Network.TESTNET or Network.DEVNET)
    * const supra = new SupraClient({ network: Network.TESTNET });
    *
    *
    * // Options:2 (Custom node)
    * const custom = new SupraClient({ network: Network.CUSTOM, rpcUrl: "http://localhost:27001", chainId: 255 });
    *
    *
    * // Options:3 (Custom node, without `network`)
    * const local = new SupraClient({ rpcUrl: "http://localhost:27001", chainId: 255 });
    *
    * // Offline signing: no request reads the node's chain ID
    * const offline = new SupraClient({ network: Network.MAINNET, verifyChainId: false });
    *
    * // Gas settings for every transaction of the client, and a longer request timeout
    * const configured = new SupraClient({
    *     network: Network.TESTNET,
    *     maxGas: 20_000n,
    *     minGasUnitPrice: 100_000n,
    *     timeoutMs: 60_000,
    * });
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

        // Optional gas; without `maxGas` the max gas of each transaction is estimated or defaulted when it is built
        if (config.maxGas !== undefined) {
            this.networkInformation.maxGas = config.maxGas;
        }
        this.networkInformation.minGasUnitPrice = config.minGasUnitPrice ?? DEFAULT_GAS_PRICE;
        if (config.estimateMaxGas !== undefined) {
            this.networkInformation.estimateMaxGas = config.estimateMaxGas;
        }
        if (config.maxGasEstimateMultiplier !== undefined) {
            this.networkInformation.maxGasEstimateMultiplier = validateMaxGasEstimateMultiplier(
                config.maxGasEstimateMultiplier,
            );
        }

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

        // Optional expiry window of the transactions built without `txExpiryTime`
        if (config.txExpirySecs !== undefined) {
            this.networkInformation.txExpirySecs = validateTxExpirySecs(config.txExpirySecs);
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
   * Reads the median gas unit price, in quants, from `GET /rpc/v3/transactions/estimate_gas_price`
   * (`median_gas_price`). Transactions that set no `gasUnitPrice` do not use it; they use `SupraConfig.minGasUnitPrice`.
   * @returns The median gas unit price
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
     * Reads the minimum gas unit price that the node's gas schedule configures, in quants, from
     * `GET /rpc/v3/transactions/estimate_gas_price` (`min_configured_gas_price`). Transactions that set no
     * `gasUnitPrice` do not use it; they use `SupraConfig.minGasUnitPrice`, default `DEFAULT_GAS_PRICE`.
     * @returns The minimum gas unit price
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

    /**
     * Forgets the client's sequence-number counter of `address` and its records of the account's transactions that
     * the client submitted. The next transaction of that account that a helper builds reads the sequence number from
     * the chain again.
     *
     * The client keeps, per account, the account's sequence number on the chain and a record of each transaction that
     * it submitted and that can still commit, for the transactions that its helpers (`transferSupraCoin`,
     * `transferCoin`, `transferSupraFungibleAsset`, `transferFungibleAsset`, `migrateCoinToFungibleStore`,
     * `publishPackage` and the entry functions of `Contract.fromABI`) send (see `SupraConfig`). The chain is read again
     * automatically when the node reports a stale number; call this method after the account has sent transactions by
     * other means (another client or process, a wallet, or the builders of `transaction.build`), or to hand out the
     * number of a transaction that will not commit before its expiration time.
     * @param address - The account whose counter is reset.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     * supra.resetSequenceNumber("0x1234");
     * ```
     * @group SupraClient
     */
    resetSequenceNumber(address: AccountAddressInput): void {
        resetSequenceNumberInternal({ address }, this.networkInformation);
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