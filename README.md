
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

## Requirements

- Node.js ≥ 18
- TypeScript ≥ 4.9 (5.x strongly recommended)


## 🚀 Quick Start

```ts
import { SupraClient, Network } from 'supra-ts-sdk';

(async () => {
  const supra = new SupraClient({ network: Network.TESTNET });
  console.log("Connected to Supra Testnet (Chain ID 6)");
  // Devnet: new SupraClient({ network: Network.DEVNET }) (Chain ID 50)
})();
```

### Querying Accounts

#### 1. Check if an Account Exists

```ts
import { SupraClient, Network } from 'supra-ts-sdk';

(async () => {
  const supra = new SupraClient({ network: Network.TESTNET });

  const accountAddress = "0x88fbd33f54e1126269769780feb24480428179f552e2313fbe571b72e62a1c55";

  const exists = await supra.account.isAccountExists({ accountAddress });

  console.log(`Account ${accountAddress.slice(0, 8)}... exists:`, exists);

})();
```

**Note**: Accounts on Supra only exist after receiving a transaction or resource. This is a fast, gas-free check.

#### 2. Get Full Account Information

```ts
import { SupraClient, Network } from 'supra-ts-sdk';

(async () => {
  const supra = new SupraClient({ network: Network.TESTNET });

  const rootAddress = "0x0000000000000000000000000000000000000000000000000000000000000001";

  const accountData = await supra.account.getAccountInfo({ accountAddress: rootAddress });

  console.log("Framework (0x1) account info:", accountData);
  // Expected fields: sequence_number, authentication_key, etc.
})();
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

## 📚 More Examples

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
