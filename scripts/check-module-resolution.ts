/**
 * Checks that the packed package type-checks when imported from a CommonJS project and from an ES module project under
 * Node.js module resolution.
 *
 * Usage: `pnpm check:module-resolution` (after `pnpm build`)
 *
 * The script packs the repository with `npm pack`, unpacks the tarball into `node_modules/supra-ts-sdk` of a temporary
 * directory, links the package's dependencies from the repository's `node_modules`, and runs `tsc --noEmit` on two
 * fixture projects:
 *
 * - `cjs`: `"type": "commonjs"`, `module` and `moduleResolution` `node16`.
 * - `esm`: `"type": "module"`, `module` and `moduleResolution` `nodenext`.
 *
 * Each fixture imports `SupraClient` and a type from `supra-ts-sdk`. The check needs no network access.
 *
 * Exits with 1 and prints the compiler output when a fixture does not type-check.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TSC = join(ROOT, "node_modules", "typescript", "bin", "tsc");
const DEPENDENCIES = ["supra-l1-sdk-core", "js-sha3"];

interface Fixture {
    name: string;
    packageType: "commonjs" | "module";
    module: "node16" | "nodenext";
    source: string;
}

const FIXTURES: Fixture[] = [
    {
        name: "cjs",
        packageType: "commonjs",
        module: "node16",
        source: [
            `import { SupraClient } from "supra-ts-sdk";`,
            `import type { SupraConfig } from "supra-ts-sdk";`,
            ``,
            `const config: SupraConfig = { rpcUrl: "http://localhost:27001", chainId: 255 };`,
            `export const client: SupraClient = new SupraClient(config);`,
            ``,
        ].join("\n"),
    },
    {
        name: "esm",
        packageType: "module",
        module: "nodenext",
        source: [
            `import { SupraClient } from "supra-ts-sdk";`,
            `import type { SupraConfig } from "supra-ts-sdk";`,
            ``,
            `const config: SupraConfig = { rpcUrl: "http://localhost:27001", chainId: 255 };`,
            `export const client: SupraClient = new SupraClient(config);`,
            ``,
        ].join("\n"),
    },
];

function run(command: string, args: string[], cwd: string): { ok: boolean; output: string } {
    const result = spawnSync(command, args, { cwd, encoding: "utf8" });
    return { ok: result.status === 0, output: `${result.stdout}${result.stderr}` };
}

function main(): void {
    const work = mkdtempSync(join(tmpdir(), "supra-ts-sdk-module-resolution-"));
    let failed = false;
    try {
        const tarballs = join(work, "tarballs");
        mkdirSync(tarballs);
        const pack = run("npm", ["pack", "--ignore-scripts", "--pack-destination", tarballs, ROOT], work);
        if (!pack.ok) {
            console.error(pack.output);
            process.exit(1);
        }
        const tarball = readdirSync(tarballs).find((name) => name.endsWith(".tgz"));
        if (tarball === undefined) {
            console.error("npm pack produced no tarball");
            process.exit(1);
        }
        const unpacked = join(work, "unpacked");
        mkdirSync(unpacked);
        const extract = run("tar", ["-xzf", join(tarballs, tarball), "-C", unpacked], work);
        if (!extract.ok) {
            console.error(extract.output);
            process.exit(1);
        }

        for (const fixture of FIXTURES) {
            const dir = join(work, fixture.name);
            const modules = join(dir, "node_modules");
            mkdirSync(modules, { recursive: true });
            cpSync(join(unpacked, "package"), join(modules, "supra-ts-sdk"), { recursive: true });
            for (const dependency of DEPENDENCIES) {
                symlinkSync(join(ROOT, "node_modules", dependency), join(modules, dependency));
            }
            writeFileSync(
                join(dir, "package.json"),
                JSON.stringify({ name: `fixture-${fixture.name}`, private: true, type: fixture.packageType }),
            );
            writeFileSync(
                join(dir, "tsconfig.json"),
                JSON.stringify({
                    compilerOptions: {
                        target: "es2022",
                        module: fixture.module,
                        moduleResolution: fixture.module,
                        lib: ["es2022", "dom"],
                        strict: true,
                        noEmit: true,
                        skipLibCheck: false,
                        types: [],
                    },
                    include: ["index.ts"],
                }),
            );
            writeFileSync(join(dir, "index.ts"), fixture.source);

            const result = run(process.execPath, [TSC, "-p", "."], dir);
            if (result.ok) {
                console.log(`${fixture.name}: ok (${fixture.module})`);
            } else {
                failed = true;
                console.error(`${fixture.name}: failed (${fixture.module})\n${result.output}`);
            }
        }
    } finally {
        rmSync(work, { recursive: true, force: true });
    }
    if (failed) process.exit(1);
}

main();
