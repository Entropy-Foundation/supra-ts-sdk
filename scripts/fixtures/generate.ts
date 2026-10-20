/**
 * Records transaction fixtures from a Supra node.
 *
 * Usage:
 *
 *   node scripts/fixtures/generate.ts --cli <supra> --rpc <url> --out <file> \
 *       [--also-cli <supra> --also-rpc <url>]
 *
 * `--cli` is a Supra node CLI binary and `--rpc` the RPC service of a localnet that serves a faucet.
 * `--also-cli` and `--also-rpc` name a second node (another release) against which every recorded
 * transaction is submitted again; the run fails when the second node reports a different hash or
 * signature. The tool runs TypeScript directly, so it needs Node 22.18 or later, and it imports the
 * built SDK: run `pnpm build` first. Details are in `scripts/fixtures/README.md`.
 */
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { BCS, SupraAccount, SupraClient, TxnBuilderTypes, TypeTagParser } from "../../dist/index.js";

const PASSWORD = "fixture-profile-password";
const GAS_PRICE = 100_000n;
const MAX_GAS = 20_000n;
const EXPIRATION_SECS = 600;

/** `script { fun main(sender: &signer, amount: u64) }`: SUPRA from the sender to the sender. */
const SELF_TRANSFER_SCRIPT =
    "a11ceb0b060000000501000403040a050e0f071d29084620000000010002020300010304010002060c030001060c010503060c0503067369676e65720d73757072615f6163636f756e740a616464726573735f6f66087472616e736665720000000000000000000000000000000000000000000000000000000000000001000001060a000b0011000b01110102";

/**
 * `script { fun main(first: &signer, second: &signer, amount: u64) }`: SUPRA from the first signer to
 * the second.
 */
const TWO_SIGNER_SCRIPT =
    "a11ceb0b060000000501000403040a050e11071f29084820000000010002020300010304010003060c060c030001060c010503060c0503067369676e65720d73757072615f6163636f756e740a616464726573735f6f66087472616e736665720000000000000000000000000000000000000000000000000000000000000001000001060b000b0111000b02110102";

type Provenance = "node" | "node-verified" | "specification";

interface Signer {
    role: "sender" | "secondary" | "fee_payer";
    seed: string;
    address: string;
    publicKey: string;
}

interface FixtureRaw {
    sender: string;
    sequenceNumber: string;
    maxGasAmount: string;
    gasUnitPrice: string;
    expirationTimestampSecs: string;
    payload: Record<string, unknown> & { type: string };
}

interface Fixture {
    name: string;
    description: string;
    authenticator: "ed25519" | "multi_agent" | "fee_payer";
    chainId: number;
    signers: Signer[];
    raw: FixtureRaw;
    expected: {
        rawTransactionBcs: string;
        signingMessage: string;
        signatures: string[];
        signedTransactionBcs: string;
        transactionHash: string;
    };
    provenance: Record<string, Provenance>;
}

interface Node {
    label: string;
    cli: string;
    rpc: string;
    home: string;
    chainId: number;
    version: string;
    client: SupraClient;
}

interface NodeTransaction {
    hash: string;
    status: string;
    authenticator: { Move: Record<string, unknown> };
    header: {
        chain_id: number;
        sender: { Move: string };
        sequence_number: number | string;
        gas_unit_price: number | string;
        max_gas_amount: number | string;
        expiration_timestamp: { microseconds_since_unix_epoch: number | string };
    };
    output: { Move: { vm_status: string; events: Array<{ type: string; data: Record<string, unknown> }> } };
}

function fail(message: string): never {
    throw new Error(message);
}

function hex(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString("hex");
}

function bare(value: string): string {
    return value.replace(/^0x/, "");
}

