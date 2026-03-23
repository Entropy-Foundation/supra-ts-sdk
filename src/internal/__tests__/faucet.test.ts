import { fundAccountWithFaucetInternal } from "../faucet";
import type { NetworkConfig } from "../../utils/apiEndpoints";

jest.mock("../../client/get", () => ({
    get: jest.fn(),
}));

import { get } from "../../client/get";
const mockGet = get as jest.MockedFunction<typeof get>;

const testnetConfig: NetworkConfig = {
    name: "testnet",
    chainId: 6,
    rpcUrl: "https://rpc-testnet.supra.com",
};

const mainnetConfig: NetworkConfig = {
    name: "mainnet",
    chainId: 8,
    rpcUrl: "https://rpc-mainnet.supra.com",
};

const fullAddress = "0x0000000000000000000000000000000000000000000000000000000000000001";

describe("internal/faucet", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe("fundAccountWithFaucetInternal", () => {
        it("should call get with correct faucet path on testnet", async () => {
            mockGet.mockResolvedValue({ data: { Accepted: "0xtxhash" } });
            const result = await fundAccountWithFaucetInternal(
                { accountAddress: "0x1" },
                testnetConfig,
            );
            expect(mockGet).toHaveBeenCalledWith(
                { path: `/wallet/faucet/${fullAddress}` },
                testnetConfig,
            );
            expect(result).toEqual({ hash: "0xtxhash" });
        });

        it("should throw error on mainnet", async () => {
            await expect(
                fundAccountWithFaucetInternal({ accountAddress: "0x1" }, mainnetConfig),
            ).rejects.toThrow("Faucet is only available on testnet");
        });
    });
});
