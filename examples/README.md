# Examples

Runnable snippets for every `supra-ts-sdk` module: account queries, coin & fungible-asset
transfers, view functions, the contract ABI proxy, the full transaction lifecycle
(build / simulate / submit / wait), events, blocks, tables, and the faucet.

The examples import the SDK by its package name — exactly as your app would:

```typescript
import { SupraClient, Network } from "supra-ts-sdk";
```

This is a package **self-reference**: Node and TypeScript resolve `supra-ts-sdk` from
within this repo through the package's `exports` map. No `../src/...` deep paths.

## Prerequisites

```bash
pnpm install
pnpm build        # required: the runtime resolves "supra-ts-sdk" to ./dist
```

Type-checking the examples does **not** need the build (a path alias in
`examples/tsconfig.json` points `supra-ts-sdk` at the source):

```bash
pnpm typecheck:examples
```

## Running an example

```bash
npx tsx examples/account.ts
npx tsx examples/methods.ts
```

`account.ts`, `block.ts`, `events.ts`, `methods.ts`, `table.ts`, `faucet.ts` are
read-only and run as-is against testnet.

## Accounts (for transfer / submit examples)

`coin.ts`, `fungibleAsset.ts`, `buildTransaction.ts`, `simulateTransaction.ts`,
`submitTransaction.ts`, and `contract.ts` import accounts from
[`account.setup.ts`](./account.setup.ts). By default those are **freshly generated,
zero-balance** accounts — enough to type-check and import, but any on-chain transfer
will fail until the account is funded.

To run them for real:

1. Fund a testnet account with the faucet:
   ```bash
   npx tsx examples/faucet.ts   # edit the address first
   ```
2. Edit `account.setup.ts` to use your funded account:
   ```typescript
   export const account = SupraAccount.fromSupraAccountObject({
       address: "0x<ADDRESS>",
       privateKeyHex: "<PRIVATE_KEY_HEX><PUBLIC_KEY_HEX_WITHOUT_0x>",
       publicKeyHex: "0x<PUBLIC_KEY_HEX_WITHOUT_0x>",
   });
   ```

> **Never commit real private keys.** Keep them in an untracked file or environment
> variables. `account.setup.ts` ships with generated keys precisely so nothing secret
> lives in the repo.

## ABIs

`contract.ts` uses [`abi.ts`](./abi.ts), a hand-written minimal ABI for `0x1::coin`.
In a real app, fetch the ABI on-chain instead:

```typescript
const mod = await supra.account.getAccountModule({ accountAddress: "0x1", moduleName: "coin" });
const COIN_ABI = mod.abi!;
```

## Network

All examples target `Network.TESTNET`. Switch to `Network.MAINNET` (or a custom
`{ rpcUrl, chainId }`) in the `new SupraClient({ ... })` call.
