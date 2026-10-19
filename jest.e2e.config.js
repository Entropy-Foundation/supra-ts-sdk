/** @type {import('jest').Config} */
const config = {
    testEnvironment: "node",
    roots: ["<rootDir>/e2e"],
    testMatch: ["**/*.e2e.test.ts"],
    moduleFileExtensions: ["ts", "js", "json"],
    transform: {
        "^.+\\.ts$": [
            "ts-jest",
            {
                tsconfig: "tsconfig.tools.json",
            },
        ],
    },
    moduleNameMapper: {
        "^(\\.{1,2}/.*)\\.js$": "$1",
    },
    globalSetup: "<rootDir>/e2e/globalSetup.ts",
    testPathIgnorePatterns: ["/node_modules/", "/dist/"],
    testTimeout: Number(process.env.SUPRA_E2E_TEST_TIMEOUT_MS ?? 90_000),
    // Test files share one localnet and one faucet; running them one after another keeps
    // faucet rate limits and sequence numbers predictable.
    maxWorkers: 1,
};

export default config;
