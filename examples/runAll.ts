import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { REQUEST_TIMEOUT_EXIT_STATUS } from "./setup";

/**
 * Runs every example in sequence and stops at the first one that fails. Run it with `pnpm examples`, which builds the
 * SDK first. The environment (`SUPRA_RPC_URL`, `SUPRA_CHAIN_ID`, `SUPRA_NETWORK`, `SUPRA_PRIVATE_KEY`,
 * `SUPRA_EXAMPLES_FUND`) is passed on to each example.
 *
 * An example that fails because a request to the node timed out (exit status `REQUEST_TIMEOUT_EXIT_STATUS`) is run
 * again from the start, up to `ATTEMPTS` runs in total, `RETRY_DELAY_MS` after the failed run. Any other failure stops
 * the run at once.
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

/** Runs of one example, the first included, when its runs fail on a request timeout. */
const ATTEMPTS = 3;

const RETRY_DELAY_MS = 15_000;

for (const name of EXAMPLES) {
    console.log(`\n=== ${name}`);
    const file = fileURLToPath(new URL(`./${name}.ts`, import.meta.url));
    for (let attempt = 1; ; attempt++) {
        const result = spawnSync(process.execPath, ["--import", "tsx", file], { stdio: "inherit" });
        if (result.status === 0) {
            break;
        }
        if (result.status === REQUEST_TIMEOUT_EXIT_STATUS && attempt < ATTEMPTS) {
            console.error(
                `\nA request of the example ${name} timed out; running it again in ${RETRY_DELAY_MS / 1000} s ` +
                    `(run ${attempt + 1} of ${ATTEMPTS})`,
            );
            await sleep(RETRY_DELAY_MS);
            continue;
        }
        console.error(`\nThe example ${name} failed (exit status ${String(result.status)})`);
        process.exit(result.status ?? 1);
    }
}
console.log("\nAll examples completed");
