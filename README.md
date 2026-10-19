
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

Releases that support a network are published to npm under a dist-tag named after the network: `devnet`, `testnet`
and `mainnet`. The `devnet` tag carries the prerelease versions that support Devnet before the other networks:

```bash
pnpm add supra-ts-sdk@devnet
```

The dist-tags are set when a version is released; until then `pnpm add supra-ts-sdk` installs the `latest` version.
The SDK supports nodes from v11.7.0 onwards.

## Requirements

- Node.js ≥ 18
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
`SupraAccount.fromSupraAccountObject`. The [examples](./examples/README.md) run against Devnet, Testnet and localnets.

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

### Reading a Feed Page by Page

Paginated methods return `{ response, cursor }`. Pass `cursor` back unchanged until it is `undefined`. A page
can be empty and still carry a cursor.

```ts
import { TransactionType } from 'supra-ts-sdk';

let cursor: string | undefined;
do {
  const page = await supra.account.getAccountCoinTransactions({
    accountAddress: sender.address(),
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
fungible asset transfers, `publishPackage` and the entry functions of `Contract.fromABI`. These signing methods return
promises.

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
  optionalTransactionPayloadArgs: { maxGas: 5_000n, gasUnitPrice: 100n },
});
const signedTransaction = await rawTxn.signedTransaction(sender); // chain ID 8, no request
```

## Errors

Every error the SDK raises on its own behalf derives from `SupraError`.

| Class | Raised when | Useful fields |
|---|---|---|
| `SupraAPIError` | the node answers with an error status | `status`, `statusText`, `url`, `data`, `major_status`, `sub_status` |
| `SupraNotFoundError` (extends `SupraAPIError`) | HTTP 404 | |
| `SupraGoneError` (extends `SupraAPIError`) | HTTP 410: the node has pruned the data | |
| `SupraRateLimitError` (extends `SupraAPIError`) | HTTP 429 | `retryAfterSeconds` |
| `SupraServiceUnavailableError` (extends `SupraAPIError`) | HTTP 503 | |
| `SupraTimeoutError` | a request exceeds the timeout | `url`, `timeoutMs`, `cause` |
| `SupraNetworkError` | the connection fails before the node answers | `url`, `cause` |
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
for an unknown transaction, block, module or resource, and 410 for pruned data, are the same on both.

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
transfers, `publishPackage` and the entry functions of `Contract.fromABI`) handles the outcome the same way:

- With `enableTransactionSimulation: true`, a simulation with a status other than `Success` throws
  `SupraSimulationFailedError` and nothing is submitted. `simulate` throws it too.
- With `enableWaitForTransaction: true`, the call waits for a final status. `Success` is returned; `Fail` (executed
  and failed, for example a Move abort or `Out of gas`) and `Invalid` (discarded) throw `SupraTransactionFailedError`,
  unless `checkSuccess: false` is passed. `Pending` and `PendingAfterExecution` are not final, and neither is a 404
  for a transaction the node has not seen yet: the call keeps waiting until `waitTimeoutMs` (per call, else
  `SupraConfig.waitTimeoutMs`, else 60 seconds) and then throws `SupraTransactionTimeoutError`.
- Without `enableWaitForTransaction`, the call returns the transaction as the node reports it right after the
  submission. When that read fails, it returns `{ hash, status: "NotReadBack", readError }`: the node accepted the
  transaction, and `hash` can be passed to `waitForTransaction`.

```ts
import {
  SupraClient,
  Network,
  SupraAccount,
  SupraSimulationFailedError,
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
  } else if (error instanceof SupraTransactionTimeoutError) {
    console.log(`${error.hash} has no final status after ${error.timeoutMs} ms (last status ${error.lastStatus})`);
  } else {
    throw error;
  }
}
```

### Sequence numbers

A transaction carries the sender's sequence number, and the node executes a transaction only when its number is the
account's next number. `transferSupraCoin`, `transferCoin`, `transferSupraFungibleAsset`, `transferFungibleAsset`,
`migrateCoinToFungibleStore`, `publishPackage` and the entry functions of `Contract.fromABI` take the number from a
counter that the `SupraClient` keeps for each account:

- The first use reads the account's sequence number from the chain. Each transaction the node accepts advances the
  counter, so transactions sent without waiting for the previous one to commit get consecutive numbers, also when they
  are sent concurrently (`Promise.all`).
- A transaction the node refuses for another reason (for example an insufficient balance) gives its number back.
- When the node refuses a number as stale (`SEQUENCE_NUMBER_TOO_OLD`, `SEQUENCE_NUMBER_TOO_NEW`, or a refusal of a
  number beyond what it queues for the account, or a number that already has a pending transaction), the client reads the number from the chain again and the helper sends
  the transaction once more. A second refusal is thrown. A transaction with an explicit number is not retried.
