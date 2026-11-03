
# Supra TypeScript SDK

[![npm version](https://img.shields.io/npm/v/supra-ts-sdk?logo=npm&logoColor=white&style=flat-square)](https://www.npmjs.com/package/supra-ts-sdk)
[![npm downloads](https://img.shields.io/npm/dm/supra-ts-sdk?style=flat-square&color=orange)](https://www.npmjs.com/package/supra-ts-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TS-5.x-blue?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

**Type-safe client library for the Supra blockchain (MoveVM)**

`supra-ts-sdk` is a lightweight, modern TypeScript SDK for building applications on the **Supra Layer-1 blockchain** (MoveVM-based).

It provides strongly-typed helpers for:

- Connecting to Supra nodes (Mainnet / Testnet / Devnet)
- Reading account balances & resources
- Submitting transactions
- Calling view / entry functions on Move modules
- Working with Move structs and ABIs

The [API reference](https://entropy-foundation.github.io/supra-ts-sdk/) documents every exported class, function and type of the latest release.


## ✨ Features

- Full TypeScript support with excellent type inference
- Native Move function calling (entry & view)
- Clean builder-style transaction creation
- Automatic BCS serialization / deserialization
- Built-in support for Supra Mainnet, Testnet & Devnet
- Minimal dependencies

## 📦 Installation

```bash
# Recommended (fastest + best disk usage)
pnpm add supra-ts-sdk

# or with npm
npm install supra-ts-sdk

# or with Yarn
yarn add supra-ts-sdk
```

### Release channels

Each network has an npm dist-tag that points at the SDK version for the node release it runs: `devnet`, `testnet`
and `mainnet`. `mainnet` is the same version as `latest`, which a plain `pnpm add supra-ts-sdk` installs. The `devnet`
tag carries prereleases (`X.Y.Z-beta.N`) for node release candidates that run on Devnet before the other networks:

```bash
pnpm add supra-ts-sdk@devnet
```

A tag moves to a new version when the node release that version supports reaches the tag's network.
[RELEASING.md](https://github.com/Entropy-Foundation/supra-ts-sdk/blob/master/RELEASING.md) describes the versioning policy and the release process.

### Compatibility

2.0.0 supports Supra node v11.7.0 (Mainnet and Testnet) and the v12.0.0 release candidates (Devnet).
[`compatibility.json`](https://github.com/Entropy-Foundation/supra-ts-sdk/blob/master/compatibility.json) states, for each SDK release, the node releases it supports and the RPC
API versions it calls. The package ships it, so an application can read it as `supra-ts-sdk/compatibility.json`:

```json
{
    "schema": 1,
    "releases": [
        {
            "sdk": "2.0.0",
            "node": { "min": "v11.7.0", "tested": ["v11.7.0", "v12.0.0-rc6"], "unsupported": [] },
            "rpc": ["v3"]
        }
    ]
}
```

| Field | Meaning |
|---|---|
| `schema` | Version of this format. It changes only when a field is removed or changes meaning. |
| `releases` | One entry per SDK release, newest first. |
| `sdk` | SDK version. |
| `node.min` | Lowest node release the SDK release supports, or `null` when none was stated for it. |
| `node.tested` | Node releases the end-to-end suite passed against before the release. |
| `node.unsupported` | Node major lines (`v12`) the SDK release does not work with. |
| `rpc` | RPC API versions the SDK calls (`/rpc/<version>/...`). |

Node releases are written `v<major>.<minor>.<patch>`, with `-rc<N>` for a release candidate: the node tag
`supra_node_v12.0.0.rc6` is `v12.0.0-rc6`.

### Stability

The node's API added in `supra_node_v12.0.0` runs on Devnet as release candidates, and it can change between them. It
is frozen only when `supra_node_v12.0.0` is cut and promoted to Testnet. The SDK symbols that wrap it carry the TSDoc
release tag `@beta`, which the generated API reference shows as a badge:

- `account.getAccountHistory`, with `AccountHistoryEntry`, `AccountHistoryPage` and `AccountHistoryCategory`;
- `methods.viewBatch`, `transaction.getTransactionsByHashes`, `transaction.simulate.withStateChanges`,
  `transaction.getSettlements`, `transaction.getSettlement` and `fungibleAsset.getNativeSupply`, with the argument and
  response types that only they use;
- the `settlement` transaction response types (`SettlementTransactionResponse` and its data types), the `Remove`
  variant of `AutomationRecordAction`, and the `release` field of `NodeVersionInfo`.

A `@beta` symbol is exempt from the SDK's semantic versioning until `supra_node_v12.0.0` reaches Testnet: a 2.x minor
release can change or remove it. A minor release removes the tags once `supra_node_v12.0.0` is on Testnet, and the
symbols are then covered by semantic versioning.

Two behaviours that are not symbols follow the same rule: [generic-view conversion with type arguments other than
`address`](#generic-view-functions) and [sponsoring a sender with no account](#sponsored-transaction-from-a-sender-without-an-account).

### Upgrading from 1.x

[MIGRATION.md](https://github.com/Entropy-Foundation/supra-ts-sdk/blob/master/MIGRATION.md) lists every breaking change from 1.2.0 to 2.0.0 and the code to change.
[CHANGELOG.md](https://github.com/Entropy-Foundation/supra-ts-sdk/blob/master/CHANGELOG.md) lists every change of each release.

## Requirements

- Node.js ≥ 20
- TypeScript ≥ 4.9 (5.x strongly recommended)


## 🚀 Quick Start

The program below connects to Devnet, funds a new account from the faucet, sends 0.01 SUPRA to another account and
waits for the commit. It is an ES module (top-level `await`):

```ts
import { SupraAccount, SupraClient, Network } from 'supra-ts-sdk';

const supra = new SupraClient({ network: Network.DEVNET }); // chain ID 50
// Testnet: Network.TESTNET (chain ID 6), Mainnet: Network.MAINNET (chain ID 8)
// Any other node: new SupraClient({ rpcUrl: "http://localhost:27001", chainId: 255 })

const sender = new SupraAccount();
const receiver = new SupraAccount();

// The faucet answers before its transaction executes; wait for the commit.
const faucet = await supra.faucet.fundAccountWithFaucet({ accountAddress: sender.address() });
await supra.transaction.waitForTransaction({ transactionHash: faucet.hash });
console.log("Balance:", await supra.account.getAccountSupraCoinBalance({ accountAddress: sender.address() }));

const transfer = await supra.coin.transferSupraCoin({
  senderAccount: sender,
  receiverAccountAddress: receiver.address(),
  amount: 1_000_000n,
  optionalTransactionArgs: { enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true } },
});
console.log(`Transfer ${transfer.hash}: ${transfer.status}`);
```

The helper estimates the max gas, takes the sequence number from the client's counter and checks the chain ID of the
node before it signs. On a network without a faucet, use an account that holds SUPRA, for example one made with
`SupraAccount.fromSupraAccountObject`. The [examples](https://github.com/Entropy-Foundation/supra-ts-sdk/blob/master/examples/README.md) run against Devnet, Testnet and localnets.

### Querying Accounts

#### 1. Check if an Account Exists

```ts
const accountAddress = new SupraAccount().address();

const exists = await supra.account.isAccountExists({ accountAddress });

console.log(`Account ${accountAddress.toString().slice(0, 8)}... exists:`, exists); // false
```

**Note**: Accounts on Supra only exist after receiving a transaction or resource. This is a fast, gas-free check.

#### 2. Get Full Account Information

```ts
const rootAddress = "0x0000000000000000000000000000000000000000000000000000000000000001";

const accountData = await supra.account.getAccountInfo({ accountAddress: rootAddress });

console.log("Framework (0x1) account info:", accountData);
// Expected fields: sequence_number, authentication_key, etc.
```

### Reading the Node Version

`getNodeVersion()` reads `GET /rpc/v3/version`. `release` is the node release tag; it is absent before
`supra_node_v12.0.0`, so it is `undefined` for a v11 node. The `release` field is `@beta`; see
[Stability](#stability).

```ts
const info = await supra.getNodeVersion();
console.log(info.release); // "supra_node_v12.0.0.rc7" on a v12 node, undefined on a v11 node
console.log(info.version, info.branch, info.commit_hash, info.build_time, info.build_env);
```

### Reading a Feed Page by Page

Paginated methods return `{ response, cursor }`. Pass `cursor` back unchanged until it is `undefined`. A page
can be empty and still carry a cursor.

This example reads the feed of the account's primary fungible store, which holds the account's SUPRA on a chain
created from the `supra_node_v12.0.0` genesis (Devnet) and works on every network. SUPRA held in a `CoinStore`
(Mainnet and Testnet nodes at v11.7.x) is listed by `getAccountCoinTransactions`, which takes the account address and
returns an empty page for SUPRA held in a primary store. `getAccountHistory`, below, covers both.

```ts
import { TransactionType } from 'supra-ts-sdk';

const storeAddress = await supra.account.getPrimaryStoreAddress({ accountAddress: sender.address() });
let cursor: string | undefined;
do {
  const page = await supra.account.getAccountFaTransactions({
    storeAddress,
    options: { count: 50, start: cursor },
  });
  for (const txn of page.response) {
    // Only user and automated transactions have a header, payload and authenticator.
    if (txn.txn_type === TransactionType.User || txn.txn_type === TransactionType.Auto) {
      console.log(txn.hash, txn.header.sender.Move);
    } else {
      console.log(txn.hash, txn.txn_type);
    }
  }
  cursor = page.cursor;
} while (cursor !== undefined);
```

### Account History and Fungible Store Transactions

`getAccountHistory` lists every finalized transaction that concerns an account, once each, with the categories it
matched (`sent`, `coin`, `fa`, `da`). It lists SUPRA transfers between primary fungible stores, which
`getAccountCoinTransactions` does not, and lists SUPRA held in a `CoinStore` as well. It needs a node from
`supra_node_v12.0.0` (Devnet): Mainnet and Testnet nodes at v11.7.x answer HTTP 404, which the SDK throws as
`SupraRouteUnsupportedError`, a `SupraNotFoundError`. It omits automated transactions and automation records; read
those with `getAccountAutoTransactions`. `getAccountHistory` is `@beta`; see [Stability](#stability).

```ts
let cursor: string | undefined;
do {
  const page = await supra.account.getAccountHistory({
    accountAddress: sender.address(),
    options: { categories: ['sent', 'fa'], count: 50, start: cursor },
  });
  for (const { categories, transaction } of page.response) {
    console.log(transaction.hash, categories);
  }
  // page.indexedFrom: the lowest block height the history covers, when the node reports one.
  cursor = page.cursor;
} while (cursor !== undefined);
```

The node applies `categories` while it scans, so a page can have fewer entries than `count`, or none, and still carry a
cursor. The feed ends only when `cursor` is `undefined`; the cursor `"0"` does not end it.

`getAccountFaTransactions` lists the transactions that withdrew from or deposited to one fungible store, given the
store's address (Mainnet, Testnet and Devnet nodes serve it). It lists the movements of that one store: an account
address returns an empty page. `getPrimaryStoreAddress` derives an account's primary store for a fungible asset (SUPRA
by default). The method takes `count`, `start`, `ascending` and `type`, and is read page by page like the feeds above.
To list everything that concerns an account, use `getAccountHistory` (nodes from `supra_node_v12.0.0`).

```ts
const storeAddress = await supra.account.getPrimaryStoreAddress({ accountAddress: sender.address() });
const page = await supra.account.getAccountFaTransactions({ storeAddress, options: { count: 50 } });
```

### Operations of the `/rpc/v4` API

The client's base path is `/rpc/v3`. These methods call `/rpc/v4` routes, which nodes from `supra_node_v12.0.0`
(Devnet) serve. A Mainnet or Testnet node at v11.7.x answers HTTP 404 for each route except simulate, and the SDK throws
`SupraRouteUnsupportedError` (a `SupraNotFoundError` with `method` and `minimumNodeRelease`). The methods are `@beta`;
see [Stability](#stability).

| Method | Route |
|---|---|
| `supra.methods.viewBatch` | `POST /rpc/v4/view/batch` |
| `supra.transaction.getTransactionsByHashes` | `POST /rpc/v4/transactions/by_hashes` |
| `supra.transaction.simulate.withStateChanges` | `POST /rpc/v4/transactions/simulate` |
| `supra.transaction.getSettlements`, `getSettlement` | `GET /rpc/v4/transactions/settlements`, `.../{settlement_id}` |
| `supra.fungibleAsset.getNativeSupply` | `GET /rpc/v4/supply/native` |

`viewBatch` executes several view functions against one snapshot of Move state. Each element takes the arguments of
`view`. A function the node fails has an `error` in its entry and does not fail the call:

```ts
const { state_height, results } = await supra.methods.viewBatch({
  requests: [
    { function: '0x1::timestamp::now_microseconds' },
    { function: '0x1::coin::balance', typeArguments: ['0x1::supra_coin::SupraCoin'], functionArguments: ['0x1'] },
  ],
});
for (const entry of results) {
  console.log(entry.error ? `${entry.error.status} ${entry.error.message}` : entry.result);
}
```

`getTransactionsByHashes` answers each requested hash in order, with `transaction: null` for a hash the node does not
know. The node bounds the request (100 hashes by default) and the response; the hashes it left out of the response are in
`omitted`, to be requested again.

`simulate.withStateChanges` returns the simulated transaction with `changes`, `prior_values` (the value each changed
state key held before, keyed by `state_key_hash`), `state_height`, `omitted`, `omitted_counts` and `changes_truncated`.
A v11.7.x node answers the route as `/rpc/v3` does, so the call succeeds there and those fields are `undefined`.
`simulate.simple` keeps calling `/rpc/v3`.

```ts
const simulated = await supra.transaction.simulate.withStateChanges({ sendTxPayload });
if (simulated.changes === undefined) {
  // The node does not report state changes.
} else {
  for (const change of simulated.changes) {
    console.log(change.type, change.state_key_hash, simulated.prior_values?.[change.state_key_hash]);
  }
}
```

`getSettlements` lists the cross-VM crossings of native SUPRA that an address is party to, oldest first. `domain` (`"move"`
or `"evm"`) is required, and the address is left-padded with zeros to 32 bytes for `"move"` or 20 bytes for `"evm"` (a longer one is rejected). Read it page by page
as in [Reading a Feed Page by Page](#reading-a-feed-page-by-page); a page can be empty and still carry a cursor.
`getSettlement` returns every stage of one crossing by its settlement id; a crossing the node has no record of is a
`SupraNotFoundError`, and one recorded below its oldest retained block is a `SupraGoneError`.

```ts
const page = await supra.transaction.getSettlements({ address: evmRecipient, domain: 'evm', options: { count: 20 } });
for (const settlement of page.response) {
  const settled = await supra.transaction.getSettlement({ settlementId: settlement.settlement_id });
  console.log(settled.pending ? 'pending' : 'applied', settled.stages.map((stage) => stage.stage));
}
```

`getNativeSupply` returns the accounting of native SUPRA across the two VMs as of one height: wei figures are decimal
strings, and `escrow_shortfall_wei` is `"0"` while the mirror is fully backed. The `*_quants` figures are `bigint`, exact
above `Number.MAX_SAFE_INTEGER` (`escrow_balance_quants` is `null` when the node could not read the escrow). The `amount`
of a settlement's `pending` entry and stages, the `burn_amount` of a settlement transaction and the
`evm_base_fee_per_gas` of a block's `execution_statistics` are `bigint` as well.

## Chain ID

Every transaction carries the chain ID of the client's configuration: 8 for `Network.MAINNET`, 6 for `Network.TESTNET`,
50 for `Network.DEVNET`, or the `chainId` of a custom configuration (an integer from 0 to 255).

Before its first signature a client reads the chain ID of the node at its `rpcUrl`: from the `x-supra-chain-id` header of
an earlier response, or with `GET /rpc/v3/transactions/chain_id` when it has received none. It keeps that value for its
lifetime, and concurrent first signatures share one request. Every signature then checks that the configured chain ID
and the chain ID inside the transaction are the node's, and throws `SupraChainIdMismatchError` before signing when one
is not; nothing is signed or sent. The check covers `signTransaction`, the `signedTransaction`, `sendTxnPayload`,
`signTransaction`, `simulate` and `submitTransaction` methods of a built transaction, `transaction.build.signedTransaction`
and `transaction.build.sendTxnPayload`, the `transaction.submit` methods that take a `senderAccount`, the coin and
fungible asset transfers, `publishPackage`, the automation task helpers, the multisig helpers and the entry functions
of `Contract.fromABI`. These signing methods return promises.

`getChainId()` resolves to the node's chain ID, and `validateChainId()` throws `SupraChainIdMismatchError` when the
configured chain ID differs from it; both use the same stored value.

```ts
import { SupraClient, SupraChainIdMismatchError } from 'supra-ts-sdk';

const supra = new SupraClient({ rpcUrl: "https://rpc-testnet.supra.com", chainId: 8 });

try {
  await supra.validateChainId();
} catch (error) {
  if (error instanceof SupraChainIdMismatchError) {
    console.log(`Configured ${error.configuredChainId}, node ${error.nodeChainId}`);
  }
}
console.log((await supra.getChainId()).value); // 6
```

### Offline signing

`verifyChainId: false` turns the check off. The client signs with its configured chain ID and sends no request to do so,
and `getChainId()` returns the configured chain ID:

```ts
import { SupraClient, SupraAccount, Network, BCS } from 'supra-ts-sdk';

const supra = new SupraClient({ network: Network.MAINNET, verifyChainId: false });
const sender = new SupraAccount(); // the signing account

const rawTxn = supra.transaction.build.rawTxnObject({
  senderAddress: sender.address(),
  senderSequenceNumber: 0n, // the account's sequence number, obtained separately
  function: "0x1::supra_account::transfer",
  functionTypeArgs: [],
  functionArgs: [new SupraAccount().address().toUint8Array(), BCS.bcsSerializeUint64(1_000n)],
  // The builders that make no request need a gas unit price, from the call or from `SupraConfig.gasUnitPrice`
  optionalTransactionPayloadArgs: { maxGas: 5_000n, gasUnitPrice: 100_000n },
});
const signedTransaction = await rawTxn.signedTransaction(sender); // chain ID 8, no request
```

## Errors

Every error the SDK raises on its own behalf derives from `SupraError`.

| Class | Raised when | Useful fields |
|---|---|---|
| `SupraAPIError` | the node answers with an error status | `status`, `statusText`, `url`, `data`, `major_status`, `sub_status` |
| `SupraNotFoundError` (extends `SupraAPIError`) | HTTP 404 | |
| `SupraGoneError` (extends `SupraAPIError`) | HTTP 410: the node has pruned the data | `oldestBlock?: bigint`, the oldest block the node holds; restart reads from it |
| `SupraRateLimitError` (extends `SupraAPIError`) | HTTP 429 | `retryAfterSeconds` |
| `SupraServiceUnavailableError` (extends `SupraAPIError`) | HTTP 503 | |
| `SupraAccountQueueFullError` (extends `SupraAPIError`) | HTTP 400 for a submission beyond the sequence numbers the node queues for the account | `sequenceNumber` |
| `SupraGasUnitPriceBelowMinimumError` | the node refuses a submission or a simulation because the gas unit price is below its minimum | `gasUnitPrice`, `minimumGasUnitPrice`, `major_status`, `cause` (the `SupraAPIError` or `SupraSimulationFailedError`) |
| `SupraTimeoutError` | a request exceeds the timeout (for a submission, the `cause` of `SupraSubmissionOutcomeUnknownError`) | `url`, `timeoutMs`, `cause` |
| `SupraNetworkError` | the connection fails before the node answers (for a submission, the `cause` of `SupraSubmissionOutcomeUnknownError`) | `url`, `cause` |
| `SupraSubmissionOutcomeUnknownError` | a submission request times out, fails before the node answers, or is answered with a 5xx status other than 503: the node may have accepted the transaction; also after a v11.7 `Already scheduled` refusal of a copy whose read does not settle the outcome (see [Transaction outcomes](#transaction-outcomes)) | `hash`, `sender`, `sequenceNumber`, `expirationTimestampSecs`, `waitError`, `cause`, `readStatus`, `readError` |
| `SupraFaucetUnavailableError`, `SupraFaucetResponseError` | the faucet cannot fund the account / answers unexpectedly | |
| `SupraChainIdMismatchError` | before signing, the configured chain ID or the transaction's chain ID is not the node's | `configuredChainId`, `nodeChainId`, `transactionChainId` |
| `SupraSimulationFailedError` | a simulation returns a status other than `Success` | `status`, `vm_status`, `major_status`, `sub_status`, `transaction` |
| `SupraTransactionFailedError` | a transaction the SDK waited for ends with `Fail` or `Invalid` | `hash`, `status`, `vm_status`, `major_status`, `sub_status`, `transaction` |
| `SupraTransactionTimeoutError` | a transaction the SDK waited for has no final status within the wait timeout | `hash`, `timeoutMs`, `lastStatus`, `transaction`, `cause` |

`SupraAPIError.message` is the node's `message` when the error body has one, otherwise the HTTP status text.
`major_status` is the name of the Move VM status the message reports, for example `SEQUENCE_NUMBER_TOO_OLD`,
`INSUFFICIENT_BALANCE_FOR_TRANSACTION_FEE`, `LINKER_ERROR` or `ABORTED`, and `sub_status` is the abort code of an
`ABORTED` status. Both are `undefined` when the message names no status. `MoveVmError` lists the common statuses.

```ts
import { SupraClient, Network, SupraAPIError, SupraRateLimitError, SupraTimeoutError } from 'supra-ts-sdk';

const supra = new SupraClient({ network: Network.TESTNET });

try {
  await supra.faucet.fundAccountWithFaucet({ accountAddress: "0x1234" });
} catch (error) {
  if (error instanceof SupraRateLimitError) {
    console.log(`Try again in ${error.retryAfterSeconds} seconds`);
  } else if (error instanceof SupraTimeoutError) {
    console.log(`No answer within ${error.timeoutMs} ms`);
  } else if (error instanceof SupraAPIError) {
    console.log(error.message, error.major_status);
  } else {
    throw error;
  }
}
```

### HTTP Status Codes by Node Version

Errors from the node are thrown as `SupraAPIError`, whose `status` is the HTTP status. The SDK supports nodes from
v11.7.0 onwards. These conditions are reported with a different status by v12 nodes than by v11 nodes:

| Condition | v12 | v11 |
|---|---|---|
| An account that does not exist (`getAccountInfo`) | 404 | 400 |
| A fault in the node (store, archive or state failure) | 500 | 400 |
| A path parameter that does not parse (an address, hash or height) | 400 | 404 |
| A full transaction pool on submission | 503 | 500 |
| A `type` of `"settlement"` | accepted | 400 |

`isAccountExists` returns `false` for an account that does not exist on both versions. Other statuses, such as 404
for an unknown transaction, block, module or resource, and 410 for pruned data, are the same on both. A submission
answered with a 5xx status other than 503, which includes the 500 of a v11 node whose transaction pool is full, throws
`SupraSubmissionOutcomeUnknownError` with the `SupraAPIError` as `cause` (see [Transaction outcomes](#transaction-outcomes)).

### Timeout and retries

Each request times out after 30 seconds. `timeoutMs` changes that, and `retry` turns on retries of GET requests, which
are off by default:

```ts
const supra = new SupraClient({
  network: Network.TESTNET,
  timeoutMs: 10_000,
  retry: { attempts: 3, maxDelayMs: 5_000 },
});
```

A GET is retried when the node answers 429 or 503 or the connection fails, up to `attempts` requests in total. A 429 is
retried after the wait the node asks for (`retry_after_seconds`, else `Retry-After`) and is thrown at once when that wait
exceeds `maxDelayMs`; the other cases wait 250 ms, doubling on every retry, up to `maxDelayMs`. A timeout is not
retried. POST requests (submit, simulate, view) are never retried.

### Transaction outcomes

Every submit helper (`transaction.submit.*`, the submit methods of a built transaction, the coin and fungible asset
transfers, `publishPackage`, the automation task helpers, the multisig helpers and the entry functions of
`Contract.fromABI`) handles the outcome the same way:

- With `enableTransactionSimulation: true`, a simulation with a status other than `Success` throws
  `SupraSimulationFailedError` and nothing is submitted. `simulate` throws it too. A gas unit price below the node's
  minimum throws `SupraGasUnitPriceBelowMinimumError` instead, for a simulation and for a submission (see
  [Gas](#gas)). Behind pending transactions of the
  same client, the simulation uses the account's sequence number on the chain, as the max gas estimate does, and a
  failed read of the account during that check is thrown (see [Sequence numbers](#sequence-numbers)).
- With `enableWaitForTransaction: true`, the call waits for a final status. `Success` is returned; `Fail` (executed
  and failed, for example a Move abort or `Out of gas`) and `Invalid` (discarded) throw `SupraTransactionFailedError`,
  unless `checkSuccess: false` is passed. `Pending` and `PendingAfterExecution` are not final, and neither is a 404
  for a transaction the node has not seen yet: the call keeps waiting until `waitTimeoutMs` (per call, else
  `SupraConfig.waitTimeoutMs`, else 60 seconds) and then throws `SupraTransactionTimeoutError`.
- Without `enableWaitForTransaction`, the call returns the transaction as the node reports it right after the
  submission. When that read fails, it returns `{ hash, status: "NotReadBack", readError }`: the node accepted the
  transaction, and `hash` can be passed to `waitForTransaction`.
- The SDK derives the transaction's hash from the signed transaction before it submits it. When the submission
  request times out, fails before the node answers, or is answered with a 5xx status other than 503, the node may
  have accepted the transaction: the call throws `SupraSubmissionOutcomeUnknownError` with `hash`, `sender`,
  `sequenceNumber`, `expirationTimestampSecs` and the error of the request (`SupraTimeoutError`, `SupraNetworkError` or
  `SupraAPIError`) as `cause`. Look the hash up or wait for it before sending the transaction again; the transaction
  can commit until the chain's time reaches `expirationTimestampSecs`. With `enableWaitForTransaction: true`, the call
  first waits for that hash as above: a transaction that reaches a final status is returned (or throws
  `SupraTransactionFailedError`), and `SupraSubmissionOutcomeUnknownError` is thrown when the wait ends without a final
  status, with the wait's `SupraTransactionTimeoutError` as `waitError`. A node that answers the submission with a 4xx
  status or 503 did not accept the transaction; that is thrown as `SupraAPIError`, or as
  `SupraGasUnitPriceBelowMinimumError` for a gas unit price below the node's minimum. A 2xx answer whose body is not a
  transaction hash is an accepted submission, and the derived hash is used in place of the body.
- A 400 that says the node's pool already holds the submitted transaction, for example when the same signed
  transaction is submitted twice, is handled as follows when the transaction's sequence number is the caller's (the
  `transaction.submit` methods, the submit methods of a built transaction, and helper calls with `sequenceNumber`).
  The transaction commits at most once.
  - A v12 node names the transaction (`transaction <hash> is already pending`) after it has forwarded it again: the
    submission is handled as accepted with the derived hash, and the call waits for it or reads it back as above.
  - A v11.7 node answers `Already scheduled digest=<hash>, ...`, also when its pool holds another transaction with the
    same sequence number at a gas unit price at least this one's, and does not forward the submission. The SDK reads
    the transaction by hash once, within 5 seconds and without retries. `Success` or `Fail`: handled as accepted.
    `Pending` (the node's pool holds it, and its earlier forward may have failed), another non-final status, or a
    failed read other than a 404: handled as an unknown outcome, with the refusal as `cause` of
    `SupraSubmissionOutcomeUnknownError` and the read's status as `readStatus` or its error as `readError` (or a wait
    for the hash with `enableWaitForTransaction: true`). Sending the same signed transaction to the same v11.7 node
    again does not reach a validator while the node's pool holds it. A 404 or
    `Invalid`: the refusal is thrown as `SupraAPIError`. The 404 is taken to come from the node that refused the
    submission; several RPC nodes behind one URL can answer 404 for a transaction another of them holds.

  A helper call whose number comes from the client's counter does not deduplicate: a repeated call, including one
  from a restarted process that builds the same transaction again, submits a new transaction. When the node already
  holds the same transaction, its number stays taken and the helper sends its transaction with the next number.

```ts
import {
  SupraClient,
  Network,
  SupraAccount,
  SupraSimulationFailedError,
  SupraSubmissionOutcomeUnknownError,
  SupraTransactionFailedError,
  SupraTransactionTimeoutError,
} from 'supra-ts-sdk';

const supra = new SupraClient({ network: Network.TESTNET, waitTimeoutMs: 30_000 });
const sender = new SupraAccount(); // a funded account

try {
  const txn = await supra.coin.transferSupraCoin({
    senderAccount: sender,
    receiverAccountAddress: "0x1234",
    amount: 100n,
    optionalTransactionArgs: {
      enableTransactionWaitAndSimulationArgs: { enableTransactionSimulation: true, enableWaitForTransaction: true },
    },
  });
  console.log(`Committed ${txn.hash}`);
} catch (error) {
  if (error instanceof SupraSimulationFailedError) {
    console.log(`Not submitted: ${error.vm_status}`);
  } else if (error instanceof SupraTransactionFailedError) {
    console.log(`${error.hash} failed with status ${error.status}: ${error.vm_status}`);
  } else if (error instanceof SupraSubmissionOutcomeUnknownError) {
    // The node may have accepted the transaction: read it by its hash before sending it again.
    const read = await supra.transaction.getTransactionByHash({ transactionHash: error.hash }).catch(() => undefined);
    console.log(`${error.hash}: ${read?.status ?? "not found yet"}; it can commit until ${error.expirationTimestampSecs}`);
  } else if (error instanceof SupraTransactionTimeoutError) {
    console.log(`${error.hash} has no final status after ${error.timeoutMs} ms (last status ${error.lastStatus})`);
  } else {
    throw error;
  }
}
```

### Sponsored transaction from a sender without an account

`rawTxnObject` and the sponsor submission take the sender's sequence number from the caller. A sender with no `Account`
resource (`isAccountExists` is `false`) uses sequence number 0 and is not read with `getAccountInfo`, which throws for
an absent account (`SupraNotFoundError` on v12, a `SupraAPIError` with status 400 on v11):

```ts
const accountAddress = sender.address();
const senderSequenceNumber = (await supra.account.isAccountExists({ accountAddress }))
  ? (await supra.account.getAccountInfo({ accountAddress })).sequence_number
  : 0n;
```

This behaviour is exempt from semantic versioning until `supra_node_v12.0.0` reaches Testnet; see
[Stability](#stability). The simulation with that number succeeds on every node. A node from `supra_node_v12.0.0` (Devnet) admits the
submission, the transaction creates the account, and the sender's sequence number is 1 afterwards. A v11.7.x node
(Mainnet, Testnet) refuses the submission with HTTP 400, "Transaction validation failed: Failed to read the
AccountResource".

The fee payer pays the gas, but a new sender holds no SUPRA, so its payload must not spend from the sender's balance (a
transfer from it aborts). `0x1::supra_account::create_account` spends nothing.

### Sequence numbers

A transaction carries the sender's sequence number, and the node executes a transaction only when its number is the
account's next number. `transferSupraCoin`, `transferCoin`, `transferSupraFungibleAsset`, `transferFungibleAsset`,
`migrateCoinToFungibleStore`, `publishPackage`, `cancelAutomationTask`, `stopAutomationTasks`, the multisig helpers and
the entry functions of `Contract.fromABI` take the number from a counter that the `SupraClient` keeps for each account:

- The counter records every transaction the client submits: those the node accepted, and those whose submission
  request failed without an answer (a timeout, a lost connection, a 5xx other than 503), which the node may have
  accepted. Each record keeps the transaction's expiration time and hash (the node's answer, or the hash derived
  before the submission when there was no answer). A transaction the node accepted either commits or, once
  the timestamp of the latest block has reached its expiration time, can no longer commit.
- A record is dropped when the account's sequence number on the chain passes it, when the timestamp of a latest block
  the client reads (`GET /rpc/v3/block`) has reached its expiration time, or when a read of the transaction through
  the client returns `Invalid`; the next call then reads the account's number from the chain, because another sender may
  have committed the discarded transaction's number. Reads of a block by height or by hash do not drop records. An HTTP 404 does not drop a
  record: an RPC node answers 404 for a pending transaction that another RPC node behind the same URL received.
- A submission whose outcome is unknown holds its number until its expiration time or `resetSequenceNumber`, including
  when its expiration time was beyond what a node accepts.
- The number handed out is the lowest number at or above the account's sequence number on the chain that has no
  record. So transactions sent without waiting for the previous one to commit get consecutive numbers, also when they
  are sent concurrently (`Promise.all`), and a number whose transaction can no longer commit is used again.
- The first use reads the account and the latest block (two requests). So does the next call after a refusal for a
  stale number or a full queue, and every call while the client's estimate of the chain's time has passed the
  expiration time of a record by two seconds and no latest block read has reached it (a call makes at most one such
  read). The estimate is the newest latest block's timestamp read plus the time elapsed since that read, measured with
  a monotonic clock, so it does not depend on the client's wall clock and does not move backwards when a read returns
  an older block. Before any latest block has been read it is the client's wall clock. A read updates
  the chain's number and time and drops the records they show dead; it keeps the others.
- A transaction that fails before the node accepts it (its estimate or signing throws, or the node refuses it for
  another reason, for example an insufficient balance) has no record, and the next call uses its number.
- When the node refuses a number as stale (`SEQUENCE_NUMBER_TOO_OLD`, `SEQUENCE_NUMBER_TOO_NEW`, a number below the
  account's, or a number that already has a pending transaction, for example one sent by another client), the helper
  sends the transaction once more with the next number. A second refusal is thrown. A transaction with an explicit
  number is not retried. When the refusal shows that the pending transaction is the one the helper built (another
  call, for example of another client, built the same transaction with the same number), that number stays taken and
  the helper sends its transaction once more with the next number (see [Transaction outcomes](#transaction-outcomes)).
- When the node refuses a number because its queue for the account is full, `SupraAccountQueueFullError` is thrown and
  the transaction is not sent again.
- After a submission whose outcome is unknown and that the node did not in fact accept, later transactions wait in the
  node behind its number until the chain's time reaches its expiration time (`txExpirySecs` after the client's clock,
  60 seconds by default); the next call after that takes the number, and the waiting transactions commit if they have
  not expired.
- `supra.resetSequenceNumber(address)` forgets the counter and the records of an account, including those of this
  client's pending transactions: the next call takes the account's number on the chain, and while a pending
  transaction of this client holds it the node refuses the call. Call it only when no transaction of this client from
  the account is pending, or when the expiration times of those that are have passed. Transactions sent by other
  means (another client or process, a wallet) need no reset: the refusal of a stale number makes the next call read
  the chain.
- `optionalTransactionPayloadArgs: { sequenceNumber }` makes a helper use that number as given. The counter records
  that transaction like its own and does not hand out its number while it can commit. The builders of
  `supra.transaction.build` always take the number as `senderSequenceNumber`.

Calls of one client from one account are submitted one after another. A call holds the account from the moment it
takes its number until the node answers its submission (accepted, refused, or the request fails); building, the max gas
estimate, signing and the simulation before submission (`enableTransactionSimulation`) happen in that time. The wait
for the final status (`enableWaitForTransaction`) comes after it and does not hold the account. So:

- A call without `maxGas` holds the account while its max gas is estimated: a balance read and a simulation, and behind
  pending transactions of the account a read of the account, a read of the latest block and a second simulation.
- A call with `maxGas` (on the call or in `SupraConfig`) waits only until the calls ahead of it have been submitted or
  have failed, then signs and submits.
- To submit faster from one account, set `maxGas`; to submit in parallel, send from several accounts, which do not wait
  for each other.

A call with an explicit `sequenceNumber` does not take part in this order. The counter and the order live in one
`SupraClient`. Two clients, or two processes, that send from the same account each keep their own counter and recover
from each other's transactions through the refusal and re-read described above.

The max gas estimate simulates against committed state. For a transaction sent while an earlier transaction of the
account has not committed, the node reports the number as too new; the SDK then simulates the same transaction with the
account's number on the chain and submits it with the counter's number, so pipelined transfers work with the default
gas settings. Before that simulation the SDK reads the account and the latest block, and it simulates at the chain's
number only when every number between the chain's and the transaction's has a record of a transaction this client
submitted. Otherwise (one of them expired or was discarded, or another client or wallet used a number) the
transaction is built and signed again with the lowest number that has no record, and keeps its place in the order of
the calls. The simulation before submission (`enableTransactionSimulation`) handles the number the same way. When the
read of the account fails, its error is thrown and nothing is submitted, in the estimate and in the simulation before
submission alike; a failed read of the block is ignored. A transaction that depends on an earlier one that has not
committed (for example a call to a module that the earlier transaction publishes) fails that simulation and throws
`SupraSimulationFailedError`, and nothing is submitted. Pass `maxGas` for such a transaction, or wait for the earlier
transaction to commit.

A node accepts a transaction whose number is ahead of the account's next number and holds it until the numbers before
it have been sent. The node holds at most 25 numbers per account by default and refuses a number beyond them
(`SupraAccountQueueFullError`), so at most about 25 transactions of one account can be in flight; wait for commits
(`enableWaitForTransaction: true`) when sending more than that.

A transaction expires at `txExpiryTime` (seconds since the Unix epoch, used as given). Without it, a transaction expires
`SupraConfig.txExpirySecs` seconds (default 60) after the client's clock in whole seconds, at most 5 seconds less than
the node's maximum time to live: the node refuses an expiration time more than that maximum after its own clock, and
the 5 seconds left cover a node clock that is up to 5 seconds behind the client's, so a `txExpirySecs` equal to the
maximum is accepted. The maximum is `max_transaction_time_to_live_seconds` of `GET /rpc/v3/transactions/parameters`
(600 on Mainnet, Testnet and Devnet); `supra.getTransactionParameters()` returns it. The client reads it once, with
the first builder that sends requests or the first signature that needs it, and keeps it; a failed read throws its
error and nothing falls back to 600. A `txExpirySecs` above the maximum throws a `RangeError` when the transaction is
built, and a transaction whose expiration time is more than the maximum (plus 5 seconds of slack, for the client's
estimate of the node's clock) after the current time throws a `RangeError` before signing. The messages name the
maximum and say whether it was read from the node or assumed (600, when the client has not read it;
`getTransactionParameters()` reads it first). Signing with `verifyChainId: false` sends no request and does not check
the expiration time, and the builders that send no request (`rawTxnObject` and the like) use the maximum the client
has read, else 600, and throw the same `RangeError` for a `txExpirySecs` above it. The node also refuses a transaction whose expiration time is not
after its clock, so a client whose clock is far from the node's has its transactions refused (as expired, or as too far
in the future); these refusals are thrown as they are. Set `txExpirySecs` or `txExpiryTime` for a transaction that is
signed or submitted later.

```ts
const supra = new SupraClient({ network: Network.TESTNET });

// Ten transfers from one account, submitted one after another without waiting for the earlier ones to commit.
const responses = await Promise.all(
  Array.from({ length: 10 }, () =>
    supra.coin.transferSupraCoin({ senderAccount: sender, receiverAccountAddress: "0x1234", amount: 100n }),
  ),
);
```

### Gas

Each transaction has a max gas (`max_gas_amount`, in gas units), a gas unit price (in quants) and an expiration time.
`optionalTransactionPayloadArgs` sets them per transaction (`maxGas`, `gasUnitPrice`, `txExpiryTime`) on every method
that builds a transaction, and `SupraConfig` sets `maxGas`, `gasUnitPrice` and `txExpirySecs` (see
[Sequence numbers](#sequence-numbers)) for every transaction of the client. A per-call setting replaces the client's. The SDK does not modify the options objects it is given.

The gas unit price of a transaction is, in this order:

1. the call's `gasUnitPrice`;
2. the client's `SupraConfig.gasUnitPrice`;
3. the node's estimate, `max(median gas price, minimum gas price)` of `GET /rpc/v3/transactions/estimate_gas_price`
   (`supra.getEstimatedGasUnitPrice()` returns it). The median is taken over the last transactions the RPC node
   executed and can be below the node's current minimum. The estimate is read for each transaction that needs it. In the
   helpers that submit (the transfers, `migrateCoinToFungibleStore`, `publishPackage`, the automation task helpers,
   the multisig helpers and the entry functions of `Contract.fromABI`) the read starts when the call is made, before the
   sender's account lock is requested, and is awaited in the call's turn, so calls from one account keep the order of
   the calls, except SUPRA fungible asset transfers, whose balance check is awaited before the lock is requested, and
   the multisig propose and execute helpers (`proposeMultisigTransaction`, `proposeMultisigTransactionWithHash`,
   `executeMultisigTransaction`), whose reads of the proposal's function ABI and of the next proposal are awaited before
   the lock is requested. For these two the price read starts after those reads, not when the call is made.
   `transaction.build.simple` awaits the read before it builds. The same price is used for the max gas estimate and the
   transaction. A failed read throws its
   error, like a failed build, and nothing is submitted.

A price set by the call or the client is used as given and makes no request. When it is below the node's minimum, the
node refuses the transaction and the SDK throws `SupraGasUnitPriceBelowMinimumError` (`gasUnitPrice`,
`minimumGasUnitPrice`) from the submission or from the simulation. It is not a `SupraAPIError` or a
`SupraSimulationFailedError`; that original error is its `cause`. The SDK does not send the transaction again or raise
the price, and the sequence number is used by the next transaction. The builders that make no request cannot read the
estimate: without a price on the call or the client they throw a `RangeError` before building.

The node accepts a transaction only when the sender's balance pays for `max gas × gas unit price`, and charges the gas
used. When neither the call nor the client sets `maxGas`:

- The coin and fungible asset transfers, `publishPackage`, the automation task helpers, the multisig helpers and the
  entry functions of `Contract.fromABI` estimate it.
  They read the sender's SUPRA balance, simulate the transaction with the largest max gas that balance pays for, and
  use `ceil(gas used × 1.5)`, at least 1,500 units and at most what the balance pays for. A simulation whose status is
  not `Success` (an abort, `OUT_OF_GAS`, `PendingAfterExecution`, `Invalid`) throws `SupraSimulationFailedError` and
  nothing is submitted. When an earlier transaction of the sender has not committed, the simulation of the next one is
  made with the sender's sequence number on the chain (see [Sequence numbers](#sequence-numbers)). When the balance
  read or the simulation request fails, or the response has no `gas_used`, the
  fixed default below applies, at most what the balance pays for. `SupraConfig.maxGasEstimateMultiplier` replaces the
  factor 1.5.
- `transaction.build.simple` has no key pair to simulate with: it uses the fixed default, at most what the sender's
  balance pays for.
- The builders that make no request (`rawTxnObject`, `scriptRawTxnObject`, `automationRegistrationRawTxnObject`,
  `multisigRawTxnObject`, `multisigProposalTxRawTxnObject`) use the fixed default.

The fixed default, `DEFAULT_MAX_GAS_UNITS`, is 20,000 units: it covers a one-module publish (about 2,000 units), a
multisig account creation (about 1,700) and a transfer that creates the receiver (about 1,000). The node requires the
sender's SUPRA balance to cover `max gas × gas unit price` at validation: at a gas unit price of 100,000 quants,
20,000 units need 20 SUPRA (2,000,000,000 quants). The builders that make no request keep this limit, so a
sender with less than that must set `maxGas`. `estimateMaxGas: false`, per call or in `SupraConfig`, turns the
estimate off and uses the fixed default without a request.

```ts
// Estimated max gas, the node's gas unit price estimate
await supra.coin.transferSupraCoin({ senderAccount: sender, receiverAccountAddress: "0x1234", amount: 100n });

// Per-call settings
await supra.coin.transferSupraCoin({
  senderAccount: sender,
  receiverAccountAddress: "0x1234",
  amount: 100n,
  optionalTransactionArgs: { optionalTransactionPayloadArgs: { maxGas: 5_000n, gasUnitPrice: 100_000n } },
});
```

### Multisig accounts

`supra.multisig` covers the lifecycle of a multisig account (`0x1::multisig_account`). Every method that sends a
transaction takes the sender's `SupraAccount` and the usual `optionalTransactionArgs`, and uses the client's sequence
numbers, chain ID check and gas estimate like the other helpers.

```ts
const { multisigAddress } = await supra.multisig.createMultisigAccount({
    senderAccount: first,
    additionalOwners: [second.address()],
    signaturesRequired: 2,
    optionalTransactionArgs: { enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true } },
});

// The payload is stored on chain; the executor needs no payload.
await supra.multisig.proposeMultisigTransaction({
    senderAccount: first,
    multisigAddress,
    payload: { function: '0x1::supra_account::transfer', functionArgs: ['0x2', 1000n] },
    optionalTransactionArgs: { enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true } },
});
const { next } = await supra.multisig.getMultisigSequenceNumbers({ multisigAddress });
await supra.multisig.approveMultisigTransaction({
    senderAccount: second,
    multisigAddress,
    sequenceNumber: next - 1n,
    optionalTransactionArgs: { enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true } },
});
await supra.multisig.executeMultisigTransaction({ senderAccount: first, multisigAddress });

// A proposal that the owners reject is removed with:
// await supra.multisig.rejectMultisigTransaction({ senderAccount: first, multisigAddress, sequenceNumber });
// await supra.multisig.executeRejectedMultisigTransaction({ senderAccount: first, multisigAddress });
```

A proposal can store only the hash of its payload, which keeps the payload off chain until the execution. The executor
then passes the payload to `executeMultisigTransaction`:

```ts
const payload: MultisigEntryFunctionPayload = {
    function: '0x1::supra_account::transfer',
    functionArgs: ['0x2', 1000n],
};

await supra.multisig.proposeMultisigTransactionWithHash({
    senderAccount: first,
    multisigAddress,
    payload,
    optionalTransactionArgs: { enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true } },
});

const { next: nextNumber } = await supra.multisig.getMultisigSequenceNumbers({ multisigAddress });
await supra.multisig.approveMultisigTransaction({
    senderAccount: second,
    multisigAddress,
    sequenceNumber: nextNumber - 1n,
    optionalTransactionArgs: { enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true } },
});

// Without the payload this call throws SupraMultisigPayloadError before it submits anything.
await supra.multisig.executeMultisigTransaction({ senderAccount: first, multisigAddress, payload });
```

Creating a proposal counts as the proposer's approval: `create_transaction` and `create_transaction_with_hash` record
the creator's vote as an approval. With `signaturesRequired: 2`, as above, one more owner has to approve before the
execution.

`createMultisigAccount` returns the account's address, derived from the sender and the creating transaction's sequence
number (`deriveMultisigAccountAddress`); the account exists once the transaction has executed. The default
`timeoutDurationSecs` of a proposal is seven days. `executeMultisigTransaction` reads the next proposal first: for a
proposal that stores its payload it sends the transaction without a payload, and for a proposal that stores only a hash
it sends the `payload` of the call, throwing `SupraMultisigPayloadError` before submitting when that payload is missing
or does not match the hash. `transaction.build.multisigRawTxnObject` builds the same execution; leave out `function`,
`functionTypeArgs` and `functionArgs` for a proposal that stores its payload. The nodes refuse to simulate an execution
without a payload (`MISSING_DATA`), so the helper simulates the execution with the stored payload for the max gas
estimate and for `enableTransactionSimulation`, and sends the execution without it. A simulation does not check the
approvals, the timeout or the payload against the proposal: `enableTransactionSimulation` does not detect missing
approvals or an expired proposal, and the node refuses such an execution when it validates it. The propose and approve
calls above wait for their commit so that the sequence-number read and the execution see them.

### `bigint` values

Move `u64`, `u128` and `u256` values are `bigint` in several objects the SDK returns: built transactions, the
`SendTxnPayload` of `transaction.build.sendTxnPayload`, `getAccountCoinBalance` and view results. So are the `u64`
response fields that can exceed `Number.MAX_SAFE_INTEGER`: `execution_statistics.evm_base_fee_per_gas` of every block a
v12 node returns, the `burn_amount` of a settlement transaction, settlement amounts and the `*_quants` figures of
`getNativeSupply`. `JSON.stringify` throws `TypeError: Do not know how to serialize a BigInt` for an object that holds
one. `stringifyWithBigInt` writes them as
exact JSON numbers, the form the node accepts in a request body; to display or store such an object, convert them to
strings:

```ts
import { stringifyWithBigInt } from 'supra-ts-sdk';

const body = stringifyWithBigInt(await supra.transaction.build.sendTxnPayload({ senderAccount: sender, rawTxn }));
const text = JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? v.toString() : v));
```

### Fixed-point arguments

An entry or view function parameter of type `0x1::fixed_point32::FixedPoint32` or `0x1::fixed_point64::FixedPoint64`
takes the struct's raw value: the `u64` of a `FixedPoint32` (the number times 2^32) or the `u128` of a `FixedPoint64`
(the number times 2^64), as a `bigint` or a decimal string. `vector<FixedPoint32>` and `Option<FixedPoint64>` work
the same way. A view function returns such a value as `{ value: bigint }`.

```ts
const oneAndAHalf = 3n << 31n; // 1.5 as a FixedPoint32

const rawTxn = await supra.transaction.build.simple({
    senderAddress: sender.address(),
    senderSequenceNumber: sequenceNumber,
    function: `${moduleAddress}::prices::set_rate`, // set_rate(account: &signer, rate: FixedPoint32)
    functionTypeArgs: [],
    functionArgs: [oneAndAHalf],
});

const [rate] = await supra.methods.view<[{ value: bigint }]>({
    function: `${moduleAddress}::prices::rate`,
    functionArguments: [],
});
console.log(rate.value); // 6442450944n
```

### Generic view functions

`methods.view` and the contract proxy convert a parameter or return type that is a type parameter, or contains one
(`vector<T>`, `0x1::option::Option<T>`, `0x1::object::Object<T>`, a struct over `T`), as the type with each type
parameter replaced by its type argument. For `#[view] public fun identity<T: copy + drop>(x: T): T`:

```ts
const [value] = await supra.methods.view<[bigint]>({
    function: `${moduleAddress}::m::identity`,
    typeArguments: ["u64"],
    functionArguments: [12345n],
});
console.log(value); // 12345n
```

An `0x1::object::Object<…>` argument is given as its address. Inside a `vector` or an `Option` the node reads an
`Object` as the struct `{ inner: <address> }`, and the SDK sends it in that form there.

A v11 node (Mainnet, Testnet) reads every type parameter as `address`, so for any other type argument it refuses the
request or reads the value's bytes as the wrong type. A type parameter that occurs in a parameter or return type outside
`Object<…>` therefore needs a node from `supra_node_v12.0.0` (Devnet) unless its type argument is `address` or
`signer`, or is `0x1::object::Object<…>` and the type parameter is the whole parameter or return type (inside a
`vector` or `Option` a v12 node reads the `Object` as `{ inner }` and a v11 node as an address). This behaviour is
exempt from semantic versioning until `supra_node_v12.0.0` reaches Testnet; see [Stability](#stability). For such a call the
client reads `GET /rpc/v3/version` and keeps a `release` once the node reports one; on a node that reports none the call
throws `SupraError` before the view request is sent, and the next such call reads the version again. Behind a load
balancer whose nodes run different releases, as during an upgrade, the SDK cannot tell which node answers the view.
Calls with only address-like type arguments make no version request and work on both. `methods.viewRaw` makes no such
check.

### Automation tasks

The node runs the entry function of an automation task as automated transactions of the task's owner, from the
automation cycle after its registration until the task expires. A task is registered with an automation
registration transaction built by `transaction.build.automationRegistrationRawTxnObject`. With
`automationTaskType` or `automationPriority` the registration carries version 2 parameters; without them, version 1.
Nodes of the v11.7.0 and v12 lines accept both. A task registered without a priority gets its task index as its
priority. `automationPriority` is for system tasks only: the registry aborts a user task that carries a priority
(`EUSER_TASK_PRIORITY_NOT_SUPPORTED`), so the builder throws a `RangeError` when `automationPriority` is given with
`automationTaskType: 'User'` or with no task type. Only accounts that the Supra framework has authorised can register
`"System"` tasks, with or without a priority.

`automationGasPriceCap` must be at least the node's minimum gas unit price (`supra.getMinGasUnitPrice()`). The node
refuses a registration with a lower cap at validation: submitting answers `400` with `MoveTransactionValidationFailed`
and `AUTOMATION_TASK_GAS_PRICE_CAP_BELOW_MIN_BOUND` (a `SupraAPIError`), and a simulation reports `Invalid` with that
status (a `SupraSimulationFailedError`). The builder does not check the cap.

```ts
const gasUnitPrice = await supra.getEstimatedGasUnitPrice();
const registration = supra.transaction.build.automationRegistrationRawTxnObject({
    senderAddress: owner.address(),
    senderSequenceNumber: (await supra.getAccountInfo({ accountAddress: owner.address() })).sequence_number,
    function: '0x1::supra_account::transfer',
    functionTypeArgs: [],
    functionArgs: [receiver.toUint8Array(), BCS.bcsSerializeUint64(1_000n)],
    automationMaxGasAmount: 500n,
    automationGasPriceCap: 2n * gasUnitPrice,
    automationFeeCapForEpoch: 1_000_000_000n,
    automationExpirationTimestampSecs: BigInt(Math.floor(Date.now() / 1000) + 60 * 60),
    automationAuxData: [],
    automationTaskType: 'User',
    optionalTransactionPayloadArgs: { gasUnitPrice },
});
const registered = await registration.submitTransaction({
    senderAccount: owner,
    enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true },
});
```

The registration emits a `0x1::automation_registry::AutomationTaskMetaData` event whose `task_index` identifies the
task. `automation.cancelAutomationTask` (`0x1::automation_registry::cancel_task`) cancels a task: one that has not run
yet is removed, an active one runs until the end of the current automation cycle. `automation.stopAutomationTasks`
(`0x1::automation_registry::stop_tasks`) removes tasks at once. Both take the sender's sequence number from the
client's counter, like the transfer helpers, and refunds follow the registry's rules.

```ts
await supra.automation.cancelAutomationTask({ senderAccount: owner, taskIndex: 42n });
await supra.automation.stopAutomationTasks({ senderAccount: owner, taskIndexes: [43n, 44n] });
```

## 📚 More Examples

Every example runs against Devnet, Testnet or a localnet given `SUPRA_NETWORK` (or `SUPRA_RPC_URL` and
`SUPRA_CHAIN_ID`) and, for the examples that send transactions, `SUPRA_PRIVATE_KEY` or `SUPRA_EXAMPLES_FUND=1`.
[`examples/README.md`](https://github.com/Entropy-Foundation/supra-ts-sdk/blob/master/examples/README.md) lists what each one needs. From a clone of this repository:

```bash
SUPRA_NETWORK=devnet SUPRA_EXAMPLES_FUND=1 pnpm examples
```

- [Account](https://github.com/Entropy-Foundation/supra-ts-sdk/blob/master/examples/account.ts)
- [Faucet](https://github.com/Entropy-Foundation/supra-ts-sdk/blob/master/examples/faucet.ts)
- [Coin](https://github.com/Entropy-Foundation/supra-ts-sdk/blob/master/examples/coin.ts)
- [Fungible Asset](https://github.com/Entropy-Foundation/supra-ts-sdk/blob/master/examples/fungibleAsset.ts)
- [Transaction](https://github.com/Entropy-Foundation/supra-ts-sdk/blob/master/examples/transaction.ts)
- [Build Transaction](https://github.com/Entropy-Foundation/supra-ts-sdk/blob/master/examples/buildTransaction.ts)
- [Simulate Transaction](https://github.com/Entropy-Foundation/supra-ts-sdk/blob/master/examples/simulateTransaction.ts)
- [Submit Transaction](https://github.com/Entropy-Foundation/supra-ts-sdk/blob/master/examples/submitTransaction.ts)
- [Contract](https://github.com/Entropy-Foundation/supra-ts-sdk/blob/master/examples/contract.ts)
- [Event](https://github.com/Entropy-Foundation/supra-ts-sdk/blob/master/examples/events.ts)
- [Methods](https://github.com/Entropy-Foundation/supra-ts-sdk/blob/master/examples/methods.ts)
- [Table](https://github.com/Entropy-Foundation/supra-ts-sdk/blob/master/examples/table.ts)
- [Block](https://github.com/Entropy-Foundation/supra-ts-sdk/blob/master/examples/block.ts)



## 🤝 Contributing

Contributions are welcome!

1. Fork the repository
2. Create your feature branch (`git checkout -b feat/your-feature`)
3. Commit your changes (`git commit -m 'Add your feature'`)
4. Push to the branch (`git push origin feat/your-feature`)
5. Open a Pull Request

Please:

- Follow existing code style & add tests where possible
- Update README/examples if behavior changes
- Report bugs via **Issues** with reproduction steps

### Releasing

[RELEASING.md](https://github.com/Entropy-Foundation/supra-ts-sdk/blob/master/RELEASING.md) describes the versioning policy, the npm dist-tags and the release checklist.
[`compatibility.json`](https://github.com/Entropy-Foundation/supra-ts-sdk/blob/master/compatibility.json) and [CHANGELOG.md](https://github.com/Entropy-Foundation/supra-ts-sdk/blob/master/CHANGELOG.md) are updated with every release.


## 📄 License

MIT License

See the [LICENSE](https://github.com/Entropy-Foundation/supra-ts-sdk/blob/master/LICENSE) file for full details.

Built with ❤️ for the Supra ecosystem. Happy coding! 🚀
