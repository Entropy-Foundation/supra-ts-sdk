# Changelog

All notable changes to `supra-ts-sdk` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`Network.DEVNET`** — `new SupraClient({ network: Network.DEVNET })` connects to
  `https://rpc-devnet.supra.com` with chain ID 50.
- **`SupraFaucetUnavailableError`** — thrown by `fundAccountWithFaucet` when the node answers `"TryLater"` because no
  faucet account is free. **`SupraFaucetResponseError`** is thrown when the node answers with any other body that
  carries no transaction hash; the body is available as `data`.
- **`faucet.getFaucetTransaction({ transactionHash })`** — reads a faucet transaction
  (`GET /rpc/v3/wallet/faucet/transactions/{hash}`).
- **Typed errors.** `SupraNotFoundError` (HTTP 404), `SupraGoneError` (410), `SupraRateLimitError` (429, with
  `retryAfterSeconds` from the body's `retry_after_seconds` or the `Retry-After` header) and
  `SupraServiceUnavailableError` (503) extend `SupraAPIError`, so `instanceof SupraAPIError` still matches.
  `SupraTimeoutError` and `SupraNetworkError` replace the raw `DOMException` and `TypeError` of a request that times
  out or fails before the node answers; the original error is their `cause`. `SupraError` is the base class of all of
  them and of the faucet errors.
- **`SupraConfig.timeoutMs`** sets the request timeout (default 30000 ms; an integer up to 2147483647) for predefined
  networks and custom configurations.
- **`SupraConfig.retry`** (`{ attempts, maxDelayMs }`) turns on retries of GET requests that fail with 429, 503 or a
  connection failure, honouring the node's `retry_after_seconds` / `Retry-After`. It is off by default; POST requests
  are never retried.
- **`SupraAPIError.sub_status`** is the abort code of an `ABORTED` status. `parseVmStatus` is exported.
- `MoveVmError` lists the validation, verification, invariant and runtime statuses that clients commonly handle,
  including `ABORTED`, `MISSING_DATA`, `TYPE_RESOLUTION_FAILURE`, `LOOKUP_FAILED` and `MAX_GAS_UNITS_*`.

### Changed

- **Breaking:** `SupraAPIError.message` is the node's `message` when the error body has one (for example
  `General err: MoveTransactionValidationFailed(0x…, 0, SEQUENCE_NUMBER_TOO_OLD)`), otherwise the HTTP status text.
  It was always the status text. `statusText` and `data` are unchanged.
- **Breaking:** `SupraAPIError.major_status` is the name of the Move VM status that the message reports (view errors,
  submit validation errors, and the `vm_status` of a failed simulation), and `undefined` when the message names none.
  It was `"unknown"` for every error. `toJSON()` also returns `message` and `sub_status`.
- **Breaking:** `MoveVmError` follows the Move VM `StatusCode` names: `MOVE_ABORT`, which is not a VM status, is
  removed (`ABORTED` replaces it), the description of `OUT_OF_GAS` is corrected, and the link to an unrelated
  repository is removed.
- **Breaking:** `SupraFaucetUnavailableError` and `SupraFaucetResponseError` extend `SupraError`; they are still not
  `SupraAPIError`s and keep their names.
- **Breaking:** a request that times out or fails before the node answers, or whose response body cannot be read,
  rejects with `SupraTimeoutError` or
  `SupraNetworkError` instead of a raw `DOMException` or `TypeError`.
- Clients of a predefined network no longer share one mutable network configuration: the gas, timeout and retry
  settings of one `SupraClient` no longer reach another client of the same network.
- **Breaking:** `standardizeAddress` returns lower-case hex, and throws a `RangeError` for an address of more than 64
  hex digits instead of a `SupraAPIError` with status 400 that no node sent.
- **Breaking:** `getAccountModule` requires `moduleName` to be a Move identifier, and the resource, event and coin
  type arguments of the account, event, coin and fungible asset methods require the module and struct names of the
  type to be Move identifiers (a letter or underscore, then letters, digits and underscores). Other values are
  rejected before any request. The resource and event type and the module name are percent-encoded in the request
  path.

- **Breaking:** `fundAccountWithFaucet` sends the request on every network, including custom configurations, instead of
  throwing `Faucet is only available on testnet` on all but Testnet. A node that does not serve the faucet answers with
  an error status, which is thrown as `SupraAPIError`.
- **Breaking:** `fundAccountWithFaucet` throws `SupraFaucetUnavailableError` or `SupraFaucetResponseError` where it
  returned `{ hash: undefined }`.
- The `SupraConfig` type accepts `Network.DEVNET` alongside `Network.MAINNET` and `Network.TESTNET`.

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

[1.2.0]: https://github.com/Entropy-Foundation/supra-ts-sdk/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Entropy-Foundation/supra-ts-sdk/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Entropy-Foundation/supra-ts-sdk/releases/tag/v1.0.0
