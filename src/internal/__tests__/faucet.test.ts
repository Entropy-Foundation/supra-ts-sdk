import { fundAccountWithFaucetInternal, getFaucetTransactionInternal } from "../faucet";
import { SupraFaucetResponseError, SupraFaucetUnavailableError } from "../../errors/faucetError";
import { NetworkInfo, Network, type NetworkConfig } from "../../utils/apiEndpoints";

jest.mock("../../client/get", () => ({
    get: jest.fn(),
}));

import { get } from "../../client/get";
const mockGet = get as jest.MockedFunction<typeof get>;

const customConfig: NetworkConfig = {
    name: "custom",
    chainId: 255,
    rpcUrl: "http://localhost:27001",
};

const configs: Array<[string, NetworkConfig]> = [
    ["mainnet", NetworkInfo[Network.MAINNET]],
    ["testnet", NetworkInfo[Network.TESTNET]],
    ["devnet", NetworkInfo[Network.DEVNET]],
    ["custom", customConfig],
];

const fullAddress = "0x0000000000000000000000000000000000000000000000000000000000000001";
const txHash = "0x" + "ab".repeat(32);

describe("internal/faucet", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe("fundAccountWithFaucetInternal", () => {
        it.each(configs)("sends the faucet request on %s", async (_name, config) => {
            mockGet.mockResolvedValue({ data: { Accepted: "0xtxhash" } });
            const result = await fundAccountWithFaucetInternal({ accountAddress: "0x1" }, config);
            expect(mockGet).toHaveBeenCalledWith({ path: `/wallet/faucet/${fullAddress}` }, config);
            expect(result).toEqual({ hash: "0xtxhash" });
        });

        it("throws SupraFaucetUnavailableError when the node answers TryLater", async () => {
            mockGet.mockResolvedValue({ data: "TryLater" });
            await expect(fundAccountWithFaucetInternal({ accountAddress: "0x1" }, customConfig)).rejects.toThrow(
                SupraFaucetUnavailableError,
            );
        });

        it.each([[null], [{}], [{ Accepted: 5 }], [{ Accepted: "" }], ["Other"], [42]])(
            "throws SupraFaucetResponseError for the body %p",
            async (body) => {
                mockGet.mockResolvedValue({ data: body });
                const error = await fundAccountWithFaucetInternal({ accountAddress: "0x1" }, customConfig).catch(
                    (e: unknown) => e,
                );
                expect(error).toBeInstanceOf(SupraFaucetResponseError);
                expect((error as SupraFaucetResponseError).data).toEqual(body);
            },
        );

        it("propagates the error of the HTTP client", async () => {
            mockGet.mockRejectedValue(new Error("Not Found"));
            await expect(fundAccountWithFaucetInternal({ accountAddress: "0x1" }, customConfig)).rejects.toThrow(
                "Not Found",
            );
        });
    });

    describe("getFaucetTransactionInternal", () => {
        it("reads the faucet transaction by hash", async () => {
            const transaction = { hash: txHash, status: "Success" };
            mockGet.mockResolvedValue({ data: transaction });
            const result = await getFaucetTransactionInternal({ transactionHash: txHash }, customConfig);
            expect(mockGet).toHaveBeenCalledWith({ path: `/wallet/faucet/transactions/${txHash}` }, customConfig);
            expect(result).toBe(transaction);
        });
    });
});
