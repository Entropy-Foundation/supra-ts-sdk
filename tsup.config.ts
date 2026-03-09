import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    minify: false,               // usually keep false in SDKs — consumers minify
    target: 'es2022',            // align with tsconfig
    splitting: false,            // usually false for SDKs (better tree-shaking)
    shims: false,

    // Very useful for browser compatibility
    external: ['axios', 'supra-l1-sdk-core', 'js-sha3'],

    // Optional: if you later add worker / edge support
    // platform: 'neutral',

    // Very recommended in 2025+
    banner: {
        js: `/*! supra-ts-sdk v${process.env.npm_package_version} | (c) ${new Date().getFullYear()} Supra | MIT */`
    }
});