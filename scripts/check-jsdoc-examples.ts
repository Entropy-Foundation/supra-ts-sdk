/**
 * Type-checks the code examples of the package against `src/index.ts`.
 *
 * Usage: `pnpm check:jsdoc`
 *
 * The examples are the ```typescript and ```ts fenced blocks in the JSDoc comments under `src/` (test directories
 * excluded), in `.claude/skills/supra-ts-sdk/SKILL.md` and in `MIGRATION.md`. Each block is written to its own file
 * under `.jsdoc-check/`, which imports from `supra-ts-sdk` through a tsconfig `paths` alias to `src/index.ts`, and the
 * files are checked together with `tsc` under the strict settings of the root tsconfig.
 *
 * A fence whose info string has a word after the language (```typescript 1.2.0) is not checked. MIGRATION.md marks
 * its 1.2.0 code that way.
 *
 * A block is checked as a module. Its `import` statements are hoisted and the rest of its text is wrapped in an async
 * function, so a block may use top-level `await` and declare names that another block declares. A block with a
 * top-level `export` or a `"use server"` directive is checked as written.
 *
 * SKILL.md continues one example through many blocks. A block of SKILL.md that uses a name imported by its first
 * block (the "Key Import" block) without importing it is given that import. The names `supra`, `account`,
 * `feePayerAccount`, `rawTxn` and `submitted` are declared in `.jsdoc-check/context.d.ts` for the blocks that use the
 * values of an earlier block; a block that declares one of them uses its own.
 *
 * Exits with 1 and lists each failing diagnostic with the source file and line of the block when a block does not
 * type-check.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, ".jsdoc-check");
const SKILL_FILE = join(ROOT, ".claude", "skills", "supra-ts-sdk", "SKILL.md");
const SKILL_SOURCE = relative(ROOT, SKILL_FILE);
const MIGRATION_FILE = join(ROOT, "MIGRATION.md");

interface Block {
    /** Path of the file that holds the block, relative to the repository root. */
    source: string;
    /** Line, 1-based, of the first code line in that file. */
    line: number;
    code: string;
}

interface Generated {
    block: Block;
    file: string;
    /** Line, 1-based, of the generated file that holds the first code line of the block. */
    bodyStart: number;
}

const IMPORT_PATTERN = /^import\s[\s\S]*?\sfrom\s+["'][^"']+["'];?[ \t]*$/gm;

function sourceFiles(dir: string): string[] {
    const files: string[] = [];
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
            if (name !== "__tests__" && name !== "fixtures") files.push(...sourceFiles(path));
        } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
            files.push(path);
        }
    }
    return files;
}

