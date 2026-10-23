# Examples

Runnable examples for every `supra-ts-sdk` module: account queries, coin and fungible asset transfers, view
functions, the contract ABI proxy, the transaction lifecycle (build, simulate, submit, wait), events, blocks, tables
and the faucet.

The examples import the SDK by its package name, as an application does:

```typescript
import { SupraClient, Network } from "supra-ts-sdk";
```

Node and TypeScript resolve `supra-ts-sdk` from within this repository through the `exports` map of `package.json`,
so the runtime uses the built `dist/`.

## Running

```bash
pnpm install
pnpm build                       # the runtime resolves "supra-ts-sdk" to ./dist
pnpm exec tsx examples/block.ts  # one example
pnpm examples                    # builds, then runs every example in sequence and stops at the first failure
```

`pnpm typecheck:examples` type-checks the examples against the source and needs no build.

Every example exits with a non-zero status when a step throws or a transaction does not end with status `Success`.

## Environment

| Variable | Meaning |
|---|---|
| `SUPRA_NETWORK` | `devnet`, `testnet` or `mainnet`. Default `devnet`. |
| `SUPRA_RPC_URL`, `SUPRA_CHAIN_ID` | A node by its base URL (without `/rpc/v3`) and its chain ID, for example a localnet: `http://localhost:27001` and `255`. They replace `SUPRA_NETWORK`. |
| `SUPRA_PRIVATE_KEY` | The Ed25519 private key (32 bytes as hex, with or without `0x`) of a funded account. The examples that send transactions send them from this account. |
| `SUPRA_EXAMPLES_FUND` | `1` generates fresh accounts and funds them from the faucet of the network. The node must serve a faucet. |

The examples that send transactions need `SUPRA_PRIVATE_KEY` or `SUPRA_EXAMPLES_FUND=1`. An example that needs more
than one account (a fee payer, a second signer, a receiver with a coin store) generates the others and funds them from
the first account, or from the faucet when `SUPRA_EXAMPLES_FUND=1` is set. The examples do not send transactions to
Mainnet, and they do not call a faucet unless `SUPRA_EXAMPLES_FUND=1` is set.

Keep private keys in environment variables or an untracked file. Do not commit them.

Examples against Devnet:

```bash
SUPRA_NETWORK=devnet SUPRA_EXAMPLES_FUND=1 pnpm examples
SUPRA_NETWORK=devnet SUPRA_PRIVATE_KEY=<key> pnpm exec tsx examples/coin.ts
```

Examples against a localnet:

```bash
SUPRA_RPC_URL=http://localhost:27001 SUPRA_CHAIN_ID=255 SUPRA_EXAMPLES_FUND=1 pnpm examples
```

## The examples

| Example | Shows | Needs |
|---|---|---|
| [`account.ts`](./account.ts) | Account existence, info, modules, resources, transactions, balances, paginated feeds | Nothing for the queries about `0x1`; a funded account for the queries about an account's history (skipped otherwise) |
| [`block.ts`](./block.ts) | The latest block, a block by height and by hash, the transactions of a block | Nothing |
| [`events.ts`](./events.ts) | Events by type | Nothing |
| [`methods.ts`](./methods.ts) | Typed and raw view function calls, with the argument encodings | Nothing |
| [`table.ts`](./table.ts) | Reading a table item (the framework's coin to fungible asset map) | Nothing |
| [`faucet.ts`](./faucet.ts) | Funding a new account and reading the faucet transaction | `SUPRA_EXAMPLES_FUND=1` (skipped otherwise) |
| [`coin.ts`](./coin.ts) | Coin info, SUPRA and coin transfers | A funded account |
| [`fungibleAsset.ts`](./fungibleAsset.ts) | Fungible asset metadata, migrating SUPRA to the fungible asset store, fungible asset transfers | A funded account |
| [`contract.ts`](./contract.ts) | The ABI proxy: a view function and an entry function of `0x1::coin` (ABI in [`abi.ts`](./abi.ts)) | A funded account |
| [`transaction.ts`](./transaction.ts) | Transaction status, waiting for a commit, reading a transaction | A funded account |
| [`simulateTransaction.ts`](./simulateTransaction.ts) | Simulating signed, serialized and shorthand transactions | A funded account |
| [`buildTransaction.ts`](./buildTransaction.ts) | Every builder: simple, raw, payload for an HTTP client, script, automation registration, multisig account creation, proposal and execution | A funded account |
| [`submitTransaction.ts`](./submitTransaction.ts) | Submitting serialized, signed, sponsored and multi-agent transactions | A funded account; two more accounts, funded by the example |

[`setup.ts`](./setup.ts) reads the environment, creates the client and the accounts, and sets the exit status.
[`twoSignersModule.ts`](./twoSignersModule.ts) publishes the module of `e2e/fixtures/move` with the entry function that
takes two signers, for the multi-agent transaction of `submitTransaction.ts`; the network has no such framework
function. [`runAll.ts`](./runAll.ts) is the script behind `pnpm examples`.

## Sequence numbers

The helpers (`transferSupraCoin`, `transferCoin`, the fungible asset transfers, `migrateCoinToFungibleStore`,
`publishPackage`, the automation task helpers, the multisig helpers and the entry functions of `Contract.fromABI`) take the sequence number from the client's counter.
The builders of `supra.transaction.build` take the number as `senderSequenceNumber`; `buildTransaction.ts` and
`submitTransaction.ts` read the account's number once, after its funding has committed, and use consecutive numbers
for the transactions they build.

## ABIs

`contract.ts` uses [`abi.ts`](./abi.ts), a hand-written minimal ABI for `0x1::coin`. An application can read the ABI
of a module from the chain instead:

```typescript
const mod = await supra.account.getAccountModule({ accountAddress: "0x1", moduleName: "coin" });
const COIN_ABI = mod.abi!;
```
