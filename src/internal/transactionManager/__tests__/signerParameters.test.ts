import type { MoveModule } from "../../../types/move";
import { generateTransactionPayload } from "../txnBuild";
import type { NetworkConfig } from "../../../utils/apiEndpoints";

const config: NetworkConfig = { name: "custom", chainId: 255, rpcUrl: "http://localhost:1" };

function moduleWith(params: string[]): MoveModule {
    return {
        address: "0x1",
        name: "m",
        friends: [],
        structs: [],
        exposed_functions: [
            {
                name: "f",
                visibility: "public",
                is_entry: true,
                is_view: false,
                generic_type_params: [],
                params,
                return: [],
            },
        ],
    } as unknown as MoveModule;
}

async function payloadFor(params: string[], functionArgs: unknown[]) {
    return generateTransactionPayload(
        { function: "0x1::m::f", functionTypeArgs: [], functionArgs: functionArgs as never, abi: moduleWith(params) },
        config,
    );
}

describe("leading signer parameters of an entry function", () => {
    it("strips one &signer", async () => {
        const { functionArguments } = await payloadFor(["&signer", "u8"], [7]);
        expect(functionArguments.map((a) => Array.from(a))).toEqual([[7]]);
    });

    it("strips every leading &signer and signer", async () => {
        for (const params of [
            ["&signer", "&signer"],
            ["&signer", "signer", "u8"],
            ["signer", "signer", "&signer", "u8"],
        ]) {
            const values = params.filter((p) => p === "u8").map(() => 7);
            const { functionArguments } = await payloadFor(params, values);
            expect(functionArguments).toHaveLength(values.length);
        }
    });

    it("keeps all parameters of a function without a signer", async () => {
        const { functionArguments } = await payloadFor(["u8", "u8"], [1, 2]);
        expect(functionArguments).toHaveLength(2);
    });

    it("does not strip a signer parameter that follows a value parameter", async () => {
        await expect(payloadFor(["u8", "&signer"], [1])).rejects.toThrow(/Argument count mismatch/);
    });

    it("reports a count mismatch with the signer parameters excluded", async () => {
        await expect(payloadFor(["&signer", "&signer", "u8"], [])).rejects.toThrow(
            "Argument count mismatch: expected 1, got 0",
        );
    });
});
