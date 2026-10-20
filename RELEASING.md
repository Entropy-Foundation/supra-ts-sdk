# Releasing supra-ts-sdk

This document is for maintainers. It describes how versions are numbered, which npm dist-tags exist and when they
move, and the steps of a release.

## Versioning

`supra-ts-sdk` follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html) for its own API. Its version
numbers are independent of the Supra node's.

- **Major** (`X.0.0`): a change to the SDK's API or behaviour that can break code written for the previous major. A
  node change that forces such a change in the SDK is released as a new major.
- **Minor** (`x.Y.0`): support for a new node release or a new node feature, and other additions that existing code
  is unaffected by.
- **Patch** (`x.y.Z`): fixes.

A release line supports every node release that runs on Devnet, Testnet and Mainnet as long as the node changes are
additive. When a node release changes its API in a way the SDK cannot absorb, a new major targets the new node line,
and the previous major receives patches until Mainnet runs the new node line.

Each release lists the node releases it supports in [`compatibility.json`](./compatibility.json) and in the opening
paragraph of its [CHANGELOG](./CHANGELOG.md) entry. The README's "Compatibility" section describes the file.

### Prereleases

A release that supports a node release candidate running on Devnet is a prerelease, `X.Y.Z-beta.N`, published under
the `devnet` dist-tag only. `N` starts at 0 and increases with each prerelease of the same `X.Y.Z`. The final
`X.Y.Z` is published once the node release it supports is final.

## npm dist-tags

| Dist-tag | Version it points at |
|---|---|
| `latest` | The release for Mainnet. npm installs it when no tag or version is given. |
| `mainnet` | The same version as `latest`. |
| `testnet` | The release for the node release that runs on Testnet. |
| `devnet` | The release for the node release that runs on Devnet; a prerelease while that node release is a candidate. |

The documentation installs the SDK with `npm install supra-ts-sdk@<network>`, not with a version number.

A tag is moved when a node release reaches its network: when the node release that SDK version supports is deployed to
Devnet, Testnet or Mainnet, the `devnet`, `testnet` or `mainnet` tag is set to that version. `latest` moves together
with `mainnet`. `npm publish` sets `latest` unless `--tag` is given, so every publish passes `--tag` and the tags are
then set explicitly:

```bash
npm dist-tag add supra-ts-sdk@<version> devnet
npm dist-tag add supra-ts-sdk@<version> testnet
npm dist-tag add supra-ts-sdk@<version> mainnet
npm dist-tag add supra-ts-sdk@<version> latest
npm dist-tag ls supra-ts-sdk
```

## Publishing

Until publishing runs in CI, the owner of the npm package publishes from a clean checkout of the release commit:

```bash
git checkout <merge commit>
pnpm install --frozen-lockfile
pnpm build
npm whoami                                              # <npm account>
npm publish --tag <devnet|testnet|mainnet> --otp=<otp>  # prepare runs pnpm build again
```

`npm publish --dry-run --tag <tag>` lists the files of the package without publishing. The package contains `dist/`,
`.claude/skills/`, `README.md`, `CHANGELOG.md` and `LICENSE` (the `files` field of `package.json`).

## Release checklist

1. **CHANGELOG.** Rename `## [Unreleased]` to `## [<version>] - <YYYY-MM-DD>`, open the entry with the node releases
   the version supports, mark each breaking change `**Breaking:**`, add a new empty `## [Unreleased]` above it, and
   update the comparison links at the end of the file. For a major, update [`MIGRATION.md`](./MIGRATION.md) with every
   breaking change.
2. **`compatibility.json`.** Add the version as the first entry of `releases`, with the node releases it supports and
   was tested against and the RPC API versions it calls.
3. **Version.** Set `version` in `package.json`. The unit test of `compatibility.json` fails when its first entry is
   not this version.
4. **Gates.** `pnpm lint`, `pnpm typecheck`, `pnpm typecheck:examples`, `pnpm check:jsdoc`, `pnpm test` and
   `pnpm build` pass. `pnpm test:e2e` passes against a localnet of each node release in `node.tested`
   (`SUPRA_E2E_RPC_URL=<localnet rpc url> pnpm test:e2e`; see [`e2e/README.md`](./e2e/README.md)).
5. **Smoke run on Devnet and Testnet.** From the release branch, run `pnpm examples` against Devnet and Testnet with a
   funded key (`SUPRA_NETWORK=<network> SUPRA_PRIVATE_KEY=<key> pnpm examples`), send ten transfers
   from one account without waiting between them and check that all commit, and fund a new account from the Devnet
   faucet.
6. **Merge** the release pull request.
7. **Publish** from the merge commit, as described under [Publishing](#publishing): a prerelease with
   `--tag devnet`, a release with the tag of the first network it is for.
8. **Tag** the merge commit `v<version>` and push the tag:
   `git tag -a v<version> -m "supra-ts-sdk <version>" <merge commit> && git push origin v<version>`.
9. **GitHub release** for the tag, with the CHANGELOG entry as its notes, marked as a prerelease for `X.Y.Z-beta.N`.
10. **Dist-tags.** Set each dist-tag whose network runs a node release the version supports (see
    [npm dist-tags](#npm-dist-tags)); check them with `npm dist-tag ls supra-ts-sdk`.
11. **Documentation site.** Update the SDK pages of the documentation site to the new version.
