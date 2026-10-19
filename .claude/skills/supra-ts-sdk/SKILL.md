---
name: supra-ts-sdk
description: |
  Guide for integrating the Supra L1 blockchain TypeScript SDK (supra-ts-sdk) into React or Next.js projects. Covers client setup, account queries, coin/fungible asset transfers, smart contract interaction via ABI proxies, transaction lifecycle (build/simulate/submit/wait), gas, sequence numbers, the chain ID check, errors, view functions, events, and Move type mapping.
when_to_use: |
  Use when: user asks to integrate Supra blockchain into a React/Next.js app; user wants to query Supra accounts, balances, or transactions from a frontend; user needs to build/sign/submit Supra transactions; user wants to interact with Move smart contracts from TypeScript; user asks about supra-ts-sdk usage patterns.
---

# supra-ts-sdk Integration Guide for React / Next.js

You are helping a developer integrate the `supra-ts-sdk` package (version 2.0.0 or later) into a React or Next.js project. Follow these patterns and API references exactly. The SDK supports nodes from v11.7.0 onwards.

SUPRA amounts are integers in **quants**, the smallest unit (1 SUPRA = 100,000,000 quants). Gas unit prices are in quants.

## Installation

```bash
npm install supra-ts-sdk
# or
pnpm add supra-ts-sdk
```

The SDK requires Node.js >= 18 (uses native `fetch` and `AbortSignal.timeout()`). Calls that sign a transaction need the account's private key, so they belong in server-side code (see Important Caveats).

## Key Import

Import everything — including the `supra-l1-sdk-core` primitives (`SupraAccount`,
`HexString`, `TxnBuilderTypes`, `TypeTagParser`, `BCS`) — from the single
`supra-ts-sdk` package. The SDK re-exports them, so you never import
`supra-l1-sdk-core` directly.

```typescript
import {
  SupraClient,
  Network,
  type SupraConfig,
  type TransactionResponse,
  type CommittedTransactionResponse,
  type SubmitTransactionResponse,
  type PaginatedResponse,
  type AccountData,
  type MoveModule,
  type MoveFunctionId,
  type MoveStructId,
  type CoinInfo,
  // re-exported from supra-l1-sdk-core:
  BCS,
  SupraAccount,
  HexString,
  TxnBuilderTypes,
  TypeTagParser,
} from "supra-ts-sdk";
```

## Client Initialization

`SupraClient` is synchronous to construct and sends no request. Create one instance and reuse it: it keeps the sequence-number counters and the node's chain ID.

```typescript
// Predefined networks: Network.MAINNET (chain ID 8), Network.TESTNET (6) and Network.DEVNET (50)
const supra = new SupraClient({ network: Network.TESTNET });
```

```typescript
// Any other node: its RPC URL and chain ID (an integer from 0 to 255)
const local = new SupraClient({ rpcUrl: "http://localhost:27001", chainId: 255 });
```

```typescript
// Settings for every transaction of the client; a setting on a call replaces the client's
const configured = new SupraClient({
    network: Network.TESTNET,
    maxGas: 20_000n,             // without it the max gas is estimated per transaction (see Gas)
    minGasUnitPrice: 100_000n,   // gas unit price in quants (default 100,000)
    timeoutMs: 10_000,           // request timeout (default 30,000)
    retry: { attempts: 3, maxDelayMs: 5_000 }, // retries of GET requests that fail with 429, 503 or a connection error; off by default
    waitTimeoutMs: 30_000,       // how long a wait for a final transaction status lasts (default 60,000)
});
```

### React Pattern: Singleton Client

```typescript
// lib/supra.ts
import { SupraClient, Network } from "supra-ts-sdk";

let client: SupraClient | null = null;

export function getSupraClient(): SupraClient {
    if (!client) {
        client = new SupraClient({ network: Network.MAINNET });
    }
    return client;
}
```

### Next.js: Server Actions / Route Handlers

The SDK uses `fetch` internally. In Next.js App Router, wrap SDK calls in Server Actions or Route Handlers to keep RPC calls server-side:

```typescript
// app/actions/supra.ts
"use server";
import { SupraClient, Network } from "supra-ts-sdk";

const supra = new SupraClient({ network: Network.MAINNET });

export async function getBalance(address: string): Promise<string> {
    const balance = await supra.account.getAccountSupraCoinBalance({
        accountAddress: address,
    });
    return balance.toString(); // bigint cannot be serialized to client
}
```

