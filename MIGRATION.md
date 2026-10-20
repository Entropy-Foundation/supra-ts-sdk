# Migrating from 1.2.0 to 2.0.0

`supra-ts-sdk` 2.0.0 supports Supra node v11.7.0 (Mainnet and Testnet) and the v12.0.0 release candidates (Devnet).
This guide lists every breaking change from 1.2.0, grouped by topic, and what to change for each. The
[CHANGELOG](./CHANGELOG.md) lists every change of the release, including the additions.

```bash
pnpm add supra-ts-sdk@2.0.0
```

The code blocks labelled 2.0.0 type-check against 2.0.0 (`pnpm check:jsdoc` checks them). They use a client `supra`
(`new SupraClient(...)`) and an account `account` that holds SUPRA, created as in the
[README](./README.md#-quick-start). Blocks labelled 1.2.0 show the code to replace and do not compile against 2.0.0.

The changes that most programs meet first:

- Signing returns a promise: `await` `signTransaction`, `signedTransaction` and `sendTxnPayload`
  ([Chain ID](#chain-id)).
- A client checks its node's chain ID before it signs; a client configured for another chain throws
  `SupraChainIdMismatchError` ([Chain ID](#chain-id)).
- Failures are thrown as typed errors: a waited transaction that fails, a simulation that does not succeed, a wait
  that times out ([Transactions](#transactions-submit-wait-and-simulate)).
- The max gas of the transfers, `publishPackage` and contract entry functions is estimated, and the default max gas
  is 20,000 units ([Gas](#gas)).
- The default gas unit price is read from the node, `SupraConfig.minGasUnitPrice` is renamed `gasUnitPrice`, and the
  builders that make no request need a price ([The gas unit price comes from the node](#the-gas-unit-price-comes-from-the-node)).
- The helpers take sequence numbers from a counter in the client ([Sequence numbers](#sequence-numbers)).
- A transaction built without `txExpiryTime` expires 60 seconds after the client's clock, not 300 seconds
  ([Transaction expiration time](#transaction-expiration-time)).

## Networks and faucet

### The faucet request is sent on every network

1.2.0 threw `Faucet is only available on testnet` for every network other than Testnet. 2.0.0 sends the request on
every network, including custom configurations; a node that does not serve the faucet answers with an error status,
thrown as `SupraAPIError` (`SupraNotFoundError` for HTTP 404). Remove code that tests for the old message.
`Network.DEVNET` is available, and its node serves the faucet.

### The faucet throws where it returned `{ hash: undefined }`

`fundAccountWithFaucet` throws `SupraFaucetUnavailableError` when no faucet account is free (the node answered
`"TryLater"`), and `SupraFaucetResponseError` for any other answer without a transaction hash. The returned `hash` is
always a string.

1.2.0:

```typescript 1.2.0
const { hash } = await supra.faucet.fundAccountWithFaucet({ accountAddress: account.address() });
if (hash === undefined) {
    // try again later
}
```

2.0.0:

```typescript
import { SupraFaucetResponseError, SupraFaucetUnavailableError } from "supra-ts-sdk";

try {
    const { hash } = await supra.faucet.fundAccountWithFaucet({ accountAddress: account.address() });
    await supra.transaction.waitForTransaction({ transactionHash: hash });
} catch (error) {
    if (error instanceof SupraFaucetUnavailableError) {
        // No faucet account is free; try again later.
    } else if (error instanceof SupraFaucetResponseError) {
        console.error("Unexpected faucet answer", error.data);
    } else {
        throw error;
    }
}
```

## Errors

### `SupraAPIError.message` is the node's message

`message` is the `message` of the node's error body when it has one, for example
`General err: MoveTransactionValidationFailed(0x…, 0, SEQUENCE_NUMBER_TOO_OLD)`, and the HTTP status text otherwise.
Code that compared `message` with the status text compares `statusText` instead. `status`, `statusText` and `data`
are unchanged.

### `major_status`, `sub_status` and `MoveVmError`

`SupraAPIError.major_status` is the name of the Move VM status that the message reports, and `undefined` when it
reports none; it was `"unknown"` for every error. `sub_status` is the abort code of an `ABORTED` status.
`MoveVmError.MOVE_ABORT` is removed: an abort is `MoveVmError.ABORTED`.

1.2.0:

```typescript 1.2.0
if (error instanceof SupraAPIError && error.major_status !== "unknown") {
    if (error.major_status === MoveVmError.MOVE_ABORT) {
        // ...
    }
}
```

2.0.0:

```typescript
import { MoveVmError, SupraAPIError } from "supra-ts-sdk";

function abortCode(error: unknown): number | undefined {
    if (error instanceof SupraAPIError && error.major_status === MoveVmError.ABORTED) {
        return error.sub_status;
    }
    return undefined;
}
```

A transaction that fails after the SDK waited for it, and a simulation that does not succeed, are no longer
`SupraAPIError`s: they throw `SupraTransactionFailedError` and `SupraSimulationFailedError`, which carry the same
`major_status` and `sub_status` fields ([Transactions](#transactions-submit-wait-and-simulate)).

### Timeouts and connection failures

A request that times out rejects with `SupraTimeoutError` (`url`, `timeoutMs`), and a request that fails before the
node answers with `SupraNetworkError` (`url`); the original `DOMException` or `TypeError` is their `cause`.

1.2.0:

```typescript 1.2.0
if (error instanceof DOMException && error.name === "TimeoutError") {
    // the request timed out
} else if (error instanceof TypeError) {
    // fetch failed
}
```

2.0.0:

```typescript
import { SupraNetworkError, SupraTimeoutError } from "supra-ts-sdk";

try {
    await supra.account.getAccountInfo({ accountAddress: account.address() });
} catch (error) {
    if (error instanceof SupraTimeoutError) {
        console.error(`No answer from ${error.url} within ${error.timeoutMs} ms`);
    } else if (error instanceof SupraNetworkError) {
        console.error(`The request to ${error.url} failed`, error.cause);
    } else {
        throw error;
    }
}
```

`SupraConfig.timeoutMs` sets the request timeout and `SupraConfig.retry` turns on retries of GET requests. The faucet request is sent once.

### Faucet errors extend `SupraError`

`SupraFaucetUnavailableError` and `SupraFaucetResponseError` extend `SupraError`, the base class of every error the
SDK defines. They keep their names and are still not `SupraAPIError`s.

## Transactions: submit, wait and simulate

### A failed transaction throws when the SDK waits for it

With `enableWaitForTransaction: true`, every submit helper (`transaction.submit.*`, the submit methods of a built
transaction, the coin and fungible asset transfers, `publishPackage` and the entry functions of `Contract.fromABI`)
throws `SupraTransactionFailedError` when the transaction ends with `Fail` or `Invalid`; it resolved with the failed
transaction. A wait that ends without a final status throws `SupraTransactionTimeoutError`; it threw a `SupraAPIError`
with status 500. `checkSuccess: false` returns the transaction whatever its final status.

1.2.0:

```typescript 1.2.0
const txn = await supra.coin.transferSupraCoin({
    senderAccount: account,
    receiverAccountAddress: receiver,
    amount: 1_000_000n,
    optionalTransactionArgs: { enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true } },
});
if (txn.status !== TransactionStatus.Success) {
    console.error(txn.output);
}
```

2.0.0:

```typescript
import { SupraAccount, SupraTransactionFailedError, SupraTransactionTimeoutError } from "supra-ts-sdk";

const receiver = new SupraAccount().address();
try {
    const txn = await supra.coin.transferSupraCoin({
        senderAccount: account,
        receiverAccountAddress: receiver,
        amount: 1_000_000n,
        optionalTransactionArgs: { enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true } },
    });
    console.log(`${txn.hash} committed`);
} catch (error) {
    if (error instanceof SupraTransactionFailedError) {
        console.error(`${error.hash} ended with ${error.status}: ${error.vm_status}`);
    } else if (error instanceof SupraTransactionTimeoutError) {
        console.error(`${error.hash} has no final status after ${error.timeoutMs} ms`);
    } else {
        throw error;
    }
}
```

### A simulation throws for every status other than `Success`

A simulation throws `SupraSimulationFailedError` (`status`, `vm_status`, `major_status`, `sub_status`,
`transaction`) for `Fail`, `Invalid` and `PendingAfterExecution` (for example `SENDING_ACCOUNT_DOES_NOT_EXIST` or
`SEQUENCE_NUMBER_TOO_NEW`). 1.2.0 threw a `SupraAPIError` with status 400 for `Fail` only and returned the other
statuses. With `enableTransactionSimulation: true`, a failed simulation means the transaction is not submitted. The
max gas estimate ([Gas](#gas)) simulates too, so the transfers, `publishPackage` and contract entry functions throw
`SupraSimulationFailedError` for a transaction that would not succeed, before submitting it. A simulation refused for a
gas unit price below the node's minimum throws `SupraGasUnitPriceBelowMinimumError` instead
([The gas unit price comes from the node](#the-gas-unit-price-comes-from-the-node)).

1.2.0:

```typescript 1.2.0
try {
    await supra.transaction.simulate.simple({ sendTxPayload: rawTxn.sendTxnPayload(account) });
} catch (error) {
    if (error instanceof SupraAPIError && error.status === 400) {
        // the simulated transaction failed
    }
}
```

2.0.0:

```typescript
import { SupraSimulationFailedError } from "supra-ts-sdk";

try {
    await supra.transaction.simulate.simple({ sendTxPayload: await rawTxn.sendTxnPayload(account) });
} catch (error) {
    if (error instanceof SupraSimulationFailedError) {
        console.error(`The simulation ended with ${error.status}: ${error.vm_status}`);
    } else {
        throw error;
    }
}
```

### Waiting for a transaction

`waitForTransaction` and submissions with `enableWaitForTransaction` keep reading the transaction while its status is
`Pending` or `PendingAfterExecution` and while a read fails (including HTTP 404 for a transaction the node has not seen
yet), until the timeout, measured in wall-clock time. The default timeout is 60 seconds for both; it was 20 seconds.
`options.timeoutSecs` is deprecated: use `options.timeoutMs`. `SupraConfig.waitTimeoutMs` sets the default of a client,
and `enableTransactionWaitAndSimulationArgs.waitTimeoutMs` the timeout of one submission. `DEFAULT_TXN_TIMEOUT_SEC` is
removed; `DEFAULT_TXN_WAIT_TIMEOUT_MS` is the default in milliseconds.

`waitForTransaction` throws `SupraTransactionFailedError` for `Fail` and `Invalid` unless `options.checkSuccess` is
`false`:

```typescript
async function finalStatus(transactionHash: string) {
    const txn = await supra.transaction.waitForTransaction({
        transactionHash,
        options: { timeoutMs: 30_000, checkSuccess: false },
    });
    return txn.status;
}
```

`isPendingTransaction` returns `true` for `PendingAfterExecution` as well as `Pending`.

### Submit helpers return `SubmitTransactionResponse`

The submit helpers return `SubmitTransactionResponse`, which is `TransactionResponse | NotReadBackTransactionResponse`.
Without `enableWaitForTransaction`, when the node accepts the transaction and the read that follows fails, they return
`{ hash, status: "NotReadBack", readError }`; 1.2.0 threw the read's error, which did not carry the hash. Code that
reads fields other than `hash` and `status` narrows on `status` first:

```typescript
import { SupraAccount } from "supra-ts-sdk";

const response = await supra.coin.transferSupraCoin({
    senderAccount: account,
    receiverAccountAddress: new SupraAccount().address(),
    amount: 1_000n,
});
if (response.status === "NotReadBack") {
    // The node accepted the transaction; read it again by its hash.
    const committed = await supra.transaction.waitForTransaction({ transactionHash: response.hash });
    console.log(committed.status);
} else {
    console.log(response.status, response.output);
}
```

### Transaction hashes and `getTransactionByHash`

`deriveTransactionHash` returns the hash with a `0x` prefix, the form that `getTransactionByHash` and
`waitForTransaction` accept. Remove code that adds the prefix. These methods and `isPendingTransaction` reject a hash
that is not `0x` followed by exactly 64 hex digits.

`getTransactionByHash` takes no type argument; it returns `TransactionResponse`. Narrow on `txn_type` instead of
passing a type:

1.2.0:

```typescript 1.2.0
const txn = await supra.transaction.getTransactionByHash<UserTransactionResponse>({ transactionHash });
console.log(txn.header.sender.Move);
```

2.0.0:

```typescript
import { TransactionType } from "supra-ts-sdk";

async function senderOf(transactionHash: string): Promise<string | undefined> {
    const txn = await supra.transaction.getTransactionByHash({ transactionHash });
    return txn.txn_type === TransactionType.User ? txn.header.sender.Move : undefined;
}
```

### `standardizeAddress` lower-cases and throws `RangeError`

`standardizeAddress` returns the hex digits in lower case. Code that compares its result with an upper-case address
must lower-case the other side. It accepts a `0x` or `0X` prefix. A value that is not 1 to 64 hex digits after the
optional prefix throws a `RangeError`: an address of more than 64 hex digits threw a `SupraAPIError` with status 400
and an empty `url`, and other malformed values (`"0XA"`, `"0xzz"`, `""`) were returned with the prefix doubled or the
invalid characters kept. Code that caught the `SupraAPIError` of an invalid address must catch `RangeError`.
`fundAccountWithFaucet`, `getFaucetTransaction`, `resetSequenceNumber` and the builders of `transaction.build` throw
this `RangeError` for a malformed address before any request.

## Gas

### The max gas is estimated

Without a `maxGas` on the call or the client, the coin and fungible asset transfers, `publishPackage` and the entry
functions of `Contract.fromABI` read the sender's SUPRA balance, simulate the transaction, and submit it with
`ceil(gas used × 1.5)`, at least 1,500 units and at most what the balance pays for. Each of these calls makes a
balance read and a simulation request before the submission. `transaction.build.simple` makes a balance read and uses
`DEFAULT_MAX_GAS_UNITS`, at most what the balance pays for.

The simulation runs against committed state. When earlier transactions of the same account that this client submitted
have not committed, the SDK simulates the transaction with the account's sequence number on the chain and submits it
with the counter's number, so transfers sent one after another without waiting work with the default gas settings. It
does so only when every number between the chain's and the transaction's has a record of a transaction this client
submitted that can still commit ([Sequence numbers](#sequence-numbers)); otherwise the transaction is built and signed
again with the lowest number without a record. A transaction that depends on an earlier one that has not committed
(for example a call to a module that the earlier one publishes) fails its estimate and throws
`SupraSimulationFailedError`; set `maxGas` for such a transaction.

To submit with a fixed max gas, set `maxGas` on the client or on the call; `estimateMaxGas: false` uses
`DEFAULT_MAX_GAS_UNITS` without a request:

```typescript
import { Network, SupraAccount, SupraClient } from "supra-ts-sdk";

// Every transaction of this client has max gas 5,000 units.
const fixed = new SupraClient({ network: Network.TESTNET, maxGas: 5_000n });

// One transaction with its own max gas.
await supra.coin.transferSupraCoin({
    senderAccount: account,
    receiverAccountAddress: new SupraAccount().address(),
    amount: 1_000n,
    optionalTransactionArgs: { optionalTransactionPayloadArgs: { maxGas: 2_000n } },
});

// A client that does not estimate: transactions without maxGas have DEFAULT_MAX_GAS_UNITS.
const unestimated = new SupraClient({ network: Network.TESTNET, estimateMaxGas: false });
console.log(fixed.networkInformation.maxGas, unestimated.networkInformation.estimateMaxGas);
```

### `DEFAULT_MAX_GAS_UNITS` is 20,000 units

It was 1,000. It is the max gas of the builders that make no request (`rawTxnObject`, `scriptRawTxnObject`,
`automationRegistrationRawTxnObject`, `multisigRawTxnObject`, `multisigProposalTxRawTxnObject`), of transactions when
the estimate is turned off, and of an estimate whose simulation could not run to a result. The node accepts a
transaction only when the sender's balance pays for `max gas × gas unit price`: 20 SUPRA at a gas unit price of
100,000 quants. A sender with less sets `maxGas` on those builders:

```typescript
import { BCS, SupraAccount } from "supra-ts-sdk";

const { sequence_number } = await supra.account.getAccountInfo({ accountAddress: account.address() });
const transfer = supra.transaction.build.rawTxnObject({
    senderAddress: account.address(),
    senderSequenceNumber: sequence_number,
    function: "0x1::supra_account::transfer",
    functionTypeArgs: [],
    functionArgs: [new SupraAccount().address().toUint8Array(), BCS.bcsSerializeUint64(1_000n)],
    optionalTransactionPayloadArgs: { maxGas: 2_000n, gasUnitPrice: await supra.getEstimatedGasUnitPrice() },
});
```

### The gas unit price comes from the node

In 1.2.0 a transaction without a `gasUnitPrice` on the call used `SupraConfig.minGasUnitPrice`, else
`DEFAULT_GAS_PRICE` (100,000 quants), and never read the node; a network that raised its minimum refused every client
that relied on the default. In 2.0.0 the price of a transaction is the call's `gasUnitPrice`, else the client's
`gasUnitPrice`, else the node's estimate: `max(median gas price, minimum gas price)` of
`GET /rpc/v3/transactions/estimate_gas_price`, read for each transaction that needs it. A price set by the call or the client is used as given and makes no request. The changes:

- **Breaking:** `SupraConfig.minGasUnitPrice` and `NetworkConfig.minGasUnitPrice` are renamed `gasUnitPrice`. There is no
  alias. `SupraClient.networkInformation.gasUnitPrice` is `undefined` when the configuration sets none; it was
  `DEFAULT_GAS_PRICE`.
- **Breaking:** `DEFAULT_GAS_PRICE` is removed.
- **Breaking:** the builders that make no request (`rawTxnObject`, `scriptRawTxnObject`,
  `automationRegistrationRawTxnObject`, `multisigRawTxnObject`, `multisigProposalTxRawTxnObject`) cannot read the
  estimate. Without a `gasUnitPrice` on the call or the client they throw a `RangeError` before building. Pass a price
  (`getEstimatedGasUnitPrice()` returns the node's estimate) or set `SupraConfig.gasUnitPrice`.
- **Breaking:** a price below the node's minimum is refused by the node. The SDK throws
  `SupraGasUnitPriceBelowMinimumError`, a `SupraError`, with `gasUnitPrice` (the price sent), `minimumGasUnitPrice` (read
  from the node after the refusal, `undefined` when that read fails), `major_status` and the original error as `cause`,
  from the submission and from the simulation that precedes it (the max gas estimate and `enableTransactionSimulation`).
  It is neither a `SupraAPIError` nor a `SupraSimulationFailedError`. In 1.2.0 the submission refusal was a
  `SupraAPIError` with status 400, which code can have caught with `instanceof SupraAPIError`; catch
  `SupraGasUnitPriceBelowMinimumError` as well, and read the original `SupraAPIError` from `cause`. In 1.2.0 a simulation
  (`simulate` of a built transaction, `simulate.simple`) returned the `Invalid` response without throwing; it now
  throws, as for every status other than `Success` ([A simulation throws for every status other than
  `Success`](#a-simulation-throws-for-every-status-other-than-success)). The transaction is not sent again and its price
  is not raised; the sequence number is used by the next transaction.
- A failed read of the estimate throws that read's error, like a failed build, and nothing is submitted. In the helpers
  that submit, the read starts when the call is made and is awaited in the call's turn for the sender's account, so calls
  from one account keep the order of the calls, except SUPRA fungible asset transfers, whose balance check is awaited
  before the lock is requested. `transaction.build.simple` awaits the read before it builds.
- `getEstimatedGasUnitPrice()` is new; `getGasPrice()` (the median) and `getMinGasUnitPrice()` (the minimum) are
  unchanged.

```typescript
import { Network, SupraClient, SupraGasUnitPriceBelowMinimumError } from "supra-ts-sdk";

// 2.0.0: no price on the call or the client; the transaction carries the node's estimate.
await supra.coin.transferSupraCoin({ senderAccount: account, receiverAccountAddress: "0x2", amount: 100n });

// A price of the client: used as given by every transaction that sets none.
const priced = new SupraClient({ network: Network.TESTNET, gasUnitPrice: 150_000n });

// A price below the node's minimum is refused.
try {
    await supra.coin.transferSupraCoin({
        senderAccount: account,
        receiverAccountAddress: "0x2",
        amount: 100n,
        optionalTransactionArgs: { optionalTransactionPayloadArgs: { gasUnitPrice: 1n } },
    });
} catch (error) {
    if (error instanceof SupraGasUnitPriceBelowMinimumError) {
        console.log(error.gasUnitPrice, error.minimumGasUnitPrice, error.cause);
    }
}
console.log(priced.networkInformation.gasUnitPrice);
```

### Other gas changes

- `SupraClient.networkInformation.maxGas` is `undefined` when `SupraConfig.maxGas` is not set; it was
  `DEFAULT_MAX_GAS_UNITS`.
- `DEFAULT_MAX_GAS_FOR_SUPRA_TRANSFER_WHEN_RECEIVER_EXISTS` and
  `DEFAULT_MAX_GAS_FOR_SUPRA_TRANSFER_WHEN_RECEIVER_NOT_EXISTS` are removed. The estimate replaces them; code that
  passed them as `maxGas` passes its own value or none.

## Sequence numbers

The transfers, `migrateCoinToFungibleStore`, `publishPackage` and the entry functions of `Contract.fromABI` take the
sequence number from a counter in the client instead of reading it from the chain on every call. The counter records
each transaction the client submitted, with its expiration time, until the chain's number passes it, a latest block the
client reads has reached its expiration time, or a read of it returns `Invalid`, and hands out the lowest number at or above
the chain's that has no record. A refusal for a stale number reads the chain again and sends the transaction once
more. A refusal because the node's queue for the account is full (25 numbers ahead of the chain's by default) throws
`SupraAccountQueueFullError`.

Calls of one client from one account are submitted one after another: a call holds the account from taking its number
until the node answers its submission (accepted, refused, or the request fails), so concurrent sends get consecutive
numbers, and a number that a failed call did not use is the next one handed out. The wait for the final status
(`enableWaitForTransaction`) comes after the submission and does not hold the account. A call without `maxGas` holds the
account while its max gas is estimated; a call with `maxGas` waits only until the calls ahead of it have been submitted
or have failed. To submit faster from one account, set `maxGas`; to submit in parallel, send from several accounts. A
call with an explicit `sequenceNumber` does not take part in this order.

When the account also sends transactions by other means (another client or process, a wallet), the node refuses a
helper call whose number such a transaction holds, and the next call reads the chain again; a call made after those
transactions have committed takes the next number. Transactions submitted through the client's submit methods,
including those built with an explicit number by `transaction.build`, are recorded like the helpers' own.

`resetSequenceNumber` forgets the counter and its records, including those of this client's pending transactions:
while such a transaction holds the account's number on the chain, the node refuses the next helper call. Reset only
when no transaction of this client from the account is pending, or when the expiration times of those that are have
passed. A number can also be set for one transaction:

```typescript
import { SupraAccount } from "supra-ts-sdk";

// No transaction of this client from the account is pending: the next helper call reads the sequence number from the
// chain.
supra.resetSequenceNumber(account.address());

// This transaction uses the given number; the counter does not hand it out while the transaction can commit.
const { sequence_number } = await supra.account.getAccountInfo({ accountAddress: account.address() });
await supra.coin.transferSupraCoin({
    senderAccount: account,
    receiverAccountAddress: new SupraAccount().address(),
    amount: 1_000n,
    optionalTransactionArgs: { optionalTransactionPayloadArgs: { sequenceNumber: sequence_number } },
});
```

A transaction that will not commit keeps its number until the timestamp of a latest block the client reads reaches its
expiration time.

## Transaction expiration time

A transaction built without `txExpiryTime` expires 60 seconds (`DEFAULT_TX_EXPIRATION_DURATION`) after the client's
clock in whole seconds; 1.2.0 used 300 seconds. `SupraConfig.txExpirySecs` sets another window, from 1 to 600 seconds;
the expiration time is at most 595 seconds after the client's clock, so that a node whose clock is up to 5 seconds
behind the client's accepts `txExpirySecs: 600`. The node refuses a transaction whose expiration time is not after its
clock or is more than 600 seconds after it, so a client whose clock is far from the node's has its transactions
refused. This applies to every builder, including those of `transaction.build`. For a transaction that is signed or
submitted later (for example after a wallet's confirmation), set a longer window for the client or an absolute time
for the transaction:

```typescript
import { Network, SupraClient } from "supra-ts-sdk";

// Transactions of this client expire 300 seconds after the client's clock (at most 595).
const patient = new SupraClient({ network: Network.TESTNET, txExpirySecs: 300 });

// This transaction expires at the given time, in seconds since the Unix epoch.
const expiry = { optionalTransactionPayloadArgs: { txExpiryTime: BigInt(Math.floor(Date.now() / 1000) + 300) } };
```

## Chain ID

### Signing returns a promise

A client reads its node's chain ID before its first signature, so `signTransaction`,
`transaction.build.signedTransaction`, `transaction.build.sendTxnPayload` and the `signTransaction`,
`signedTransaction` and `sendTxnPayload` methods of a built transaction return promises. Code that already awaits them
is unaffected.

1.2.0:

```typescript 1.2.0
const signature = supra.transaction.signTransaction({ senderAccount: account, rawTxn });
const payload = rawTxn.sendTxnPayload(account);
```

2.0.0:

```typescript
const signature = await supra.transaction.signTransaction({ senderAccount: account, rawTxn });
const signed = await supra.transaction.build.signedTransaction({ senderAccount: account, rawTxn });
const payload = await rawTxn.sendTxnPayload(account);
console.log(signature.toString(), supra.transaction.deriveTransactionHash({ signedTransaction: signed }), payload);
```

`signTransaction` has one signature per kind of transaction: it resolves to a `HexString` for a `RawTransaction` and
to an `AccountAuthenticatorEd25519` for a `MultiAgentRawTransaction` or `FeePayerRawTransaction`. Casts of its result
can be removed.

### The chain ID is checked before signing

Every signing path throws `SupraChainIdMismatchError` (`configuredChainId`, `nodeChainId`, `transactionChainId`)
before signing when the client's configured chain ID, or the chain ID of the transaction, is not the node's. Configure
the chain ID of the node the client talks to; `verifyChainId: false` signs with the configured chain ID without a
request, for offline signing:

```typescript
import { Network, SupraChainIdMismatchError, SupraClient } from "supra-ts-sdk";

const offline = new SupraClient({ network: Network.MAINNET, verifyChainId: false });

try {
    await supra.validateChainId();
} catch (error) {
    if (error instanceof SupraChainIdMismatchError) {
        console.error(`Configured for chain ${error.configuredChainId}, the node is on chain ${error.nodeChainId}`);
    } else {
        throw error;
    }
}
console.log((await offline.getChainId()).value);
```

- `getChainId()` returns a promise of the node's chain ID; it returned the configured chain ID synchronously. With
  `verifyChainId: false` it resolves to the configured chain ID without a request.
- `validateChainId()` throws `SupraChainIdMismatchError`; it threw a plain `Error`.
- `new SupraClient` throws a `RangeError` when the `chainId` of a custom configuration is not an integer from 0 to 255,
  and a `TypeError` when `verifyChainId` is not a boolean.
- `DEFAULT_CHAIN_ID` is removed. A predefined network sets its chain ID (`NetworkInfo[Network.TESTNET].chainId` is 6);
  a custom configuration passes `chainId`.

## Arguments and types

- Integer arguments given as strings (`u8` to `u256` in entry functions, `u8` to `u256` and `i8` to `i256` in views)
  must be decimal digits, with a leading `-` for signed types, or, for entry functions, `0x` followed by hex digits.
  Empty strings, surrounding whitespace, `"1.5"`, `"-1"` for unsigned types and values above the maximum of the type
  throw before any request. Pass a `number`, a `bigint` or a trimmed decimal string.
- Integer arguments of views outside the range of their type (`u8` 300, `u64` -1) throw before any request; the
  node refused them.
- A `number` given for an integer argument must be a safe integer (at most 2^53 - 1 in magnitude). Pass larger
  values, such as `u64` amounts above 2^53 - 1, as a `bigint` or a decimal string; a larger `number` holds a rounded
  value.
- `methods.view` sends an `Option<u8>` argument as the hex of the byte, which is what the node reads. Pass the number
  (`16`); code that converted it to a string to work around the old encoding passes the number instead.
- A `bool` argument of a view is a boolean, `"true"` or `"false"`. Other values, such as `0`, `1` or `"0"`, throw
  before any request; `"false"` and `"0"` were sent as `true`. Pass a boolean.
- `address` and `0x1::object::Object<T>` arguments of entry functions and views are a string or a `HexString` with
  1 to 64 hex digits after an optional `0x`. `""` and `"0x"`, which entry functions encoded as the address `0x0`, and
  values of other types throw before any request. Pass `"0x0"` for the zero address.
- A type argument given as a string must be exactly one concrete Move type, in entry functions, views and the
  `coinType` of `coin.transferCoin` and `fungibleAsset.migrateCoinToFungibleStore`. Text after the type, generic type parameters such as `T0`, and the short name
  `"string"` throw before any request; write `"0x1::string::String"`. `0x1::object::Object<T>` written as a string is
  the struct `Object<T>`; `TypeTagParser` turns it into `address`, so pass `Object` type arguments as strings.
  Code that builds `TypeTag`s, for example for the `functionTypeArgs` of `transaction.build.rawTxnObject`, uses
  `parseTypeArgument` instead of `TypeTagParser`: it parses the same grammar as the SDK's type argument strings,
  keeps `Object<T>` a struct and accepts names such as `USDT0`.
- `FunctionTypeArgs`, the type of an entry of `ty_args` in a transaction payload in JSON form, is a union of the
  primitive type names, `{ vector }` and `{ struct }`. Code that reads `.struct` narrows first:

```typescript
import type { FunctionTypeArgs } from "supra-ts-sdk";

function structName(typeArg: FunctionTypeArgs): string | undefined {
    return typeof typeArg === "object" && "struct" in typeArg ? typeArg.struct.name : undefined;
}
```

## Responses and pagination

### The end of a feed is `cursor === undefined`

`PaginatedResponse.cursor` is `undefined` exactly at the end of a feed, on v11 and v12 nodes alike. The empty string,
the `"0"` and the repeated `start` that v11 nodes send at the end of some feeds are returned as `undefined`. A page can
be empty and still carry a cursor. Every cursor option accepts `undefined`, so the returned cursor is passed back as it
is:

```typescript
let cursor: string | undefined;
do {
    const page = await supra.account.getAccountResources({
        accountAddress: account.address(),
        options: { start: cursor },
    });
    console.log(page.response.length);
    cursor = page.cursor;
} while (cursor !== undefined);
```

`getEventsByType` types `options.start` as `string`, the cursor it returns; it was `number`.

### Transaction response types

- `CommittedTransactionResponse` and `TransactionResponse` include `SettlementTransactionResponse`, which v12 nodes
  return. Like the block metadata and automation record variants, it has no `header`, `payload` or `authenticator`:
  narrow on `txn_type` before reading them (see `senderOf` under
  [Transaction hashes](#transaction-hashes-and-gettransactionbyhash)).
- `EmptyTransactionOutput` is the string `"Empty"`, which is what the node sends; it was declared `{ Empty: null }`.
- `PendingTransactionResponse.txn_type` is `TransactionType.User`. `BlockMetadataTransactionResponse` and
  `AutomationRecordTransactionResponse` declare `output` as non-null. `block_header` is optional on every transaction
  response; transactions returned as part of a block have `block_header: null`.
- `FinalizedBlockHeader.transactions` is optional (the node omits it unless the block is requested with
  `withFinalizedTransactions: true`) and is typed `CommittedTransactionResponse[]`:

```typescript
const block = await supra.block.getBlockByHeight({ height: 1, options: { withFinalizedTransactions: true } });
for (const txn of block.transactions ?? []) {
    console.log(txn.txn_type, txn.hash);
}
```

### `isAccountExists` throws failures

`isAccountExists` returns `false` only when the node reports the account as absent (HTTP 404 on v12 nodes, HTTP 400
with a "Resource not found" message on v11 nodes). An unreachable node, a timeout, HTTP 429 and HTTP 5xx are thrown;
they returned `false`.

## Client configuration

- `new SupraClient` throws a `TypeError` when `rpcUrl` is not an absolute `http:` or `https:` URL.
- `SupraClient.config` is a copy of the configuration object passed to the constructor. Changing that object after
  construction does not change the client; construct a new client instead.
- The `SupraClient` type no longer declares `build`, `simulate` and `submit`, which were `undefined` at runtime. Use
  `supra.transaction.build`, `supra.transaction.simulate` and `supra.transaction.submit`.
- The constants `MAX_RETRY_FOR_TRANSACTION_COMPLETION`, `DELAY_BETWEEN_POOLING_REQUEST` and
  `DEFAULT_RECORDS_ITEMS_COUNT` are removed; no function of the SDK read them. `SupraConfig.waitTimeoutMs` sets how
  long a wait lasts.

## Fungible assets

### SUPRA fungible asset transfers check the fungible asset balance

`fungibleAsset.transferSupraFungibleAsset`, and `fungibleAsset.transferFungibleAsset` with the SUPRA fungible asset
address, move SUPRA from the sender's fungible asset store only. They throw
`SupraInsufficientFungibleAssetBalanceError` (`amount`, `fungibleAssetBalance`, `coinBalance`) without submitting when
that store holds less than `amount`; 1.2.0 submitted a transaction that aborted on chain. SUPRA that an account
received as a coin, for example from the faucet, stays in its `CoinStore` until `migrateCoinToFungibleStore` moves it.
`coin.transferSupraCoin` moves SUPRA held in either form.

```typescript
import { SupraAccount, SupraInsufficientFungibleAssetBalanceError } from "supra-ts-sdk";

const wait = { enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true } };
const receiverAccountAddress = new SupraAccount().address();
try {
    await supra.fungibleAsset.transferSupraFungibleAsset({ senderAccount: account, receiverAccountAddress, amount: 1_000n });
} catch (error) {
    if (!(error instanceof SupraInsufficientFungibleAssetBalanceError)) throw error;
    if (error.fungibleAssetBalance + error.coinBalance < error.amount) throw error;
    // The SUPRA is held as a coin: move it to the fungible asset store, then transfer.
    await supra.fungibleAsset.migrateCoinToFungibleStore({ senderAccount: account, optionalTransactionArgs: wait });
    await supra.fungibleAsset.transferSupraFungibleAsset({ senderAccount: account, receiverAccountAddress, amount: 1_000n });
}
```

### `getAccountCoinsCount` counts SUPRA held as a fungible asset

`account.getAccountCoinsCount` counts SUPRA held as a fungible asset when the account has no `CoinStore<SupraCoin>`,
so an account whose SUPRA was migrated returns 1 where it returned 0. Other fungible assets are not counted.
`account.getAccountSupraBalance` returns the SUPRA balance in total and per form.
