import { BCS, SupraAccount, TxnBuilderTypes } from "supra-l1-sdk-core";
import { MockNode } from "./helpers/mockNode";
import { ClientClock, newClient } from "./helpers/transfers";
import type { SupraClient } from "../../../api/supraClient";
import { addressToBytes } from "../../../helper/account";
import { multisigRawTxnObjectInternal, rawTxnObjectInnerInternal } from "../txnBuild";
import { buildAndSubmitInternal } from "../txnSubmit";

/**
 * A transaction can have a form that the node simulates and another that is sent (an execution of a multisig proposal
 * without a payload is simulated with the stored payload). The simulation before submission, including the ones after
 * the transaction is signed again with a lower sequence number, simulates the simulation form; the transaction that is
 * sent, its signature and its sequence number are those of the form that is sent.
 */

const HASH = "0x" + "ab".repeat(32);
const MULTISIG = "0x" + "0".repeat(60) + "beef";
const originalFetch = global.fetch;

interface Recorded {
    simulations: string[];
    submissions: string[];
}

let node: MockNode;
let recorded: Recorded;

beforeEach(() => {
    recorded = { simulations: [], submissions: [] };
});

afterEach(() => {
    node.stop();
    global.fetch = originalFetch;
});

/** A node answered from memory whose submissions are recorded and accepted with a fixed hash. */
function start(chain: number): void {
    node = new MockNode({ chain });
    global.fetch = ((input: string | URL | Request, init?: RequestInit) => {
        const path = new URL(String(input)).pathname.replace(/^\/rpc\/v3/, "");
        if ((init?.method ?? "GET") === "POST" && path === "/transactions/submit") {
            recorded.submissions.push(String(init?.body));
            return Promise.resolve(
                new Response(JSON.stringify(HASH), { status: 200, headers: { "Content-Type": "application/json" } }),
            );
        }
        if ((init?.method ?? "GET") === "POST" && path === "/transactions/simulate") {
            recorded.simulations.push(String(init?.body));
        }
        return node.fetch(input, init);
    }) as typeof fetch;
}

interface Body {
    Move: {
        raw_txn: {
            sequence_number: number;
            payload: { Multisig: { multisig_address: string; transaction_payload?: unknown } };
        };
        authenticator: { Ed25519: { signature: string } };
    };
}

const parsed = (body: string) => (JSON.parse(body) as Body).Move;

const storedPayload = new TxnBuilderTypes.MultiSigTransactionPayload(
    new TxnBuilderTypes.EntryFunction(
        TxnBuilderTypes.ModuleId.fromStr("0x1::supra_account"),
        new TxnBuilderTypes.Identifier("transfer"),
        [],
        [addressToBytes("0x2"), BCS.bcsSerializeUint64(5n)],
    ),
);

/** `buildAndSubmitInternal` of an execution that is sent without a payload and simulated with `storedPayload`. */
function execute(
    client: SupraClient,
    sender: SupraAccount,
    expiry: bigint,
    extra: { maxGas?: bigint; onSubmission?: (rawTxn: { sequence_number: bigint | number }) => void } = {},
): Promise<unknown> {
    const config = client.networkInformation;
    return buildAndSubmitInternal(
        {
            senderAccount: sender,
            buildRawTxn: (senderSequenceNumber, options) =>
                multisigRawTxnObjectInternal(
                    {
                        senderAddress: sender.address(),
                        senderSequenceNumber,
                        multisigAddress: MULTISIG,
                        optionalTransactionPayloadArgs: options,
                    },
                    config,
                ),
            buildEstimateRawTxn: (senderSequenceNumber, options) =>
                rawTxnObjectInnerInternal(
                    {
                        senderAddress: sender.address(),
                        senderSequenceNumber,
                        payload: new TxnBuilderTypes.TransactionPayloadMultisig(
                            new TxnBuilderTypes.MultiSig(
                                new TxnBuilderTypes.AccountAddress(addressToBytes(MULTISIG)),
                                storedPayload,
                            ),
                        ),
                        optionalTransactionPayloadArgs: options,
                    },
                    config,
                ),
            optionalTransactionArgs: {
                optionalTransactionPayloadArgs: {
                    ...("maxGas" in extra
                        ? extra.maxGas === undefined
                            ? {}
                            : { maxGas: extra.maxGas }
                        : { maxGas: 5_000n }),
                    gasUnitPrice: 100_000n,
                    txExpiryTime: expiry,
                },
                enableTransactionWaitAndSimulationArgs: { enableTransactionSimulation: true },
            },
            onSubmission: extra.onSubmission,
        },
        config,
    );
}

