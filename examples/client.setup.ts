import { SupraClient, Network, type SupraAccount } from "supra-ts-sdk";

/**
 * The client used by the transaction examples.
 *
 * By default it connects to Testnet. To run an example against a localnet or another node, set
 * `SUPRA_RPC_URL` (the base URL of the RPC service, without `/rpc/v3`) and `SUPRA_CHAIN_ID`:
 *
 *   SUPRA_RPC_URL=http://localhost:27001 SUPRA_CHAIN_ID=255 npx tsx examples/buildTransaction.ts
 */
export function usesCustomNode(): boolean {
    return (process.env["SUPRA_RPC_URL"] ?? "") !== "";
}

export function createClient(): SupraClient {
    const rpcUrl = process.env["SUPRA_RPC_URL"];
    if (rpcUrl === undefined || rpcUrl === "") {
        return new SupraClient({ network: Network.TESTNET });
    }
    const chainId = Number(process.env["SUPRA_CHAIN_ID"]);
    if (!Number.isInteger(chainId) || chainId <= 0) {
        throw new Error("SUPRA_CHAIN_ID must be set to the chain ID of the node at SUPRA_RPC_URL");
    }
    return new SupraClient({ rpcUrl, chainId });
}

/**
 * Funds the accounts from the node's faucet and waits until they exist on chain. It does nothing unless
 * `SUPRA_EXAMPLES_FUND=1` is set, so an example never calls a faucet by itself. The node must have a faucet,
 * which a localnet's first RPC node has.
 */
export async function fundAccountsIfRequested(supra: SupraClient, accounts: SupraAccount[]): Promise<void> {
    if (process.env["SUPRA_EXAMPLES_FUND"] !== "1") {
        return;
    }
    for (const account of accounts) {
        await supra.faucet.fundAccountWithFaucet({ accountAddress: account.address() });
    }
    const deadline = Date.now() + 120_000;
    for (const account of accounts) {
        for (;;) {
            try {
                await supra.account.getAccountInfo({ accountAddress: account.address() });
                break;
            } catch (error) {
                if (Date.now() > deadline) {
                    throw error;
                }
                await new Promise((resolve) => setTimeout(resolve, 500));
            }
        }
    }
}
