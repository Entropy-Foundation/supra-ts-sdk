# End-to-end tests

These tests run the SDK against a Supra node and check what it returns. They are separate from the unit
tests: `pnpm test` runs only the tests under `src/`, makes no network request and does not read these
files.

## Running

Start a Supra localnet, then run:

```bash
SUPRA_E2E_RPC_URL=http://127.0.0.1:<port> pnpm test:e2e
```

`SUPRA_E2E_RPC_URL` is the base URL of the node's RPC service, without the `/rpc/v3` suffix. Without it
every test is skipped and the run prints a message saying so.

| Variable | Meaning |
|---|---|
| `SUPRA_E2E_RPC_URL` | Base URL of the RPC service. Required. |
| `SUPRA_E2E_ALLOW_PUBLIC` | Set to `1` to run against Devnet (chain ID 50). |
| `SUPRA_E2E_PUBLIC_READS` | Set to `1` to run the tests that send read-only GET requests to the public Devnet RPC node (`https://rpc-devnet.supra.com`). They are skipped otherwise. |
| `SUPRA_E2E_FAUCET_PATH` | Faucet path, with `{address}` for the account. Default `/rpc/v3/wallet/faucet/{address}`. |
| `SUPRA_E2E_TEST_TIMEOUT_MS` | Timeout of each test in milliseconds. Default 240000. Funding and commit waits time out after 180 s, the faucet transaction's expiry. |

The chain ID is read from the node. The run is refused when it is 6 (Testnet) or 8 (Mainnet), and when it
is 50 (Devnet) unless `SUPRA_E2E_ALLOW_PUBLIC=1`.

## Accounts

No key is read from the environment. Each test file generates fresh accounts and funds them from the
node's faucet with a plain HTTP request, so the tests of the account and transfer APIs do not depend on
the SDK's own faucet method. The faucet of a localnet limits how often an address can be funded, which is
why every account is new.

## Layout

- `helpers/env.ts`: environment, the chain ID guard and the shared SDK client.
- `helpers/raw.ts`: plain `fetch` helpers for reading balances and waiting for commits.
- `helpers/accounts.ts`: account creation and funding.
- `helpers/transfers.ts`: a SUPRA transfer used to give an account some history.
- `helpers/fixturePackage.ts`: the compiled package of `fixtures/`, with its module address replaced by the
  publishing account's address.
- `*.e2e.test.ts`: one file per area of the API.

A test that fails because of a defect in the SDK is written with `test.failing` and a comment stating the
behaviour the SDK is expected to have. When the defect is fixed the test starts to pass, which Jest
reports as a failure of the `test.failing` test; the fix removes the `failing` marker.
