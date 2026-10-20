import { SupraAccount } from "../../src/index";
import { DEFAULT_FAUCET_PATH, type E2EContext } from "./env";
import { pollUntil, rawGet, rawSupraBalance } from "./raw";

/**
 * Creates an account with a fresh key pair and funds it from the node's faucet. The faucet is called
 * with a plain request, so tests of the account and transfer APIs do not depend on the SDK's faucet
 * method, which has its own test.
 */
export async function createFundedAccount(ctx: E2EContext): Promise<SupraAccount> {
    const account = new SupraAccount();
    await fundFromFaucet(ctx, account.address().toString());
    return account;
}

/** Requests funds for `address` and waits until its SUPRA balance is above zero. */
export async function fundFromFaucet(ctx: E2EContext, address: string): Promise<void> {
    const template = process.env["SUPRA_E2E_FAUCET_PATH"] ?? DEFAULT_FAUCET_PATH;
    const response = await rawGet(ctx, template.replace("{address}", address));
    if (response.status !== 200) {
        throw new Error(
            `Faucet request for ${address} returned HTTP ${response.status}: ${JSON.stringify(response.body)}`,
        );
    }
    await waitForBalance(ctx, address, (balance) => balance > 0n);
}

/** Polls the SUPRA balance of `address` until `accept` returns true, and returns that balance. */
export function waitForBalance(
    ctx: E2EContext,
    address: string,
    accept: (balance: bigint) => boolean,
    timeoutMs = 180_000,
): Promise<bigint> {
    return pollUntil(`the balance of ${address}`, () => rawSupraBalance(ctx, address), accept, timeoutMs);
}

/** A fresh account that has never been funded and does not exist on chain. */
export function createUnfundedAccount(): SupraAccount {
    return new SupraAccount();
}