**Important**: `bigint` values cannot be serialized across the server/client boundary in Next.js. Convert to `string` or `number` before returning to client components.

---

## Chain ID Check and Async Signing

Before its first signature a client reads the chain ID of its node and keeps it. Every signing path (`signTransaction`, `transaction.build.signedTransaction` and `sendTxnPayload`, the signing methods of a built transaction, the `transaction.submit` methods that take a `senderAccount`, the coin and fungible asset transfers, `publishPackage` and the entry functions of `Contract.fromABI`) throws `SupraChainIdMismatchError` before signing when the configured chain ID or the transaction's chain ID is not the node's. Nothing is signed or sent in that case.

Signing methods return promises: `await` `signTransaction`, `transaction.build.signedTransaction`, `transaction.build.sendTxnPayload` and the `signTransaction`, `signedTransaction` and `sendTxnPayload` methods of a built transaction.

```typescript
import { SupraChainIdMismatchError } from "supra-ts-sdk";

const checked = new SupraClient({ rpcUrl: "http://localhost:27001", chainId: 8 });

try {
    await checked.validateChainId();   // optional: reports a mismatch before any transaction is built
} catch (error) {
    if (error instanceof SupraChainIdMismatchError) {
        console.log(error.configuredChainId, error.nodeChainId);
    }
}

const nodeChainId = (await checked.getChainId()).value; // getChainId() is async: the node's chain ID
```

`verifyChainId: false` turns the check off for offline signing: the client signs with its configured chain ID and sends no request to do so.

```typescript
const offline = new SupraClient({ network: Network.MAINNET, verifyChainId: false });
const sender = new SupraAccount();

const rawTxn = offline.transaction.build.rawTxnObject({
    senderAddress: sender.address(),
    senderSequenceNumber: 0n,   // the account's sequence number, obtained separately
    function: "0x1::supra_account::transfer",
    functionTypeArgs: [],
    functionArgs: [new SupraAccount().address().toUint8Array(), BCS.bcsSerializeUint64(1_000n)],
    optionalTransactionPayloadArgs: { maxGas: 5_000n, gasUnitPrice: 100_000n },
});
const signedTransaction = await rawTxn.signedTransaction(sender);
```

---

## Account Module

All account methods accept `accountAddress` as `string` (hex) or `HexString`.

```typescript
// Check if an account exists: false when the node has no such account.
// Any other failure (unreachable node, timeout, 429, 5xx) is thrown and does not mean the account is absent.
const exists: boolean = await supra.account.isAccountExists({
    accountAddress: "0x1",
});

// Get account info (sequence number, auth key); throws SupraAPIError for an account that does not exist
const info: AccountData = await supra.account.getAccountInfo({
    accountAddress: account.address(),
});
// info.sequence_number is bigint

// Get the SUPRA balance in quants: the CoinStore balance plus the fungible asset store balance
const balance: bigint = await supra.account.getAccountSupraCoinBalance({
    accountAddress: account.address(),
});

// Get the SUPRA balance by form
const { total, coin, fungibleAsset } = await supra.account.getAccountSupraBalance({
    accountAddress: account.address(),
});

// Get the balance of a coin type (total of CoinStore and paired fungible asset store)
const coinBalance: bigint = await supra.account.getAccountCoinBalance({
    accountAddress: account.address(),
    asset: "0x1::supra_coin::SupraCoin",
});

// Get the balance of a fungible asset: its primary store only, so 0xa is 0 for SUPRA that was never migrated
const assetBalance: bigint = await supra.account.getAccountCoinBalance({
    accountAddress: account.address(),
    asset: "0xa",
});

// Get account resources (paginated)
const { response: resources, cursor } = await supra.account.getAccountResources({
    accountAddress: account.address(),
    options: { count: 10 },
});

// Get specific resource
const resource = await supra.account.getAccountResource<{ coin: { value: string } }>({
    accountAddress: account.address(),
    resourceType: "0x1::coin::CoinStore<0x1::supra_coin::SupraCoin>",
});

// Get account modules (paginated)
const { response: modules } = await supra.account.getAccountModules({
    accountAddress: "0x1",
});

// Get specific module
const module = await supra.account.getAccountModule({
    accountAddress: "0x1",
    moduleName: "acl",
});

// Get account transactions (paginated)
const { response: txns } = await supra.account.getAccountTransactions({
    accountAddress: account.address(),
    options: { count: 10, ascending: false },
});

// Count the coin types the account holds (SUPRA counts once, in either form)
const count: number = await supra.account.getAccountCoinsCount({
    accountAddress: account.address(),
});
```

