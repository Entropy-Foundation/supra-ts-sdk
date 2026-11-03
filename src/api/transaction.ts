// Portions of this file are derived from @aptos-labs/ts-sdk (https://github.com/aptos-labs/aptos-ts-sdk),
// Copyright © Aptos Foundation, licensed under the Apache License, Version 2.0. See NOTICE.
import type { NetworkConfig } from "../utils/apiEndpoints";
import type { AccountAddressInput } from "../types/account";
import type {
    CommittedTransactionResponse,
    Settlement,
    SettlementDomain,
    SettlementRole,
    SettlementsPage,
    TransactionQueryType,
    TransactionResponse,
    TransactionsByHashesResponse,
    WaitForTransactionOptions,
} from "../types/transaction";
import {
    getSettlementInternal,
    getSettlementsInternal,
    getTransactionByHashInternal,
    getTransactionsByHashesInternal,
    getTransactionSignatureMessageInternal,
    isPendingTransactionInternal,
    publishPackageInternal,
    signTransactionInternal,
    waitForTransactionInternal,
} from "../internal/transaction";

import { retryWithFreshSequenceNumber } from "../internal/sequenceNumber";
import { Build } from "./transactionManager/txnBuild";
import { TxnBuilderTypes, type AnyRawTransaction, type HexString, type SupraAccount } from "supra-l1-sdk-core";
import { Simulate } from "./transactionManager/txnSimulate";
import { Submit } from "./transactionManager/txnSubmit";
import type { OptionalTransactionArgs, SubmitTransactionResponse } from "../types/transactionManager/transactionSubmit";
import {
    validatePaginationCount,
    validateSettlementAddress,
    validateSettlementDomain,
    validateSettlementRole,
    validateTransactionHash,
} from "../helper/validation";
import { transactionHashInternal } from "../internal/transactionManager/txnHash";

/**
 * The Transaction class provides methods for interacting with the Supra network.
 * @group Transaction
 */
export class Transaction {
    /**
     * The networkInformation property is A NetworkConfig object that contains information about the network on which the Supra client is running.
     */
    protected readonly networkInformation: NetworkConfig;

    /**
     * The build property is an instance of the Build class, which is used to build transactions.
     */
    readonly build: Build;

    /**
     * The simulate property is an instance of the Simulate class, which is used to simulate transactions.
     */
    readonly simulate: Simulate;

