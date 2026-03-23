import { getFunctionABI } from "../abi";
import type { MoveFunction, MoveModule } from "../../types/move";

function createMockFunction(name: string, overrides: Partial<MoveFunction> = {}): MoveFunction {
    return {
        name,
        visibility: "public",
        is_entry: false,
        is_view: true,
        generic_type_params: [],
        params: [],
        return: [],
        ...overrides,
    };
}

function createMockModule(functions: MoveFunction[]): MoveModule {
    return {
        address: "0x1",
        name: "coin",
        friends: [],
        exposed_functions: functions,
        structs: [],
    };
}

describe("getFunctionABI", () => {
    it("should find function by name", async () => {
        const balanceFn = createMockFunction("balance", {
            params: ["address"],
            return: ["u64"],
        });
        const module = createMockModule([balanceFn]);

        const result = await getFunctionABI(module, "0x1", "coin", "balance");
        expect(result).toBe(balanceFn);
        expect(result.name).toBe("balance");
    });

    it("should throw when function not found", async () => {
        const module = createMockModule([createMockFunction("balance")]);

        await expect(
            getFunctionABI(module, "0x1", "coin", "transfer"),
        ).rejects.toThrow("Function 'transfer' not found in module '0x1::coin'");
    });

    it("should include module info in error message", async () => {
        const module = createMockModule([]);

        await expect(
            getFunctionABI(module, "0xdead", "token", "mint"),
        ).rejects.toThrow("Function 'mint' not found in module '0xdead::token'");
    });

    it("should work with multiple functions in module", async () => {
        const module = createMockModule([
            createMockFunction("balance"),
            createMockFunction("transfer"),
            createMockFunction("mint"),
        ]);

        const result = await getFunctionABI(module, "0x1", "coin", "transfer");
        expect(result.name).toBe("transfer");
    });
});
