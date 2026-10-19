import { SupraAccount } from "supra-l1-sdk-core";
import { transferCoinInternal } from "../coin";
import { typeTagToString } from "../../helper/typeTag";
import type { NetworkConfig } from "../../utils/apiEndpoints";
import type { MoveStructId } from "../../types/move";

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
const LONG_ABC = `0x${"0".repeat(61)}abc`;
const RECEIVER = `0x${"0".repeat(63)}2`;

function transfer(coinType: string) {
    return transferCoinInternal(
        { senderAccount: sender, receiverAccountAddress: RECEIVER, amount: 5n, coinType: coinType as MoveStructId },
        config,
    );
}

describe("the coin type of transferCoin", () => {
    beforeEach(() => mockSubmit.mockClear());

    test.each([
        ["0x1::supra_coin::SupraCoin", "0x1::supra_coin::SupraCoin"],
        ["0xabc::usdt0::USDT0", `${LONG_ABC}::usdt0::USDT0`],
        ["0xabc::m::T1", `${LONG_ABC}::m::T1`],
    ])("is the type argument of transfer_coins for %s", async (coinType, expected) => {
        await transfer(coinType);
        const [typeArg] = mockSubmit.mock.calls.at(-1)![0].payload.functionTypeArgs;
        expect(typeTagToString(typeArg!)).toBe(expected);
    });

    test.each(["0x1::supra_coin::SupraCoin junk", "0x1::supra_coin::SupraCoin, u8", "0x1::supra_coin::SupraCoin>"])(
        "with text after the type, %j, is refused before submission",
        async (coinType) => {
            await expect(transfer(coinType)).rejects.toThrow(/after the type/);
            expect(mockSubmit).not.toHaveBeenCalled();
        },
    );
});