function seedFor(runId: string, label: string): string {
    return createHash("sha256").update(`supra-ts-sdk fixture ${runId} ${label}`).digest("hex");
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function signerOf(role: Signer["role"], seed: string): Signer {
    const account = new SupraAccount(new Uint8Array(Buffer.from(seed, "hex")));
    return {
        role,
        seed,
        address: account.address().toString(),
        publicKey: hex(account.pubKey().toUint8Array()),
    };
}

function accountOf(signer: Signer): SupraAccount {
    return new SupraAccount(new Uint8Array(Buffer.from(signer.seed, "hex")));
}

function runCli(node: Node, args: string[], env: Record<string, string> = {}): string {
    const result = spawnSync(node.cli, args, {
        encoding: "utf8",
        env: { ...process.env, CLI_PROFILE_PASSWORD: PASSWORD, ...env },
        maxBuffer: 64 * 1024 * 1024,
    });
    if (result.status !== 0) {
        fail(`${node.cli} ${args.join(" ")} exited with ${result.status}: ${result.stderr.slice(0, 2000)}`);
    }
    return result.stdout;
}

async function connect(label: string, cli: string, rpc: string): Promise<Node> {
    const chainId = Number(await (await fetch(`${rpc}/rpc/v3/transactions/chain_id`)).json());
    const versionOutput = runCliVersion(cli);
    return {
        label,
        cli,
        rpc,
        home: mkdtempSync(join(tmpdir(), `supra-fixtures-${label}-`)),
        chainId,
        version: versionOutput,
        client: new SupraClient({ rpcUrl: rpc, chainId }),
    };
}

function runCliVersion(cli: string): string {
    const result = spawnSync(cli, ["--version"], { encoding: "utf8" });
    const tag = /tag:(\S+)/.exec(result.stdout)?.[1];
    const commit = /commit_hash:(\S+)/.exec(result.stdout)?.[1];
    return `${tag ?? "unknown"} (${commit ?? "unknown"})`;
}

async function fund(node: Node, address: string): Promise<void> {
    const response = await fetch(`${node.rpc}/rpc/v1/wallet/faucet/${address}`);
    if (!response.ok) {
        fail(`Faucet request on ${node.label} returned HTTP ${response.status}`);
    }
    for (let attempt = 0; attempt < 120; attempt++) {
        const resource = await fetch(
            `${node.rpc}/rpc/v3/accounts/${address}/resources/0x1::coin::CoinStore<0x1::supra_coin::SupraCoin>`,
        );
        if (resource.ok) {
            return;
        }
        await sleep(500);
    }
    fail(`Account ${address} was not funded on ${node.label}`);
}

function profileName(signer: Signer): string {
    return `p${signer.address.slice(2, 12)}`;
}

function createProfile(node: Node, signer: Signer): void {
    runCli(
        node,
        [
            "profile",
            "new",
            profileName(signer),
            "--supra-home",
            node.home,
            "--rpc-url",
            node.rpc,
            "--chain-id",
            String(node.chainId),
            "--faucet-url",
            node.rpc,
            "--account-address",
            signer.address,
            "--accept-defaults",
        ],
        { CLI_PROFILE_ACCOUNT_KEY: signer.seed, CLI_PROFILE_AUTHENTICATION_KEY: signer.seed },
    );
}

/**
 * Runs a transaction command of the CLI as `signer` and returns the node's report of the transaction.
 * `subcommand` holds the arguments of a nested subcommand, which follow the common options.
 */
function cliTransaction(node: Node, signer: Signer, command: string[], subcommand: string[] = []): NodeTransaction {
    const stdout = runCli(node, [
        ...command,
        "--supra-home",
        node.home,
        "--profile",
        profileName(signer),
        "--max-gas",
        String(MAX_GAS),
        "--gas-unit-price",
        String(GAS_PRICE),
        "--expiration-secs",
        String(EXPIRATION_SECS),
        "--accept-defaults",
        "--stdout",
        "json",
        ...subcommand,
    ]);
    const parsed = JSON.parse(stdout) as { MoveToolResult: { TransactionInfo: NodeTransaction } };
    const transaction = parsed.MoveToolResult.TransactionInfo;
    if (transaction.status !== "Success") {
        fail(`${command.join(" ")} finished with status ${transaction.status}: ${transaction.output.Move.vm_status}`);
    }
    return transaction;
}

async function fetchTransaction(node: Node, hash: string): Promise<NodeTransaction> {
    for (let attempt = 0; attempt < 120; attempt++) {
        const response = await fetch(`${node.rpc}/rpc/v3/transactions/${hash}`);
        if (response.ok) {
            const transaction = (await response.json()) as NodeTransaction;
            if (transaction.status !== "Pending") {
                return transaction;
            }
        }
        await sleep(500);
    }
    return fail(`Transaction ${hash} did not commit on a node`);
}

function addressArgument(address: string): string {
    return hex(TxnBuilderTypes.AccountAddress.fromHex(address).address);
}

function u64Argument(value: bigint): string {
    return hex(BCS.bcsSerializeUint64(value));
}

function typeTags(types: string[]): TxnBuilderTypes.TypeTag[] {
    return types.map((type) => new TypeTagParser(type).parseTypeTag());
}

/** The raw transaction of a fixture's inputs, built with the SDK. */
function buildRawTransaction(node: Node, raw: FixtureRaw) {
    const common = {
        senderAddress: raw.sender,
        senderSequenceNumber: BigInt(raw.sequenceNumber),
        optionalTransactionPayloadArgs: {
            maxGas: BigInt(raw.maxGasAmount),
            gasUnitPrice: BigInt(raw.gasUnitPrice),
            txExpiryTime: BigInt(raw.expirationTimestampSecs),
        },
    };
    const bytes = (value: string) => new Uint8Array(Buffer.from(value, "hex"));
    const payload: Record<string, unknown> = raw.payload;
    const strings = (key: string): string[] => payload[key] as string[];

    switch (raw.payload.type) {
        case "entry_function":
            return node.client.transaction.build.rawTxnObject({
                ...common,
                function: payload["function"] as `${string}::${string}::${string}`,
                functionTypeArgs: typeTags(strings("typeArguments")),
                functionArgs: strings("arguments").map(bytes),
            });
        case "script": {
            const scriptArguments = payload["arguments"] as Array<{ type: string; value: string }>;
            return node.client.transaction.build.scriptRawTxnObject({
                ...common,
                scriptCode: bytes(payload["code"] as string),
                scriptTypeArgs: typeTags(strings("typeArguments")),
                scriptArgs: scriptArguments.map((argument) => {
                    if (argument.type !== "u64") {
                        fail(`The generator builds only u64 script arguments, not ${argument.type}`);
                    }
                    return new TxnBuilderTypes.TransactionArgumentU64(BigInt(argument.value));
                }),
            });
        }
        case "multisig":
            return node.client.transaction.build.multisigRawTxnObject({
                ...common,
                multisigAddress: payload["multisigAddress"] as string,
                function: payload["function"] as `${string}::${string}::${string}`,
                functionTypeArgs: typeTags(strings("typeArguments")),
                functionArgs: strings("arguments").map(bytes),
            });
        case "automation_registration":
            return node.client.transaction.build.automationRegistrationRawTxnObject({
                ...common,
                function: payload["function"] as `${string}::${string}::${string}`,
                functionTypeArgs: typeTags(strings("typeArguments")),
                functionArgs: strings("arguments").map(bytes),
                automationMaxGasAmount: BigInt(payload["maxGasAmount"] as string),
                automationGasPriceCap: BigInt(payload["gasPriceCap"] as string),
                automationFeeCapForEpoch: BigInt(payload["feeCapForEpoch"] as string),
                automationExpirationTimestampSecs: BigInt(payload["expirationTimestampSecs"] as string),
                automationAuxData: strings("auxData").map(bytes),
            });
        default:
            return fail(`Unknown payload type ${raw.payload.type}`);
    }
}

function rawFromNode(transaction: NodeTransaction, payload: FixtureRaw["payload"]): FixtureRaw {
    const { header } = transaction;
    return {
        sender: header.sender.Move,
        sequenceNumber: String(header.sequence_number),
        maxGasAmount: String(header.max_gas_amount),
        gasUnitPrice: String(header.gas_unit_price),
        expirationTimestampSecs: String(BigInt(header.expiration_timestamp.microseconds_since_unix_epoch) / 1_000_000n),
        payload,
    };
}

function nodeSignature(transaction: NodeTransaction): string {
    const ed25519 = transaction.authenticator.Move["Ed25519"] as { signature: string } | undefined;
    if (ed25519 === undefined) {
        fail("The node reports an authenticator that is not Ed25519");
    }
    return bare(ed25519.signature);
}

/**
 * Completes a fixture recorded from a single-signer transaction the CLI signed: the derived values are
 * computed with the SDK, and the run fails unless they agree with what the node reported.
 */
function completeEd25519Fixture(
    node: Node,
    partial: Pick<Fixture, "name" | "description" | "signers">,
    transaction: NodeTransaction,
    payload: FixtureRaw["payload"],
): Fixture {
    const raw = rawFromNode(transaction, payload);
    const signer = partial.signers[0] ?? fail("A fixture needs a signer");
    const account = accountOf(signer);
    if (raw.sender !== signer.address) {
        fail(`${partial.name}: the node reports sender ${raw.sender}, expected ${signer.address}`);
    }

    const rawTxn = buildRawTransaction(node, raw);
    const signingMessage = node.client.transaction.getTransactionSignatureMessage({ rawTxn });
    const sdkSignature = hex(
        (
            node.client.transaction.signTransaction({ senderAccount: account, rawTxn }) as {
                toUint8Array(): Uint8Array;
            }
        ).toUint8Array(),
    );
    const signed = rawTxn.signedTransaction(account);
    const signedBcs = hex(BCS.bcsToBytes(signed));
    const hash = bare(node.client.transaction.deriveTransactionHash({ signedTransaction: signed }));

    if (sdkSignature !== nodeSignature(transaction)) {
        fail(
            `${partial.name}: the SDK signature differs from the node's: ${sdkSignature} vs ${nodeSignature(transaction)}`,
        );
    }
    if (hash !== bare(transaction.hash)) {
        fail(`${partial.name}: the SDK transaction hash ${hash} differs from the node's ${transaction.hash}`);
    }

    return {
        ...partial,
        authenticator: "ed25519",
        chainId: node.chainId,
        raw,
        expected: {
            rawTransactionBcs: hex(BCS.bcsToBytes(rawTxn)),
            signingMessage: hex(signingMessage),
            signatures: [nodeSignature(transaction)],
            signedTransactionBcs: signedBcs,
            transactionHash: bare(transaction.hash),
        },
        provenance: {
            inputs: "node",
            rawTransactionBcs: "specification",
            signingMessage: "specification",
            signatures: "node",
            signedTransactionBcs: "specification",
            transactionHash: "node",
        },
    };
}

async function newSigner(node: Node, runId: string, label: string, role: Signer["role"] = "sender"): Promise<Signer> {
    const signer = signerOf(role, seedFor(runId, label));
    await fund(node, signer.address);
    return signer;
}

async function entryFunctionFixtures(node: Node, runId: string): Promise<Fixture[]> {
    const fixtures: Fixture[] = [];
    const receiver = signerOf("secondary", seedFor(runId, "receiver")).address;

    const plain = signerOf("sender", seedFor(runId, "entry_function_ed25519"));
    await fund(node, plain.address);
    createProfile(node, plain);
    const plainTransaction = cliTransaction(node, plain, [
        "move",
        "tool",
        "run",
        "--function-id",
        "0x1::supra_account::transfer",
        "--args",
        `address:${receiver}`,
        "u64:12345",
    ]);
    fixtures.push(
        completeEd25519Fixture(
            node,
            {
                name: "entry_function_ed25519",
                description: "0x1::supra_account::transfer without type arguments, signed with one Ed25519 key.",
                signers: [plain],
            },
            plainTransaction,
            {
                type: "entry_function",
                function: "0x1::supra_account::transfer",
                typeArguments: [],
                arguments: [addressArgument(receiver), u64Argument(12345n)],
            },
        ),
    );

    const generic = signerOf("sender", seedFor(runId, "entry_function_type_arguments"));
    await fund(node, generic.address);
    createProfile(node, generic);
    const genericTransaction = cliTransaction(node, generic, [
        "move",
        "tool",
        "run",
        "--function-id",
        "0x1::supra_account::transfer_coins",
        "--type-args",
        "0x1::supra_coin::SupraCoin",
        "--args",
        `address:${receiver}`,
        "u64:6789",
    ]);
    fixtures.push(
        completeEd25519Fixture(
            node,
            {
                name: "entry_function_type_arguments",
                description: "0x1::supra_account::transfer_coins with a struct type argument.",
                signers: [generic],
            },
            genericTransaction,
            {
                type: "entry_function",
                function: "0x1::supra_account::transfer_coins",
                typeArguments: ["0x1::supra_coin::SupraCoin"],
                arguments: [addressArgument(receiver), u64Argument(6789n)],
            },
        ),
    );
    return fixtures;
}

async function scriptFixture(node: Node, runId: string): Promise<Fixture> {
    const signer = signerOf("sender", seedFor(runId, "script_ed25519"));
    await fund(node, signer.address);
    createProfile(node, signer);
    const scriptFile = join(node.home, "self_transfer.mv");
    writeFileSync(scriptFile, Buffer.from(SELF_TRANSFER_SCRIPT, "hex"));
    const transaction = cliTransaction(node, signer, [
        "move",
        "tool",
        "run-script",
        "--compiled-script-path",
        scriptFile,
        "--args",
        "u64:1000",
    ]);
    return completeEd25519Fixture(
        node,
        {
            name: "script_ed25519",
            description: "A script with a u64 argument, signed with one Ed25519 key.",
            signers: [signer],
        },
        transaction,
        {
            type: "script",
            code: SELF_TRANSFER_SCRIPT,
            typeArguments: [],
            arguments: [{ type: "u64", value: "1000" }],
        },
    );
}

/** Creates a multisig account owned by `signer` and requiring one signature, and returns its address. */
async function createMultisig(node: Node, signer: Signer): Promise<string> {
    // The framework reports the address the owner's next multisig account will have.
    const response = await fetch(`${node.rpc}/rpc/v3/view`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            function: "0x1::multisig_account::get_next_multisig_account_address",
            type_arguments: [],
            arguments: [signer.address],
        }),
    });
    const address = ((await response.json()) as { result: string[] }).result[0] ?? fail("The view returned no address");
    cliTransaction(node, signer, [
        "move",
        "multisig",
        "create",
        "--timeout-duration",
        "3600",
        "--num-signatures-required",
        "1",
    ]);
    return address;
}

