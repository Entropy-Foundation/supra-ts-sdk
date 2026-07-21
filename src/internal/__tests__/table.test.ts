import { getTableItemInternal } from "../table";
import type { NetworkConfig } from "../../utils/apiEndpoints";

jest.mock("../../client/post", () => ({
    post: jest.fn(),
}));

import { post } from "../../client/post";
const mockPost = post as jest.MockedFunction<typeof post>;

const testConfig: NetworkConfig = {
    name: "testnet",
    chainId: 6,
    rpcUrl: "https://rpc-testnet.supra.com",
};

describe("internal/table", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe("getTableItemInternal", () => {
        it("should call post with the standardized handle path and body", async () => {
            const mockResult = { key: "value" };
            mockPost.mockResolvedValue(mockResult);

            const tableData = {
                key_type: "address",
                value_type: "u64",
                key: "0x1",
            };

            const result = await getTableItemInternal(
                { handle: "0x1", data: tableData },
                testConfig,
            );

            // The handle is standardized to a full 32-byte address and the path is
            // rooted with a leading slash, consistent with every other client path.
            expect(mockPost).toHaveBeenCalledWith(
                {
                    path: "/tables/0x0000000000000000000000000000000000000000000000000000000000000001/item",
                    data: tableData,
                },
                testConfig,
            );
            expect(result).toEqual(mockResult);
        });
    });
});