/** The fenced blocks of `text`, where line `firstLine` of the file is the first line of `text`. */
function fencedBlocks(text: string, source: string, firstLine: number): Block[] {
    const blocks: Block[] = [];
    const lines = text.split("\n");
    let open: { start: number; code: string[] } | undefined;
    lines.forEach((raw, index) => {
        const line = raw.trimEnd();
        if (open === undefined) {
            if (/^\s*```(typescript|ts)\s*$/.test(line)) open = { start: index + 1, code: [] };
        } else if (/^\s*```\s*$/.test(line)) {
            blocks.push({ source, line: firstLine + open.start, code: open.code.join("\n") });
            open = undefined;
        } else {
            open.code.push(raw);
        }
    });
    return blocks;
}

function jsdocBlocks(file: string): Block[] {
    const text = readFileSync(file, "utf8");
    const source = relative(ROOT, file);
    const blocks: Block[] = [];
    for (const match of text.matchAll(/\/\*\*[\s\S]*?\*\//g)) {
        if (!match[0].includes("```")) continue;
        const startLine = text.slice(0, match.index).split("\n").length;
        // Strip the leading ` * ` of each comment line; the line count is unchanged.
        const stripped = match[0]
            .split("\n")
            .map((line) => line.replace(/^\s*\*\/?\s?/, "").replace(/^\/\*\*\s?/, ""))
            .join("\n");
        blocks.push(...fencedBlocks(stripped, source, startLine));
    }
    return blocks;
}

/** The names that an import statement binds, each flagged when it is imported as a type only. */
function importedNames(statement: string): Array<{ name: string; typeOnly: boolean }> {
    const typeOnlyStatement = /^import\s+type\s/.test(statement);
    const list = /\{([\s\S]*)\}/.exec(statement)?.[1] ?? "";
    return list
        .replace(/\/\/.*$/gm, "")
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry !== "")
        .map((entry) => {
            const typeOnly = typeOnlyStatement || /^type\s/.test(entry);
            const name = entry.replace(/^type\s+/, "").split(/\s+as\s+/).pop() ?? entry;
            return { name: name.trim(), typeOnly };
        });
}

/** The `supra-ts-sdk` imports of the first SKILL.md block, which the text of SKILL.md uses as its standing imports. */
function skillImports(blocks: Block[]): Array<{ name: string; typeOnly: boolean }> {
    const first = blocks.find((block) => block.source === SKILL_SOURCE);
    return importedNames(first?.code.match(IMPORT_PATTERN)?.[0] ?? "");
}

/**
 * Import statements for the standing imports that the block uses and does not import itself. A fragment of SKILL.md
 * relies on the imports of the "Key Import" block.
 */
function standingImports(block: Block, standing: Array<{ name: string; typeOnly: boolean }>): string[] {
    if (block.source !== SKILL_SOURCE) return [];
    const own = new Set((block.code.match(IMPORT_PATTERN) ?? []).flatMap((statement) => importedNames(statement)).map((entry) => entry.name));
    return standing
        .filter((entry) => !own.has(entry.name) && new RegExp(`\\b${entry.name}\\b`).test(block.code))
        .map((entry) => `import ${entry.typeOnly ? "type " : ""}{ ${entry.name} } from "supra-ts-sdk";`);
}

function generate(block: Block, index: number, standing: Array<{ name: string; typeOnly: boolean }>): Generated {
    const file = join(OUT_DIR, `example${String(index).padStart(3, "0")}.ts`);
    const added = standingImports(block, standing);
    const asWritten = /^export\s/m.test(block.code) || /^\s*["']use (server|client)["']/.test(block.code);
    if (asWritten) {
        // The added imports follow the block, so that its line numbers are unchanged.
        writeFileSync(file, `${block.code}\n${added.join("\n")}\nexport {};\n`);
        return { block, file, bodyStart: 1 };
    }
    const imports: string[] = [];
    // Blank out the hoisted imports, keeping their line breaks, so that line numbers still match the block.
    const body = block.code.replace(IMPORT_PATTERN, (statement) => {
        imports.push(statement);
        return statement.replace(/[^\n]/g, "");
    });
    const header = [...imports, ...added, "export {};", "async function example(): Promise<void> {"].join("\n");
    writeFileSync(file, `${header}\n${body}\n}\nvoid example;\n`);
    return { block, file, bodyStart: header.split("\n").length + 1 };
}

const CONTEXT = `import type { SupraAccount, SupraClient } from "supra-ts-sdk";

declare global {
    const supra: SupraClient;
    const account: SupraAccount;
    const feePayerAccount: SupraAccount;
    const rawTxn: ReturnType<SupraClient["transaction"]["build"]["rawTxnObject"]>;
    const submitted: Awaited<ReturnType<SupraClient["transaction"]["submit"]["submitRawTransaction"]>>;
}

export {};
`;

/** Declarations of the packages that SKILL.md imports and the repository does not depend on. */
const MODULES = `declare module "@tanstack/react-query" {
    export function useQuery(options: {
        queryKey: unknown[];
        queryFn: () => Promise<unknown>;
        enabled?: boolean;
    }): unknown;
    export function useQueryClient(): { invalidateQueries(options: { queryKey: unknown[] }): unknown };
    export function useMutation<TVariables>(options: {
        mutationFn: (variables: TVariables) => Promise<unknown>;
        onSuccess?: () => void;
    }): unknown;
}

declare module "@/lib/supra" {
    export function getSupraClient(): import("supra-ts-sdk").SupraClient;
}
`;

function main(): void {
    const blocks: Block[] = [];
    for (const file of sourceFiles(join(ROOT, "src"))) blocks.push(...jsdocBlocks(file));
    blocks.push(...fencedBlocks(readFileSync(SKILL_FILE, "utf8"), relative(ROOT, SKILL_FILE), 0));
    blocks.push(...fencedBlocks(readFileSync(MIGRATION_FILE, "utf8"), relative(ROOT, MIGRATION_FILE), 0));

    rmSync(OUT_DIR, { recursive: true, force: true });
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, "context.d.ts"), CONTEXT);
    writeFileSync(join(OUT_DIR, "modules.d.ts"), MODULES);
    writeFileSync(
        join(OUT_DIR, "tsconfig.json"),
        JSON.stringify(
            {
                extends: "../tsconfig.json",
                compilerOptions: {
                    noEmit: true,
                    declaration: false,
                    declarationMap: false,
                    sourceMap: false,
                    rootDir: "..",
                    baseUrl: ".",
                    paths: { "supra-ts-sdk": ["../src/index.ts"] },
                },
                include: ["./*.ts"],
                exclude: [],
            },
            undefined,
            4,
        ),
    );

    const standing = skillImports(blocks);
    const generated = blocks.map((block, index) => generate(block, index, standing));
    const tsc = join(ROOT, "node_modules", ".bin", "tsc");
    const result = spawnSync(tsc, ["-p", join(OUT_DIR, "tsconfig.json"), "--pretty", "false"], {
        cwd: ROOT,
        encoding: "utf8",
    });
    if (result.error !== undefined) throw result.error;

    const failures: string[] = [];
    for (const diagnostic of `${result.stdout}${result.stderr}`.split("\n")) {
        const match = /^(.+?)\((\d+),(\d+)\): (error TS\d+: .*)$/.exec(diagnostic);
        if (match === null) {
            if (diagnostic.trim() !== "" && !diagnostic.startsWith(" ")) failures.push(diagnostic);
            continue;
        }
        const entry = generated.find((candidate) => resolve(ROOT, match[1] ?? "") === candidate.file);
        if (entry === undefined) {
            failures.push(diagnostic);
            continue;
        }
        const line = entry.block.line + Number(match[2]) - entry.bodyStart;
        failures.push(`${entry.block.source}:${line}: ${match[4]}`);
    }

    if (failures.length > 0 || result.status !== 0) {
        // The generated files stay in `.jsdoc-check/` for inspection; the next run replaces them.
        console.error(failures.join("\n"));
        console.error(`\n${failures.length} diagnostics in ${generated.length} examples`);
        process.exit(1);
    }
    rmSync(OUT_DIR, { recursive: true, force: true });
    console.log(`${generated.length} examples type-check`);
}

main();
