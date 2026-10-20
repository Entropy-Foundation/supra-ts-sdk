import { SupraClient } from "../supraClient";
import { Network } from "../../utils/apiEndpoints";
import { DEFAULT_GAS_PRICE, DEFAULT_MAX_GAS_UNITS } from "../../utils/constants";
import { Account } from "../account";
import { Transaction } from "../transaction";
import { Contract } from "../contract";
import { Methods } from "../methods";
import { Faucet } from "../faucet";
import { Table } from "../table";
import { Coin } from "../coin";
import { Events } from "../events";
import { Block } from "../block";
import { FungibleAsset } from "../fungibleAsset";

jest.mock("../../client/get", () => ({
    get: jest.fn(),
}));

import { get } from "../../client/get";
const mockGet = get as jest.MockedFunction<typeof get>;

describe("SupraClient", () => {
    describe("constructor", () => {
        it("should initialize with TESTNET config", () => {
            const client = new SupraClient({ network: Network.TESTNET });
            expect(client.networkInformation.name).toBe("testnet");
            expect(client.networkInformation.chainId).toBe(6);
            expect(client.networkInformation.rpcUrl).toBe("https://rpc-testnet.supra.com");
        });

        it("should initialize with MAINNET config", () => {
            const client = new SupraClient({ network: Network.MAINNET });
            expect(client.networkInformation.name).toBe("mainnet");
            expect(client.networkInformation.chainId).toBe(8);
            expect(client.networkInformation.rpcUrl).toBe("https://rpc-mainnet.supra.com");
        });

        it("should initialize with DEVNET config", () => {
            const client = new SupraClient({ network: Network.DEVNET });
            expect(client.networkInformation.name).toBe("devnet");
            expect(client.networkInformation.chainId).toBe(50);
            expect(client.networkInformation.rpcUrl).toBe("https://rpc-devnet.supra.com");
        });

        it("should initialize with custom rpcUrl and chainId", () => {
            const client = new SupraClient({
                rpcUrl: "https://custom-rpc.example.com",
                chainId: 99,
            });
            expect(client.networkInformation.name).toBe("custom");
            expect(client.networkInformation.chainId).toBe(99);
            expect(client.networkInformation.rpcUrl).toBe("https://custom-rpc.example.com");
        });

        it("should not set a timeout or a retry policy by default", () => {
            const client = new SupraClient({ network: Network.TESTNET });
            expect(client.networkInformation.timeout).toBeUndefined();
            expect(client.networkInformation.retry).toBeUndefined();
        });

        it("should set the request timeout of a predefined network and of a custom network", () => {
            const predefined = new SupraClient({ network: Network.DEVNET, timeoutMs: 5_000 });
            const custom = new SupraClient({ rpcUrl: "https://custom.example.com", chainId: 42, timeoutMs: 7_000 });
            expect(predefined.networkInformation.timeout).toBe(5_000);
            expect(custom.networkInformation.timeout).toBe(7_000);
        });

        it("should keep the settings of one client from reaching another client of the same network", () => {
            const slow = new SupraClient({ network: Network.DEVNET, timeoutMs: 5_000, retry: { attempts: 2 } });
            const plain = new SupraClient({ network: Network.DEVNET });
            expect(slow.networkInformation.timeout).toBe(5_000);
            expect(plain.networkInformation.timeout).toBeUndefined();
            expect(plain.networkInformation.retry).toBeUndefined();
        });

        it("should reject a timeout that is not an integer from 1 to 2^31 - 1", () => {
            for (const timeoutMs of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31, 2 ** 32]) {
                expect(() => new SupraClient({ network: Network.TESTNET, timeoutMs })).toThrow(RangeError);
            }
        });

        it("should apply the defaults to a retry policy and validate it", () => {
            const client = new SupraClient({ network: Network.TESTNET, retry: {} });
            expect(client.networkInformation.retry).toEqual({ attempts: 3, maxDelayMs: 10_000 });

            const tuned = new SupraClient({ network: Network.TESTNET, retry: { attempts: 5, maxDelayMs: 2_000 } });
            expect(tuned.networkInformation.retry).toEqual({ attempts: 5, maxDelayMs: 2_000 });

            expect(() => new SupraClient({ network: Network.TESTNET, retry: { attempts: 0 } })).toThrow(RangeError);
            expect(() => new SupraClient({ network: Network.TESTNET, retry: { attempts: 1.5 } })).toThrow(RangeError);
            expect(() => new SupraClient({ network: Network.TESTNET, retry: { maxDelayMs: -1 } })).toThrow(RangeError);
        });

        it("should accept a retry delay up to 2^31 - 1 ms and reject a longer one", () => {
            const longest = new SupraClient({ network: Network.TESTNET, retry: { maxDelayMs: 2 ** 31 - 1 } });
            expect(longest.networkInformation.retry?.maxDelayMs).toBe(2 ** 31 - 1);

            for (const maxDelayMs of [2 ** 31, 2 ** 32, Number.POSITIVE_INFINITY, Number.NaN]) {
                expect(() => new SupraClient({ network: Network.TESTNET, retry: { maxDelayMs } })).toThrow(
                    `retry.maxDelayMs must be a number of milliseconds from 0 to 2147483647, got ${maxDelayMs}`,
                );
            }
        });

        it("should initialize with explicit Network.CUSTOM", () => {
            const client = new SupraClient({
                network: Network.CUSTOM,
                rpcUrl: "https://custom.example.com",
                chainId: 42,
            });
            expect(client.networkInformation.chainId).toBe(42);
            expect(client.networkInformation.rpcUrl).toBe("https://custom.example.com");
        });

        it("should use default gas values when not provided", () => {
            const client = new SupraClient({ network: Network.TESTNET });
            expect(client.networkInformation.maxGas).toBe(DEFAULT_MAX_GAS_UNITS);
            expect(client.networkInformation.minGasUnitPrice).toBe(DEFAULT_GAS_PRICE);
        });

        it("should use custom gas values when provided", () => {
            const client = new SupraClient({
                network: Network.TESTNET,
                maxGas: 5000n,
                minGasUnitPrice: 200_000n,
            });
            expect(client.networkInformation.maxGas).toBe(5000n);
            expect(client.networkInformation.minGasUnitPrice).toBe(200_000n);
        });

        it("should instantiate all sub-modules", () => {
            const client = new SupraClient({ network: Network.TESTNET });
            expect(client.account).toBeInstanceOf(Account);
            expect(client.transaction).toBeInstanceOf(Transaction);
            expect(client.contract).toBeInstanceOf(Contract);
            expect(client.methods).toBeInstanceOf(Methods);
            expect(client.faucet).toBeInstanceOf(Faucet);
            expect(client.table).toBeInstanceOf(Table);
            expect(client.coin).toBeInstanceOf(Coin);
            expect(client.events).toBeInstanceOf(Events);
            expect(client.block).toBeInstanceOf(Block);
            expect(client.fungibleAsset).toBeInstanceOf(FungibleAsset);
        });

        it("should store the original config", () => {
            const config = { network: Network.TESTNET as const };
            const client = new SupraClient(config);
            expect(client.config).toBe(config);
        });
    });

    describe("getChainId", () => {
        it("should return correct chain ID for testnet", () => {
            const client = new SupraClient({ network: Network.TESTNET });
            const chainId = client.getChainId();
            expect(chainId.value).toBe(6);
        });

        it("should return correct chain ID for mainnet", () => {
            const client = new SupraClient({ network: Network.MAINNET });
            const chainId = client.getChainId();
            expect(chainId.value).toBe(8);
        });

        it("should return correct chain ID for custom network", () => {
            const client = new SupraClient({
                rpcUrl: "https://custom.example.com",
                chainId: 42,
            });
            const chainId = client.getChainId();
            expect(chainId.value).toBe(42);
        });
    });

    describe("validateChainId", () => {
        beforeEach(() => {
            jest.clearAllMocks();
        });

        it("should resolve without throwing when the configured chainId matches the network", async () => {
            mockGet.mockResolvedValueOnce({ data: 6 });

            const client = new SupraClient({ network: Network.TESTNET });

            await expect(client.validateChainId()).resolves.toBeUndefined();
            expect(client.networkInformation.chainId).toBe(6);
        });

        it("should throw on chainId mismatch without mutating networkInformation", async () => {
            mockGet.mockResolvedValueOnce({ data: 6 });

            const client = new SupraClient({
                rpcUrl: "https://custom-rpc.example.com",
                chainId: 99,
            });

            await expect(client.validateChainId()).rejects.toThrow(
                "SupraClient: configured chainId (99) does not match the network's chainId (6).",
            );
            expect(client.networkInformation.chainId).toBe(99);
        });
    });

    describe("mixin behavior", () => {
        it("should have Account methods on prototype", () => {
            const client = new SupraClient({ network: Network.TESTNET });
            expect(typeof client.getAccountInfo).toBe("function");
            expect(typeof client.isAccountExists).toBe("function");
        });

        it("should have Transaction methods on prototype", () => {
            const client = new SupraClient({ network: Network.TESTNET });
            expect(typeof client.getTransactionByHash).toBe("function");
            expect(typeof client.waitForTransaction).toBe("function");
        });
    });
});
