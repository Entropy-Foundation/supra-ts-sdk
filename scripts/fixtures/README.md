# Transaction fixtures

`generate.ts` records the fixtures in
`src/internal/transactionManager/__tests__/fixtures/transactions.json`. The unit tests in
`src/internal/transactionManager/__tests__/nodeFixtures.test.ts` rebuild every transaction with the SDK and
compare the BCS of the raw transaction, the signing message, the signatures, the BCS of the signed
transaction and the transaction hash with the recorded bytes.

## What each value is

Every case records where each value comes from in its `provenance` map:

- `node`: produced or reported by a Supra node. For the cases signed by the node CLI (entry functions,
  script, multisig, automation registration) these are the transaction fields, the signature, the
  public key and the hash that the node reports for the committed transaction.
- `node-verified`: produced by the SDK and accepted by the node. The multi-agent and fee payer cases are
  not built by the node CLI; the SDK signs them, a node commits them, and the hash the node reports
  equals the hash the SDK derives.
- `specification`: derived from the definitions of the formats: the BCS of the raw transaction, the
  signing message (the SHA3-256 hash of the salt `SUPRA::RawTransaction` or
  `SUPRA::RawTransactionWithData` followed by the BCS bytes) and the BCS of the signed transaction. The
  generator checks them against the node: it fails unless the SDK's signature equals the node's, and
  unless the hash of the SDK's signed transaction equals the hash the node reports.

The signer seeds in the file belong to accounts created for the fixtures. They hold no value outside a
localnet.

## Regenerating

Requirements: a Supra node CLI binary, a Supra localnet whose RPC node serves a faucet, and Node 22.18 or
later (the script runs TypeScript directly). The generator imports the built SDK, so build it first:

```bash
pnpm install
pnpm build
node scripts/fixtures/generate.ts \
    --cli /path/to/supra \
    --rpc http://127.0.0.1:<port> \
    --out src/internal/transactionManager/__tests__/fixtures/transactions.json
```

`--rpc` is the RPC node with the faucet. The generator creates a CLI profile for every signer in a
temporary `--supra-home` directory, so it does not touch an existing CLI profile. Each case uses a new
account, funded from the faucet.

To check that two node releases agree, add a second node. Every recorded transaction is then submitted to
it again, signed by the SDK with the same seeds and inputs, and the run fails unless that node reports the
same hash and signature:

```bash
node scripts/fixtures/generate.ts --cli /path/to/supra --rpc http://127.0.0.1:<port> \
    --also-cli /path/to/other/supra --also-rpc http://127.0.0.1:<other port> \
    --out src/internal/transactionManager/__tests__/fixtures/transactions.json
```

Both localnets must use the same chain ID, which is part of the signed message. `--run-id` fixes the string
the seeds are derived from; without it each run uses new accounts.

The two-signer script of the multi-agent case is the compiled form of:

```move
script {
    use supra_framework::supra_account;

    fun main(first: &signer, second: &signer, amount: u64) {
        supra_account::transfer(first, std::signer::address_of(second), amount);
    }
}
```
