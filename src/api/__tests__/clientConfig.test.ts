import { SupraClient } from "../supraClient";
import { Network, NetworkInfo } from "../../utils/apiEndpoints";
import { declaredClientMembers } from "./clientMembers";

describe("SupraClient configuration", () => {
    describe("settings per client", () => {
        it("keeps the settings of two clients of the same predefined network apart", () => {
            const a = new SupraClient({
                network: Network.TESTNET,
                maxGas: 1_000n,
                minGasUnitPrice: 7n,
                timeoutMs: 1_000,
            });
            const b = new SupraClient({ network: Network.TESTNET, maxGas: 2_000n });

            expect(a.networkInformation.maxGas).toBe(1_000n);
            expect(a.networkInformation.minGasUnitPrice).toBe(7n);
            expect(a.networkInformation.timeout).toBe(1_000);
            expect(b.networkInformation.maxGas).toBe(2_000n);
            expect(b.networkInformation.minGasUnitPrice).not.toBe(7n);
            expect(b.networkInformation.timeout).toBeUndefined();
            expect(a.networkInformation).not.toBe(b.networkInformation);
        });

        it("does not write into the shared network table", () => {
            const before = JSON.stringify(NetworkInfo, (_key, value) =>
                typeof value === "bigint" ? `${value}n` : value,
            );
            new SupraClient({
                network: Network.DEVNET,
                maxGas: 1n,
                minGasUnitPrice: 2n,
                timeoutMs: 3,
                retry: { attempts: 2 },
                waitTimeoutMs: 4,
            });
            const after = JSON.stringify(NetworkInfo, (_key, value) =>
                typeof value === "bigint" ? `${value}n` : value,
            );
            expect(after).toBe(before);
            expect(NetworkInfo[Network.DEVNET].maxGas).toBeUndefined();
        });

        it("keeps the settings of two custom clients apart", () => {
            const a = new SupraClient({ rpcUrl: "http://a.example", chainId: 1, maxGas: 10n, retry: { attempts: 5 } });
            const b = new SupraClient({ rpcUrl: "http://b.example", chainId: 2, maxGas: 20n });

            expect(a.networkInformation.maxGas).toBe(10n);
            expect(a.networkInformation.retry?.attempts).toBe(5);
            expect(b.networkInformation.maxGas).toBe(20n);
            expect(b.networkInformation.retry).toBeUndefined();
            expect(a.networkInformation.rpcUrl).toBe("http://a.example");
            expect(b.networkInformation.chainId).toBe(2);
        });

        it("shares the network information object with its sub-clients and with no other client", () => {
            const a = new SupraClient({ network: Network.TESTNET });
            const b = new SupraClient({ network: Network.TESTNET });
            a.networkInformation.maxGas = 99n;
            expect(b.networkInformation.maxGas).not.toBe(99n);
            expect(NetworkInfo[Network.TESTNET].maxGas).toBeUndefined();
        });

        it("is not affected by later changes to the configuration object passed in", () => {
            const config = { rpcUrl: "http://a.example", chainId: 1, maxGas: 10n };
            const client = new SupraClient(config);
            config.maxGas = 11n;
            expect(client.config).toMatchObject({ maxGas: 10n });
            expect(client.networkInformation.maxGas).toBe(10n);
        });

        it("does not change the network information when the chain ID is validated", async () => {
            const originalFetch = global.fetch;
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                status: 200,
                statusText: "OK",
                text: jest.fn().mockResolvedValue("6"),
                json: jest.fn().mockResolvedValue(6),
                headers: { get: () => null },
            } as unknown as Response);
            try {
                await new SupraClient({ network: Network.TESTNET, maxGas: 5n }).validateChainId();
            } finally {
                global.fetch = originalFetch;
            }
            expect(NetworkInfo[Network.TESTNET]).toEqual({
                name: "testnet",
                chainId: 6,
                rpcUrl: "https://rpc-testnet.supra.com",
            });
        });
    });

    describe("rpcUrl validation", () => {
        it.each(["", "rpc.example.com", "/rpc", "ftp://rpc.example.com", "ws://rpc.example.com", "not a url"])(
            "rejects %j",
            (rpcUrl) => {
                expect(() => new SupraClient({ rpcUrl, chainId: 1 })).toThrow(TypeError);
            },
        );

        it.each(["http://localhost:27001", "https://rpc.example.com/", "https://rpc.example.com/prefix/"])(
            "accepts %s",
            (rpcUrl) => {
                expect(new SupraClient({ rpcUrl, chainId: 1 }).networkInformation.rpcUrl).toBe(rpcUrl);
            },
        );
    });

    describe("declared members", () => {
        it.each(Object.keys(declaredClientMembers))("has %s at runtime", (member) => {
            const client = new SupraClient({ network: Network.TESTNET });
            expect(member in client).toBe(true);
            expect((client as unknown as Record<string, unknown>)[member]).toBeDefined();
        });

        it("has the SupraClient constructor", () => {
            const client = new SupraClient({ network: Network.TESTNET });
            expect(client.constructor).toBe(SupraClient);
        });

        it("reaches build, simulate and submit through the transaction property", () => {
            const client = new SupraClient({ network: Network.TESTNET });
            expect(typeof client.transaction.build.simple).toBe("function");
            expect(typeof client.transaction.simulate.simple).toBe("function");
            expect(client.transaction.submit).toBeDefined();
            // @ts-expect-error `build` is declared on `transaction` only.
            expect(client.build).toBeUndefined();
        });
    });
});