---

## Coin Module

`transferSupraCoin` and `transferCoin` take the amount in the coin's smallest unit (quants for SUPRA) as `number` (a safe integer) or `bigint`. `transferSupraCoin` moves SUPRA held in the `CoinStore` or in the fungible asset store.

```typescript
// Get coin metadata
const coinInfo: CoinInfo = await supra.coin.getCoinInfo({
    coinType: "0x1::supra_coin::SupraCoin",
});
// { name: string, symbol: string, decimals: number }

// Transfer SUPRA (high-level: estimates gas, takes the sequence number, signs and submits)
const transfer: SubmitTransactionResponse = await supra.coin.transferSupraCoin({
    senderAccount: account,  // SupraAccount instance
    receiverAccountAddress: "0x2",
    amount: 10_000n,         // quants
    optionalTransactionArgs: {
        enableTransactionWaitAndSimulationArgs: {
            enableTransactionSimulation: true,
            enableWaitForTransaction: true,
        },
    },
});

// Transfer any coin type
const coinTransfer: SubmitTransactionResponse = await supra.coin.transferCoin({
    senderAccount: account,
    receiverAccountAddress: "0x2",
    amount: 10_000n,
    coinType: "0x1::supra_coin::SupraCoin",
    optionalTransactionArgs: {
        enableTransactionWaitAndSimulationArgs: {
            enableWaitForTransaction: true,
        },
    },
});
```

---

## Fungible Asset Module

SUPRA that an account received as a coin (for example from the faucet) is in its `CoinStore`. The fungible asset transfers move only the primary fungible store. `transferSupraFungibleAsset`, and `transferFungibleAsset` with the SUPRA fungible asset address (`0xa`), read the sender's fungible asset balance first and throw `SupraInsufficientFungibleAssetBalanceError` without submitting when it is below `amount`. `migrateCoinToFungibleStore` moves the coin balance into the fungible store; `supra.coin.transferSupraCoin` moves SUPRA held in either form.

```typescript
// Get fungible asset metadata
const metadata = await supra.fungibleAsset.getFungibleAssetMetadata({
    assetAddress: "0xa",
});

// Move the SUPRA held in the CoinStore to the fungible asset store
await supra.fungibleAsset.migrateCoinToFungibleStore({
    senderAccount: account,
    optionalTransactionArgs: { enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true } },
});

// Transfer SUPRA as fungible asset (amount in quants)
const faTransfer = await supra.fungibleAsset.transferSupraFungibleAsset({
    senderAccount: account,
    receiverAccountAddress: "0x2",
    amount: 10_000n,
});

// Transfer any fungible asset
const assetTransfer = await supra.fungibleAsset.transferFungibleAsset({
    senderAccount: account,
    receiverAccountAddress: "0x2",
    amount: 10_000n,
    assetAddress: "0x1234",
});
```

---

## View Functions (Read-Only Contract Calls)

Two approaches: typed `view` and untyped `viewRaw`.

```typescript
// Typed view - arguments are encoded and results converted by the function's ABI
const [balance] = await supra.methods.view<[bigint]>({
    function: "0x1::coin::balance",
    functionArguments: ["0x1"],  // account address
    typeArguments: [new TypeTagParser("0x1::supra_coin::SupraCoin").parseTypeTag()],
});

// Raw view - returns raw JSON values (u64/u128/u256 come as strings)
const [balanceRaw] = await supra.methods.viewRaw({
    function: "0x1::coin::balance",
    functionArguments: ["0x1"],
    typeArguments: ["0x1::supra_coin::SupraCoin"],
});
```

Type arguments are `TypeTag`s or Move type strings. A string must be exactly one concrete type (`u64`,
`vector<u8>`, `0x1::coin::CoinStore<0x1::supra_coin::SupraCoin>`); text after the type, generic parameters such as
`T0` and unknown names throw before any request. `TypeTagParser` parses `0x1::object::Object<T>` as `address`, so pass
`Object` type arguments as strings: `typeArguments: ["0x1::object::Object<0x1::fungible_asset::Metadata>"]`. Where a
`TypeTag` is required (the `functionTypeArgs` of `transaction.build.rawTxnObject`), build it with
`parseTypeArgument("0x1::object::Object<0x1::fungible_asset::Metadata>")`, which parses strings as the SDK does.

