import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BCS, HexString, SupraAccount, TxnBuilderTypes, TypeTagParser } from "supra-l1-sdk-core";
import { SupraClient } from "../../../api/supraClient";
import type { MoveFunctionId } from "../../../types/move";
import type { OptionalTransactionPayloadArgs } from "../../../types/transactionManager/transactionBuild";

/**
 * Byte-equality tests against fixtures recorded from a Supra node. Each case lists the inputs of one
 * transaction (including the seed of every signer), and the BCS of the raw transaction, the signing
 * message, the signatures, the signed transaction and its hash.
 *
 * The `provenance` map of a case states where each recorded value comes from: `node` for a value
 * produced or reported by a Supra node, `node-verified` for a value the SDK produced that the node
 * accepted (a signature that passed the node's check, the hash the node reported for the submitted
 * transaction), and `specification` for a value derived from the definitions of the formats. The
 * regeneration steps are in `scripts/fixtures/README.md`.
 */

interface FixtureSigner {
    role: "sender" | "secondary" | "fee_payer";
    seed: string;
    address: string;
    publicKey: string;
}

type FixtureScriptArgument =
    | { type: "u8" | "u16" | "u32" | "u64" | "u128"; value: string }
    | { type: "address"; value: string }
    | { type: "bool"; value: boolean }
    | { type: "u8vector"; value: string };

interface EntryFunctionFixture {
    type: "entry_function";
    function: string;
    typeArguments: string[];
    arguments: string[];
}

interface ScriptFixture {
    type: "script";
    code: string;
    typeArguments: string[];
    arguments: FixtureScriptArgument[];
}

interface MultisigFixture {
    type: "multisig";
    multisigAddress: string;
    function: string;
    typeArguments: string[];
    arguments: string[];
}

interface AutomationRegistrationFixture {
    type: "automation_registration";
    function: string;
    typeArguments: string[];
    arguments: string[];
    maxGasAmount: string;
    gasPriceCap: string;
    feeCapForEpoch: string;
    expirationTimestampSecs: string;
    auxData: string[];
}

type FixturePayload = EntryFunctionFixture | ScriptFixture | MultisigFixture | AutomationRegistrationFixture;

interface TransactionFixture {
    name: string;
    description: string;
    authenticator: "ed25519" | "multi_agent" | "fee_payer";
    chainId: number;
    signers: FixtureSigner[];
    raw: {
        sender: string;
        sequenceNumber: string;
        maxGasAmount: string;
        gasUnitPrice: string;
        expirationTimestampSecs: string;
        payload: FixturePayload;
    };
    expected: {
        rawTransactionBcs: string;
        signingMessage: string;
        signatures: string[];
        signedTransactionBcs: string;
        transactionHash: string;
    };
    provenance: Record<string, "node" | "node-verified" | "specification">;
}

interface FixtureFile {
    schema: number;
    cases: TransactionFixture[];
}

const fixtureFile = JSON.parse(readFileSync(join(__dirname, "fixtures", "transactions.json"), "utf8")) as FixtureFile;

// Offline signing: the fixtures carry their own chain IDs and no node is reachable.
const supra = new SupraClient({ rpcUrl: "http://127.0.0.1:1", chainId: 1, verifyChainId: false });

function hex(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString("hex");
}

function bytes(value: string): Uint8Array {
    return new Uint8Array(Buffer.from(value, "hex"));
}

function typeTags(types: string[]): TxnBuilderTypes.TypeTag[] {
    return types.map((type) => new TypeTagParser(type).parseTypeTag());
}

function scriptArgument(argument: FixtureScriptArgument): TxnBuilderTypes.TransactionArgument {
    switch (argument.type) {
        case "u8":
            return new TxnBuilderTypes.TransactionArgumentU8(Number(argument.value));
        case "u16":
            return new TxnBuilderTypes.TransactionArgumentU16(Number(argument.value));
        case "u32":
            return new TxnBuilderTypes.TransactionArgumentU32(Number(argument.value));
        case "u64":
            return new TxnBuilderTypes.TransactionArgumentU64(BigInt(argument.value));
        case "u128":
            return new TxnBuilderTypes.TransactionArgumentU128(BigInt(argument.value));
        case "address":
            return new TxnBuilderTypes.TransactionArgumentAddress(
                TxnBuilderTypes.AccountAddress.fromHex(argument.value),
            );
        case "bool":
            return new TxnBuilderTypes.TransactionArgumentBool(argument.value);
        case "u8vector":
            return new TxnBuilderTypes.TransactionArgumentU8Vector(bytes(argument.value));
    }
}

