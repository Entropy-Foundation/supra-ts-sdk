import {
    HexString,
    Network,
    SupraAccount,
    SupraClient,
    SupraFaucetUnavailableError,
    TransactionStatus,
} from "supra-ts-sdk";

/**
 * Setup shared by the examples: the client, the accounts and the exit code.
 *
 * The network comes from the environment:
 *
 * - `SUPRA_RPC_URL` and `SUPRA_CHAIN_ID`: a node by its base URL (without `/rpc/v3`) and chain ID, for example a
 *   localnet: `SUPRA_RPC_URL=http://localhost:27001 SUPRA_CHAIN_ID=255`.
 * - `SUPRA_NETWORK`: `devnet`, `testnet` or `mainnet`. Used when `SUPRA_RPC_URL` is not set. Default `devnet`.
 *
 * The examples that send transactions need a funded account:
 *
 * - `SUPRA_PRIVATE_KEY`: the Ed25519 private key (32 bytes as hex) of a funded account.
 * - `SUPRA_EXAMPLES_FUND=1`: the examples generate fresh accounts and fund them from the network's faucet. The node
 *   must serve a faucet; the first RPC node of a localnet does.
 *
 * Examples that need more than one account (a fee payer, a second signer) fund the others from the first, or from
 * the faucet when `SUPRA_EXAMPLES_FUND=1` is set.
 */

/** The chain ID of Mainnet. The examples do not send transactions to it. */
const MAINNET_CHAIN_ID = 8;

/** Quants given to each account other than the first when it is funded from the first account (25 SUPRA). */
const SHARED_FUNDING_QUANTS = 2_500_000_000n;

const FUNDING_TIMEOUT_MS = 180_000;

export function createClient(): SupraClient {
    const rpcUrl = process.env["SUPRA_RPC_URL"] ?? "";
    if (rpcUrl !== "") {
        const chainId = Number(process.env["SUPRA_CHAIN_ID"]);
        if (!Number.isInteger(chainId) || chainId < 0 || chainId > 255) {
            throw new Error("SUPRA_CHAIN_ID must be set to the chain ID of the node at SUPRA_RPC_URL");
        }
        return new SupraClient({ rpcUrl, chainId });
    }
    switch ((process.env["SUPRA_NETWORK"] ?? "devnet").toLowerCase()) {
        case "devnet":
            return new SupraClient({ network: Network.DEVNET });
        case "testnet":
            return new SupraClient({ network: Network.TESTNET });
        case "mainnet":
            return new SupraClient({ network: Network.MAINNET });
        default:
            throw new Error("SUPRA_NETWORK must be devnet, testnet or mainnet");
    }
}

/** True when the environment provides a funded account (`SUPRA_PRIVATE_KEY`) or asks for faucet funding. */
export function canSendTransactions(): boolean {
    return (process.env["SUPRA_PRIVATE_KEY"] ?? "") !== "" || faucetFundingRequested();
}

function faucetFundingRequested(): boolean {
    return process.env["SUPRA_EXAMPLES_FUND"] === "1";
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Requests funds for `account` from the faucet, retrying while the faucet has no free account, and waits for them. */
async function fundFromFaucet(supra: SupraClient, account: SupraAccount): Promise<void> {
    const deadline = Date.now() + FUNDING_TIMEOUT_MS;
    for (;;) {
        try {
            await supra.faucet.fundAccountWithFaucet({ accountAddress: account.address() });
            break;
        } catch (error) {
            if (!(error instanceof SupraFaucetUnavailableError) || Date.now() > deadline) {
                throw error;
            }
            await sleep(2_000);
        }
    }
    await waitForBalance(supra, account);
}

/** Waits until the account holds SUPRA. */
async function waitForBalance(supra: SupraClient, account: SupraAccount): Promise<void> {
    const deadline = Date.now() + FUNDING_TIMEOUT_MS;
    for (;;) {
        try {
            if ((await supra.account.getAccountSupraCoinBalance({ accountAddress: account.address() })) > 0n) {
                return;
            }
        } catch (error) {
            if (Date.now() > deadline) {
                throw error;
            }
        }
        if (Date.now() > deadline) {
            throw new Error(`${account.address().toString()} holds no SUPRA after ${FUNDING_TIMEOUT_MS} ms`);
        }
        await sleep(500);
    }
}

function accountFromPrivateKey(privateKey: string): SupraAccount {
    const bytes = new HexString(privateKey.trim()).toUint8Array();
    if (bytes.length !== 32) {
        throw new Error("SUPRA_PRIVATE_KEY must be 32 bytes as hex");
    }
    return new SupraAccount(bytes);
}

/**
 * Returns `count` funded accounts for an example that sends transactions.
 *
 * The first account is the one of `SUPRA_PRIVATE_KEY` when it is set; otherwise it is generated and funded from the
 * faucet (`SUPRA_EXAMPLES_FUND=1`). Further accounts are generated. With `SUPRA_EXAMPLES_FUND=1` the faucet funds
 * them; otherwise the first account sends each of them 25 SUPRA.
 */
export async function getFundedAccounts(supra: SupraClient, count: number): Promise<SupraAccount[]> {
    if (!canSendTransactions()) {
        throw new Error("Set SUPRA_PRIVATE_KEY to a funded account's key, or SUPRA_EXAMPLES_FUND=1 to use the faucet");
    }
    if (supra.networkInformation.chainId === MAINNET_CHAIN_ID) {
        throw new Error("The examples do not send transactions to Mainnet");
    }

    const privateKey = process.env["SUPRA_PRIVATE_KEY"] ?? "";
    const accounts: SupraAccount[] = [];
    for (let index = 0; index < count; index += 1) {
        accounts.push(index === 0 && privateKey !== "" ? accountFromPrivateKey(privateKey) : new SupraAccount());
    }

    const [first, ...others] = accounts;
    if (first === undefined) {
        return accounts;
    }
    if (privateKey === "") {
        await fundFromFaucet(supra, first);
    } else if ((await supra.account.getAccountSupraCoinBalance({ accountAddress: first.address() })) === 0n) {
        throw new Error(`The account of SUPRA_PRIVATE_KEY (${first.address().toString()}) holds no SUPRA`);
    }
    for (const account of others) {
        if (faucetFundingRequested()) {
            await fundFromFaucet(supra, account);
        } else {
            await supra.coin.transferSupraCoin({
                senderAccount: first,
                receiverAccountAddress: account.address(),
                amount: SHARED_FUNDING_QUANTS,
                optionalTransactionArgs: { enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true } },
            });
        }
    }
    return accounts;
}

/** Throws unless the transaction ended with status `Success`. */
export function assertSuccess(label: string, transaction: { hash: string; status: string }): void {
    if (transaction.status !== TransactionStatus.Success) {
        throw new Error(`${label}: transaction ${transaction.hash} ended with status ${transaction.status}`);
    }
}

/** Runs an example and exits with a non-zero code when it throws. */
export function runExample(main: () => Promise<void>): void {
    main().catch((error: unknown) => {
        console.error(error);
        process.exit(1);
    });
}