### Move Type Argument Mapping

When passing **function arguments** to `view()`:
| Move Type | TypeScript Value |
|-----------|-----------------|
| `u8`, `u16`, `u32` | `number` (e.g., `10`) |
| `u64`, `u128`, `u256` | `bigint` (e.g., `100n`), a decimal string, or a `number` up to 2^53 - 1 |
| `bool` | `boolean` (or `"true"` / `"false"`; other values throw) |
| `address` | `string` or `HexString` (1 to 64 hex digits, e.g., `"0x1"`; `""` and `"0x"` throw) |
| `0x1::object::Object<T>` | the object's address, as for `address` (e.g., `"0xa"`) |
| `vector<u8>` | `string` (hex) |
| `vector<T>` | `T[]` |
| `0x1::string::String` | `string` |
| `0x1::option::Option<T>` | `T \| null` |
| `signer` / `&signer` | `SupraAccount` (for entry functions) |

When **return types** come back from `view()`:
| Move Type | TypeScript Return |
|-----------|------------------|
| `u8`, `u16`, `u32` | `number` |
| `u64`, `u128`, `u256` | `bigint` |
| `bool` | `boolean` |
| `address` | `string` |
| `vector<T>` | `T[]` |
| `Option<T>` | `T \| null` |

---

## Contract ABI Proxy (Type-Safe Contract Interaction)

Define ABIs as `const` for full type inference:

```typescript
const MY_CONTRACT_ABI = {
    address: "0x1",
    name: "coin",
    friends: [],
    exposed_functions: [
        {
            name: "balance",
            visibility: "public",
            is_entry: false,
            is_view: true,
            generic_type_params: [{ constraints: [] }],
            params: ["address"],
            return: ["u64"],
        },
        {
            name: "transfer",
            visibility: "public",
            is_entry: true,
            is_view: false,
            generic_type_params: [{ constraints: [] }],
            params: ["&signer", "address", "u64"],
            return: [],
        },
    ],
    structs: [],
} as const;

// Create typed proxy
const { contracts } = supra.contract.fromABI([MY_CONTRACT_ABI] as const);

// View function call (read-only)
const [balance] = await contracts.coin.view.balance({
    functionArguments: ["0x1"],
    typeArguments: ["0x1::supra_coin::SupraCoin"],
});
// balance is typed as bigint (from u64 return)

// Entry function call (state-changing, requires signer)
const txn = await contracts.coin.entry.transfer({
    functionArguments: [account, "0x2", 1000n],
    typeArguments: [new TypeTagParser("0x1::supra_coin::SupraCoin").parseTypeTag()],
    enableTransactionWaitAndSimulationArgs: {
        enableTransactionSimulation: true,
        enableWaitForTransaction: true,
    },
});
```

**Key rules for ABI proxy**:
- ABI array must be `as const` for type inference to work
- `is_view: true` functions appear under `.view`, `is_entry: true` under `.entry`
- `&signer` params in entry functions expect a `SupraAccount` instance
- Entry functions accept optional `optionalTransactionPayloadArgs` and `enableTransactionWaitAndSimulationArgs`; they estimate the max gas, take the sequence number from the client's counter and check the chain ID like the transfers

---

## Transaction Lifecycle (Low-Level)

### 1. Build

```typescript
// High-level simple build (auto-serializes args based on the function's ABI, which it reads from the node)
const simpleTxn = await supra.transaction.build.simple({
    senderAddress: account.address(),
    senderSequenceNumber: (await supra.account.getAccountInfo({
        accountAddress: account.address(),
    })).sequence_number,
    function: "0x1::supra_account::transfer_coins",
    functionTypeArgs: ["0x1::supra_coin::SupraCoin"],
    functionArgs: ["0x2", 10000n],
});

// Low-level build (pre-serialized BCS args, no request)
const rawTxn = supra.transaction.build.rawTxnObject({
    senderAddress: account.address(),
    senderSequenceNumber: 0n,   // the account's next sequence number
    function: "0x1::supra_account::transfer",
    functionTypeArgs: [],
    functionArgs: [new SupraAccount().address().toUint8Array(), BCS.bcsSerializeUint64(10000n)],
});
```

