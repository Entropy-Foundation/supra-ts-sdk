import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Runs every example in sequence and stops at the first one that fails. Run it with `pnpm examples`, which builds the
 * SDK first. The environment (`SUPRA_RPC_URL`, `SUPRA_CHAIN_ID`, `SUPRA_NETWORK`, `SUPRA_PRIVATE_KEY`,
 * `SUPRA_EXAMPLES_FUND`) is passed on to each example.
 */
const EXAMPLES = [
    "account",
    "block",
    "events",
    "methods",
    "table",
    "faucet",
    "coin",
    "fungibleAsset",
    "contract",
    "transaction",
    "simulateTransaction",
    "buildTransaction",
    "submitTransaction",
];

for (const name of EXAMPLES) {
    console.log(`\n=== ${name}`);
    const file = fileURLToPath(new URL(`./${name}.ts`, import.meta.url));
    const result = spawnSync(process.execPath, ["--import", "tsx", file], { stdio: "inherit" });
    if (result.status !== 0) {
        console.error(`\nThe example ${name} failed (exit status ${String(result.status)})`);
        process.exit(result.status ?? 1);
    }
}
console.log("\nAll examples completed");
