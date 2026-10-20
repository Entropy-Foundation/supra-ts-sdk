import { get } from "../get";
import { post } from "../post";
import { buildRpcUrl, validateRpcUrl } from "../url";
import type { NetworkConfig } from "../../utils/apiEndpoints";

function config(rpcUrl: string): NetworkConfig {
    return { name: "custom", chainId: 1, rpcUrl };
}

function okResponse(): Response {
    return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: jest.fn().mockResolvedValue("{}"),
        json: jest.fn().mockResolvedValue({}),
        headers: { get: () => null },
    } as unknown as Response;
}

const VARIANTS = ["https://host.example", "https://host.example/", "https://host.example///"];

const PREFIXED_VARIANTS = [
    "https://host.example/prefix",
    "https://host.example/prefix/",
    "https://host.example/prefix//",
];

describe("client/url", () => {
    describe("buildRpcUrl", () => {
        it.each(VARIANTS)("joins %s without doubled slashes", (rpcUrl) => {
            expect(buildRpcUrl(rpcUrl, "v3", "/block").toString()).toBe("https://host.example/rpc/v3/block");
        });

        it.each(PREFIXED_VARIANTS)("keeps the path prefix of %s", (rpcUrl) => {
            expect(buildRpcUrl(rpcUrl, "v3", "/block").toString()).toBe("https://host.example/prefix/rpc/v3/block");
        });

        it("keeps a port and a nested prefix", () => {
            expect(buildRpcUrl("http://localhost:27001/a/b/", "v1", "/x").toString()).toBe(
                "http://localhost:27001/a/b/rpc/v1/x",
            );
        });
    });

    describe("validateRpcUrl", () => {
        it.each(["http://localhost:1", "https://host.example/prefix/"])("accepts %s", (url) => {
            expect(validateRpcUrl(url)).toBe(url);
        });

        it.each([
            "",
            "host.example",
            "//host.example",
            "/rpc",
            "file:///tmp/x",
            "ftp://host.example",
            "javascript:alert(1)",
        ])("rejects %j", (url) => {
            expect(() => validateRpcUrl(url)).toThrow(TypeError);
        });
    });

    describe("requests", () => {
        const originalFetch = global.fetch;

        beforeEach(() => {
            global.fetch = jest.fn().mockImplementation(async () => okResponse());
        });

        afterEach(() => {
            global.fetch = originalFetch;
        });

        function requestedUrls(): string[] {
            return (global.fetch as jest.Mock).mock.calls.map((call) => String(call[0]));
        }

        it("sends GET requests to the same URL whatever the trailing slashes", async () => {
            for (const rpcUrl of VARIANTS) {
                await get({ path: "/accounts/0x1", query: { count: 2 } }, config(rpcUrl));
            }
            expect(new Set(requestedUrls())).toEqual(new Set(["https://host.example/rpc/v3/accounts/0x1?count=2"]));
            expect(requestedUrls()).toHaveLength(VARIANTS.length);
        });

        it("sends POST requests to the same URL whatever the trailing slashes", async () => {
            for (const rpcUrl of VARIANTS) {
                await post({ path: "/view", data: { a: 1 } }, config(rpcUrl));
            }
            expect(new Set(requestedUrls())).toEqual(new Set(["https://host.example/rpc/v3/view"]));
            expect(requestedUrls()).toHaveLength(VARIANTS.length);
        });

        it("sends GET and POST requests below a path prefix", async () => {
            for (const rpcUrl of PREFIXED_VARIANTS) {
                await get({ path: "/block" }, config(rpcUrl));
                await post({ path: "/view", data: { a: 1 } }, config(rpcUrl), "v2");
            }
            expect(new Set(requestedUrls())).toEqual(
                new Set(["https://host.example/prefix/rpc/v3/block", "https://host.example/prefix/rpc/v2/view"]),
            );
        });
    });
});