The builders take the sequence number as `senderSequenceNumber`; they do not use the client's counter.

### 2. Simulate

`simulate` throws `SupraSimulationFailedError` when the simulated status is not `Success`.

```typescript
// Build a sendTxnPayload for simulation (signing is async)
const sendPayload = await supra.transaction.build.sendTxnPayload({
    senderAccount: account,
    rawTxn: rawTxn,
});

const simResult = await supra.transaction.simulate.simple({
    sendTxPayload: sendPayload,
});

// Or use shorthand on ExtendedRawTransaction
const simResult2 = await rawTxn.simulate(account);
```

### 3. Submit

The `submit` methods that take a `senderAccount` sign with it and check the chain ID first.

```typescript
// Submit raw transaction (signs internally)
const submitted = await supra.transaction.submit.submitRawTransaction({
    senderAccount: account,
    rawTransaction: rawTxn,
    enableTransactionWaitAndSimulationArgs: {
        enableTransactionSimulation: true,
        enableWaitForTransaction: true,
    },
});

// Submit serialized bytes
const submittedBytes = await supra.transaction.submit.submitSerializedRawTransaction({
    senderAccount: account,
    serializedRawTransaction: BCS.bcsToBytes(rawTxn),
    enableTransactionWaitAndSimulationArgs: {
        enableWaitForTransaction: true,
    },
});

// Submit with a signature made elsewhere
const signature = await supra.transaction.signTransaction({
    senderAccount: account,
    rawTxn: rawTxn,
});
const submittedSigned = await supra.transaction.submit.submitSerializedRawTransactionAndSignature({
    senderPubkey: account.pubKey(),
    signature: signature,
    serializedRawTransaction: BCS.bcsToBytes(rawTxn),
});
```

Outcome of a submission (every submit helper, transfer, `publishPackage` and contract entry function):
- With `enableTransactionSimulation: true`, a simulation with a status other than `Success` throws `SupraSimulationFailedError` and nothing is submitted.
- With `enableWaitForTransaction: true`, the call waits for a final status. `Success` is returned; `Fail` (executed and failed) and `Invalid` (discarded) throw `SupraTransactionFailedError` unless `checkSuccess: false` is passed. No final status within `waitTimeoutMs` throws `SupraTransactionTimeoutError`.
- Without `enableWaitForTransaction`, the call returns the transaction as the node reports it right after the submission (usually `Pending`), or `{ hash, status: "NotReadBack", readError }` when that read fails; the node has accepted the transaction in both cases.

### 4. Wait & Query

```typescript
// Wait for transaction confirmation
const committed: CommittedTransactionResponse = await supra.transaction.waitForTransaction({
    transactionHash: submitted.hash,
    options: { timeoutMs: 30_000, checkSuccess: true },
});

// Check if pending
const isPending: boolean = await supra.transaction.isPendingTransaction({
    transactionHash: submitted.hash,
});

// Get transaction by hash
const txnData = await supra.transaction.getTransactionByHash({
    transactionHash: submitted.hash,
});
```

---

## Sequence Numbers

A transaction executes only when its sequence number is the account's next number. The transfers, `migrateCoinToFungibleStore`, `publishPackage` and the entry functions of `Contract.fromABI` take the number from a counter that the `SupraClient` keeps for each account:

- The first use reads the number from the chain. Each transaction the node accepts advances the counter, so transactions sent without waiting get consecutive numbers, also with `Promise.all`.
- A transaction the node refuses for another reason (for example an insufficient balance) gives its number back.
- When the node refuses a number as stale (`SEQUENCE_NUMBER_TOO_OLD`, `SEQUENCE_NUMBER_TOO_NEW`, a number beyond what it queues, or a number that already has a pending transaction), the client reads the number from the chain again and sends the transaction once more. A second refusal is thrown. A transaction with an explicit number is not retried.
- `supra.resetSequenceNumber(address)` forgets the counter of an account. Call it after the account sent transactions by other means.
- `optionalTransactionPayloadArgs: { sequenceNumber }` makes a helper use that number as given, without using or changing the counter.

A node holds at most 25 queued transactions per account by default, so wait for commits (`enableWaitForTransaction: true`) when sending more than that from one account.