function buildRawTransaction(fixture: TransactionFixture) {
    const { raw } = fixture;
    const client = new SupraClient({ rpcUrl: "http://127.0.0.1:1", chainId: fixture.chainId, verifyChainId: false });
    const optionalTransactionPayloadArgs: OptionalTransactionPayloadArgs = {
        maxGas: BigInt(raw.maxGasAmount),
        gasUnitPrice: BigInt(raw.gasUnitPrice),
        txExpiryTime: BigInt(raw.expirationTimestampSecs),
    };
    const common = {
        senderAddress: raw.sender,
        senderSequenceNumber: BigInt(raw.sequenceNumber),
        optionalTransactionPayloadArgs,
    };
    const payload = raw.payload;

    switch (payload.type) {
        case "entry_function":
            return client.transaction.build.rawTxnObject({
                ...common,
                function: payload.function as MoveFunctionId,
                functionTypeArgs: typeTags(payload.typeArguments),
                functionArgs: payload.arguments.map(bytes),
            });
        case "script":
            return client.transaction.build.scriptRawTxnObject({
                ...common,
                scriptCode: bytes(payload.code),
                scriptTypeArgs: typeTags(payload.typeArguments),
                scriptArgs: payload.arguments.map(scriptArgument),
            });
        case "multisig":
            return client.transaction.build.multisigRawTxnObject({
                ...common,
                multisigAddress: payload.multisigAddress,
                function: payload.function as MoveFunctionId,
                functionTypeArgs: typeTags(payload.typeArguments),
                functionArgs: payload.arguments.map(bytes),
            });
        case "automation_registration":
            return client.transaction.build.automationRegistrationRawTxnObject({
                ...common,
                function: payload.function as MoveFunctionId,
                functionTypeArgs: typeTags(payload.typeArguments),
                functionArgs: payload.arguments.map(bytes),
                automationMaxGasAmount: BigInt(payload.maxGasAmount),
                automationGasPriceCap: BigInt(payload.gasPriceCap),
                automationFeeCapForEpoch: BigInt(payload.feeCapForEpoch),
                automationExpirationTimestampSecs: BigInt(payload.expirationTimestampSecs),
                automationAuxData: payload.auxData.map(bytes),
            });
    }
}

function accountOf(signer: FixtureSigner): SupraAccount {
    return new SupraAccount(bytes(signer.seed));
}

function addressOf(account: SupraAccount): TxnBuilderTypes.AccountAddress {
    return new TxnBuilderTypes.AccountAddress(account.address().toUint8Array());
}

/**
 * What the SDK signs for the fixture, and the authenticators it builds: the raw transaction itself for
 * a single-signer transaction, or the raw transaction with the secondary signer and fee payer addresses.
 */
function signingTarget(fixture: TransactionFixture, rawTxn: TxnBuilderTypes.RawTransaction, accounts: SupraAccount[]) {
    const secondary = accounts.filter((_, index) => fixture.signers[index]?.role === "secondary");
    const feePayer = accounts.find((_, index) => fixture.signers[index]?.role === "fee_payer");

    switch (fixture.authenticator) {
        case "ed25519":
            return rawTxn;
        case "multi_agent":
            return new TxnBuilderTypes.MultiAgentRawTransaction(rawTxn, secondary.map(addressOf));
        case "fee_payer":
            if (feePayer === undefined) {
                throw new Error(`Fixture ${fixture.name} has no fee payer signer`);
            }
            return new TxnBuilderTypes.FeePayerRawTransaction(rawTxn, secondary.map(addressOf), addressOf(feePayer));
    }
}

async function signedTransaction(
    fixture: TransactionFixture,
    rawTxn: TxnBuilderTypes.RawTransaction,
    accounts: SupraAccount[],
    target: ReturnType<typeof signingTarget>,
): Promise<TxnBuilderTypes.SignedTransaction> {
    if (fixture.authenticator === "ed25519") {
        const [sender] = accounts;
        if (sender === undefined) {
            throw new Error(`Fixture ${fixture.name} has no signer`);
        }
        return supra.transaction.build.signedTransaction({ senderAccount: sender, rawTxn });
    }

    const authenticators = await Promise.all(
        accounts.map(
            async (account) =>
                (await supra.transaction.signTransaction({
                    senderAccount: account,
                    rawTxn: target,
                })) as TxnBuilderTypes.AccountAuthenticatorEd25519,
        ),
    );
    const roles = fixture.signers.map((signer) => signer.role);
    const senderAuthenticator = authenticators[roles.indexOf("sender")];
    if (senderAuthenticator === undefined) {
        throw new Error(`Fixture ${fixture.name} has no sender signer`);
    }
    const secondaryIndexes = roles.flatMap((role, index) => (role === "secondary" ? [index] : []));
    const secondaryAddresses = secondaryIndexes.map((index) => addressOf(accounts[index] as SupraAccount));
    const secondaryAuthenticators = secondaryIndexes.map(
        (index) => authenticators[index] as TxnBuilderTypes.AccountAuthenticatorEd25519,
    );

    if (fixture.authenticator === "multi_agent") {
        return new TxnBuilderTypes.SignedTransaction(
            rawTxn,
            new TxnBuilderTypes.TransactionAuthenticatorMultiAgent(
                senderAuthenticator,
                secondaryAddresses,
                secondaryAuthenticators,
            ),
        );
    }

    const feePayerIndex = roles.indexOf("fee_payer");
    const feePayerAuthenticator = authenticators[feePayerIndex];
    if (feePayerAuthenticator === undefined) {
        throw new Error(`Fixture ${fixture.name} has no fee payer signer`);
    }
    return new TxnBuilderTypes.SignedTransaction(
        rawTxn,
        new TxnBuilderTypes.TransactionAuthenticatorFeePayer(
            senderAuthenticator,
            secondaryAddresses,
            secondaryAuthenticators,
            {
                address: addressOf(accounts[feePayerIndex] as SupraAccount),
                authenticator: feePayerAuthenticator,
            },
        ),
    );
}