/**
 * Creates a multisig account owned by `signer`, funds it, and proposes the transfer that the fixture
 * then executes. The proposal is created at the sender's sequence number 1 and the execution is
 * sequence number 2. Returns the multisig account address.
 */
async function prepareMultisig(node: Node, signer: Signer, receiver: string): Promise<string> {
    const multisigAddress = await createMultisig(node, signer);
    // The multisig account has to hold the SUPRA it transfers.
    await fund(node, multisigAddress);
    cliTransaction(
        node,
        signer,
        ["move", "multisig", "create-transaction", "--multisig-address", multisigAddress],
        [
            "entry-function",
            "--function-id",
            "0x1::supra_account::transfer",
            "--args",
            `address:${receiver}`,
            "u64:4321",
        ],
    );
    return multisigAddress;
}

async function multisigFixture(node: Node, runId: string): Promise<Fixture> {
    const signer = signerOf("sender", seedFor(runId, "multisig_ed25519"));
    const receiver = signerOf("secondary", seedFor(runId, "receiver")).address;
    await fund(node, signer.address);
    createProfile(node, signer);
    const multisigAddress = await prepareMultisig(node, signer, receiver);
    const transaction = cliTransaction(
        node,
        signer,
        ["move", "multisig", "execute-with-payload", "--multisig-address", multisigAddress],
        [
            "entry-function",
            "--function-id",
            "0x1::supra_account::transfer",
            "--args",
            `address:${receiver}`,
            "u64:4321",
        ],
    );
    return completeEd25519Fixture(
        node,
        {
            name: "multisig_ed25519",
            description: "A multisig transaction that carries its entry function payload, sent by an owner.",
            signers: [signer],
        },
        transaction,
        {
            type: "multisig",
            multisigAddress,
            function: "0x1::supra_account::transfer",
            typeArguments: [],
            arguments: [addressArgument(receiver), u64Argument(4321n)],
        },
    );
}