- `supra.resetSequenceNumber(address)` forgets the counter of an account. Call it after the account has sent
  transactions by other means, or after a `SupraTransactionTimeoutError` for a transaction that will not commit.
- `optionalTransactionPayloadArgs: { sequenceNumber }` makes a helper use that number as given, without using or
  changing the counter. The builders of `supra.transaction.build` always take the number as `senderSequenceNumber`.

The counter lives in one `SupraClient`. Two clients, or two processes, that send from the same account each keep their
own counter and recover from each other's transactions through the refusal and re-read described above.

The max gas estimate simulates against committed state. For a transaction sent while an earlier transaction of the
account has not committed, the node reports the number as too new; the SDK then simulates the same transaction with the
account's number on the chain and submits it with the counter's number, so pipelined transfers work with the default
gas settings. A transaction that depends on an earlier one that has not committed (for example a call to a module that
the earlier transaction publishes) fails that simulation and throws `SupraSimulationFailedError`, and nothing is
submitted. Pass `maxGas` for such a transaction, or wait for the earlier transaction to commit.

A node accepts a transaction whose number is ahead of the account's next number and holds it until the numbers before
it have been sent. The node holds at most 25 numbers per account by default (the refusal message names the highest
number the node accepts), so at most about 25 transactions of one account can be in flight; wait for commits
(`enableWaitForTransaction: true`) when sending more than that. A transaction expires at `txExpiryTime`, which defaults
to five minutes after the transaction was built.

```ts
const supra = new SupraClient({ network: Network.TESTNET });

// Ten transfers from one account, all accepted without waiting for each other.
const responses = await Promise.all(
  Array.from({ length: 10 }, () =>
    supra.coin.transferSupraCoin({ senderAccount: sender, receiverAccountAddress: "0x1234", amount: 100n }),
  ),
);
```

### Gas

Each transaction has a max gas (`max_gas_amount`, in gas units), a gas unit price (in quants) and an expiration time.
`optionalTransactionPayloadArgs` sets them per transaction (`maxGas`, `gasUnitPrice`, `txExpiryTime`) on every method
that builds a transaction, and `SupraConfig` sets `maxGas` and `minGasUnitPrice` for every transaction of the client.
A per-call setting replaces the client's. The SDK does not modify the options objects it is given.

The node accepts a transaction only when the sender's balance pays for `max gas × gas unit price`, and charges the gas
used. When neither the call nor the client sets `maxGas`:

- The coin and fungible asset transfers, `publishPackage` and the entry functions of `Contract.fromABI` estimate it.
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
sender's SUPRA balance to cover `max gas × gas unit price` at validation: with the default gas unit price of 100,000
quants, 20,000 units need 20 SUPRA (2,000,000,000 quants). The builders that make no request keep this limit, so a
sender with less than that must set `maxGas`. `estimateMaxGas: false`, per call or in `SupraConfig`, turns the
estimate off and uses the fixed default without a request.

```ts
// Estimated max gas, minimum gas unit price
await supra.coin.transferSupraCoin({ senderAccount: sender, receiverAccountAddress: "0x1234", amount: 100n });

// Per-call settings
await supra.coin.transferSupraCoin({
  senderAccount: sender,
  receiverAccountAddress: "0x1234",
  amount: 100n,
  optionalTransactionArgs: { optionalTransactionPayloadArgs: { maxGas: 5_000n, gasUnitPrice: 100_000n } },
});
```

### `bigint` values

Move `u64`, `u128` and `u256` values are `bigint` in several objects the SDK returns: built transactions, the
`SendTxnPayload` of `transaction.build.sendTxnPayload`, `getAccountCoinBalance` and view results. `JSON.stringify` throws
`TypeError: Do not know how to serialize a BigInt` for an object that holds one. `stringifyWithBigInt` writes them as
exact JSON numbers, the form the node accepts in a request body; to display or store such an object, convert them to
strings:

```ts
import { stringifyWithBigInt } from 'supra-ts-sdk';

const body = stringifyWithBigInt(await supra.transaction.build.sendTxnPayload({ senderAccount: sender, rawTxn }));
const text = JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? v.toString() : v));
```

## 📚 More Examples

Every example runs against Devnet, Testnet or a localnet given `SUPRA_NETWORK` (or `SUPRA_RPC_URL` and
`SUPRA_CHAIN_ID`) and, for the examples that send transactions, `SUPRA_PRIVATE_KEY` or `SUPRA_EXAMPLES_FUND=1`.
[`examples/README.md`](./examples/README.md) lists what each one needs. From a clone of this repository:

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


## 📄 License

MIT License

See the [LICENSE](./LICENSE) file for full details.

Built with ❤️ for the Supra ecosystem. Happy coding! 🚀
