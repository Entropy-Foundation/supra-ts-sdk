
# Supra TypeScript SDK

[![npm version](https://img.shields.io/npm/v/supra-ts-sdk?logo=npm&logoColor=white&style=flat-square)](https://www.npmjs.com/package/supra-ts-sdk)
[![npm downloads](https://img.shields.io/npm/dm/supra-ts-sdk?style=flat-square&color=orange)](https://www.npmjs.com/package/supra-ts-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TS-5.x-blue?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

**Type-safe client library for the Supra blockchain (MoveVM)**

`supra-ts-sdk` is a lightweight, modern TypeScript SDK for building applications on the **Supra Layer-1 blockchain** (MoveVM-based).

It provides strongly-typed helpers for:

- Connecting to Supra nodes (Mainnet / Testnet)
- Reading account balances & resources
- Submitting transactions
- Calling view / entry functions on Move modules
- Working with Move structs and ABIs


## ✨ Features

- Full TypeScript support with excellent type inference
- Native Move function calling (entry & view)
- Clean builder-style transaction creation
- Automatic BCS serialization / deserialization
- Built-in support for Supra Mainnet & Testnet
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

## 📚 More Examples

- [Account](/examples/account.ts)
- [Faucet](/examples/faucet.ts)
- [Coin](/examples/coin.ts)
- [Fungible Asset](/examples/fungibleAsste.ts)
- [Transaction](/examples/transaction.ts)
- [Build Transaction](/examples/buildTransaction.ts)
- [Simulate Transaction](/examples/simulateTransaction.ts)
- [Submit Transaction](/examples/submitTransaction.ts)
- [Contract](/examples/contract.ts)
- [Event](/examples/events.ts)
- [Method](/examples/methods.ts)
- [Table](/examples/table.ts)
- [Block](/examples/block.ts)



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
