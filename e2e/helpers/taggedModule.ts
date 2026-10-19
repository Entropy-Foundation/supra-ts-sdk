import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MoveFunctionId, SupraAccount } from "../../src/index";
import { BCS, HexString, TransactionStatus } from "../../src/index";
import type { E2EContext } from "./env";

/**
 * Publishes the `sdk_e2e::tagged` module of `fixtures/move` under the address of `publisher`. The
 * compiled module in `fixtures/compiled.json` is patched with that address before it is published.
 */

interface Compiled {
    moduleAddress: string;
    metadata: string;
    module: string;
    script: string;
}

const compiled = JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "compiled.json"), "utf8")) as Compiled;

function moduleBytecodeFor(address: string): Uint8Array {
    const bytecode = Buffer.from(compiled.module, "hex");
    const from = Buffer.from(compiled.moduleAddress.slice(2), "hex");
    const to = Buffer.from(new HexString(address).toUint8Array());
    const at = bytecode.indexOf(from);
    if (at < 0) {
        throw new Error("The compiled module does not contain its compile-time address");
    }
    to.copy(bytecode, at);
    return new Uint8Array(bytecode);
}

/** Publishes the module and returns the address it was published under. */
export async function publishTaggedModule(
    ctx: E2EContext,
    publisher: SupraAccount,
    gas: { maxGas: bigint; gasUnitPrice: bigint },
): Promise<string> {
    const moduleAddress = publisher.address().toString();
    const code = new BCS.Serializer();
    code.serializeU32AsUleb128(1);
    code.serializeBytes(moduleBytecodeFor(moduleAddress));
    const sequenceNumber = BigInt(
        (await ctx.supra.account.getAccountInfo({ accountAddress: publisher.address() })).sequence_number,
    );
    const publish = ctx.supra.transaction.build.rawTxnObject({
        senderAddress: publisher.address(),
        senderSequenceNumber: sequenceNumber,
        function: "0x1::code::publish_package_txn" as MoveFunctionId,
        functionTypeArgs: [],
        functionArgs: [BCS.bcsSerializeBytes(new HexString(compiled.metadata).toUint8Array()), code.getBytes()],
        optionalTransactionPayloadArgs: gas,
    });
    const published = await publish.submitTransaction({
        senderAccount: publisher,
        enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true },
    });
    if (published.status !== TransactionStatus.Success) {
        throw new Error(`Publishing the module failed with status ${published.status}`);
    }
    return moduleAddress;
}
