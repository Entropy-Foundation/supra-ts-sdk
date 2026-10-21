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
  the original error is their `cause`. For a submission request they are the `cause` of
  `SupraSubmissionOutcomeUnknownError` (below). `SupraError` is the base class of all of them and of the faucet errors.
- **`SupraAPIError.sub_status`** is the abort code of an `ABORTED` status. `parseVmStatus` is exported.
- `MoveVmError` lists the validation, verification, invariant and runtime statuses that clients commonly handle,
  including `ABORTED`, `MISSING_DATA`, `TYPE_RESOLUTION_FAILURE`, `LOOKUP_FAILED` and `MAX_GAS_UNITS_*`.
- **Transaction outcome errors.** `SupraTransactionFailedError` (a transaction the SDK waited for ended with `Fail` or
  `Invalid`; carries `hash`, `status`, `vm_status`, `major_status`, `sub_status` and `transaction`),
  `SupraSimulationFailedError` (a simulation returned a status other than `Success`; carries `status`, `vm_status`,
  `major_status`, `sub_status` and `transaction`) and `SupraTransactionTimeoutError` (no final status within the wait
  timeout; carries `hash`, `timeoutMs`, `lastStatus`, `transaction` and the last read error as `cause`). All three
  extend `SupraError`.
- **`SupraSubmissionOutcomeUnknownError`** (extends `SupraError`; carries `hash`, `sender`, `sequenceNumber`,
  `expirationTimestampSecs`, `waitError`, and the error of the request as `cause`) is thrown by every submit helper
  when the submission request times out (`SupraTimeoutError`), fails before the node answers (`SupraNetworkError`), or
  is answered with a 5xx status other than 503 (`SupraAPIError`). In each case the node may have accepted the
  transaction; look `hash` up or wait for it before sending the transaction again. The submit helpers derive the hash
  from the signed transaction before they submit it (the Keccak-256 of its BCS bytes, as `deriveTransactionHash`
  does), which is the hash v11.7.0 and v12 nodes give a transaction of every kind the SDK submits. With
  `enableWaitForTransaction`, the helper first waits for that hash within the wait timeout: a transaction that reaches
  a final status is returned, or throws `SupraTransactionFailedError`, as after an accepted submission, and the error
  is thrown, with the wait's `SupraTransactionTimeoutError` as `waitError`, when the wait ends without a final status.
  A refusal of the node (a 4xx status or 503) is thrown as a `SupraAPIError`, or as
  `SupraGasUnitPriceBelowMinimumError` when the gas unit price is below the node's minimum (below).
- **`FixedPoint32` and `FixedPoint64` arguments.** An entry or view function parameter of type
  `0x1::fixed_point32::FixedPoint32` or `0x1::fixed_point64::FixedPoint64`, also inside `vector` and `Option`, takes the
  struct's raw `u64` or `u128` value as a `bigint` or a decimal string, with the range checks of `u64` and `u128`.
  `transaction.build.simple` previously threw `Unsupported type` for them. `MoveToTS` maps them to
  `bigint | string`.
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
  `SupraConfig.maxGasEstimateMultiplier` replaces the factor (`DEFAULT_MAX_GAS_ESTIMATE_MULTIPLIER`). The simulation
  runs against committed state: for a transaction sent while earlier transactions of the account that this client
  submitted have not committed, it uses the account's sequence number on the chain, so pipelined transactions work
  with the default gas settings; a transaction that depends on an earlier uncommitted one fails its estimate and needs
  `maxGas`. When the simulation reports the number as too new, the estimate reads the account and the latest block. It
  uses the chain's number when every number between it and the transaction's has a record of a transaction this client
  submitted (see the counter below); otherwise the transaction is built and signed again with the lowest number that
  has no record, without giving up its place in the order of the calls. No transaction is read by hash. A failed read
  of the account is thrown and nothing is submitted.
- **`estimateMaxGas`** in `OptionalTransactionPayloadArgs` and `SupraConfig`: `false` uses `DEFAULT_MAX_GAS_UNITS`
  without a request.
- **`getEstimatedGasUnitPrice()`** returns the gas unit price that a transaction carries when neither the call nor
  `SupraConfig.gasUnitPrice` sets one: `max(median_gas_price, min_configured_gas_price)` of
  `GET /rpc/v3/transactions/estimate_gas_price`. It throws a `SupraError` naming the field when
  `median_gas_price` or `min_configured_gas_price` is missing or is not a non-negative integer.