async function automationFixture(node: Node, runId: string): Promise<Fixture> {
    const signer = signerOf("sender", seedFor(runId, "automation_registration_ed25519"));
    const receiver = signerOf("secondary", seedFor(runId, "receiver")).address;
    await fund(node, signer.address);
    createProfile(node, signer);
    const expiry = Math.floor(Date.now() / 1000) + 2 * 60 * 60;
    const transaction = cliTransaction(node, signer, [
        "move",
        "automation",
        "register",
        "--function-id",
        "0x1::supra_account::transfer",
        "--args",
        `address:${receiver}`,
        "u64:1000",
        "--task-max-gas-amount",
        "500",
        "--task-gas-price-cap",
        "200000",
        "--task-expiry-time-secs",
        String(expiry),
        "--task-automation-fee-cap",
        "1000000000",
    ]);
    return completeEd25519Fixture(
        node,
        {
            name: "automation_registration_ed25519",
            description: "The registration of an automation task, signed with one Ed25519 key.",
            signers: [signer],
        },
        transaction,
        {
            type: "automation_registration",
            function: "0x1::supra_account::transfer",
            typeArguments: [],
            arguments: [addressArgument(receiver), u64Argument(1000n)],
            maxGasAmount: "500",
            gasPriceCap: "200000",
            feeCapForEpoch: "1000000000",
            expirationTimestampSecs: String(expiry),
            auxData: [],
        },
    );
}

