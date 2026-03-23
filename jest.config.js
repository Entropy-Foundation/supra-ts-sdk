/** @type {import('jest').Config} */
const config = {
    preset: "ts-jest/presets/default-esm",
    testEnvironment: "node",
    roots: ["<rootDir>/src"],
    testMatch: ["**/__tests__/**/*.test.ts"],
    moduleFileExtensions: ["ts", "js", "json"],
    transform: {
        "^.+\\.ts$": [
            "ts-jest",
            {
                useESM: true,
                tsconfig: "tsconfig.json",
            },
        ],
    },
    extensionsToTreatAsEsm: [".ts"],
    moduleNameMapper: {
        "^(\\.{1,2}/.*)\\.js$": "$1",
    },
    testPathIgnorePatterns: ["/node_modules/", "/dist/"],
    collectCoverageFrom: [
        "src/**/*.ts",
        "!src/index.ts",
        "!src/**/*.d.ts",
    ],
};

export default config;
