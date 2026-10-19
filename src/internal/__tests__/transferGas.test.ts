import { SupraAccount } from "supra-l1-sdk-core";
import { transferCoinInternal } from "../coin";
import { transferFungibleAssetInternal } from "../fungibleAsset";
import { SupraAPIError } from "../../errors/apiError";
import type { OptionalTransactionArgs } from "../../types/transactionManager/transactionSubmit";
import type { NetworkConfig } from "../../utils/apiEndpoints";
import {
    DEFAULT_MAX_GAS_FOR_SUPRA_TRANSFER_WHEN_RECEIVER_EXISTS,
    DEFAULT_MAX_GAS_FOR_SUPRA_TRANSFER_WHEN_RECEIVER_NOT_EXISTS,
} from "../../utils/constants";

jest.mock("../account", () => ({
    getAccountInfoInternal: jest.fn(),
    getAccountResourceInternal: jest.fn(),
    isAccountExistsInternal: jest.fn(),
}));

jest.mock("../transactionManager/txnBuild", () => ({
    rawTxnObjectInternal: jest.fn(() => ({})),
    sendTxnPayloadInternal: jest.fn(() => ({})),
}));

jest.mock("../transactionManager/txnSubmit", () => ({
    submitTxnInternal: jest.fn(),
}));

import { getAccountInfoInternal, isAccountExistsInternal } from "../account";
import { submitTxnInternal } from "../transactionManager/txnSubmit";

const mockIsAccountExists = isAccountExistsInternal as jest.MockedFunction<typeof isAccountExistsInternal>;
const mockAccountInfo = getAccountInfoInternal as jest.MockedFunction<typeof getAccountInfoInternal>;
const mockSubmit = submitTxnInternal as jest.MockedFunction<typeof submitTxnInternal>;

const config: NetworkConfig = { name: "testnet", chainId: 6, rpcUrl: "http://localhost:1" };
const SUPRA_FA = "0x000000000000000000000000000000000000000000000000000000000000000a";
const receiver = "0x0000000000000000000000000000000000000000000000000000000000000002";

const transfers = {
    transferCoinInternal: (optionalTransactionArgs: OptionalTransactionArgs) =>
        transferCoinInternal(
            {
                senderAccount: new SupraAccount(),
                receiverAccountAddress: receiver,
                amount: 1n,
                coinType: "0x1::supra_coin::SupraCoin",
                optionalTransactionArgs,
            },
            config,
        ),
    transferFungibleAssetInternal: (optionalTransactionArgs: OptionalTransactionArgs) =>
        transferFungibleAssetInternal(
            {
                senderAccount: new SupraAccount(),
                receiverAccountAddress: receiver,
                amount: 1n,
                assetAddress: SUPRA_FA,
                optionalTransactionArgs,
            },
            config,
        ),
};

describe.each(Object.entries(transfers))("%s chooses the gas limit from the receiver check", (_name, transfer) => {
    beforeEach(() => {
        jest.resetAllMocks();
        mockAccountInfo.mockResolvedValue({ sequence_number: 3n, authentication_key: "0x" });
        mockSubmit.mockResolvedValue({} as Awaited<ReturnType<typeof submitTxnInternal>>);
    });

    it("uses the existing-receiver limit when the receiver exists", async () => {
        mockIsAccountExists.mockResolvedValue(true);
        const args: OptionalTransactionArgs = { optionalTransactionPayloadArgs: {} };

        await transfer(args);

        expect(args.optionalTransactionPayloadArgs?.maxGas).toBe(
            BigInt(DEFAULT_MAX_GAS_FOR_SUPRA_TRANSFER_WHEN_RECEIVER_EXISTS),
        );
    });

    it("uses the new-receiver limit when the receiver is absent", async () => {
        mockIsAccountExists.mockResolvedValue(false);
        const args: OptionalTransactionArgs = { optionalTransactionPayloadArgs: {} };

        await transfer(args);

        expect(args.optionalTransactionPayloadArgs?.maxGas).toBe(
            BigInt(DEFAULT_MAX_GAS_FOR_SUPRA_TRANSFER_WHEN_RECEIVER_NOT_EXISTS),
        );
    });

    it("rejects with the error of the receiver check and submits nothing", async () => {
        const error = new SupraAPIError({ status: 429, statusText: "Too Many Requests", url: "http://node" });
        mockIsAccountExists.mockRejectedValue(error);
        const args: OptionalTransactionArgs = { optionalTransactionPayloadArgs: {} };

        await expect(transfer(args)).rejects.toBe(error);

        expect(mockSubmit).not.toHaveBeenCalled();
        expect(args.optionalTransactionPayloadArgs?.maxGas).toBeUndefined();
    });
});