/**
 * Multi-agent and fee payer transactions are not built by the node CLI. The SDK signs them and submits
 * them; the fixture records the node's hash and the signatures the node accepted.
 */
async function sdkSignedFixture(node: Node, runId: string, kind: "multi_agent" | "fee_payer"): Promise<Fixture> {
    const sender = await newSigner(node, runId, `${kind}_sender`);
    const secondary = signerOf("secondary", seedFor(runId, `${kind}_secondary`));
    const feePayer = signerOf("fee_payer", seedFor(runId, `${kind}_fee_payer`));
    const signers = kind === "multi_agent" ? [sender, secondary] : [sender, feePayer];
    await Promise.all(signers.slice(1).map((signer) => fund(node, signer.address)));

    const payload: FixtureRaw["payload"] =
        kind === "multi_agent"
            ? {
                  type: "script",
                  code: TWO_SIGNER_SCRIPT,
                  typeArguments: [],
                  arguments: [{ type: "u64", value: "2500" }],
              }
            : {
                  type: "entry_function",
                  function: "0x1::supra_account::transfer",
                  typeArguments: [],
                  arguments: [addressArgument(secondary.address), u64Argument(2500n)],
              };
    const raw: FixtureRaw = {
        sender: sender.address,
        sequenceNumber: "0",
        maxGasAmount: String(MAX_GAS),
        gasUnitPrice: String(GAS_PRICE),
        expirationTimestampSecs: String(Math.floor(Date.now() / 1000) + EXPIRATION_SECS),
        payload,
    };

    const outcome = await submitSdkSigned(node, kind, signers, raw);
    const rawTxn = buildRawTransaction(node, raw);
    const target = signingTarget(kind, rawTxn, signers);
    const signingMessage = node.client.transaction.getTransactionSignatureMessage({ rawTxn: target });

    return {
        name: kind === "multi_agent" ? "multi_agent_script" : "fee_payer_entry_function",
        description:
            kind === "multi_agent"
                ? "A script with two signers: the sender and one secondary signer."
                : "An entry function whose gas is paid by a fee payer.",
        authenticator: kind,
        chainId: node.chainId,
        signers,
        raw,
        expected: {
            rawTransactionBcs: hex(BCS.bcsToBytes(rawTxn)),
            signingMessage: hex(signingMessage),
            signatures: outcome.signatures,
            signedTransactionBcs: outcome.signedBcs,
            transactionHash: outcome.hash,
        },
        provenance: {
            inputs: "specification",
            rawTransactionBcs: "specification",
            signingMessage: "specification",
            signatures: "node-verified",
            signedTransactionBcs: "specification",
            transactionHash: "node",
        },
    };
}

