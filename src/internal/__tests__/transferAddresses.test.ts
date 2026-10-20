import { SupraAccount } from "supra-l1-sdk-core";
import { transferCoinInternal } from "../coin";
import { transferFungibleAssetInternal } from "../fungibleAsset";
import { validateAddress } from "../../helper/validation";
import type { NetworkConfig } from "../../utils/apiEndpoints";

jest.mock("../account", () => ({
    getAccountInfoInternal: jest.fn().mockResolvedValue({ sequence_number: 0n }),
    getAccountResourceInternal: jest.fn(),
    // The SUPRA fungible asset transfer reads the sender's balances first; the fungible store covers the amounts here.
    getAccountSupraBalanceInternal: jest.fn().mockResolvedValue({ total: 100n, coin: 0n, fungibleAsset: 100n }),
}));
jest.mock("../transactionManager/txnSubmit", () => ({
    buildAndSubmitEntryFunctionInternal: jest.fn().mockResolvedValue({}),
}));

import { buildAndSubmitEntryFunctionInternal } from "../transactionManager/txnSubmit";
const mockSubmit = buildAndSubmitEntryFunctionInternal as jest.MockedFunction<
    typeof buildAndSubmitEntryFunctionInternal
>;

const config: NetworkConfig = {
    name: "custom",
    chainId: 255,
    rpcUrl: "http://localhost:1",
    maxGas: 1000n,
    gasUnitPrice: 100n,
};
const sender = new SupraAccount();

/** The entry function arguments of the payload passed to the last submission, as hex strings. */
function submittedArgs(): string[] {
    return mockSubmit.mock.calls.at(-1)![0].payload.functionArgs.map((arg) => Buffer.from(arg).toString("hex"));
}

const pad = (hex: string) => hex.padStart(64, "0");

// Hex digits after the `0x` prefix: 1 (`0x1`), 1 (`0xa`), 3, 62, 63 and 64 characters.
const ADDRESSES = ["1", "a", "123", `ab${"0".repeat(60)}`, `f${"1".repeat(62)}`, `0${"7".repeat(63)}`, "1".repeat(64)];

describe("receiver and asset addresses in the transfer helpers", () => {
    beforeEach(() => mockSubmit.mockClear());

    test.each(ADDRESSES)("transferCoin encodes the receiver 0x%s as 32 bytes", async (hex) => {
        expect(() => validateAddress(`0x${hex}`)).not.toThrow();
        await transferCoinInternal(
            {
                senderAccount: sender,
                receiverAccountAddress: `0x${hex}`,
                amount: 5n,
                coinType: "0x1::supra_coin::SupraCoin",
            },
            config,
        );
        const [receiver, amount] = submittedArgs();
        expect(receiver).toBe(pad(hex));
        expect(amount).toBe("0500000000000000");
    });

    test.each(ADDRESSES)("transferFungibleAsset encodes the receiver and the asset 0x%s as 32 bytes", async (hex) => {
        await transferFungibleAssetInternal(
            { senderAccount: sender, receiverAccountAddress: `0x${hex}`, assetAddress: `0x${hex}`, amount: 5n },
            config,
        );
        const [asset, receiver] = submittedArgs();
        expect(asset).toBe(pad(hex));
        expect(receiver).toBe(pad(hex));
    });

    test("a 62-character address is a 32-byte argument starting with 00", async () => {
        const hex = "ab" + "cd".repeat(30);
        await transferCoinInternal(
            {
                senderAccount: sender,
                receiverAccountAddress: `0x${hex}`,
                amount: 1n,
                coinType: "0x1::supra_coin::SupraCoin",
            },
            config,
        );
        const [receiver] = submittedArgs();
        expect(receiver).toHaveLength(64);
        expect(receiver!.startsWith("00")).toBe(true);
    });

    test("a short address and its padded form give the same argument", async () => {
        const args = { senderAccount: sender, amount: 1n, coinType: "0x1::supra_coin::SupraCoin" } as const;
        await transferCoinInternal({ ...args, receiverAccountAddress: "0xa" }, config);
        const short = submittedArgs()[0];
        await transferCoinInternal({ ...args, receiverAccountAddress: `0x${pad("a")}` }, config);
        expect(submittedArgs()[0]).toBe(short);
    });

    test("an address of more than 64 hex characters is rejected before submission", async () => {
        await expect(
            transferCoinInternal(
                {
                    senderAccount: sender,
                    receiverAccountAddress: `0x${"1".repeat(65)}`,
                    amount: 1n,
                    coinType: "0x1::supra_coin::SupraCoin",
                },
                config,
            ),
        ).rejects.toThrow();
        expect(mockSubmit).not.toHaveBeenCalled();
    });
});
