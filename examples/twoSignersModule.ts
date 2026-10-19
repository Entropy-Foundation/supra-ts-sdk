import { readFileSync } from "node:fs";
import { HexString, type SupraAccount, type SupraClient } from "supra-ts-sdk";
import { assertSuccess } from "./setup";

/**
 * The module `sdk_e2e::tagged` of `e2e/fixtures/move`, compiled for the address `compiledFixtures.moduleAddress`.
 * It has `two_signers(a: &signer, b: &signer)`, an entry function without arguments that takes two signers, which
 * the multi-agent example calls.
 */
interface CompiledFixtures {
    moduleAddress: string;
    metadata: string;
    module: string;
}

const compiledFixtures = JSON.parse(
    readFileSync(new URL("../e2e/fixtures/compiled.json", import.meta.url), "utf8"),
) as CompiledFixtures;

/** The compiled module with the address it was compiled for replaced by `address`. */
function moduleBytecodeFor(address: string): Uint8Array {
    const bytecode = Buffer.from(compiledFixtures.module, "hex");
    const from = Buffer.from(compiledFixtures.moduleAddress.slice(2), "hex");
    const at = bytecode.indexOf(from);
    if (at < 0) {
        throw new Error("The compiled module does not contain its compile-time address");
    }
    Buffer.from(new HexString(address).toUint8Array()).copy(bytecode, at);
    return new Uint8Array(bytecode);
}

/**
 * Publishes the module under the address of `publisher` and returns the function id of its two-signer entry function.
 */
export async function publishTwoSignersModule(supra: SupraClient, publisher: SupraAccount): Promise<string> {
    const address = publisher.address().toString();
    const published = await supra.transaction.publishPackage({
        senderAccount: publisher,
        packageMetadata: new HexString(compiledFixtures.metadata).toUint8Array(),
        modulesCode: [moduleBytecodeFor(address)],
        optionalTransactionArgs: { enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true } },
    });
    assertSuccess("publishPackage", published);
    return `${address}::tagged::two_signers`;
}
