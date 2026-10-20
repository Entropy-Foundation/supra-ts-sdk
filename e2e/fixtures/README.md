# Compiled Move fixtures

`compiled.json` holds the build output of the package in `move/`:

- `metadata`: the serialized package metadata, the first argument of `0x1::code::publish_package_txn`.
- `module`: the bytecode of `sdk_e2e::tagged`.
- `script`: the bytecode of `scripts/wide_integers.move`.
- `moduleAddress`: the address the module was compiled for. The tests replace it in `module` with the
  publishing account's address before publishing.

Regenerate it with the Supra CLI (any 11.7 or 12 release):

```bash
supra move tool build-publish-payload --supra-home <empty dir> --package-dir e2e/fixtures/move \
    --output-dir <build dir> --named-addresses sdk_e2e=0xcafe --sender-account 0xcafe \
    --skip-fetch-latest-git-deps --included-artifacts none --json-output-file <payload.json>
```

`metadata` and `module` come from `<payload.json>`. For `script`, run `supra move tool compile` with the
same package, home, named address and output directory options; the script is
`<build dir>/build/sdk_e2e_fixtures/bytecode_scripts/main.mv`, as hex.