function addressOf(signer: Signer): TxnBuilderTypes.AccountAddress {
    return TxnBuilderTypes.AccountAddress.fromHex(signer.address);
}

function signingTarget(
    kind: "multi_agent" | "fee_payer",
    rawTxn: TxnBuilderTypes.RawTransaction,
    signers: Signer[],
): TxnBuilderTypes.MultiAgentRawTransaction | TxnBuilderTypes.FeePayerRawTransaction {
    if (kind === "multi_agent") {
        return new TxnBuilderTypes.MultiAgentRawTransaction(
            rawTxn,
            signers.filter((signer) => signer.role === "secondary").map(addressOf),
        );
    }
    const feePayer = signers.find((signer) => signer.role === "fee_payer") ?? fail("No fee payer signer");
    return new TxnBuilderTypes.FeePayerRawTransaction(
        rawTxn,
        signers.filter((signer) => signer.role === "secondary").map(addressOf),
        addressOf(feePayer),
    );
}

interface SdkSignedOutcome {
    hash: string;
    signatures: string[];
    signedBcs: string;
}

/** Signs a multi-agent or fee payer transaction with the SDK, submits it, and reads back what the node reports. */
async function submitSdkSigned(
    node: Node,
    kind: "multi_agent" | "fee_payer",
    signers: Signer[],
    raw: FixtureRaw,
): Promise<SdkSignedOutcome> {
    const rawTxn = buildRawTransaction(node, raw);
    const target = signingTarget(kind, rawTxn, signers);
    const authenticators = signers.map(
        (signer) =>
            node.client.transaction.signTransaction({
                senderAccount: accountOf(signer),
                rawTxn: target,
            }) as TxnBuilderTypes.AccountAuthenticatorEd25519,
    );
    const [senderAuthenticator, secondaryAuthenticator] = authenticators as [
        TxnBuilderTypes.AccountAuthenticatorEd25519,
        TxnBuilderTypes.AccountAuthenticatorEd25519,
    ];
    const secondaries = signers.filter((signer) => signer.role === "secondary");

    let response;
    let authenticator: TxnBuilderTypes.TransactionAuthenticator;
    if (kind === "multi_agent") {
        response = await rawTxn.submitMultiAgentTransaction({
            secondarySignersAccountAddress: secondaries.map((signer) => signer.address),
            senderAuthenticator,
            secondarySignersAuthenticator: [secondaryAuthenticator],
            enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true },
        });
        authenticator = new TxnBuilderTypes.TransactionAuthenticatorMultiAgent(
            senderAuthenticator,
            secondaries.map(addressOf),
            [secondaryAuthenticator],
        );
    } else {
        const feePayer = signers.find((signer) => signer.role === "fee_payer") ?? fail("No fee payer signer");
        response = await rawTxn.submitSponsorTransaction({
            feePayerAddress: feePayer.address,
            secondarySignersAccountAddress: [],
            senderAuthenticator,
            feePayerAuthenticator: secondaryAuthenticator,
            secondarySignersAuthenticator: [],
            enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true },
        });
        authenticator = new TxnBuilderTypes.TransactionAuthenticatorFeePayer(senderAuthenticator, [], [], {
            address: addressOf(feePayer),
            authenticator: secondaryAuthenticator,
        });
    }

    if (response.status !== "Success") {
        fail(`The ${kind} transaction finished with status ${String(response.status)}`);
    }
    const signed = new TxnBuilderTypes.SignedTransaction(rawTxn, authenticator);
    const derived = bare(node.client.transaction.deriveTransactionHash({ signedTransaction: signed }));
    if (derived !== bare(response.hash)) {
        fail(`${kind}: the SDK hash ${derived} differs from the node's ${response.hash}`);
    }
    return {
        hash: derived,
        signatures: authenticators.map((signed) => hex(signed.signature.value)),
        signedBcs: hex(BCS.bcsToBytes(signed)),
    };
}

