import { SupraAccount } from "supra-l1-sdk-core";
import { SupraClient } from "../supraClient";

jest.mock("../../internal/multisig", () => ({
    createMultisigAccountInternal: jest.fn().mockResolvedValue({ multisigAddress: "0x1", transaction: {} }),
    proposeMultisigTransactionInternal: jest.fn().mockResolvedValue({}),
    proposeMultisigTransactionWithHashInternal: jest.fn().mockResolvedValue({}),
    voteMultisigTransactionInternal: jest.fn().mockResolvedValue({}),
    executeMultisigTransactionInternal: jest.fn().mockResolvedValue({}),
    executeRejectedMultisigTransactionInternal: jest.fn().mockResolvedValue({}),
    getMultisigSequenceNumbersInternal: jest.fn().mockResolvedValue({ lastResolved: 0n, next: 1n }),
    getMultisigProposalInternal: jest.fn().mockResolvedValue({}),
    getNextMultisigProposalInternal: jest.fn().mockResolvedValue(undefined),
}));

import {
    createMultisigAccountInternal,
    executeMultisigTransactionInternal,
    getMultisigProposalInternal,
    voteMultisigTransactionInternal,
} from "../../internal/multisig";

const supra = new SupraClient({ rpcUrl: "http://127.0.0.1:1", chainId: 255, verifyChainId: false });
const senderAccount = new SupraAccount();
const multisigAddress = "0x1234";
const payload = { function: "0x1::supra_account::transfer", functionArgs: ["0x2", 1n] } as const;

describe("the multisig methods", () => {
    beforeEach(() => jest.clearAllMocks());

    test("are on the client and on supra.multisig", () => {
        expect(supra.createMultisigAccount).toBeInstanceOf(Function);
        expect(supra.multisig.executeMultisigTransaction).toBeInstanceOf(Function);
        expect(supra.executeRejectedMultisigTransaction).toBeInstanceOf(Function);
    });

    test("createMultisigAccount refuses an invalid owner, threshold or timeout before any request", async () => {
        await expect(
            supra.multisig.createMultisigAccount({ senderAccount, additionalOwners: ["nope"], signaturesRequired: 1 }),
        ).rejects.toThrow("additionalOwners");
        await expect(supra.multisig.createMultisigAccount({ senderAccount, signaturesRequired: -1 })).rejects.toThrow(
            "signaturesRequired",
        );
        await expect(
            supra.multisig.createMultisigAccount({ senderAccount, signaturesRequired: 1, timeoutDurationSecs: 299 }),
        ).rejects.toThrow("timeoutDurationSecs");
        expect(createMultisigAccountInternal).not.toHaveBeenCalled();
    });

    test("createMultisigAccount accepts a timeout of 300 seconds", async () => {
        await supra.multisig.createMultisigAccount({ senderAccount, signaturesRequired: 1, timeoutDurationSecs: 300 });
        expect(createMultisigAccountInternal).toHaveBeenCalledTimes(1);
    });

    test.each([
        ["approveMultisigTransaction", true],
        ["rejectMultisigTransaction", false],
    ] as const)("%s votes %s and numbers proposals from 1", async (method, approved) => {
        await supra.multisig[method]({ senderAccount, multisigAddress, sequenceNumber: 2 });
        expect(voteMultisigTransactionInternal).toHaveBeenCalledWith(
            expect.objectContaining({ approved, sequenceNumber: 2 }),
            expect.anything(),
        );
        await expect(supra.multisig[method]({ senderAccount, multisigAddress, sequenceNumber: 0 })).rejects.toThrow(
            "sequenceNumber",
        );
        await expect(
            supra.multisig[method]({ senderAccount, multisigAddress: "x", sequenceNumber: 1 }),
        ).rejects.toThrow("multisigAddress");
    });

    test("getMultisigProposal refuses sequence number 0", async () => {
        await expect(supra.multisig.getMultisigProposal({ multisigAddress, sequenceNumber: 0n })).rejects.toThrow(
            "sequenceNumber",
        );
        expect(getMultisigProposalInternal).not.toHaveBeenCalled();
    });

    test("the proposal and execution methods refuse an invalid function id", async () => {
        const bad = { function: "not-a-function", functionArgs: [] };
        await expect(
            supra.multisig.proposeMultisigTransaction({ senderAccount, multisigAddress, payload: bad }),
        ).rejects.toThrow("payload.function");
        await expect(
            supra.multisig.proposeMultisigTransactionWithHash({ senderAccount, multisigAddress, payload: bad }),
        ).rejects.toThrow("payload.function");
        await expect(
            supra.multisig.executeMultisigTransaction({ senderAccount, multisigAddress, payload: bad }),
        ).rejects.toThrow("payload.function");
        expect(executeMultisigTransactionInternal).not.toHaveBeenCalled();
    });

    test("executeMultisigTransaction passes a call without a payload on", async () => {
        await supra.multisig.executeMultisigTransaction({ senderAccount, multisigAddress });
        expect(executeMultisigTransactionInternal).toHaveBeenCalledTimes(1);
        await supra.multisig.executeMultisigTransaction({ senderAccount, multisigAddress, payload });
        expect(executeMultisigTransactionInternal).toHaveBeenCalledTimes(2);
    });
});
