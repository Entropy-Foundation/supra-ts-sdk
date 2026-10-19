# Changelog

All notable changes to `supra-ts-sdk` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0] - YYYY-MM-DD

This release supports Supra node v11.7.0, which runs on Mainnet and Testnet, and the v12.0.0 release candidates, which
run on Devnet. [`compatibility.json`](./compatibility.json) lists the node releases that each SDK release supports.
Entries marked **Breaking:** change behaviour or types that code written for 1.2.0 can depend on;
[MIGRATION.md](./MIGRATION.md) describes what to change for each of them.

### Added

- **`Network.DEVNET`** — `new SupraClient({ network: Network.DEVNET })` connects to
  `https://rpc-devnet.supra.com` with chain ID 50. The `SupraConfig` type accepts it alongside `Network.MAINNET` and
  `Network.TESTNET`.
- **`SupraFaucetUnavailableError`** — thrown by `fundAccountWithFaucet` when the node answers `"TryLater"` because no
  faucet account is free. **`SupraFaucetResponseError`** is thrown when the node answers with any other body that
  carries no transaction hash; the body is available as `data`.
- **`faucet.getFaucetTransaction({ transactionHash })`** — reads a faucet transaction
  (`GET /rpc/v3/wallet/faucet/transactions/{hash}`).