    /**
     * The submit property is an instance of the Submit class, which is used to submit transactions.
     */
    readonly submit: Submit;

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
        this.build = new Build(networkInformation);
        this.simulate = new Simulate(networkInformation);
        this.submit = new Submit(networkInformation);
    }

    /**
     * Queries on-chain transactions by their transaction hash, returning both pending and committed transactions.
     * @param args - The arguments for querying the transaction.
     * @param args.transactionHash - The transaction hash should be a hex-encoded bytes string with a 0x prefix.
     * @param args.type - The type of transaction to query. `"settlement"` requires a node from v12 onwards; older
     * nodes reject it with HTTP 400.
     * @param args.exclude_uncommitted - Whether to exclude uncommitted transactions.
     * @returns A Promise that resolves to a TransactionResponse object. Only user and automated transactions have
     * `header`, `payload` and `authenticator`; narrow on `txn_type` before reading them.
     * @throws {SupraAPIError} HTTP 404 for an unknown hash. A hash that is not hexadecimal is HTTP 400 on v12 and
     * HTTP 404 on v11. See "HTTP status codes by node version" in the README.
     * @example
     * ```typescript
     * import { Network, SupraClient } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *   // Fetch a transaction by its hash
     *   const transaction = await supra.transaction.getTransactionByHash({ transactionHash: "0x123" }); // replace with a real transaction hash
     *
     *   console.log(transaction);
     * }
     * runExample().catch(console.error);
     * ```
     * @group Transaction
     */
    async getTransactionByHash(args: {
        transactionHash: string;
        type?: TransactionQueryType;
        exclude_uncommitted?: boolean;
    }): Promise<TransactionResponse> {
        validateTransactionHash(args.transactionHash);
        return getTransactionByHashInternal(args, this.networkInformation);
    }

    /**
     * Looks up several transactions by hash in one request (`POST /rpc/v4/transactions/by_hashes`). Needs a node from
     * `supra_node_v12.0.0`; Mainnet and Testnet nodes of `supra_node_v11.7.x` answer HTTP 404, which is thrown as
     * `SupraRouteUnsupportedError`.
     *
     * Preview: wraps an API added in `supra_node_v12.0.0`, which may change until that release reaches Testnet.
     *
     * Each hash is resolved as {@link Transaction.getTransactionByHash} resolves it, with the same `type` and
     * `exclude_uncommitted`, and the transactions are the `/rpc/v4` form of the single-hash route's body (events carry
     * `hash`; `inclusion_proof` is present with `include_proof`). A hash the node does not know does not fail the
     * request: its entry has `transaction: null`. A hash that is repeated is answered at each position.
     *
     * The node bounds the request and the response (set by the operator; defaults below):
     * - 1 to 100 hashes (`rest_limits.transactions_by_hashes.max_hashes`), repeats included; anything else is HTTP 400.
     * - A body above `128 * max_hashes + 1024` bytes is HTTP 413.
     * - The answered entries add up to at most 16 MiB of JSON. Entries are answered in request order up to the first
     *   one that would exceed the bound, or whose lookup failed, and that position and every later one are listed in
     *   `omitted`. The first hash is always answered; request the `omitted` hashes again for the rest.
     * @param args.transactionHashes - The transaction hashes, each a hex-encoded string with a 0x prefix.
     * @param args.type - Look only for transactions of this type. `"settlement"` is accepted by this route.
     * @param args.exclude_uncommitted - Whether to exclude uncommitted transactions. Without it, a user transaction
     * that is submitted and not final has the status `Pending` or `PendingAfterExecution` and `null` `block_header`
     * and `output`.
     * @param args.include_proof - Whether to include the inclusion proof, computed against the latest transactions
     * inclusion certificate the node holds. `inclusion_proof` is `null` for a transaction of a block above it.
     * @beta
     * @returns A Promise that resolves to `{ transactions, omitted }`: `transactions` holds one `{ hash, transaction }`
     * per answered hash in request order, and `omitted` the requested hashes that were not answered.
     * @throws {SupraRouteUnsupportedError} When the node does not serve the route.
     * @throws {SupraAPIError} HTTP 400 for no hashes or more than the node's limit, HTTP 413 for a body above its
     * limit, and the status `getTransactionByHash` would report when the lookup of the first hash fails.
     * @example
     * ```typescript
     * import { Network, SupraClient } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.DEVNET });
     *
     * async function runExample() {
     *   const { transactions, omitted } = await supra.transaction.getTransactionsByHashes({
     *     transactionHashes: ["0x" + "11".repeat(32), "0x" + "22".repeat(32)], // replace with real transaction hashes
     *   });
     *   for (const { hash, transaction } of transactions) {
     *     console.log(hash, transaction === null ? "unknown" : transaction.status);
     *   }
     *   console.log("not answered:", omitted);
     * }
     * runExample().catch(console.error);
     * ```
     * @group Transaction
     */
    async getTransactionsByHashes(args: {
        transactionHashes: string[];
        type?: TransactionQueryType;
        exclude_uncommitted?: boolean;
        include_proof?: boolean;
    }): Promise<TransactionsByHashesResponse> {
        if (!Array.isArray(args.transactionHashes) || args.transactionHashes.length === 0) {
            throw new Error("Invalid transactionHashes: expected a non-empty array of transaction hashes");
        }
        args.transactionHashes.forEach((hash, index) => validateTransactionHash(hash, `transactionHashes[${index}]`));
        return getTransactionsByHashesInternal(args, this.networkInformation);
    }

    /**
     * Reads the lifecycle of one cross-VM crossing of native SUPRA between SupraMVM and SupraEVM
     * (`GET /rpc/v4/transactions/settlements/{settlement_id}`): every stage the node still holds (recorded, credited,
     * applied, refunded or cleared), its queue entry while it waits to be applied, and the height the node had
     * executed to. A crossing is recorded by one block and settled by a later one, so it is not a single transaction.
     * Needs a node from `supra_node_v12.0.0`; Mainnet and Testnet nodes of `supra_node_v11.7.x` answer HTTP 404 for
     * the route, which is thrown as `SupraRouteUnsupportedError`.
     *
     * Preview: wraps an API added in `supra_node_v12.0.0`, which may change until that release reaches Testnet.
     * @param args.settlementId - The crossing's identity: `0x` followed by 64 hex digits.
     * @beta
     * @returns A Promise that resolves to the {@link Settlement}.
     * @throws {SupraNotFoundError} When the node has no record of the crossing, which includes one it has not
     * executed yet and an outbound crossing that predates its history.
     * @throws {SupraGoneError} When the crossing was recorded below the node's oldest retained block: whether it
     * existed cannot be told.
     * @throws {SupraRouteUnsupportedError} When the node does not serve the route.
     * @example
     * ```typescript
     * import { Network, SupraClient } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.DEVNET });
     *
     * async function runExample() {
     *   const settlement = await supra.transaction.getSettlement({ settlementId: "0x" + "00".repeat(32) }); // replace with a real settlement id
     *   console.log(settlement.stages.map((stage) => stage.stage), settlement.pending);
     * }
     * runExample().catch(console.error);
     * ```
     * @group Transaction
     */
    async getSettlement(args: { settlementId: string }): Promise<Settlement> {
        validateTransactionHash(args.settlementId, "settlementId");
        return getSettlementInternal(args, this.networkInformation);
    }

    /**
     * Lists the cross-VM crossings one address is party to, oldest first
     * (`GET /rpc/v4/transactions/settlements`). Needs a node from `supra_node_v12.0.0`; Mainnet and Testnet nodes of
     * `supra_node_v11.7.x` answer HTTP 404, which is thrown as `SupraRouteUnsupportedError`.
     *
     * Preview: wraps an API added in `supra_node_v12.0.0`, which may change until that release reaches Testnet.
     * @param args.address - The address, `0x`-prefixed: at most 32 bytes for `domain` `"move"` (a `string` or a
     * `HexString`), at most 20 bytes for `"evm"`. A shorter address is left-padded with zeros to the domain's width,
     * so `"0x1"` is the Move address `0x0...01`; a longer one is rejected before any request.
     * @param args.domain - Which side of the chain the address belongs to. The two domains' addresses can share their
     * bytes, so the domain is required.
     * @param args.options.role - Only the crossings the address sent (`"sender"`) or received (`"recipient"`). Both by default.
     * @param args.options.count - The number of crossings to return, 1 to 100; the node's default is 20.
     * @param args.options.start - The `cursor` of the previous page, verbatim. Omit it, or pass `undefined`, for the
     * first page. An empty string is not sent.
     * @beta
     * @returns A Promise that resolves to the crossings of the page, the cursor of the next page and the height of the
     * node's oldest block. `cursor` is `undefined` on the last page; a page can hold fewer than `count` crossings, or
     * none, and still carry a cursor, so follow the cursor until it is `undefined`.
     * @throws {SupraRouteUnsupportedError} When the node does not serve the route.
     * @throws {SupraAPIError} HTTP 400 for a `start` that was not issued for this address.
     * @example
     * ```typescript
     * import { Network, SupraClient } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.DEVNET });
     *
     * async function runExample() {
     *   let start: string | undefined;
     *   do {
     *     const page = await supra.transaction.getSettlements({
     *       address: "0x" + "11".repeat(20), // replace with a real address
     *       domain: "evm",
     *       options: { start },
     *     });
     *     for (const settlement of page.response) {
     *       console.log(settlement.settlement_id, settlement.stages.length);
     *     }
     *     start = page.cursor;
     *   } while (start !== undefined);
     * }
     * runExample().catch(console.error);
     * ```
     * @group Transaction
     */
    async getSettlements(args: {
        address: AccountAddressInput;
        domain: SettlementDomain;
        options?: { role?: SettlementRole; count?: number; start?: string | undefined };
    }): Promise<SettlementsPage> {
        validateSettlementDomain(args.domain, "domain");
        validateSettlementAddress(args.address, args.domain, "address");
        validateSettlementRole(args.options?.role, "role");
        validatePaginationCount(args.options?.count);
        return getSettlementsInternal(args, this.networkInformation);
    }

    /**
     * Reads a transaction by its hash and tells whether it has no final status yet.
     * @param args - The arguments for querying the transaction.
     * @param args.transactionHash - The transaction hash should be a hex-encoded bytes string with a 0x prefix.
     * @returns A Promise that resolves to true when the status is `Pending` or `PendingAfterExecution`, and to false
     * when it is `Success`, `Fail` or `Invalid`.
     * @throws {SupraNotFoundError} When the node has no transaction with the hash.
     * @example
     * ```typescript
     * import { Network, SupraClient } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *   // Read a transaction by its hash
     *   const isPending = await supra.transaction.isPendingTransaction({ transactionHash: "0x123" }); // replace with a real transaction hash
     *
     *   console.log(isPending);
     * }
     * runExample().catch(console.error);
     * ```
     * @group Transaction
     */
    async isPendingTransaction(args: { transactionHash: string }): Promise<boolean> {
        validateTransactionHash(args.transactionHash);
        return isPendingTransactionInternal(args, this.networkInformation);
    }

    /**
     * Waits until a transaction has a final status and returns it.
     *
     * Statuses of a transaction:
     * - `Pending`: the RPC node accepted the transaction and it is not executed yet. Not final.
     * - `PendingAfterExecution`: the transaction was executed and discarded with a status that may change in a later
     *   execution (for example `SEQUENCE_NUMBER_TOO_NEW`). Not final. A transaction that keeps this status does not
     *   commit; it can be submitted again once the cause is resolved.
     * - `Success`: executed successfully. Final.
     * - `Fail`: executed and failed (for example a Move abort or `Out of gas`); the sequence number was incremented and
     *   the gas was charged. Final.
     * - `Invalid`: discarded, and discarded on every execution; the sequence number was not incremented. Final.
     *
     * The transaction is read again while its status is not final and while a read fails, including HTTP 404 for a
     * transaction the node has not seen yet. The timeout is wall-clock time from the start of the call.
     *
     * @param args.transactionHash - The transaction hash should be a hex-encoded bytes string with a 0x prefix.
     * @param args.options - The timeout and whether a final status other than `Success` throws; see
     * {@link WaitForTransactionOptions}. Optional.
     * @returns A Promise that resolves to the transaction with its final status: `Success`, or any final status when
     * `checkSuccess` is false.
     * @throws `SupraTransactionFailedError` (with `hash`, `status`, `vm_status`, `major_status`, `sub_status` and
     * `transaction`) when the final status is `Fail` or `Invalid` and `checkSuccess` is not false.
     * @throws `SupraTransactionTimeoutError` (with `hash` and `lastStatus`) when there is no final status within the
     * timeout.
     * @example
     * ```typescript
     * import { Network, SupraClient } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *   // Wait for a transaction to commit
     *   const transaction = await supra.transaction.waitForTransaction({
     *     transactionHash: "0x123", // replace with a real transaction hash
     *     options: { timeoutMs: 30_000 },
     *   });
     *
     *   console.log(transaction);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Transaction
     */
    async waitForTransaction(args: {
        transactionHash: string;
        options?: WaitForTransactionOptions;
    }): Promise<CommittedTransactionResponse> {
        validateTransactionHash(args.transactionHash);
        return waitForTransactionInternal(args, this.networkInformation);
    }

    /**
     * Generates signature message for supra transaction using `AnyRawTransaction`
     * @param args.rawTxn a RawTransaction, MultiAgentRawTransaction or FeePayerRawTransaction
     * @returns Signature message
     * @example
     * ```typescript
     * import { BCS, Network, SupraAccount, SupraClient } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     * const account = new SupraAccount(); // an account that holds SUPRA
     *
     * async function runExample() {
     *
     *   const rawTxn = supra.transaction.build.rawTxnObject({
     *     senderAddress: account.address(),
     *     senderSequenceNumber: 0n, // the account's sequence number
     *     function: "0x1::supra_account::transfer",
     *     functionTypeArgs: [],
     *     functionArgs: [new SupraAccount().address().toUint8Array(), BCS.bcsSerializeUint64(10000n)],
     *     optionalTransactionPayloadArgs: { gasUnitPrice: await supra.getEstimatedGasUnitPrice() },
     *   });
     *
     *   const signatureMessage = supra.transaction.getTransactionSignatureMessage({ rawTxn });
     *
     *   console.log(signatureMessage);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Transaction
     */
    getTransactionSignatureMessage(args: { rawTxn: AnyRawTransaction }): Uint8Array {
        return getTransactionSignatureMessageInternal(args);
    }

    /**
     * Sign any supra transaction.
     * signer authenticator to be used to submit the transaction.
     * @param args.senderAccount the account to sign on the transaction
     * @param args.rawTxn a RawTransaction, MultiAgentRawTransaction or FeePayerRawTransaction
     * @returns A promise of the ed25519 signature as a `HexString` for a `RawTransaction`, and of the signer's
     * `AccountAuthenticatorEd25519` for a `MultiAgentRawTransaction` or `FeePayerRawTransaction`.
     * @throws `SupraChainIdMismatchError` before signing when the client's chain ID or the chain ID of `rawTxn` is not
     * the node's. The node's chain ID is read before the first signature of the client; with `verifyChainId: false`
     * nothing is read or checked and no request is sent.
     * @throws `RangeError` before signing when the expiration time of `rawTxn` is more than the node's maximum time to
     * live after the current time (the maximum is read once per client; see `getTransactionParameters()`; not checked
     * with `verifyChainId: false`), and the error of a failed read of that maximum
     * @example
     * ```typescript
     * import { BCS, Network, SupraAccount, SupraClient } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     * const account = new SupraAccount(); // an account that holds SUPRA
     *
     * async function runExample() {
     *
     *   const rawTxn = supra.transaction.build.rawTxnObject({
     *     senderAddress: account.address(),
     *     senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
     *     function: "0x1::supra_account::transfer",
     *     functionTypeArgs: [],
     *     functionArgs: [new SupraAccount().address().toUint8Array(), BCS.bcsSerializeUint64(10000n)],
     *     optionalTransactionPayloadArgs: { gasUnitPrice: await supra.getEstimatedGasUnitPrice() },
     *   });
     *
     *   const signature = await supra.transaction.signTransaction({ senderAccount: account, rawTxn });
     *
     *   console.log(signature.toString());
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Transaction
     */
    signTransaction(args: { senderAccount: SupraAccount; rawTxn: TxnBuilderTypes.RawTransaction }): Promise<HexString>;
    signTransaction(args: {
        senderAccount: SupraAccount;
        rawTxn: TxnBuilderTypes.MultiAgentRawTransaction | TxnBuilderTypes.FeePayerRawTransaction;
    }): Promise<TxnBuilderTypes.AccountAuthenticatorEd25519>;
    signTransaction(args: {
        senderAccount: SupraAccount;
        rawTxn: AnyRawTransaction;
    }): Promise<HexString | TxnBuilderTypes.AccountAuthenticatorEd25519>;
    signTransaction(args: {
        senderAccount: SupraAccount;
        rawTxn: AnyRawTransaction;
    }): Promise<HexString | TxnBuilderTypes.AccountAuthenticatorEd25519> {
        return signTransactionInternal(args, this.networkInformation);
    }

    /**
     * Derives the transaction hash from a signed transaction: the Keccak-256 of its BCS bytes, the hash the node gives
     * the transaction. The submit helpers derive the hash the same way before they submit, and report it in
     * `SupraSubmissionOutcomeUnknownError` when the outcome of the submission request is unknown.
     * @param args.signedTransaction - The signed transaction.
     * @returns The transaction hash as a `0x`-prefixed lower-case hex string, the form `getTransactionByHash` and
     * `waitForTransaction` accept.
     * @group Transaction
     */
    deriveTransactionHash(args: { signedTransaction: TxnBuilderTypes.SignedTransaction }): string {
        return transactionHashInternal(args.signedTransaction);
    }

    /**
     * Publish a package or module on the Supra network with `0x1::code::publish_package_txn`. The sequence number
     * comes from the client's counter unless `optionalTransactionPayloadArgs.sequenceNumber` is set, and the client
     * submits its calls from one account one after another. The client checks the chain ID of its node before it signs;
     * see {@link SupraConfig}.
     * @param args.senderAccount - Module Publisher KeyPair
     * @param args.packageMetadata - The BCS-encoded package metadata (the `package-metadata.bcs` file of a build)
     * @param args.modulesCode - The bytecode of each module of the package
     * @param args.optionalTransactionArgs optional arguments for transaction. The gas settings in
     * `optionalTransactionPayloadArgs` apply to the transaction; without `maxGas` it is estimated
     * (see {@link OptionalTransactionPayloadArgs}). The object is not modified.
     * @returns `SubmitTransactionResponse`; {@link Submit} describes the statuses and errors of a submission
     * @throws {SupraSimulationFailedError} When the estimating simulation or an enabled simulation does not succeed.
     * @throws {SupraGasUnitPriceBelowMinimumError} When the node refuses the submission or a simulation because the gas
     * unit price is below its minimum (this replaces `SupraSimulationFailedError` and `SupraAPIError` for that refusal).
     * @throws {SupraTransactionFailedError} When `enableWaitForTransaction` is set and the transaction fails.
     * @throws {SupraSubmissionOutcomeUnknownError} When the submission request times out, fails before the node
     * answers or is answered with a 5xx status other than 503 (after the wait, with `enableWaitForTransaction`).
     * @throws {SupraChainIdMismatchError} Before signing, when the chain ID is not the node's.
     * @example
     * ```typescript
     * import { readFileSync } from "node:fs";
     * import { Network, SupraAccount, SupraClient } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     * const account = new SupraAccount(); // an account that holds SUPRA
     *
     * async function runExample() {
     *
     *   const response = await supra.transaction.publishPackage({
     *      senderAccount: account,
     *      packageMetadata: readFileSync("build/MyPackage/package-metadata.bcs"),
     *      modulesCode: [readFileSync("build/MyPackage/bytecode_modules/my_module.mv")],
     *   });
     *
     *   console.log(response);
     * }
     * runExample().catch(console.error);
     * ```
     * @group Transaction
     */
    async publishPackage(args: {
        senderAccount: SupraAccount;
        packageMetadata: Uint8Array;
        modulesCode: Uint8Array[];
        optionalTransactionArgs?: OptionalTransactionArgs;
    }): Promise<SubmitTransactionResponse> {
        return retryWithFreshSequenceNumber(
            args.optionalTransactionArgs?.optionalTransactionPayloadArgs?.sequenceNumber,
            () => publishPackageInternal(args, this.networkInformation),
        );
    }
}