- **`SupraGasUnitPriceBelowMinimumError`** (extends `SupraError`) is thrown when the node refuses a submission or a
  simulation with `GAS_UNIT_PRICE_BELOW_MIN_BOUND`; `gasUnitPrice` is the price sent, `minimumGasUnitPrice` the node's
  minimum read after the refusal (`undefined` when that read fails), `major_status` the status name, and `cause` the
  original `SupraAPIError` of the submission or `SupraSimulationFailedError` of the simulation. The transaction is not
  sent again and its price is not raised.
- **Per-account sequence-number counter.** Each `SupraClient` keeps, for every account that its helpers send from, the
  account's sequence number on the chain and a record of each transaction it submitted (accepted, or whose submission
  request failed without an answer, so the node may have accepted it) with that transaction's expiration time and hash
  (the node's answer, or for a request without an answer the hash derived from the signed transaction). A
  transaction the node accepted either commits or, once the timestamp of the latest block has reached its expiration
  time, can no longer commit. A record is dropped when the chain's number passes it, when the timestamp of a latest
  block the client reads (`GET /rpc/v3/block`; not a block read by height or hash) has reached its expiration time, or
  when a read of the transaction returns `Invalid`; an HTTP 404 does not drop it, since an RPC node answers 404 for a
  pending transaction that another RPC node received. A submission whose outcome is unknown holds its number until the
  transaction's expiration time or `resetSequenceNumber`, including when its expiration time was beyond what a node
  accepts. The next number is the lowest number at or above the
  chain's that has no record. The first use reads the account and the latest block; so does the next call after a
  refusal for a stale number or a full queue, and every call (once per call) while the estimated chain time has passed
  the expiration time of a record by two seconds and no latest block read has reached it. The estimated chain time is
  the newest latest block's timestamp read plus the time elapsed since that read on a monotonic clock
  (`performance.now()`); it does not depend on the client's wall clock and does not move backwards. A read never drops a record that can still commit. A check behind pending
  transactions uses the higher of the account's number read and the highest number the client has observed on the
  chain. A refusal for a stale number
  (`SEQUENCE_NUMBER_TOO_OLD`, `SEQUENCE_NUMBER_TOO_NEW`, a number below the account's, or a number that already has a
  pending transaction) makes the helper send the transaction once more with the next number. A transaction refused
  for another reason has no record, and the next call uses its number. Transactions with an explicit
  `sequenceNumber` are recorded as well. After a submission whose outcome is unknown that the node did not accept,
  later calls wait behind its number in the node until the chain's time reaches its expiration time, and the next
  call then takes that number. Calls of one client
  from one account are submitted one after another: a call holds the account from taking its number until the node
  answers its submission, and the wait for the final status comes after that. A call without `maxGas` holds the account
  while its max gas is estimated; a call with `maxGas` waits only until the calls ahead of it have been submitted or
  have failed. Concurrent sends from one account get consecutive numbers. To submit faster, set `maxGas` or send from
  several accounts. A call with an explicit `sequenceNumber` does not take part in this order.
- **`SupraClient.resetSequenceNumber(address)`** forgets the counter of an account and its records of the client's
  transactions; the next transaction reads its number from the chain. While a transaction of this client from the
  account is pending, the node refuses the next helper call, whose number that transaction holds; reset when none is
  pending or their expiration times have passed.
- **`SupraAccountQueueFullError`** (extends `SupraAPIError`; carries `sequenceNumber`) is thrown when the node refuses a
  submission whose sequence number is beyond the numbers it queues for the account ahead of the chain's (25 by
  default). The helpers do not send it again; the next call reads the chain before it takes a number.
- **`SupraConfig.txExpirySecs`** sets how many seconds after the client's clock (in whole seconds) a transaction built
  without `txExpiryTime` expires: an integer from 1 to `MAX_TX_EXPIRATION_DURATION` (600), default
  `DEFAULT_TX_EXPIRATION_DURATION` (60). The expiration time is at most 595 seconds after the client's clock
  (`MAX_TX_EXPIRATION_DURATION - TX_EXPIRATION_MARGIN_SECS`), so that a node whose clock is up to 5 seconds behind the
  client's accepts `txExpirySecs: 600`.
