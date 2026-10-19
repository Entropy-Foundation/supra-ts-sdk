import { getEventsByTypeInternal } from "../events";
import type { NetworkConfig } from "../../utils/apiEndpoints";

jest.mock("../../client/get", () => ({
    get: jest.fn(),
}));

import { get } from "../../client/get";
const mockGet = get as jest.MockedFunction<typeof get>;

const testConfig: NetworkConfig = {
    name: "testnet",
    chainId: 6,
    rpcUrl: "https://rpc-testnet.supra.com",
};

describe("internal/events", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe("getEventsByTypeInternal", () => {
        it("should call get with correct path and query params", async () => {
            const mockEvents = { data: [{ event: {}, block_height: 1, transaction_hash: "0x" }] };
            mockGet.mockResolvedValue({ data: mockEvents, cursor: "cursor1" });

            const result = await getEventsByTypeInternal(
                {
                    eventType: "0x1::coin::Transfer" as `${string}::${string}::${string}`,
                    options: { startHeight: 100, endHeight: 200, limit: 50, start: "ab01" },
                },
                testConfig,
            );

            expect(mockGet).toHaveBeenCalledWith(
                {
                    path: "/events/0x1%3A%3Acoin%3A%3ATransfer",
                    query: {
                        start_height: 100,
                        end_height: 200,
                        limit: 50,
                        start: "ab01",
                    },
                },
                testConfig,
            );
            expect(result.cursor).toBe("cursor1");
        });

        it("passes the returned cursor back as start without a conversion", async () => {
            mockGet.mockResolvedValueOnce({ data: { data: [{ event: {}, block_height: 1, transaction_hash: "0x" }] }, cursor: "c1" });
            mockGet.mockResolvedValueOnce({ data: { data: [] }, cursor: undefined });

            const eventType = "0x1::coin::CoinDeposit" as const;
            const first = await getEventsByTypeInternal({ eventType, options: { limit: 1 } }, testConfig);
            const second = await getEventsByTypeInternal({ eventType, options: { limit: 1, start: first.cursor } }, testConfig);

            expect(mockGet.mock.calls[1]?.[0].query?.["start"]).toBe("c1");
            expect(second).toEqual({ response: [], cursor: undefined });
        });

        it("ends the feed on the empty cursor of a v11 node", async () => {
            mockGet.mockResolvedValue({ data: { data: [] }, cursor: "" });

            const result = await getEventsByTypeInternal(
                { eventType: "0x1::coin::CoinDeposit", options: { start: "c1" } },
                testConfig,
            );

            expect(result.cursor).toBeUndefined();
        });

        it("does not send an empty start", async () => {
            mockGet.mockResolvedValue({ data: { data: [] }, cursor: undefined });

            await getEventsByTypeInternal({ eventType: "0x1::coin::CoinDeposit", options: { start: "" } }, testConfig);

            expect(mockGet.mock.calls[0]?.[0].query?.["start"]).toBeUndefined();
        });
    });
});
