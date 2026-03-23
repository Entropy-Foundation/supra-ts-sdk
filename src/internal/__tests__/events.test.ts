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
                    options: { startHeight: 100, endHeight: 200, limit: 50, start: 0 },
                },
                testConfig,
            );

            expect(mockGet).toHaveBeenCalledWith(
                {
                    path: "/events/0x1::coin::Transfer",
                    query: {
                        start_height: 100,
                        end_height: 200,
                        limit: 50,
                        start: 0,
                    },
                },
                testConfig,
            );
            expect(result.cursor).toBe("cursor1");
        });
    });
});