```typescript
// Ten transfers from one account, accepted without waiting for each other
const responses = await Promise.all(
    Array.from({ length: 10 }, () =>
        supra.coin.transferSupraCoin({ senderAccount: account, receiverAccountAddress: "0x2", amount: 100n }),
    ),
);

// An explicit sequence number
await supra.coin.transferSupraCoin({
    senderAccount: account,
    receiverAccountAddress: "0x2",
    amount: 100n,
    optionalTransactionArgs: { optionalTransactionPayloadArgs: { sequenceNumber: 5n } },
});

supra.resetSequenceNumber(account.address());
```

---

## Gas

Each transaction has a max gas (gas units), a gas unit price (quants) and an expiration time. `optionalTransactionPayloadArgs` sets `maxGas`, `gasUnitPrice` and `txExpiryTime` per transaction on every method that builds a transaction; `SupraConfig` sets `maxGas` and `minGasUnitPrice` for the client. A per-call setting replaces the client's. The SDK does not modify the options object.

The node accepts a transaction only when the sender's balance pays for `max gas × gas unit price`, and charges the gas used. Without a `maxGas` on the call or the client:

- The transfers, `publishPackage` and contract entry functions estimate it: they read the sender's SUPRA balance, simulate the transaction with the largest max gas that balance pays for, and use `ceil(gas used × 1.5)` (`SupraConfig.maxGasEstimateMultiplier` replaces 1.5), at least 1,500 units and at most what the balance pays for. A simulation whose status is not `Success` (abort, `OUT_OF_GAS`, `PendingAfterExecution`, `Invalid`) throws `SupraSimulationFailedError` and nothing is submitted. When the balance read or the simulation request fails, `DEFAULT_MAX_GAS_UNITS` applies, at most what the balance pays for.
- `transaction.build.simple` has no key pair to simulate with: it uses `DEFAULT_MAX_GAS_UNITS`, at most what the sender's balance pays for.
- `rawTxnObject`, `scriptRawTxnObject`, `automationRegistrationRawTxnObject`, `multisigRawTxnObject` and `multisigProposalTxRawTxnObject` make no request and use `DEFAULT_MAX_GAS_UNITS`.

`DEFAULT_MAX_GAS_UNITS` is 20,000 units. At the default gas unit price of 100,000 quants the node requires the sender's SUPRA balance to cover 20,000 × 100,000 = 2,000,000,000 quants (20 SUPRA) at validation, so a sender with less must set `maxGas` on the builders that make no request. `estimateMaxGas: false`, per call or in `SupraConfig`, turns the estimate off and uses `DEFAULT_MAX_GAS_UNITS` without a request.

```typescript
await supra.coin.transferSupraCoin({
    senderAccount: account,
    receiverAccountAddress: "0x2",
    amount: 100n,
    optionalTransactionArgs: {
        optionalTransactionPayloadArgs: { maxGas: 5_000n, gasUnitPrice: 100_000n },
    },
});
```

---

## Sponsored Transactions

```typescript
const sponsoredTxn = supra.transaction.build.rawTxnObject({
    senderAddress: account.address(),
    senderSequenceNumber: 0n,   // the account's next sequence number
    function: "0x1::supra_account::transfer",
    functionTypeArgs: [],
    functionArgs: [new SupraAccount().address().toUint8Array(), BCS.bcsSerializeUint64(10000n)],
});

const feePayerPayload = new TxnBuilderTypes.FeePayerRawTransaction(
    sponsoredTxn,
    [],
    new TxnBuilderTypes.AccountAddress(feePayerAccount.address().toUint8Array()),
);

const senderAuth = await supra.transaction.signTransaction({
    senderAccount: account,
    rawTxn: feePayerPayload,
});

const feePayerAuth = await supra.transaction.signTransaction({
    senderAccount: feePayerAccount,
    rawTxn: feePayerPayload,
});

const sponsored = await supra.transaction.submit.submitSponsorTransaction({
    feePayerAddress: feePayerAccount.address().toString(),
    secondarySignersAccountAddress: [],
    rawTxn: sponsoredTxn,
    senderAuthenticator: senderAuth,
    feePayerAuthenticator: feePayerAuth,
    secondarySignersAuthenticator: [],
    enableTransactionWaitAndSimulationArgs: {
        enableWaitForTransaction: true,
    },
});
```

---

## Events

```typescript
const { response: events, cursor } = await supra.events.getEventsByType({
    eventType: "0x1::fungible_asset::Deposit",
    options: { limit: 100, startHeight: 1000, endHeight: 2000 }, // endHeight is exclusive
});
```

---

## Block Queries