- **Typed errors.** `SupraNotFoundError` (HTTP 404), `SupraGoneError` (410), `SupraRateLimitError` (429, with
  `retryAfterSeconds` from the body's `retry_after_seconds` or the `Retry-After` header) and
  `SupraServiceUnavailableError` (503) extend `SupraAPIError`, so `instanceof SupraAPIError` still matches.
  `SupraTimeoutError` and `SupraNetworkError` are thrown for a request that times out or fails before the node answers;
  the original error is their `cause`. `SupraError` is the base class of all of them and of the faucet errors.
- **`SupraAPIError.sub_status`** is the abort code of an `ABORTED` status. `parseVmStatus` is exported.
- `MoveVmError` lists the validation, verification, invariant and runtime statuses that clients commonly handle,
  including `ABORTED`, `MISSING_DATA`, `TYPE_RESOLUTION_FAILURE`, `LOOKUP_FAILED` and `MAX_GAS_UNITS_*`.
- **Transaction outcome errors.** `SupraTransactionFailedError` (a transaction the SDK waited for ended with `Fail` or
  `Invalid`; carries `hash`, `status`, `vm_status`, `major_status`, `sub_status` and `transaction`),
  `SupraSimulationFailedError` (a simulation returned a status other than `Success`; carries `status`, `vm_status`,
  `major_status`, `sub_status` and `transaction`) and `SupraTransactionTimeoutError` (no final status within the wait
  timeout; carries `hash`, `timeoutMs`, `lastStatus`, `transaction` and the last read error as `cause`). All three
  extend `SupraError`.
- **`SubmitTransactionResponse`** and **`NotReadBackTransactionResponse`** types.
- **`SupraConfig.waitTimeoutMs`** sets how long `waitForTransaction` and submissions with `enableWaitForTransaction`
  wait for a final status (default `DEFAULT_TXN_WAIT_TIMEOUT_MS`, 60000 ms).
- **`enableTransactionWaitAndSimulationArgs.waitTimeoutMs`** and **`checkSuccess`** set the wait timeout of one
  submission and whether a `Fail` or `Invalid` outcome throws (default true).
- **`WaitForTransactionOptions.timeoutMs`** sets the wait timeout of one `waitForTransaction` call in milliseconds.
  `timeoutSecs` is deprecated and still honoured; `timeoutMs` takes precedence.
- **Max gas estimate.** Without a `maxGas` on the call or the client, the coin and fungible asset transfers,
  `publishPackage` and the entry functions of `Contract.fromABI` read the sender's SUPRA balance, simulate the
  transaction with the largest max gas that balance pays for (at most `MAX_GAS_UNITS_PER_TRANSACTION`), and submit it
  with `ceil(gas used × 1.5)`, at least `MIN_ESTIMATED_MAX_GAS_UNITS` (1,500) and at most what the balance pays for.
  `SupraConfig.maxGasEstimateMultiplier` replaces the factor (`DEFAULT_MAX_GAS_ESTIMATE_MULTIPLIER`).
- **`estimateMaxGas`** in `OptionalTransactionPayloadArgs` and `SupraConfig`: `false` uses `DEFAULT_MAX_GAS_UNITS`
  without a request.
- **Per-account sequence-number counter.** Each `SupraClient` keeps the next sequence number of every account that its
  helpers send from. The first use reads the number from the chain; each transaction the node accepts advances it. A
  refusal for a stale number (`SEQUENCE_NUMBER_TOO_OLD`, `SEQUENCE_NUMBER_TOO_NEW`, or the nodes' refusal of a number
  beyond what they queue for the account, or a number that already has a pending transaction) reads the number from
  the chain again, and the helper sends the transaction once more with the fresh number. A transaction the node refused for another reason gives its number back.
  Concurrent sends from one account in a process get distinct consecutive numbers.
- **`SupraClient.resetSequenceNumber(address)`** forgets the counter of an account; the next transaction reads its
  number from the chain.
- **`OptionalTransactionPayloadArgs.sequenceNumber`** sets the sequence number of a transaction built by
  `coin.transferSupraCoin`, `coin.transferCoin`, `fungibleAsset.transferSupraFungibleAsset`,
  `fungibleAsset.transferFungibleAsset`, `fungibleAsset.migrateCoinToFungibleStore`, `transaction.publishPackage` and
  the entry functions of `Contract.fromABI`.
  The helper uses it as given and does not use or change the counter.
- **Chain ID check before signing.** Before its first signature a client reads the chain ID of its node, from the
  `x-supra-chain-id` header of an earlier response or with `GET /rpc/v3/transactions/chain_id`, and keeps it for its
  lifetime; concurrent first signatures share one request. Every signing path (`signTransaction`, the signing methods
  of `transaction.build` and of a built transaction, the `transaction.submit` methods that take a `senderAccount`, the
  coin and fungible asset transfers, `publishPackage` and the entry functions of `Contract.fromABI`) throws
  **`SupraChainIdMismatchError`** (extends `SupraError`; carries `configuredChainId`, `nodeChainId` and
  `transactionChainId`) before signing when the configured chain ID or the transaction's chain ID is not the node's.
- **`SupraConfig.verifyChainId`**: `false` turns the check off for offline signing. The client signs with its
  configured chain ID and sends no request to do so.
- **`stringifyWithBigInt`** is exported. It serializes a value whose `bigint` fields (for example the result of
  `transaction.build.sendTxnPayload`) `JSON.stringify` rejects, writing them as exact JSON numbers.
- Settlement transactions, returned by nodes from v12 onwards: `TransactionType.Settlement`, the
  `SettlementTransactionResponse` variant of `CommittedTransactionResponse` and `TransactionResponse` (with
  `SettlementData`, `SettlementApplierSummary`, `SettlementCreditSummary` and `AppliedInboundSettlement`), and
  `"settlement"` in `TransactionQueryType`. A settlement item has no `header`, `payload` or `authenticator`.
- `AutomationTransactionResponse.predicate` (`AutomationPredicateInfo`), the `Remove` variant of
  `AutomationRecordAction`, `EvmTransactionOutput` in `TransactionOutput`, and the v12 fields and
  `automation_record_count` of `ExecutedBlockStatistics`, the type of `FinalizedBlockHeader.execution_statistics`.
- `getAccountTransactions` returns a `cursor`: the sequence number after the last transaction of the page in the
  requested order, so the feed is read to its end like the others. Its `start` also accepts a `number` or `bigint`.
- **`SupraConfig.timeoutMs`** sets the request timeout (default 30000 ms) for predefined networks and custom
  configurations.
- **`SupraConfig.retry`** (`{ attempts, maxDelayMs }`) turns on retries of GET requests that fail with 429, 503 or a
  connection failure, honouring the node's `retry_after_seconds` / `Retry-After`. It is off by default; POST requests
  are never retried.
- **`fungibleAsset.migrateCoinToFungibleStore({ senderAccount, coinType?, optionalTransactionArgs? })`** submits
  `0x1::coin::migrate_to_fungible_store`, which moves the sender's balance of a coin type (default SUPRA) from its
  `CoinStore` to the primary fungible store of the paired fungible asset.
- **`SupraInsufficientFungibleAssetBalanceError`** (`senderAddress`, `assetAddress`, `amount`, `fungibleAssetBalance`,
  `coinBalance`), thrown by the SUPRA fungible asset transfers described under Changed.
- **`account.getAccountSupraBalance`** returns `{ total, coin, fungibleAsset }` (`SupraBalance`): the SUPRA balance in
  quants and the parts held in the `CoinStore` and in the fungible asset store.
- **`SUPRA_FUNGIBLE_ASSET_ADDRESS`** is the address of the SUPRA fungible asset (`0xa`, padded to 64 digits).
- `pnpm examples` runs every example in `examples/` against the network that `SUPRA_RPC_URL`/`SUPRA_CHAIN_ID` or
  `SUPRA_NETWORK` names (default Devnet); `SUPRA_EXAMPLES_FUND=1` funds their accounts from that node's faucet. The
  examples create or query the data they need instead of using hard-coded hashes, heights and Testnet addresses. CI
  type-checks the examples, and a scheduled workflow runs them on Devnet.
- README sections on reading a feed page by page and on the HTTP status codes that differ between v11 and v12
  nodes.
- `pnpm check:jsdoc` type-checks the ```` ```typescript ```` blocks of the JSDoc under `src/`, of `SKILL.md` and of
  `MIGRATION.md` against `src/index.ts`; CI runs it with the lint and type-check steps.
- [`MIGRATION.md`](./MIGRATION.md) lists the breaking changes from 1.2.0 to 2.0.0 and the code to change for each.
- [`compatibility.json`](./compatibility.json) lists, for each SDK release, the node releases it supports and the RPC
  API versions it calls. A unit test checks that its latest release is the version in `package.json`. The package
  ships it, readable as `supra-ts-sdk/compatibility.json`.
- [`RELEASING.md`](./RELEASING.md) describes the versioning policy, the npm dist-tags and the release checklist.

### Changed

- **Breaking:** `fundAccountWithFaucet` sends the request on every network, including custom configurations, instead of
  throwing `Faucet is only available on testnet` on all but Testnet. A node that does not serve the faucet answers with
  an error status, which is thrown as `SupraAPIError`.
- **Breaking:** `fundAccountWithFaucet` throws `SupraFaucetUnavailableError` or `SupraFaucetResponseError` where it
  returned `{ hash: undefined }`.
- **Breaking:** `SupraAPIError.message` is the node's `message` when the error body has one (for example
  `General err: MoveTransactionValidationFailed(0x…, 0, SEQUENCE_NUMBER_TOO_OLD)`), otherwise the HTTP status text.
  It was always the status text. `statusText` and `data` are unchanged.
- **Breaking:** `SupraAPIError.major_status` is the name of the Move VM status that the message reports (view errors
  and submit validation errors), and `undefined` when the message names none.
  It was `"unknown"` for every error. `toJSON()` also returns `message` and `sub_status`.
- **Breaking:** `MoveVmError` follows the Move VM `StatusCode` names: `MOVE_ABORT`, which is not a VM status, is
  removed (`ABORTED` replaces it), the description of `OUT_OF_GAS` is corrected, and the link to an unrelated
  repository is removed.
- **Breaking:** `SupraFaucetUnavailableError` and `SupraFaucetResponseError` extend `SupraError`; they are still not
  `SupraAPIError`s and keep their names.
- **Breaking:** a request that times out or fails before the node answers, or whose response body cannot be read,
  rejects with `SupraTimeoutError` or
  `SupraNetworkError` instead of a raw `DOMException` or `TypeError`.
- **Breaking:** a submission with `enableWaitForTransaction: true` throws `SupraTransactionFailedError` when the
  transaction ends with `Fail` or `Invalid`, unless `checkSuccess: false` is passed. It resolved with the failed
  transaction. This applies to every submit helper: `transaction.submit.*`, the submit methods of a built transaction,
  `coin.transferSupraCoin`, `coin.transferCoin`, `fungibleAsset.transferSupraFungibleAsset`,
  `fungibleAsset.transferFungibleAsset`, `transaction.publishPackage` and the entry functions of `Contract.fromABI`.
- **Breaking:** a simulation throws `SupraSimulationFailedError` for every status other than `Success`, including
  `PendingAfterExecution` (for example `SENDING_ACCOUNT_DOES_NOT_EXIST` or `SEQUENCE_NUMBER_TOO_NEW`) and `Invalid`.
  It threw a `SupraAPIError` with status 400 for `Fail` only. With `enableTransactionSimulation: true`, a failed
  simulation means the transaction is not submitted.
- **Breaking:** `waitForTransaction` and submissions with `enableWaitForTransaction` keep waiting while the status is
  `Pending` or `PendingAfterExecution` and while a read fails (including HTTP 404 for a transaction the node has not
  seen yet), until the wait timeout measured in wall-clock time. A timeout throws `SupraTransactionTimeoutError`, and a
  `Fail` or `Invalid` outcome throws `SupraTransactionFailedError`; both threw a `SupraAPIError` with status 500. The
  default timeout is 60 seconds; submissions used 20 seconds.
- **Breaking:** the submit helpers listed above return `SubmitTransactionResponse`
  (`TransactionResponse | NotReadBackTransactionResponse`). Without `enableWaitForTransaction`, when the node accepts
  the transaction and the read that follows fails, they return `{ hash, status: "NotReadBack", readError }`; they threw
  the read's error, which did not carry the hash.
- **Breaking:** `isPendingTransaction` returns true for `PendingAfterExecution` as well as `Pending`.
- **Breaking:** `deriveTransactionHash` returns the hash with a `0x` prefix, the form `getTransactionByHash` and
  `waitForTransaction` accept. It returned 64 hex characters without the prefix.
- **Breaking:** `getTransactionByHash` takes no type argument. It returns `TransactionResponse`, which is narrowed
  by `txn_type`; the type argument did not change the value returned.
- **Breaking:** `DEFAULT_MAX_GAS_UNITS` is 20,000 units (was 1,000). It is the max gas of a transaction that sets
  none when the estimate is turned off or the estimating simulation could not run to a result (a request error, a
  response without `gas_used`), and of the builders that cannot estimate. The node requires the sender's balance to pay
  for `max gas × gas unit price`: 20 SUPRA at the default gas unit price of 100,000 quants. A sender with less must set
  `maxGas` on the builders that make no request.
- **Breaking:** without a `maxGas` on the call or the client, a transaction's max gas is estimated by the methods listed
  under Added, and `transaction.build.simple` uses `DEFAULT_MAX_GAS_UNITS` at most what the sender's balance pays for
  (one balance read). These methods make a balance read and, except `transaction.build.simple`, a simulation request
  before the submission. A transaction whose estimating simulation has a status other than `Success` (an abort,
  `OUT_OF_GAS`, `PendingAfterExecution`, `Invalid`) throws `SupraSimulationFailedError` and is not submitted.
- **Breaking:** `SupraClient.networkInformation.maxGas` is `undefined` when `SupraConfig.maxGas` is not set; it was
  `DEFAULT_MAX_GAS_UNITS`.
- **Breaking:** `coin.transferSupraCoin`, `coin.transferCoin`, `fungibleAsset.transferSupraFungibleAsset`,
  `fungibleAsset.transferFungibleAsset`, `transaction.publishPackage` and the entry functions of `Contract.fromABI` (and
  the new `fungibleAsset.migrateCoinToFungibleStore`) take the sequence number from the client's counter instead of
  reading it from the chain on every call. Transactions sent by other means from the same account (another client or
  process, a wallet, a transaction built with an explicit number) make the counter stale; the next helper call then
  costs one refused submission and a read of the chain, and succeeds. After a `SupraTransactionTimeoutError` for a
  transaction that will not commit, call `resetSequenceNumber`. A transaction the node discarded after accepting it
  (`Invalid` final status) also resets the counter.
- **Breaking:** `signTransaction`, `transaction.build.signedTransaction`, `transaction.build.sendTxnPayload` and the
  `signTransaction`, `signedTransaction` and `sendTxnPayload` methods of a built transaction return promises, since a
  client's first signature reads the node's chain ID. Code that already awaits them is unaffected.
- **Breaking:** a client whose configured chain ID differs from its node's throws `SupraChainIdMismatchError` from
  every signing path, including the submit helpers and transfers, unless `verifyChainId: false` is set.
- **Breaking:** `getChainId()` returns a promise that resolves to the node's chain ID; it returned the configured chain
  ID synchronously. With `verifyChainId: false` it resolves to the configured chain ID without a request.
- **Breaking:** `validateChainId()` throws `SupraChainIdMismatchError`, whose message is
  `The configured chain ID <configured> does not match the node's chain ID <node>`; it threw a plain `Error`. It reads
  the node's chain ID once per client and shares it with signing and `getChainId()`.
- **Breaking:** `new SupraClient` throws a `RangeError` when the `chainId` of a custom configuration is not an integer
  from 0 to 255, and a `TypeError` when `verifyChainId` is not a boolean.
- **Breaking:** integer arguments given as strings (`u8` to `u256` in entry functions, `u8` to `u256` and `i8`
  to `i256` in views) must be decimal digits, with a leading `-` for signed types, or, for entry
  functions, `0x` followed by hex digits. Empty and whitespace-only strings, strings with surrounding
  whitespace, `"1.5"`, `"-1"` for unsigned types, `"0x"` and values above the maximum of the type throw
  before any request, with an error naming the argument index and type. Previously `""` and `" "` were
  encoded as 0 and padded strings were accepted.
- **Breaking:** `methods.view` encodes an `Option<u8>` argument the way the node reads it, as the hex of the
  byte (`Some(16)` is `{"vec":"10"}`). It was sent as the decimal string, which the node read as a
  different byte or rejected. `Option<T>` for every other `T` is a one-element array of the encoded
  value, `None` is an empty array, and `Option<vector<u8>>` carries the hex of the bytes.
- A `vector<u8>` argument of a view is validated: a string must be hex of whole bytes, with or without
  `0x`, and array elements must be integers from 0 to 255.
- **Breaking (types):** `FunctionTypeArgs`, the type of an entry in `ty_args` of a transaction payload
  in JSON form, is a union of the primitive type names, `{ vector }` and `{ struct }` instead of an
  interface that only describes `{ struct }`. Code that reads `ty_args[i].struct` directly must narrow
  the value first.
- **Breaking:** `signTransaction` has one signature per kind of transaction: it resolves to the `HexString` signature
  for a `RawTransaction` and to the `AccountAuthenticatorEd25519` for a `MultiAgentRawTransaction` or
  `FeePayerRawTransaction`, and to `HexString | AccountAuthenticatorEd25519` for an `AnyRawTransaction`. Casts of the
  result are no longer needed. `ExtendedRawTransaction.signTransaction` resolves to `HexString`.
- **Breaking:** `PaginatedResponse.cursor` is `undefined` exactly at the end of a feed, on v11 and v12 nodes alike.
  The empty header, the `"0"` of `coin_transactions` and the echoed `start` of `resources` and `modules` that v11
  nodes send at the end of a feed are returned as `undefined`. A page can be empty and still carry a cursor.
- **Breaking:** `getEventsByType` types `options.start` as `string`, the type of the cursor it returns. It was
  `number`.
- Every cursor option (`start` or `cursor`) accepts `undefined`, so a returned cursor is passed back without a
  check or a cast. An empty cursor is not sent.
- **Breaking:** `CommittedTransactionResponse` and `TransactionResponse` include `SettlementTransactionResponse`.
  Code that reads `header`, `payload` or `authenticator` must narrow on `txn_type` first.
- **Breaking:** `EmptyTransactionOutput` is the string `"Empty"`, which is what the node sends. It was declared
  as `{ Empty: null }`.
- **Breaking:** `PendingTransactionResponse.txn_type` is `TransactionType.User`. `BlockMetadataTransactionResponse`
  and `AutomationRecordTransactionResponse` declare `output` as non-null. `block_header` is optional on every
  transaction response, as the node's API schema declares it; transactions returned as part of a block have
  `block_header: null`.
- **Breaking:** `FinalizedBlockHeader.transactions` is optional, since the node omits it unless the block is
  requested with `withFinalizedTransactions: true`, and is typed `CommittedTransactionResponse[]`.
- The `type` option of `getBlockByHeight` and `getTransactionsByBlockHash` is `TransactionQueryType`, which adds
  `"record"` and `"settlement"`.
- **Breaking:** `isAccountExists` returns `false` only when the node reports the account as absent (HTTP 404 on
  v12 nodes, HTTP 400 with a "Resource not found" message on v11 nodes). Every other failure, such as an unreachable
  node, a timeout, HTTP 429 or HTTP 5xx, is thrown.
- **Breaking:** `new SupraClient` throws a `TypeError` when `rpcUrl` is not an absolute `http:` or `https:` URL.
- `rpcUrl` may end in slashes and may carry a path prefix (`https://host/prefix/`); every request goes to the same
  URL whichever form is configured.
- **Breaking:** `SupraClient.config` is a copy of the configuration object passed to the constructor, no longer that
  object.
- Clients of a predefined network no longer share one mutable network configuration: the gas, timeout and retry
  settings of one `SupraClient` no longer reach another client of the same network.
- `SupraConfig` documents which settings belong to a client: all of them.
- **Breaking:** the `SupraClient` type no longer declares `build`, `simulate` and `submit`, which were `undefined` at
  runtime. Use `supra.transaction.build`, `supra.transaction.simulate` and `supra.transaction.submit`.
- **Breaking:** `fungibleAsset.transferSupraFungibleAsset`, and `fungibleAsset.transferFungibleAsset` with the SUPRA
  fungible asset address, read the sender's fungible asset balance first and throw
  `SupraInsufficientFungibleAssetBalanceError` without submitting a transaction when it is below `amount`. The transfer
  moves only the fungible asset store; SUPRA that an account received as a coin (for example from the faucet) is in its
  `CoinStore` until `fungibleAsset.migrateCoinToFungibleStore` moves it. Before, the transaction was submitted and
  aborted on chain. `coin.transferSupraCoin` moves SUPRA held in either form.
- `account.getAccountSupraCoinBalance` and `account.getAccountCoinBalance` with a coin type return the total SUPRA
  balance (`CoinStore` plus the paired fungible asset store); `getAccountCoinBalance` with a fungible asset address
  returns that asset's primary store only, so it is 0 for SUPRA that has not been migrated. The behaviour is unchanged;
  the documentation now states it.
- **Breaking:** `account.getAccountCoinsCount` also counts SUPRA held as a fungible asset when the account has no
  `CoinStore<SupraCoin>`, so a migrated account returns 1 where it returned 0. Fungible assets other than SUPRA are not
  counted: the node has no listing of an account's fungible asset stores.
- `getFungibleAssetMetadata` is declared to return `FungibleAssetMetadata` (`name`, `symbol`, `decimals`,
  `icon_uri`, `project_uri`), which is what it returns. It was declared `CoinInfo`.
- The examples `buildTransaction.ts` and `submitTransaction.ts` read a fresh sequence number for each transaction
  (they reused the number of the first one), use the client's RPC URL for the raw HTTP request, and take the
  automation gas price cap from the network's minimum gas unit price.
- **Breaking:** `standardizeAddress` returns lower-case hex, and throws a `RangeError` for an address of more than 64
  hex digits instead of a `SupraAPIError` with status 400 that no node sent. An address in upper case now matches the
  SUPRA fungible asset address, and `resetSequenceNumber` finds the counter of such an address.

### Fixed

- `simulate` sends a copy of the payload with zero signatures and does not modify the caller's payload; the caller's
  signatures were replaced with zeros when the simulation request failed.
- `coin.transferSupraCoin`, `coin.transferCoin`, `fungibleAsset.transferSupraFungibleAsset` and
  `fungibleAsset.transferFungibleAsset` submit the `maxGas`, `gasUnitPrice` and `txExpiryTime` of
  `optionalTransactionArgs.optionalTransactionPayloadArgs`; they used the client's settings. A transfer of SUPRA with
  `coin.transferCoin` to a new account no longer runs out of gas with the default settings.
- No method modifies the options object it is given: the transfers no longer write a `maxGas` into
  `optionalTransactionPayloadArgs`, and `methods.view` no longer writes the fetched ABI into the caller's arguments.
- `transferSupraCoin`, `transferCoin`, `transferFungibleAsset` and `transferSupraFungibleAsset` encode the
  receiver and asset addresses as 32 bytes, left-padded with zeros, for every address that
  `validateAddress` accepts (1 to 64 hex characters). Addresses of 63 or fewer characters previously
  threw or were sent as arguments shorter than 32 bytes. The address of the sender of a raw
  transaction, the multisig address and the module address are padded the same way.
- Entry function arguments of type `vector<u8>` accept `number[]`, `Uint8Array`, `ArrayBuffer` and hex
  strings with or without `0x`, with identical BCS. Previously only `number[]` was accepted although the
  argument types admit the other forms.
- `transaction.build.simple` removes every leading `&signer` and `signer` parameter of the entry function
  from the expected arguments, not only the first, so functions with several signer parameters can be
  built.
- Type arguments of every `TypeTag` variant (`bool`, `u8` to `u256`, `address`, `signer`, `vector` and
  `struct` with type parameters, nested to any depth) are written correctly in transaction payloads.
  Building, simulating or submitting an entry function, script, automation registration or multisig
  transaction with a non-struct type argument previously threw a `TypeError`.
- `methods.view` writes a `TypeTag` type argument as its full Move type string, including the type
  parameters of a struct, and accepts non-struct `TypeTag` values. A `TypeTag` and its string form
  produce the same request.
- Script arguments of type `u16` are accepted by `parseScriptArgs`; previously they threw
  `Invalid script argument variant`. `u32` and `u256` script arguments are covered by tests.
- `getAccountInfo` returns `sequence_number` as a `bigint`, the declared type. It returned the number the node
  sends, so `info.sequence_number + 1n` threw a `TypeError`.
- `supra.constructor` is `SupraClient`; it was the constructor of the last mixed-in class.
- The JSDoc of `events.getEventsByType` describes events and calls `getEventsByType`.
- Every example in the JSDoc of the public API compiles against the 2.0.0 API (imports from `supra-ts-sdk`, awaited
  signing, current option names, self-contained accounts and addresses); several imported from `supra-l1-sdk` or
  called methods that do not exist. The descriptions of `getCoinInfo`, the transfers, `publishPackage`, the
  `transaction.submit` methods, `fundAccountWithFaucet`, `methods.view`, `getGasPrice`, `getMinGasUnitPrice` and the
  `SupraClient` constructor state the behaviour of 2.0.0: units, the sequence-number counter, the chain ID check, the
  errors thrown, and where the gas unit price comes from.
- `.claude/skills/supra-ts-sdk/SKILL.md`, which the package ships, describes 2.0.0: gas estimation, per-call gas
  settings and the 20,000-unit default of the builders, the faucet on every network and `SupraFaucetUnavailableError`,
  `isAccountExists`, the typed errors, async signing, the chain ID check, the sequence-number counter,
  `Network.DEVNET`, `migrateCoinToFungibleStore`, cursors, and quants as the smallest SUPRA unit. Its code blocks
  type-check.

### Removed

- **Breaking:** `DEFAULT_TXN_TIMEOUT_SEC`; `DEFAULT_TXN_WAIT_TIMEOUT_MS` replaces it.
- **Breaking:** `DEFAULT_MAX_GAS_FOR_SUPRA_TRANSFER_WHEN_RECEIVER_EXISTS` and
  `DEFAULT_MAX_GAS_FOR_SUPRA_TRANSFER_WHEN_RECEIVER_NOT_EXISTS`; the max gas estimate replaces the transfers'
  receiver-dependent max gas.
- **Breaking:** the constants `DEFAULT_CHAIN_ID`, `MAX_RETRY_FOR_TRANSACTION_COMPLETION`,
  `DELAY_BETWEEN_POOLING_REQUEST` and `DEFAULT_RECORDS_ITEMS_COUNT`. No function of the SDK read them; the chain ID
  comes from `SupraConfig` and the wait is set by `waitTimeoutMs`.

## [1.2.0] - 2026-09-22

### Added

- **`SupraClient.validateChainId()`** — verifies the configured `chainId`
  against the network's real `chain_id` (`GET /rpc/v3/transactions/chain_id`)
  and throws on mismatch
  ([#16](https://github.com/Entropy-Foundation/supra-ts-sdk/pull/16)). Guards
  against a misconfigured `chainId` and against a Byzantine RPC reporting one
  `chain_id` while accepting transactions signed for another. It's an
  explicit, opt-in call — the constructor never calls it, so existing callers
  are unaffected.

  An earlier version of this change (`SupraClient.init()`) auto-corrected a
  mismatched `chainId` and logged a warning; that shipped only within this
  release cycle and was replaced before reaching a tagged release, since
  silently overriding a caller-supplied `chainId` is itself a spoofing risk.

### Fixed

- **`estimate_gas_price` calls no longer 404**
  ([#16](https://github.com/Entropy-Foundation/supra-ts-sdk/pull/16)).
  `getGasPriceInternal` and `getMinGasUnitPriceInternal` built their request
  path with a redundant `/rpc/v3` prefix that `get()` already adds, so every
  call to `estimate_gas_price` — and therefore `getGasPrice()` /
  `getMinGasUnitPrice()` — 404'd against a live RPC.

### Internal

- `get<Res>` relaxed from `get<Res extends object>` to support RPC responses
  that are a bare value rather than an object, such as `chain_id`.
- New tests: `getChainIdInternal`, `getGasPriceInternal`,
  `getMinGasUnitPriceInternal`, and `SupraClient.validateChainId()`.

## [1.1.0] - 2026-08-27

### Fixed

- **Transaction JSON bodies no longer lose precision on u64/u128 values**
  ([#14](https://github.com/Entropy-Foundation/supra-ts-sdk/pull/14)). Bigint
  fields were coerced to `number` before serialization, so any value above
  `Number.MAX_SAFE_INTEGER` was rounded on its way to the RPC — a caller-supplied
  `9007199254740993` was emitted as `9007199254740992`. Because the signature is
  computed over the BCS encoding of the raw transaction, a rounded JSON body no
  longer matched what was signed: `submit` was rejected on signature
  verification, and `simulate` — which zeroes the signatures before sending —
  silently reported results for a transaction the caller never authored.

  Affected: script payload `U64`/`U128` arguments, the raw transaction header
  fields, and the automation registration u64 fields. Entry function arguments
  were never affected, since they travel as BCS bytes. The wire format is
  unchanged and no server-side change is required.

### Changed

- **Public type widening (source-compatibility note).** The u64 fields of the
  exported types `RawTxnJSON`, `ScriptArgumentJson` and
  `AutomationRegistrationParamV1JSON` are now `bigint | number` instead of
  `number`. No public API returns these types, so passing them as input or
  letting the SDK build them is unaffected. Only TypeScript code that annotates
  its own values with them and then reads a u64 field into a `number` needs a
  narrowing check or a `BigInt`/`Number` conversion.

### Security

- Patched the dev-only `js-yaml@3` transitive dependency, bumping the override
  from `^3.15.0` to `^3.15.2`
  ([#13](https://github.com/Entropy-Foundation/supra-ts-sdk/pull/13)). The
  pinned `3.15.0` is vulnerable to quadratic CPU consumption during `!!omap`
  resolution (GHSA 1138114, the unbackported CVE-2026-59870 fix). It is reached
  only through the Jest toolchain, so no published artifact was affected.

### Internal

- The HTTP `post` layer now serializes every request body through a new
  bigint-aware stringifier that writes bigints as exact JSON number literals and
  fails closed if a payload string collides with its internal marker.
- `AGENTS.md` and `.agents/skills` are now symlinks to `CLAUDE.md` and
  `.claude/skills` so the two copies cannot drift. The npm tarball is unchanged:
  `files` still ships `.claude/skills`, and the symlinks are not included.
- Added regression tests asserting the serialized request body for values above
  2^53, plus first-time coverage for `parseScriptArgs`.

## [1.0.0] - 2026-07-21

Initial public release: typed account queries, the transaction lifecycle
(build → simulate → submit → wait), proxy-based ABI contract interaction, coin
and fungible asset helpers, event and block queries, and Move-native type
handling. Dual ESM/CJS output, Node 18+.

[Unreleased]: https://github.com/Entropy-Foundation/supra-ts-sdk/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/Entropy-Foundation/supra-ts-sdk/compare/v1.2.0...v2.0.0
[1.2.0]: https://github.com/Entropy-Foundation/supra-ts-sdk/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Entropy-Foundation/supra-ts-sdk/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Entropy-Foundation/supra-ts-sdk/releases/tag/v1.0.0