- **`OptionalTransactionPayloadArgs.sequenceNumber`** sets the sequence number of a transaction built by
  `coin.transferSupraCoin`, `coin.transferCoin`, `fungibleAsset.transferSupraFungibleAsset`,
  `fungibleAsset.transferFungibleAsset`, `fungibleAsset.migrateCoinToFungibleStore`, `transaction.publishPackage` and
  the entry functions of `Contract.fromABI`.
  The helper uses it as given and does not take part in the order of the calls; the counter records the submitted
  transaction like its own and does not hand out its number while it can commit.
- **Chain ID check before signing.** Before its first signature a client reads the chain ID of its node, from the
  `x-supra-chain-id` header of an earlier response or with `GET /rpc/v3/transactions/chain_id`, and keeps it for its
  lifetime; concurrent first signatures share one request. Every signing path (`signTransaction`, the signing methods
  of `transaction.build` and of a built transaction, the `transaction.submit` methods that take a `senderAccount`, the
  coin and fungible asset transfers, `publishPackage` and the entry functions of `Contract.fromABI`) throws
  **`SupraChainIdMismatchError`** (extends `SupraError`; carries `configuredChainId`, `nodeChainId` and
  `transactionChainId`) before signing when the configured chain ID or the transaction's chain ID is not the node's.
- **`SupraConfig.verifyChainId`**: `false` turns the check off for offline signing. The client signs with its
  configured chain ID and sends no request to do so.
- **`parseTypeArgument`** is exported. It parses a Move type string into a `TypeTag` with the grammar of the node's type
  parser, as the SDK does for type argument strings: `0x1::object::Object<T>` stays the struct `Object<T>`, and names
  that contain `T` followed by digits are accepted. Use it for the `TypeTag`s of `transaction.build.rawTxnObject` and
  the other builders that take `TypeTag`s, where `TypeTagParser` turns `Object<T>` into `address`.
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
- **`SupraConfig.timeoutMs`** sets the request timeout (default 30000 ms; an integer up to 2147483647) for predefined
  networks and custom configurations.
- **`SupraConfig.retry`** (`{ attempts, maxDelayMs }`, `maxDelayMs` up to 2147483647) turns on retries of GET
  requests that fail with 429, 503 or a connection failure, honouring the node's `retry_after_seconds` /
  `Retry-After`. It is off by default; POST requests and the faucet request are never retried.
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
- The types that public signatures reference are exported: `ExtendedRawTransaction` (returned by the `Build` methods),
  `FixedPointType` and `MoveToTSOther` (used by `MoveToTS`).
- **Multisig helpers** on `supra.multisig` and the client: `createMultisigAccount` (`create_with_owners`; returns
  `{ multisigAddress, transaction }`, the address derived from the sender and the creating transaction's sequence
  number), `proposeMultisigTransaction` (`create_transaction`, payload stored on chain),
  `proposeMultisigTransactionWithHash` (`create_transaction_with_hash`), `approveMultisigTransaction`,
  `rejectMultisigTransaction`, `executeMultisigTransaction`, `executeRejectedMultisigTransaction`, and the reads
  `getMultisigSequenceNumbers`, `getMultisigProposal` and `getNextMultisigProposal`. They use the client's sequence
  numbers, chain ID check, estimated max gas and hash derivation. `executeMultisigTransaction` reads the next proposal
  and sends no payload when the proposal stores it and the call gives none, the call's `payload` when it matches the
  stored one or the stored hash; it throws `SupraMultisigPayloadError` before submitting when a needed payload is
  missing or does not match, and `SupraMultisigNoProposalError` when the queue is empty. The nodes of v11.7.0 and
  v12.0.0.rc6 do not simulate an execution without a payload (`MISSING_DATA`), so the max gas estimate and
  `enableTransactionSimulation` simulate it with the stored payload carried, while the transaction that is sent
  carries none; a stored payload that cannot be decoded throws `SupraMultisigPayloadError` (`stored-undecodable`) when
  the call needs that simulation. A simulation does not detect missing approvals or an expired proposal.
  `deriveMultisigAccountAddress`, the types `MultisigProposal`,
  `MultisigVote`, `MultisigSequenceNumbers`, `MultisigEntryFunctionPayload`, `CreateMultisigAccountResponse` and
  `MultisigExecutionPayloadArgs`, and the constants `DEFAULT_MULTISIG_TIMEOUT_DURATION_SECS` (seven days) and
  `MIN_MULTISIG_TIMEOUT_DURATION_SECS` are exported.