```typescript
const latestBlock = await supra.block.getLatestBlock();
const blockByHeight = await supra.block.getBlockByHeight({
    height: 1000,
    options: { withFinalizedTransactions: true },
});
const blockByHash = await supra.block.getBlockByHash({ blockHash: "0x1234" });
const txHashes = await supra.block.getTransactionsByBlockHash({
    blockHash: "0x1234",
    options: { type: "user" },
});
```

Nodes from v12 onwards also return settlement transactions; they have no `header`, `payload` or `authenticator`, so narrow on `txn_type` (`TransactionType.User` or `TransactionType.Auto`) before reading those fields.

---

## Table Items

```typescript
const item = await supra.table.getTableItem({
    handle: "0x1234",
    data: {
        key_type: "u64",
        value_type: "0x1234::pool::Position",
        key: "1",
    },
});
```

---

## Faucet

`fundAccountWithFaucet` sends the request on every network; a node that does not serve a faucet (Mainnet nodes) answers with an error status, thrown as `SupraAPIError`. Devnet and Testnet serve one. The faucet answers before its transaction executes, so wait for the returned hash before spending the funds.

```typescript
import { SupraFaucetUnavailableError } from "supra-ts-sdk";

try {
    const result = await supra.faucet.fundAccountWithFaucet({
        accountAddress: account.address(),
    });
    // result.hash is the faucet transaction hash
    await supra.transaction.waitForTransaction({ transactionHash: result.hash });
} catch (error) {
    if (error instanceof SupraFaucetUnavailableError) {
        // the node answered "TryLater": no faucet account is free; repeat the request later
    } else {
        throw error;
    }
}
```

---

## Account Creation

`SupraAccount` is re-exported by the SDK (originally from `supra-l1-sdk-core`):

```typescript
import { SupraAccount } from "supra-ts-sdk";

// Generate new account
const generated = new SupraAccount();

// From existing keys
const restored = SupraAccount.fromSupraAccountObject({
    address: "0x...",
    privateKeyHex: "PRIVATE_KEY" + "PUBLIC_KEY_WITHOUT_0x",
    publicKeyHex: "0x" + "PUBLIC_KEY_WITHOUT_0x",
});

// Get address
const address: HexString = generated.address();
const addressStr: string = generated.address().toString();
```

---

## Error Handling

Every error the SDK raises on its own behalf derives from `SupraError`. Errors that carry an error status of the node derive from `SupraAPIError`.

| Class | Raised when |
|---|---|
| `SupraAPIError` | the node answers with an error status (`status`, `statusText`, `url`, `data`, `major_status`, `sub_status`) |
| `SupraNotFoundError`, `SupraGoneError`, `SupraRateLimitError`, `SupraServiceUnavailableError` (extend `SupraAPIError`) | HTTP 404, 410 (pruned data), 429 (`retryAfterSeconds`), 503 |
| `SupraTimeoutError`, `SupraNetworkError` | a request times out, or fails before the node answers |
| `SupraFaucetUnavailableError`, `SupraFaucetResponseError` | the faucet answers `"TryLater"`, or answers unexpectedly |
| `SupraChainIdMismatchError` | before signing, the configured or the transaction's chain ID is not the node's |
| `SupraSimulationFailedError` | a simulation returns a status other than `Success` |
| `SupraTransactionFailedError` | a transaction the SDK waited for ends with `Fail` or `Invalid` |
| `SupraTransactionTimeoutError` | a transaction the SDK waited for has no final status within the wait timeout |
| `SupraInsufficientFungibleAssetBalanceError` | a SUPRA fungible asset transfer exceeds the sender's fungible asset balance |

`SupraAPIError.message` is the node's message when the error body has one. `major_status` is the name of the Move VM status the message reports (for example `SEQUENCE_NUMBER_TOO_OLD`, `ABORTED`) and `sub_status` is the abort code of an `ABORTED` status; both are `undefined` when the message names no status.