/**
 * Submits the transaction of `fixture` to `other` and fails unless that node reports the same hash and
 * signature. Single-signer transactions are signed by the SDK; the account is funded on `other` first,
 * and a multisig account is created there by the same owner at the same sequence number.
 */
async function crossCheck(other: Node, runId: string, fixture: Fixture): Promise<void> {
    for (const signer of fixture.signers) {
        await fund(other, signer.address);
    }

    if (fixture.authenticator !== "ed25519") {
        const kind = fixture.authenticator;
        const outcome = await submitSdkSigned(other, kind, fixture.signers, fixture.raw);
        if (outcome.hash !== fixture.expected.transactionHash) {
            fail(
                `${fixture.name}: ${other.label} reports hash ${outcome.hash}, expected ${fixture.expected.transactionHash}`,
            );
        }
        return;
    }

    const signer = fixture.signers[0] ?? fail("A fixture needs a signer");
    if (fixture.raw.payload.type === "multisig") {
        createProfile(other, signer);
        const receiver = `0x${(fixture.raw.payload["arguments"] as string[])[0] ?? ""}`;
        const address = await prepareMultisig(other, signer, receiver);
        if (address !== fixture.raw.payload["multisigAddress"]) {
            fail(`${fixture.name}: ${other.label} created multisig account ${address}`);
        }
    }
    if (fixture.raw.payload.type === "automation_registration" || fixture.raw.payload.type === "multisig") {
        // Registration and execution need the sender's sequence number to match the fixture.
        const info = await other.client.account.getAccountInfo({ accountAddress: signer.address });
        if (BigInt(info.sequence_number) !== BigInt(fixture.raw.sequenceNumber)) {
            fail(`${fixture.name}: the sequence number on ${other.label} is ${info.sequence_number}`);
        }
    }

    const rawTxn = buildRawTransaction(other, fixture.raw);
    const response = await rawTxn.submitTransaction({
        senderAccount: accountOf(signer),
        enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true },
    });
    if (response.status !== "Success") {
        fail(`${fixture.name}: ${other.label} finished with status ${String(response.status)}`);
    }
    const committed = await fetchTransaction(other, response.hash);
    if (bare(committed.hash) !== fixture.expected.transactionHash) {
        fail(
            `${fixture.name}: ${other.label} reports hash ${committed.hash}, expected ${fixture.expected.transactionHash}`,
        );
    }
    if (nodeSignature(committed) !== fixture.expected.signatures[0]) {
        fail(`${fixture.name}: ${other.label} reports a different signature`);
    }
}

