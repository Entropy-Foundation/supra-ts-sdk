/**
 * Max gas, in gas units, of a transaction whose max gas is neither set by the caller nor estimated: estimation is
 * turned off (`estimateMaxGas: false`), the builder has no signer to simulate with, or the estimating simulation
 * could not run to a result (a request error, a response without `gas_used`). It covers a one-module publish (about
 * 2,000 units), a multisig account creation (about 1,700) and a transfer that creates the receiver (about 1,000). The
 * node accepts a transaction only when the sender's balance covers `max gas × gas unit price`: at the default gas unit
 * price of 100,000 quants this is 20 SUPRA (2,000,000,000 quants).
 */
export const DEFAULT_MAX_GAS_UNITS = BigInt(20_000);
/**
 * Factor applied to the gas used by the estimating simulation to obtain the max gas of a transaction:
 * `max gas = ceil(gas used × factor)`. The margin covers a difference between the state the simulation ran on and the
 * state the transaction executes on. `SupraConfig.maxGasEstimateMultiplier` replaces it.
 */
export const DEFAULT_MAX_GAS_ESTIMATE_MULTIPLIER = 1.5;
/**
 * Lowest max gas, in gas units, that an estimate yields when the sender's balance covers it: the gas of a transfer that
 * creates the receiver (about 1,000 units) times {@link DEFAULT_MAX_GAS_ESTIMATE_MULTIPLIER}.
 */
export const MIN_ESTIMATED_MAX_GAS_UNITS = BigInt(1_500);
/**
 * The node's maximum gas units per transaction: `txn.maximum_number_of_gas_units` of the on-chain gas schedule, which is
 * 2,000,000,000 on Mainnet, Testnet and Devnet (node v11.7.0 and v12).
 */
export const MAX_GAS_UNITS_PER_TRANSACTION = BigInt(2_000_000_000);
/** Gas unit price, in quants, when neither the call nor the client sets one: the node's `txn.min_price_per_gas_unit`. */
export const DEFAULT_GAS_PRICE = BigInt(100_000);
/**
 * Seconds from the client's clock, in whole seconds, to the expiration time of a transaction built without
 * `txExpiryTime`, when `SupraConfig.txExpirySecs` sets none.
 */
export const DEFAULT_TX_EXPIRATION_DURATION = 60;
/**
 * The largest `SupraConfig.txExpirySecs`: the nodes (v11.7.0 and v12) refuse a transaction whose expiration time is
 * more than 600 seconds after their clock in whole seconds.
 */
export const MAX_TX_EXPIRATION_DURATION = 600;
/**
 * Seconds by which the clocks of the client and of the node that receives a transaction may differ. A transaction
 * built without `txExpiryTime` expires at most `MAX_TX_EXPIRATION_DURATION - TX_EXPIRATION_MARGIN_SECS` (595) seconds
 * after the client's clock, so that a node accepts it when `txExpirySecs` is 600.
 */
export const TX_EXPIRATION_MARGIN_SECS = 5;
export const MILLISECONDS_PER_SECOND = 1000;
export const SUPRA_FRAMEWORK_ADDRESS = "0x0000000000000000000000000000000000000000000000000000000000000001";
export const SUPRA_COIN_TYPE = "0x1::supra_coin::SupraCoin";
/** The address of the SUPRA fungible asset: the fungible asset that `0x1::supra_coin::SupraCoin` is paired with. */
export const SUPRA_FUNGIBLE_ASSET_ADDRESS = "0x000000000000000000000000000000000000000000000000000000000000000a";
export const OBJECT_CORE = "0x1::object::ObjectCore";

export const DEFAULT_ENABLE_SIMULATION = false;
export const DEFAULT_WAIT_FOR_TX_COMPLETION = false;
export const RAW_TRANSACTION_SALT = "SUPRA::RawTransaction";
export const RAW_TRANSACTION_WITH_DATA_SALT = "SUPRA::RawTransactionWithData";
export const DEFAULT_RPC_VERSION = "v3";
/**
 * Longest time, in milliseconds, that a wait for a transaction's final status lasts when neither the call nor
 * `SupraConfig.waitTimeoutMs` sets one.
 */
export const DEFAULT_TXN_WAIT_TIMEOUT_MS = 60000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
/** Requests (the first included) a retrying client sends before it gives up, when `retry.attempts` is not set. */
export const DEFAULT_RETRY_ATTEMPTS = 3;
/** Longest wait before a retry, when `retry.maxDelayMs` is not set. */
export const DEFAULT_RETRY_MAX_DELAY_MS = 10000;