function signatureHex(signed: HexString | TxnBuilderTypes.AccountAuthenticatorEd25519): string {
    return signed instanceof HexString ? hex(signed.toUint8Array()) : hex(signed.signature.value);
}

describe("fixtures recorded from a Supra node", () => {
    test("the fixture file has the expected schema and covers every authenticator kind", () => {
        expect(fixtureFile.schema).toBe(1);
        const authenticators = new Set(fixtureFile.cases.map((fixture) => fixture.authenticator));
        expect([...authenticators].sort()).toEqual(["ed25519", "fee_payer", "multi_agent"]);
        const payloads = new Set(fixtureFile.cases.map((fixture) => fixture.raw.payload.type));
        expect([...payloads].sort()).toEqual(["automation_registration", "entry_function", "multisig", "script"]);
    });

    describe.each(fixtureFile.cases.map((fixture) => [fixture.name, fixture] as const))("%s", (_name, fixture) => {
        const accounts = fixture.signers.map(accountOf);
        const rawTxn = buildRawTransaction(fixture);
        const target = signingTarget(fixture, rawTxn, accounts);

        test("each signer's seed derives the recorded address and public key", () => {
            fixture.signers.forEach((signer, index) => {
                const account = accounts[index] as SupraAccount;
                expect(account.address().toString()).toBe(signer.address);
                expect(hex(account.pubKey().toUint8Array())).toBe(signer.publicKey);
            });
            expect(fixture.signers[0]?.address).toBe(fixture.raw.sender);
        });

        test("the BCS of the raw transaction is the recorded bytes", () => {
            expect(hex(BCS.bcsToBytes(rawTxn))).toBe(fixture.expected.rawTransactionBcs);
        });

        test("the raw transaction deserializes from the recorded bytes and serializes back to them", () => {
            const recorded = bytes(fixture.expected.rawTransactionBcs);
            const parsed = TxnBuilderTypes.RawTransaction.deserialize(new BCS.Deserializer(recorded));
            expect(hex(BCS.bcsToBytes(parsed))).toBe(fixture.expected.rawTransactionBcs);
            expect(parsed.chain_id.value).toBe(fixture.chainId);
            expect(parsed.sequence_number).toBe(BigInt(fixture.raw.sequenceNumber));
            expect(parsed.max_gas_amount).toBe(BigInt(fixture.raw.maxGasAmount));
            expect(parsed.gas_unit_price).toBe(BigInt(fixture.raw.gasUnitPrice));
            expect(parsed.expiration_timestamp_secs).toBe(BigInt(fixture.raw.expirationTimestampSecs));
        });

        test("the signing message is the recorded bytes", () => {
            const message = supra.transaction.getTransactionSignatureMessage({ rawTxn: target });
            expect(hex(message)).toBe(fixture.expected.signingMessage);
        });

        test("each signature is the recorded bytes", async () => {
            const signatures = await Promise.all(
                accounts.map(async (account) =>
                    signatureHex(await supra.transaction.signTransaction({ senderAccount: account, rawTxn: target })),
                ),
            );
            expect(signatures).toEqual(fixture.expected.signatures);
        });

        test("the BCS of the signed transaction is the recorded bytes", async () => {
            const signed = await signedTransaction(fixture, rawTxn, accounts, target);
            expect(hex(BCS.bcsToBytes(signed))).toBe(fixture.expected.signedTransactionBcs);
        });

        test("the transaction hash is the recorded hash", async () => {
            const signed = await signedTransaction(fixture, rawTxn, accounts, target);
            expect(supra.transaction.deriveTransactionHash({ signedTransaction: signed })).toBe(
                `0x${fixture.expected.transactionHash}`,
            );
        });

        test("every recorded value states its provenance", () => {
            for (const key of [
                "inputs",
                "rawTransactionBcs",
                "signingMessage",
                "signatures",
                "signedTransactionBcs",
                "transactionHash",
            ]) {
                expect(["node", "node-verified", "specification"]).toContain(fixture.provenance[key]);
            }
        });
    });
});