- **Automation registrations with version 2 parameters.** `transaction.build.automationRegistrationRawTxnObject` takes
  `automationTaskType` (`AutomationTaskType`: `"User"` or `"System"`) and `automationPriority` (a `u64` `bigint`).
  With either one the registration carries version 2 parameters (`RegistrationParamsV2` of the node: the version 1
  fields followed by the task type and the optional priority), with task type `"User"` when only the priority is
  given; without them it carries version 1 parameters as before. Nodes of the v11.7.0 and v12 lines accept both.
  Without a priority the registry assigns the task index. Only an account that the Supra framework has authorised can register a `"System"`
  task. The submit and simulate methods that take a serialized raw transaction read version 2 parameters.
  `AutomationRegistrationParamV2JSON` is the JSON form of the submitted payload.
- **`automation.cancelAutomationTask({ senderAccount, taskIndex, optionalTransactionArgs? })`** submits
  `0x1::automation_registry::cancel_task`, and **`automation.stopAutomationTasks({ senderAccount, taskIndexes,
  optionalTransactionArgs? })`** submits `0x1::automation_registry::stop_tasks`, for the user automation tasks of the
  sender. Like the transfers, they take the sequence number from the client's counter and estimate the max gas. The
  `Automation` class is also mixed into the client (`supra.cancelAutomationTask`, `supra.stopAutomationTasks`).

### Changed

- The package includes a `NOTICE` file, and files with portions derived from `@aptos-labs/ts-sdk` carry an
  Apache-2.0 notice.
- **Breaking:** a view function that returns `0x1::fixed_point32::FixedPoint32` or `0x1::fixed_point64::FixedPoint64`,
  also inside `vector` and `Option`, returns `{ value: bigint }` where it returned `{ value: string }` (the node's
  JSON). The typed contract proxy types these results with the new `MoveResultToTS`; `ReturnTypes` uses it, and
  `MoveToTS` no longer maps them to the struct name string.
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
- **Breaking:** a submission request that times out, fails before the node answers, or is answered with a 5xx status
  other than 503 makes the submit helper throw `SupraSubmissionOutcomeUnknownError` with the error of the request as
  `cause`, and with `enableWaitForTransaction` wait for the derived hash first (see Added). It threw that request's
  `DOMException`, `TypeError` or `SupraAPIError`. This includes the 500 that a v11 node answers when its transaction
  pool is full.
- **Breaking:** a submission with `enableWaitForTransaction: true` throws `SupraTransactionFailedError` when the
  transaction ends with `Fail` or `Invalid`, unless `checkSuccess: false` is passed. It resolved with the failed
  transaction. This applies to every submit helper: `transaction.submit.*`, the submit methods of a built transaction,
  `coin.transferSupraCoin`, `coin.transferCoin`, `fungibleAsset.transferSupraFungibleAsset`,
  `fungibleAsset.transferFungibleAsset`, `transaction.publishPackage` and the entry functions of `Contract.fromABI`.
- **Breaking:** a simulation throws `SupraSimulationFailedError` for every status other than `Success`, including
  `PendingAfterExecution` (for example `SENDING_ACCOUNT_DOES_NOT_EXIST` or `SEQUENCE_NUMBER_TOO_NEW`) and `Invalid`.
  It threw a `SupraAPIError` with status 400 for `Fail` only. With `enableTransactionSimulation: true`, a failed
  simulation means the transaction is not submitted. That simulation handles `SEQUENCE_NUMBER_TOO_NEW` as the max gas
  estimate does: behind numbers that have records of transactions this client submitted, the transaction is simulated
  with the account's sequence number on the chain and submitted with its own; otherwise a helper's transaction is
  signed again with the lowest number without a record, and a transaction with an explicit number throws the failure.
  A failed read of the account during that check is thrown, as in the estimate, and nothing is submitted.
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
  `waitForTransaction` accept. It returned 64 hex characters without the prefix. The submit helpers derive the hash
  of each transaction the same way before they submit it.
