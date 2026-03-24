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

        it("should initialize with custom rpcUrl and chainId", () => {
            const client = new SupraClient({
                rpcUrl: "https://custom-rpc.example.com",
                chainId: 99,
            });
            expect(client.networkInformation.name).toBe("custom");
            expect(client.networkInformation.chainId).toBe(99);
            expect(client.networkInformation.rpcUrl).toBe("https://custom-rpc.example.com");
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
