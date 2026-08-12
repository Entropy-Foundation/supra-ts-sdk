import { BCS, SupraAccount, TxnBuilderTypes } from "supra-l1-sdk-core";
import type { NetworkConfig } from "../../../utils/apiEndpoints";
import { scriptRawTxnObjectInternal, sendTxnPayloadInternal } from "../txnBuild";
import { submitSerializedRawTransactionInternal } from "../txnSubmit";
import { simulateTxnInternal } from "../txnSimulate";

/**
 * A `u64` script argument, sequence number or gas field above
 * `Number.MAX_SAFE_INTEGER` must reach the RPC byte-for-byte. The signature is
 * computed over the BCS encoding of the raw transaction, so a value rounded on its
 * way into the JSON body would produce a request that no longer matches what was
 * signed. These tests assert on the actual serialized request body.
 */

const UNSAFE_U64 = 9007199254740993n; // 2^53 + 1
const ROUNDED_U64 = "9007199254740992"; // what Number(UNSAFE_U64) would have emitted
const SAFE_U64 = 1000n;

const testConfig: NetworkConfig = {
    name: "testnet",
    chainId: 6,
    rpcUrl: "https://rpc-testnet.supra.com",
};

function mockResponse(body: unknown) {
    return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => null },
        text: jest.fn().mockResolvedValue(JSON.stringify(body)),
    } as unknown as Response;
}

function capturedBodies(): string[] {
    return (global.fetch as jest.Mock).mock.calls
        .map((call) => (call[1] as RequestInit | undefined)?.body)
        .filter((body): body is string => typeof body === "string");
}

function buildScriptTxn(args: { u64Arg: bigint; sequenceNumber: bigint }) {
    const senderAccount = new SupraAccount();

    const rawTxn = scriptRawTxnObjectInternal(
        {
            senderAddress: senderAccount.address().toString(),
            senderSequenceNumber: args.sequenceNumber,
            scriptCode: new Uint8Array([1, 2, 3]),
            scriptTypeArgs: [],
            scriptArgs: [new TxnBuilderTypes.TransactionArgumentU64(args.u64Arg)],
            optionalTransactionPayloadArgs: { txExpiryTime: UNSAFE_U64 },
        },
        testConfig,
    );

    return { senderAccount, rawTxn };
}

describe("transaction request body precision", () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        global.fetch = jest.fn();
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it("should submit a u64 script argument above MAX_SAFE_INTEGER exactly", async () => {
        (global.fetch as jest.Mock)
            .mockResolvedValueOnce(mockResponse("0x" + "1".repeat(64)))
            .mockResolvedValueOnce(mockResponse({ status: "Success" }));

        const { senderAccount, rawTxn } = buildScriptTxn({
            u64Arg: UNSAFE_U64,
            sequenceNumber: 0n,
        });

        await submitSerializedRawTransactionInternal(
            {
                senderAccount,
                serializedRawTransaction: BCS.bcsToBytes(rawTxn),
                enableTransactionWaitAndSimulationArgs: { enableTransactionSimulation: false },
            },
            testConfig,
        );

        const [submitBody] = capturedBodies();
        expect(submitBody).toContain('"U64":9007199254740993');
        expect(submitBody).not.toContain(ROUNDED_U64);
    });

    it("should simulate a u64 script argument above MAX_SAFE_INTEGER exactly", async () => {
        (global.fetch as jest.Mock).mockResolvedValue(mockResponse({ status: "Success" }));

        const { senderAccount, rawTxn } = buildScriptTxn({
            u64Arg: UNSAFE_U64,
            sequenceNumber: 0n,
        });

        await simulateTxnInternal(
            { sendTxPayload: sendTxnPayloadInternal({ senderAccount, rawTxn }) },
            testConfig,
        );

        const [simulateBody] = capturedBodies();
        expect(simulateBody).toContain('"U64":9007199254740993');
        expect(simulateBody).not.toContain(ROUNDED_U64);
    });

    it("should emit raw transaction header u64 fields exactly", async () => {
        (global.fetch as jest.Mock).mockResolvedValue(mockResponse({ status: "Success" }));

        const { senderAccount, rawTxn } = buildScriptTxn({
            u64Arg: SAFE_U64,
            sequenceNumber: UNSAFE_U64,
        });

        await simulateTxnInternal(
            { sendTxPayload: sendTxnPayloadInternal({ senderAccount, rawTxn }) },
            testConfig,
        );

        const [body] = capturedBodies();
        expect(body).toContain('"sequence_number":9007199254740993');
        expect(body).toContain('"expiration_timestamp_secs":9007199254740993');
        expect(body).not.toContain(ROUNDED_U64);
    });

    it("should preserve a safe control value unchanged", async () => {
        (global.fetch as jest.Mock).mockResolvedValue(mockResponse({ status: "Success" }));

        const { senderAccount, rawTxn } = buildScriptTxn({
            u64Arg: SAFE_U64,
            sequenceNumber: 5n,
        });

        await simulateTxnInternal(
            { sendTxPayload: sendTxnPayloadInternal({ senderAccount, rawTxn }) },
            testConfig,
        );

        const [body] = capturedBodies();
        expect(body).toContain('"U64":1000');
        expect(body).toContain('"sequence_number":5');
    });

    it("should send a body that is still valid JSON, with the argument as a number literal", async () => {
        (global.fetch as jest.Mock).mockResolvedValue(mockResponse({ status: "Success" }));

        const { senderAccount, rawTxn } = buildScriptTxn({
            u64Arg: UNSAFE_U64,
            sequenceNumber: 0n,
        });

        await simulateTxnInternal(
            { sendTxPayload: sendTxnPayloadInternal({ senderAccount, rawTxn }) },
            testConfig,
        );

        const [body] = capturedBodies();
        expect(() => JSON.parse(body!)).not.toThrow();
        // A number literal, not a quoted string: the wire format is unchanged.
        expect(body).not.toContain('"U64":"');
    });
});