- **Breaking:** `transaction.submit.submitMultiAgentTransaction` and `submitSponsorTransaction`, and the matching
  methods of a built transaction, throw a `RangeError` before submitting when a secondary signer or fee payer address
  is not 1 to 64 hex digits after an optional `0x`. They sent the transaction, which the node refused.
- **Breaking:** `transaction.submit.submitSerializedRawTransactionAndSignature` and `submitTransactionAndSignature` of a
  built transaction throw a `RangeError` naming `senderPubkey` or `signature` before submitting when that value is not
  hex digits in pairs after its `0x` prefix. They sent the transaction, which the node refused.
- **Breaking:** `getTransactionByHash` takes no type argument. It returns `TransactionResponse`, which is narrowed
  by `txn_type`; the type argument did not change the value returned.
- **Breaking:** `DEFAULT_MAX_GAS_UNITS` is 20,000 units (was 1,000). It is the max gas of a transaction that sets
  none when the estimate is turned off or the estimating simulation could not run to a result (a request error, a
  response without `gas_used`), and of the builders that cannot estimate. The node requires the sender's balance to pay
  for `max gas × gas unit price`: 20 SUPRA at a gas unit price of 100,000 quants. A sender with less must set
  `maxGas` on the builders that make no request.
- **Breaking:** a transaction without a `gasUnitPrice` on the call or the client carries the node's estimate,
  `max(median_gas_price, min_configured_gas_price)`, read from the node for each transaction (in the helpers that submit
  the read starts when the call is made and is awaited in the call's turn for the sender's account, so calls from one
  account keep the order of the calls, except SUPRA fungible asset transfers, whose balance check is awaited before the
  lock is requested; `transaction.build.simple` awaits it before it builds); the same price is used for the max gas estimate. It was `SupraConfig.minGasUnitPrice`, else
  `DEFAULT_GAS_PRICE` (100,000 quants), without reading the node. A failed read of the estimate throws its error and
  nothing is submitted. A price of the call or the client is used as given.
- **Breaking:** `SupraConfig.minGasUnitPrice` and `NetworkConfig.minGasUnitPrice` are renamed `gasUnitPrice`, without an
  alias. `SupraClient.networkInformation.gasUnitPrice` is `undefined` when the configuration sets none.
- **Breaking:** the builders that make no request (`rawTxnObject`, `scriptRawTxnObject`,
  `automationRegistrationRawTxnObject`, `multisigRawTxnObject`, `multisigProposalTxRawTxnObject`) throw a `RangeError`
  before building when neither the call nor the client sets a `gasUnitPrice`; they cannot read the node's estimate.
- **Breaking:** a submission or a simulation refused for a gas unit price below the node's minimum throws
  `SupraGasUnitPriceBelowMinimumError`, which is neither a `SupraAPIError` nor a `SupraSimulationFailedError`; the
  original error is its `cause`.