```typescript
import {
    SupraAPIError,
    SupraTransactionFailedError,
    MoveVmError,
    isMoveVmError,
} from "supra-ts-sdk";

try {
    await supra.coin.transferSupraCoin({
        senderAccount: account,
        receiverAccountAddress: "0x2",
        amount: 100n,
        optionalTransactionArgs: { enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true } },
    });
} catch (err) {
    if (err instanceof SupraTransactionFailedError) {
        console.error(err.hash, err.status, err.vm_status);
    } else if (err instanceof SupraAPIError) {
        console.error(err.status);       // HTTP status code
        console.error(err.statusText);   // HTTP status text
        console.error(err.url);          // Request URL
        console.error(err.data);         // Response body
        console.error(err.major_status); // Move VM status name, if the message names one

        if (isMoveVmError(err.major_status)) {
            if (err.major_status === MoveVmError.INSUFFICIENT_BALANCE_FOR_TRANSACTION_FEE) {
                // the balance does not cover max gas × gas unit price
            }
        }
    } else {
        throw err;
    }
}
```

---

## Pagination Pattern

All paginated methods return `PaginatedResponse<T>`: `{ response, cursor }`. Pass `cursor` back unchanged (as `start`, or `cursor` for `getAccountAutoTransactions`) until it is `undefined`. A page can be empty and still carry a cursor, so stop only on `undefined`.

```typescript
// Fetch all pages
let cursor: string | undefined;
const allResources = [];

do {
    const page = await supra.account.getAccountResources({
        accountAddress: account.address(),
        options: { count: 25, start: cursor },
    });
    allResources.push(...page.response);
    cursor = page.cursor;
} while (cursor !== undefined);
```

---

## React Hook Patterns

### useQuery (TanStack Query)

```typescript
import { useQuery } from "@tanstack/react-query";
import { getSupraClient } from "@/lib/supra";

export function useAccountBalance(address: string | undefined) {
    return useQuery({
        queryKey: ["supra", "balance", address],
        queryFn: async () => {
            const supra = getSupraClient();
            const balance = await supra.account.getAccountSupraCoinBalance({
                accountAddress: address!,
            });
            return balance;
        },
        enabled: !!address,
    });
}

export function useCoinInfo(coinType: MoveStructId) {
    return useQuery({
        queryKey: ["supra", "coinInfo", coinType],
        queryFn: async () => {
            const supra = getSupraClient();
            return supra.coin.getCoinInfo({ coinType });
        },
    });
}
```

### Transaction Mutation

```typescript
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getSupraClient } from "@/lib/supra";
import type { SupraAccount } from "supra-ts-sdk";

export function useTransferSupra() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (params: {
            account: SupraAccount;
            to: string;
            amount: bigint;
        }) => {
            const supra = getSupraClient();
            return supra.coin.transferSupraCoin({
                senderAccount: params.account,
                receiverAccountAddress: params.to,
                amount: params.amount,
                optionalTransactionArgs: {
                    enableTransactionWaitAndSimulationArgs: {
                        enableWaitForTransaction: true,
                    },
                },
            });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["supra", "balance"] });
        },
    });
}
```

---

## Important Caveats

1. **`bigint` serialization**: JSON.stringify cannot handle `bigint`, which built transactions, `sendTxnPayload` results, balances and view results hold. `stringifyWithBigInt` (exported by the SDK) writes them as exact JSON numbers, the form the node accepts in a request body. When passing data from server to client in Next.js, convert to `string` first. Use a custom serializer or SuperJSON if needed.
2. **Private keys on client**: Never expose `SupraAccount` private keys in client-side code. Sign transactions server-side or use a wallet adapter.
3. **RPC rate limits**: Create one `SupraClient` instance and reuse it. Do not create a new client per request. `retry` retries GET requests only; submit, simulate and view POST requests are never retried.
4. **`as const` for ABIs**: The ABI proxy type system requires `as const` assertion on the ABI array for TypeScript to infer the literal types.
5. **Pagination limits**: The `count` option accepts 1-100 per page.
6. **Transaction wait**: By default `enableWaitForTransaction` is `false`; the call returns the transaction as the node reports it right after the submission (usually `Pending`). Pass `true` to get the `Success` transaction, or a thrown `SupraTransactionFailedError` or `SupraTransactionTimeoutError`.
7. **Gas**: see the Gas section. The default gas unit price is 100,000 quants and `DEFAULT_MAX_GAS_UNITS` is 20,000, which needs a balance of 20 SUPRA at validation; the estimate used by the transfers, `publishPackage` and contract entry functions needs only what the transaction uses times 1.5.
8. **Node versions**: a v12 node answers some conditions with a different HTTP status than a v11 node (for example an absent account is 404 on v12 and 400 on v11). `isAccountExists` returns `false` on both; branch on the error class, not on a specific `status`, where possible.
