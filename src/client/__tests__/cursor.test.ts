import { getPage, nextPageCursor } from "../cursor";
import type { NetworkConfig } from "../../utils/apiEndpoints";

const testConfig: NetworkConfig = {
    name: "testnet",
    chainId: 6,
    rpcUrl: "https://rpc-testnet.supra.com",
};

function mockPage(items: unknown[], cursorHeader?: string): Response {
    const headers: Record<string, string> = cursorHeader === undefined ? {} : { "x-supra-cursor": cursorHeader };
    return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: jest.fn().mockResolvedValue(JSON.stringify(items)),
        headers: {
            get: (name: string) => headers[name.toLowerCase()] ?? null,
        },
    } as unknown as Response;
}

function requestedUrl(call: number): URL {
    const url = (global.fetch as jest.Mock).mock.calls[call]?.[0] as string;
    return new URL(url);
}

describe("client/cursor", () => {
    describe("nextPageCursor", () => {
        it("is undefined when the header is absent (v12 end of feed)", () => {
            expect(nextPageCursor({ header: null, sent: "c1", itemCount: 0 })).toBeUndefined();
            expect(nextPageCursor({ header: undefined, sent: undefined, itemCount: 3 })).toBeUndefined();
        });

        it("is undefined when the header is empty (v11 events, automated transactions, empty accounts)", () => {
            expect(nextPageCursor({ header: "", sent: "c1", itemCount: 0 })).toBeUndefined();
            expect(nextPageCursor({ header: "", sent: undefined, itemCount: 0 })).toBeUndefined();
        });

        it('is undefined for "0" on an empty page (v11 coin transactions)', () => {
            expect(nextPageCursor({ header: "0", sent: "1792406658389084", itemCount: 0 })).toBeUndefined();
            expect(nextPageCursor({ header: "0", sent: undefined, itemCount: 0 })).toBeUndefined();
        });

        it('keeps "0" on a page with items, where it is the position of the last item', () => {
            expect(nextPageCursor({ header: "0", sent: undefined, itemCount: 1 })).toBe("0");
        });

        it("is undefined when an empty page echoes the request's cursor (v11 resources and modules)", () => {
            expect(nextPageCursor({ header: "abcd", sent: "abcd", itemCount: 0 })).toBeUndefined();
        });

        it("keeps a new cursor on an empty page, which a type filter can produce", () => {
            expect(nextPageCursor({ header: "1792406658389090", sent: "1792406658389084", itemCount: 0 })).toBe(
                "1792406658389090",
            );
        });

        it("keeps the cursor of a page with items", () => {
            expect(nextPageCursor({ header: "abcd", sent: undefined, itemCount: 2 })).toBe("abcd");
            expect(nextPageCursor({ header: "abce", sent: "abcd", itemCount: 1 })).toBe("abce");
        });
    });

    describe("getPage", () => {
        const originalFetch = global.fetch;

        beforeEach(() => {
            global.fetch = jest.fn();
        });

        afterEach(() => {
            global.fetch = originalFetch;
        });

        it("does not send an empty cursor", async () => {
            (global.fetch as jest.Mock).mockResolvedValue(mockPage([]));

            await getPage<unknown[], unknown>(
                { path: "/accounts/0x1/resources", query: { count: 2, start: "" }, cursorParam: "start" },
                testConfig,
                (data) => data,
            );

            expect(requestedUrl(0).searchParams.has("start")).toBe(false);
            expect(requestedUrl(0).searchParams.get("count")).toBe("2");
        });

        it("sends the cursor under the named parameter", async () => {
            (global.fetch as jest.Mock).mockResolvedValue(mockPage([]));

            await getPage<unknown[], unknown>(
                { path: "/accounts/0x1/automated_transactions", query: { cursor: "c1" }, cursorParam: "cursor" },
                testConfig,
                (data) => data,
            );

            expect(requestedUrl(0).searchParams.get("cursor")).toBe("c1");
        });

        it("returns the items and the next cursor", async () => {
            (global.fetch as jest.Mock).mockResolvedValue(mockPage([1, 2], "c2"));

            const page = await getPage<number[], number>(
                { path: "/accounts/0x1/resources", query: { start: "c1" }, cursorParam: "start" },
                testConfig,
                (data) => data,
            );

            expect(page).toEqual({ response: [1, 2], cursor: "c2" });
        });

        it.each([
            ["an absent header", undefined],
            ["an empty header", ""],
            ['"0"', "0"],
            ["the echoed start", "c1"],
        ])("ends the feed on an empty page with %s", async (_label, header) => {
            (global.fetch as jest.Mock).mockResolvedValue(mockPage([], header));

            const page = await getPage<number[], number>(
                { path: "/accounts/0x1/resources", query: { start: "c1" }, cursorParam: "start" },
                testConfig,
                (data) => data,
            );

            expect(page).toEqual({ response: [], cursor: undefined });
        });

        it("terminates a loop over a v11 feed that echoes its cursor at the end", async () => {
            (global.fetch as jest.Mock)
                .mockResolvedValueOnce(mockPage([1, 2], "c1"))
                .mockResolvedValueOnce(mockPage([3], "c2"))
                .mockResolvedValueOnce(mockPage([], "c2"));

            const seen: number[] = [];
            let cursor: string | undefined;
            let requests = 0;
            do {
                const page = await getPage<number[], number>(
                    { path: "/accounts/0x1/modules", query: { count: 2, start: cursor }, cursorParam: "start" },
                    testConfig,
                    (data) => data,
                );
                seen.push(...page.response);
                cursor = page.cursor;
                requests++;
            } while (cursor !== undefined && requests < 10);

            expect(seen).toEqual([1, 2, 3]);
            expect(requests).toBe(3);
        });
    });
});