- The JSDoc of `getGasPrice()` and `getMinGasUnitPrice()` no longer says that transactions do not use them.
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
  reading it from the chain on every call, and the calls of one client from one account are submitted one after
  another (see the counter under Added); they ran independently of each other. Transactions sent by other means from
  the same account (another client or process, a wallet) make the counter stale: a helper call whose number such a
  transaction holds is refused, sent once more after a read of the chain, and refused again while that transaction is
  pending; the next call after it has committed takes the next number. Transactions submitted through the client,
  including those built with an explicit number, are recorded and do not make it stale. A transaction that will not
  commit keeps its number until the timestamp of a latest block the client reads reaches its expiration time. A transaction the
  node discarded after accepting it frees its number when any read of it through the client (`waitForTransaction`,
  `getTransactionByHash`, `isPendingTransaction`, a submission's wait or read-back) returns `Invalid`.
- **Breaking:** a transaction built without `txExpiryTime` expires `DEFAULT_TX_EXPIRATION_DURATION` (now 60) seconds
  after the client's clock in whole seconds, or `SupraConfig.txExpirySecs` seconds (at most 595); it expired 300
  seconds after the client's clock. This applies to every builder, including `rawTxnObject` and the other builders of
  `transaction.build`. The node refuses a transaction whose expiration time is not after its clock or more than 600
  seconds after it, so a client whose clock is far from the node's has its transactions refused. Set `txExpiryTime`
  (absolute, used as given) or `txExpirySecs` for a transaction that is signed or submitted later.
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
- **Breaking:** integer arguments of views given in any form (number, bigint or string) must lie in the range of
  the type, `0` to `2^n - 1` for `un` and `-2^(n-1)` to `2^(n-1) - 1` for `in`; other values throw before any
  request. Views sent them to the node, which refused them (`u8` 300, `u64` -1).
- **Breaking:** a `number` given for an integer argument of an entry function or a view must be a safe integer
  (at most `Number.MAX_SAFE_INTEGER`, 2^53 - 1, in magnitude); larger values are given as a `bigint` or a decimal
  string. A larger `number` such as `2 ** 53 + 1` holds a rounded value, which was encoded.
- **Breaking:** `methods.view` encodes an `Option<u8>` argument the way the node reads it, as the hex of the
  byte (`Some(16)` is `{"vec":"10"}`). It was sent as the decimal string, which the node read as a
  different byte or rejected. `Option<T>` for every other `T` is a one-element array of the encoded
  value, `None` is an empty array, and `Option<vector<u8>>` carries the hex of the bytes.
- A `vector<u8>` argument of a view is validated: a string must be hex of whole bytes, with or without
  `0x`, and array elements must be integers from 0 to 255.
- **Breaking:** a `bool` argument of a view is a boolean or one of the strings `"true"` and `"false"`; other
  values throw before any request. Views converted the value with `Boolean(value)`, which sent `"false"` and `"0"`
  as `true`. Entry functions accept the same two strings, so both encode a value alike.
- **Breaking:** `address` and `0x1::object::Object<T>` arguments of entry functions and views must be a string
  or a `HexString` holding 1 to 64 hex digits after an optional `0x`. Other values, including `""` and `"0x"`,
  throw before any request. Entry functions encoded `""` and `"0x"` as the address `0x0`, and views sent every
  value to the node, converted with `String(value)` for `address` and unchanged for `Object<T>`.
- **Breaking:** type arguments given as strings are parsed by the SDK with the grammar of the node's type
  parser, in entry functions (`transaction.build.simple` and the entry functions of `Contract.fromABI`) and
  `methods.view`. The `coinType` of `coin.transferCoin` and of `fungibleAsset.migrateCoinToFungibleStore` is
  checked by `validateStructId` and then parsed the same way. A string that is not exactly one concrete type throws
  before any request: text after the type (`"u64 junk"`, `"0x1::supra_coin::SupraCoin, u8"`), a generic type
  parameter (`"T0"`), `"string"`, which was read as `0x1::string::String` and which nodes refuse, and a type
  with more than eight nested `vector` and struct levels, the most a transaction can carry. Entry
  functions used the first type of such a string, and views sent it to the node unchecked.
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
- **Breaking:** `AutomationRegistrationParamsV2`, the version 2 registration in a transaction response, types
  `task_type` as `"user" | "system"` and `task_priority` as `number | null`, which is what v11.7.0 and v12 nodes send.
  They were declared `"User" | "System"` and an optional `number`.
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
- **Breaking:** `standardizeAddress` returns lower-case hex and accepts a `0x` or `0X` prefix. It throws a
  `RangeError` for a value that is not 1 to 64 hex digits after the optional prefix (for example `""`, `"0x"`,
  `"0xzz"` or 65 digits); it threw a `SupraAPIError` with status 400 that no node sent for more than 64 digits, and
  returned other malformed values with the prefix doubled or the invalid characters kept. An address in upper case now
  matches the SUPRA fungible asset address, and `resetSequenceNumber` finds the counter of such an address. The methods
  that take an address without validating it first (`fundAccountWithFaucet`, `getFaucetTransaction`,
  `resetSequenceNumber` and the builders of `transaction.build`) throw this `RangeError` before any request.
- **Breaking:** `getTransactionByHash`, `waitForTransaction` and `isPendingTransaction` require a transaction hash of
  `0x` followed by exactly 64 hex digits. A longer or shorter value is rejected before any request.
- **Breaking:** `getAccountModule` requires `moduleName` to be a Move identifier, and the resource, event and coin
  type arguments of the account, event, coin and fungible asset methods require the module and struct names of the
  type to be Move identifiers (a letter or underscore, then letters, digits and underscores). Other values are
  rejected before any request. The resource and event type and the module name are percent-encoded in the request
  path.

### Fixed

- `transaction.build.multisigRawTxnObject` builds the execution of a proposal whose payload is stored on chain
  (`create_transaction`) when `function`, `functionTypeArgs` and `functionArgs` are left out. The payload JSON of the
  submission carries no `transaction_payload` then; it threw `Multisig payload is missing`. The derived transaction
  hash is the node's for this kind of transaction.
- A submission that the node accepts with a 2xx status whose body is not a transaction hash (a body that is not JSON,
  an empty body, or a value that is not a hash) is handled as an accepted submission with the hash derived from the
  signed transaction: the wait or the read-back uses that hash. A body that was not JSON threw a `SupraAPIError` with
  the 2xx status, and the other bodies were returned as the hash.
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
- A type argument string `0x1::object::Object<T>` is the struct type `Object<T>` in an entry function
  payload, alone and inside `vector<…>` or another struct; it was signed as `address`. A view function and an
  entry function given the same type argument string instantiate the same type.
- `address` and `Object<T>` arguments of entry functions accept a `HexString`, as their declared type
  `AccountAddressInput` states; they threw `Expected string for address, got object`. A `HexString` `Object<T>`
  argument of a view is sent as its address string; it was sent as the object `{"hexString":…}`.
- Type argument strings whose module or struct names contain `T` followed by digits, such as
  `0xabc::usdt0::USDT0` or `0xabc::m::T1`, are accepted in entry functions and as the `coinType` of
  `coin.transferCoin` and `fungibleAsset.migrateCoinToFungibleStore`; they threw
  `TypeTagParserError: Invalid type tag.`
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
- The `exports` map of `package.json` gives the `require` condition its own declarations (`dist/index.d.cts`), so a
  CommonJS TypeScript project with `moduleResolution` `node16` or `nodenext` type-checks `import ... from
  "supra-ts-sdk"`; the types resolved as an ES module before.

### Removed

- **Breaking:** `DEFAULT_TXN_TIMEOUT_SEC`; `DEFAULT_TXN_WAIT_TIMEOUT_MS` replaces it.
- **Breaking:** `DEFAULT_GAS_PRICE`; the node's estimate is the default gas unit price.
- **Breaking:** `DEFAULT_MAX_GAS_FOR_SUPRA_TRANSFER_WHEN_RECEIVER_EXISTS` and
  `DEFAULT_MAX_GAS_FOR_SUPRA_TRANSFER_WHEN_RECEIVER_NOT_EXISTS`; the max gas estimate replaces the transfers'
  receiver-dependent max gas.
- **Breaking:** the constants `DEFAULT_CHAIN_ID`, `MAX_RETRY_FOR_TRANSACTION_COMPLETION`,
  `DELAY_BETWEEN_POOLING_REQUEST` and `DEFAULT_RECORDS_ITEMS_COUNT`. No function of the SDK read them; the chain ID
  comes from `SupraConfig` and the wait is set by `waitTimeoutMs`.

### Security

- Patched the dev-only transitive dependencies `handlebars` (4.7.10; GHSA-xw65-4hp5-5hc7, GHSA-8r5x-fm3f-whwj,
  GHSA-p8wg-vrv2-v86f), `brace-expansion` (1.1.21, 2.1.7 and 5.0.12; GHSA-mh99-v99m-4gvg, GHSA-rgw5-rvv9-x895,
  GHSA-q2hr-2g5m-vwhr, GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p), `browserslist` (4.28.7; GHSA-c83g-rgw3-j3cx,
  GHSA-73wf-gq98-2v4g), `baseline-browser-mapping` (2.11.0; GHSA-w5vr-8v7q-w6rv), `markdown-it` (14.3.1;
  GHSA-253c-mchw-3w2r), `@humanfs/node` (0.16.8; GHSA-p498-v437-472g) and `ajv@6` (6.14.0; GHSA-2g4f-4pwh-qvx6)
  through `pnpm.overrides`. Each version is the minimum the override allows. They are reached only through the
  development toolchain (Jest, ts-jest, ESLint and TypeDoc), so no published artifact was affected.

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
