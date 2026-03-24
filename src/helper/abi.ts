import type { MoveFunction, MoveModule } from "../types/move";

/**
 * Get the ABI of a function from a module
 * @param abi - The module ABI
 * @param moduleAddress - The address of the module
 * @param moduleName - The name of the module
 * @param functionName - The name of the function
 * @returns The function ABI
 */
export async function getFunctionABI(
    abi: MoveModule,
    moduleAddress: string,
    moduleName: string,
    functionName: string,
): Promise<MoveFunction> {
    const funcABI = abi.exposed_functions.find(
        (f) => f.name === functionName,
    );

    if (!funcABI) {
        throw new Error(
            `Function '${functionName}' not found in module '${moduleAddress}::${moduleName}'`,
        );
    }

    return funcABI;
}
