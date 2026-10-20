import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Checks `compatibility.json` against the schema that the README's "Compatibility" section describes, and that its
 * latest release is the version in `package.json`, so that a release that changes the version also updates the file.
 */

const ROOT = join(__dirname, "..", "..");

interface CompatibilityRelease {
    sdk: string;
    node: { min: string | null; tested: string[]; unsupported: string[] };
    rpc: string[];
}

const SDK_VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
const NODE_RELEASE = /^v\d+\.\d+\.\d+(?:-rc\d+)?$/;
const NODE_LINE = /^v\d+$/;
const RPC_VERSION = /^v\d+$/;

function readJson(file: string): unknown {
    return JSON.parse(readFileSync(join(ROOT, file), "utf8"));
}

/** Compares two SDK versions by semver precedence; prerelease identifiers are compared as dot-separated parts. */
function compareVersions(a: string, b: string): number {
    const [, ...left] = SDK_VERSION.exec(a) ?? [];
    const [, ...right] = SDK_VERSION.exec(b) ?? [];
    for (let i = 0; i < 3; i++) {
        const difference = Number(left[i]) - Number(right[i]);
        if (difference !== 0) return difference;
    }
    const leftPre = left[3];
    const rightPre = right[3];
    if (leftPre === rightPre) return 0;
    if (leftPre === undefined) return 1;
    if (rightPre === undefined) return -1;
    const leftParts = leftPre.split(".");
    const rightParts = rightPre.split(".");
    for (let i = 0; i < Math.max(leftParts.length, rightParts.length); i++) {
        const l = leftParts[i];
        const r = rightParts[i];
        if (l === undefined) return -1;
        if (r === undefined) return 1;
        if (l === r) continue;
        const numeric = /^\d+$/.test(l) && /^\d+$/.test(r);
        return numeric ? Number(l) - Number(r) : l < r ? -1 : 1;
    }
    return 0;
}

describe("compatibility.json", () => {
    const file = readJson("compatibility.json") as { schema: unknown; releases: unknown };
    const releases = file.releases as CompatibilityRelease[];
    const packageVersion = (readJson("package.json") as { version: string }).version;

    it("has schema 1 and at least one release", () => {
        expect(file.schema).toBe(1);
        expect(Array.isArray(file.releases)).toBe(true);
        expect(releases.length).toBeGreaterThan(0);
    });

    it("describes every release with the fields of the schema", () => {
        for (const release of releases) {
            expect(Object.keys(release).sort()).toEqual(["node", "rpc", "sdk"]);
            expect(release.sdk).toMatch(SDK_VERSION);
            expect(Object.keys(release.node).sort()).toEqual(["min", "tested", "unsupported"]);
            if (release.node.min !== null) expect(release.node.min).toMatch(NODE_RELEASE);
            expect(Array.isArray(release.node.tested)).toBe(true);
            for (const tested of release.node.tested) expect(tested).toMatch(NODE_RELEASE);
            expect(Array.isArray(release.node.unsupported)).toBe(true);
            for (const line of release.node.unsupported) expect(line).toMatch(NODE_LINE);
            expect(release.rpc.length).toBeGreaterThan(0);
            for (const rpc of release.rpc) expect(rpc).toMatch(RPC_VERSION);
        }
    });

    it("lists the releases newest first, each once", () => {
        const versions = releases.map((release) => release.sdk);
        expect(new Set(versions).size).toBe(versions.length);
        const sorted = [...versions].sort((a, b) => compareVersions(b, a));
        expect(versions).toEqual(sorted);
    });

    it("has the version of package.json as its latest release", () => {
        expect(releases[0]?.sdk).toBe(packageVersion);
    });

    it("compares prereleases below their release", () => {
        expect(compareVersions("2.0.0-beta.0", "2.0.0")).toBeLessThan(0);
        expect(compareVersions("2.0.0-beta.2", "2.0.0-beta.10")).toBeLessThan(0);
        expect(compareVersions("2.1.0-beta.0", "2.0.0")).toBeGreaterThan(0);
        expect(compareVersions("1.2.0", "1.10.0")).toBeLessThan(0);
    });
});
