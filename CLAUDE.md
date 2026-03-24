# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

TypeScript SDK for the Supra L1 blockchain. Provides typed interfaces for account queries, transaction lifecycle (build → simulate → submit → wait), smart contract interaction via ABI proxies, and Move-native type handling. Published as `supra-ts-sdk` on npm with dual ESM/CJS output.

## Commands

```bash
pnpm install          # Install dependencies (uses pnpm)
pnpm build            # Build ESM + CJS via tsup
pnpm dev              # Build in watch mode
pnpm test             # Run Jest tests (173 tests across 14 suites)
pnpm test:watch       # Jest watch mode
pnpm lint             # ESLint (zero warnings enforced)
pnpm format           # Prettier formatting
pnpm typecheck        # tsc --noEmit
pnpm doc              # Generate TypeDoc to docs/
```

## Architecture

### Layer Structure

```
src/api/          → Public API classes (facade pattern, delegates to internal)
src/internal/     → Implementation functions (*Internal suffix)
src/client/       → HTTP layer (native fetch GET/POST wrappers)
src/types/        → TypeScript interfaces per module
src/helper/       → Utility functions (address standardization, type conversion, ABI lookup)
src/utils/        → Constants, network config, serializer
src/errors/       → SupraAPIError custom error class
src/index.ts      → Re-exports everything public
```

### Key Design Patterns

**API ↔ Internal separation**: Each feature (account, transaction, coin, etc.) has a matching pair — `api/account.ts` defines the public class, `internal/account.ts` has the `*Internal()` functions that do the actual HTTP calls. Types live in `types/account.ts`.

**Mixin composition**: `SupraClient` uses `applyMixins()` to merge all sub-module methods (Account, Transaction, Contract, etc.) onto a single client class. Sub-modules are also accessible as properties (`supra.account.getAccountInfo()`).

**Proxy-based ABI contracts**: `Contract.fromABI()` returns a Proxy object that maps Move module functions to typed TypeScript methods (`contracts.coin.view.balance(...)`).

**Network config**: `SupraConfig` is a discriminated union — either `{ network: Network.MAINNET | Network.TESTNET }` or `{ network?: Network.CUSTOM, rpcUrl, chainId }`. Defined in `src/utils/apiEndpoints.ts`.

**Pagination**: Cursor extracted from `x-supra-cursor` response header, returned as `PaginatedResponse<T>`.

### Transaction Lifecycle

Build (`txnBuild.ts`) → Simulate (`txnSimulate.ts`) → Submit (`txnSubmit.ts`) → Wait (`transaction.ts:waitForTransaction`)

### Move Type Mapping

Move `u8/u16/u32` → `number`, `u64/u128/u256` → `bigint`, `vector<T>` → `T[]`, `Option<T>` → `T | null`. Conversion logic lives in `src/helper/general.ts`.

### HTTP Client

All RPC calls go through `src/client/get.ts` and `src/client/post.ts` using native `fetch` (Node 18+). Base URL pattern: `${rpcUrl}/rpc/v3`. Request timeout via `AbortSignal.timeout()` (default 30s, configurable via `NetworkConfig.timeout`). Custom `SupraAPIError` thrown for non-2xx status, includes `major_status` parsed from error body.

## Build

- **Bundler**: tsup (esbuild-based), config in `tsup.config.ts`
- **Output**: `dist/index.js` (ESM), `dist/index.cjs` (CJS), `dist/index.d.ts` (types)
- **Target**: ES2022
- **External deps**: supra-l1-sdk-core, js-sha3
- **TypeScript**: Strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`

## Testing

Tests use Jest with ts-jest ESM support. Test files live in `__tests__/` directories adjacent to source.

```bash
npx jest                           # Run all tests
npx jest src/helper                # Run tests for helper module
npx jest --testPathPattern=account # Run tests matching "account"
```

Mock patterns: HTTP calls are mocked via `jest.mock("../../client/get")` or `global.fetch = jest.fn()`. Pure functions (helper/general.ts) are tested directly without mocks.

## Dependencies

- `supra-l1-sdk-core` — Core blockchain types (TxnBuilderTypes, HexString, etc.)
- `js-sha3` — SHA3 hashing
