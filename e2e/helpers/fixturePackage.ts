import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HexString } from "../../src/index";

/** The build output of the package in `fixtures/move`, described in `fixtures/README.md`. */
export interface CompiledFixtures {
    moduleAddress: string;
    metadata: string;
    module: string;
    script: string;
}

export const compiledFixtures = JSON.parse(
    readFileSync(join(__dirname, "..", "fixtures", "compiled.json"), "utf8"),
) as CompiledFixtures;

/** The package metadata of the fixture package, the first argument of `0x1::code::publish_package_txn`. */
export function fixturePackageMetadata(): Uint8Array {
    return new HexString(compiledFixtures.metadata).toUint8Array();
}

/** The compiled fixture module with the address it was compiled for replaced by `address`. */
export function fixtureModuleFor(address: string): Uint8Array {
    const bytecode = Buffer.from(compiledFixtures.module, "hex");
    const from = Buffer.from(compiledFixtures.moduleAddress.slice(2), "hex");
    const to = Buffer.from(new HexString(address).toUint8Array());
    const at = bytecode.indexOf(from);
    if (at < 0) {
        throw new Error("The compiled module does not contain its compile-time address");
    }
    to.copy(bytecode, at);
    return new Uint8Array(bytecode);
}
