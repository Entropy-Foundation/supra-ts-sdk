import type { E2EContext } from "./env";
import { rawGet } from "./raw";

/**
 * Where an account holds its SUPRA. A chain with feature 64 on (an rc7 or later genesis) keeps SUPRA in primary
 * fungible stores (`"fa"`); a chain without it keeps SUPRA in `0x1::coin::CoinStore<SupraCoin>` (`"coin"`). A v11
 * chain can turn the feature on later, so the layout is read from the account under test, not taken from the node
 * generation.
 */
export type SupraLayout = "coin" | "fa";

export const SUPRA_COIN_STORE = "0x1::coin::CoinStore<0x1::supra_coin::SupraCoin>";

/** The layout of a funded account: `"coin"` when its `CoinStore<SupraCoin>` exists, `"fa"` otherwise. */
export async function supraLayoutOf(ctx: E2EContext, address: string): Promise<SupraLayout> {
    const response = await rawGet(ctx, `/rpc/v3/accounts/${address}/resources/${SUPRA_COIN_STORE}`);
    if (response.status === 200) {
        return "coin";
    }
    if (response.status === 404) {
        return "fa";
    }
    throw new Error(`Reading ${SUPRA_COIN_STORE} of ${address} returned HTTP ${response.status}`);
}

/**
 * The layout the global setup found on a freshly faucet-funded account, or `undefined` outside an end-to-end run.
 * It selects which tests run; tests that read a particular account use `supraLayoutOf` for that account.
 */
export function supraLayout(): SupraLayout | undefined {
    const value = process.env["SUPRA_E2E_SUPRA_LAYOUT"];
    return value === "coin" || value === "fa" ? value : undefined;
}

/**
 * `test` for a behaviour that exists only where faucet-funded accounts hold SUPRA in the given layout; it is
 * `test.skip` on a node with the other layout.
 */
export function testForLayout(layout: SupraLayout): jest.It {
    return supraLayout() === layout ? test : test.skip;
}

/** The event type a SUPRA deposit emits: `CoinDeposit` for a CoinStore, `Deposit` of the fungible asset module otherwise. */
export function depositEventType(layout: SupraLayout): `${string}::${string}::${string}` {
    return layout === "fa" ? "0x1::fungible_asset::Deposit" : "0x1::coin::CoinDeposit";
}

/** The module, abort name and code of the Move abort of a SUPRA transfer that exceeds the balance. */
export interface InsufficientBalanceAbort {
    module: string;
    name: string;
    code: number;
    /** The text the node renders after "Move abort in ". */
    message: string;
}

export function insufficientBalanceAbort(layout: SupraLayout): InsufficientBalanceAbort {
    return layout === "fa"
        ? {
              module: "0x1::fungible_asset",
              name: "EINSUFFICIENT_BALANCE",
              code: 0x10004,
              message: "0x1::fungible_asset: EINSUFFICIENT_BALANCE(0x10004)",
          }
        : {
              module: "0x1::coin",
              name: "EINSUFFICIENT_BALANCE",
              code: 0x10006,
              message: "0x1::coin: EINSUFFICIENT_BALANCE(0x10006)",
          };
}