async function main(): Promise<void> {
    const { values } = parseArgs({
        options: {
            cli: { type: "string" },
            rpc: { type: "string" },
            out: { type: "string" },
            "also-cli": { type: "string" },
            "also-rpc": { type: "string" },
            "run-id": { type: "string" },
        },
    });
    const { cli, rpc, out } = values;
    if (cli === undefined || rpc === undefined || out === undefined) {
        fail("Usage: generate.ts --cli <supra> --rpc <url> --out <file> [--also-cli <supra> --also-rpc <url>]");
    }
    const runId = values["run-id"] ?? randomBytes(8).toString("hex");

    const primary = await connect("primary", cli, rpc.replace(/\/+$/, ""));
    const alsoCli = values["also-cli"];
    const alsoRpc = values["also-rpc"];
    const secondary =
        alsoCli !== undefined && alsoRpc !== undefined
            ? await connect("secondary", alsoCli, alsoRpc.replace(/\/+$/, ""))
            : undefined;
    if (secondary !== undefined && secondary.chainId !== primary.chainId) {
        fail("The two nodes have different chain IDs, so their signatures cannot be compared");
    }

    const fixtures: Fixture[] = [
        ...(await entryFunctionFixtures(primary, runId)),
        await scriptFixture(primary, runId),
        await multisigFixture(primary, runId),
        await automationFixture(primary, runId),
        await sdkSignedFixture(primary, runId, "multi_agent"),
        await sdkSignedFixture(primary, runId, "fee_payer"),
    ];

    if (secondary !== undefined) {
        for (const fixture of fixtures) {
            await crossCheck(secondary, runId, fixture);
            process.stdout.write(`${fixture.name}: identical on ${secondary.version}\n`);
        }
    }

    const file = {
        schema: 1,
        generatedWith: {
            node: primary.version,
            crossCheckedAgainst: secondary?.version ?? null,
            chainId: primary.chainId,
        },
        cases: fixtures,
    };
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`);
    process.stdout.write(`Wrote ${fixtures.length} fixtures to ${out}\n`);
}

main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
});
