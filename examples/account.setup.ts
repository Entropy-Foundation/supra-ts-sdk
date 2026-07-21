import { SupraAccount } from "supra-ts-sdk";

/**
 * Accounts used across the examples.
 *
 * These are freshly GENERATED accounts, so the examples type-check and import
 * cleanly without any private key being committed to the repo. Generated
 * accounts start with a ZERO balance, so the transfer/submit examples will fail
 * on-chain until the accounts are funded.
 *
 * To actually run the transfer/submit/sponsor/multi-agent examples, replace the
 * generated accounts below with your own funded testnet accounts:
 *
 *   export const account = SupraAccount.fromSupraAccountObject({
 *       address: "0x<ADDRESS>",
 *       privateKeyHex: "<PRIVATE_KEY_HEX><PUBLIC_KEY_HEX_WITHOUT_0x>",
 *       publicKeyHex: "0x<PUBLIC_KEY_HEX_WITHOUT_0x>",
 *   });
 *
 * Fund a testnet account with the faucet — see `faucet.ts`. Never commit real
 * private keys; keep them in an untracked file or environment variables.
 */
export const account = new SupraAccount();
export const feePayerAccount = new SupraAccount();
export const secondarySignerAccount = new SupraAccount();