/** The signature of the execution without a payload with `sequenceNumber`, as a `0x`-prefixed hex string. */
async function expectedSignature(sender: SupraAccount, expiry: bigint, sequenceNumber: bigint): Promise<string> {
    const client = newClient();
    const signed = await client.transaction.build
        .multisigRawTxnObject({
            senderAddress: sender.address(),
            senderSequenceNumber: sequenceNumber,
            multisigAddress: MULTISIG,
            optionalTransactionPayloadArgs: { maxGas: 5_000n, gasUnitPrice: 100_000n, txExpiryTime: expiry },
        })
        .signedTransaction(sender);
    const authenticator = signed.authenticator as TxnBuilderTypes.TransactionAuthenticatorEd25519;
    return `0x${Buffer.from(authenticator.signature.value).toString("hex")}`;
}

describe("the simulation form of a transaction", () => {
    test("is simulated before the submission, and the form without a payload is sent", async () => {
        start(5);
        const sender = new SupraAccount();
        const expiry = BigInt(node.blockSeconds() + 500);

        await execute(newClient(), sender, expiry);

        expect(recorded.simulations).toHaveLength(1);
        const simulated = parsed(recorded.simulations[0] as string);
        expect(simulated.raw_txn.sequence_number).toBe(5);
        expect(simulated.raw_txn.payload.Multisig.transaction_payload).toBeDefined();
        expect(recorded.submissions).toHaveLength(1);
        const sent = parsed(recorded.submissions[0] as string);
        expect(sent.raw_txn.sequence_number).toBe(5);
        expect(sent.raw_txn.payload).toStrictEqual({ Multisig: { multisig_address: expect.any(String) } });
        expect(sent.authenticator.Ed25519.signature).toBe(await expectedSignature(sender, expiry, 5n));
    });

    test("is the transaction that the max gas estimate simulates, when the call has no max gas", async () => {
        start(5);
        const sender = new SupraAccount();
        const expiry = BigInt(node.blockSeconds() + 500);

        await execute(newClient(), sender, expiry, { maxGas: undefined });

        // The estimate simulation and the simulation before submission both carry the stored payload.
        expect(recorded.simulations).toHaveLength(2);
        for (const body of recorded.simulations) {
            expect(parsed(body).raw_txn.payload.Multisig.transaction_payload).toBeDefined();
        }
        const sent = parsed(recorded.submissions[0] as string);
        expect(sent.raw_txn.payload).toStrictEqual({ Multisig: { multisig_address: expect.any(String) } });
        // The mock node reports 1,000 gas units used; the max gas is that times 1.5.
        expect(
            (JSON.parse(recorded.submissions[0] as string) as { Move: { raw_txn: { max_gas_amount: number } } }).Move
                .raw_txn.max_gas_amount,
        ).toBe(1_500);
    });

    test("follows the transaction when it is signed again with a lower sequence number", async () => {
        start(5);
        const clock = new ClientClock();
        const client = newClient();
        const sender = new SupraAccount();
        const later = () => BigInt(node.blockSeconds() + 500);

        // The first three executions take 5, 6 and 7 and stay pending (the chain stays at 5). The record of 6
        // expires, so the fourth takes 8, its simulation reports a number that is too new, and it is signed again
        // with 6, the lowest number without a record.
        await execute(client, sender, later());
        await execute(client, sender, BigInt(Math.floor(Date.now() / 1000) + 60));
        await execute(client, sender, later());
        clock.offsetMs += 60_000;
        clock.monotonicOffsetMs += 60_000;
        node.advance(61_000);
        recorded.simulations.length = 0;
        recorded.submissions.length = 0;
        const expiry = later();

        const reported: bigint[] = [];
        await execute(client, sender, expiry, {
            onSubmission: (rawTxn) => reported.push(BigInt(rawTxn.sequence_number)),
        });

        expect(reported).toEqual([6n]);
        const numbers = recorded.simulations.map((body) => parsed(body).raw_txn.sequence_number);
        // 8 is too new, then 6 (signed again) is too new, and 6 is simulated at the chain's number 5.
        expect(numbers).toEqual([8, 6, 5]);
        for (const body of recorded.simulations) {
            expect(parsed(body).raw_txn.payload.Multisig.transaction_payload).toBeDefined();
        }
        expect(recorded.submissions).toHaveLength(1);
        const sent = parsed(recorded.submissions[0] as string);
        expect(sent.raw_txn.sequence_number).toBe(6);
        expect(sent.raw_txn.payload).toStrictEqual({ Multisig: { multisig_address: expect.any(String) } });
        expect(sent.authenticator.Ed25519.signature).toBe(await expectedSignature(sender, expiry, 6n));
    });
});
