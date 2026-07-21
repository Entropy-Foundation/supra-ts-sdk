/**
 * Input validation utilities for API boundary checks.
 * These validators run at the public API layer to provide clear error messages
 * before requests are sent to the network.
 */

const HEX_ADDRESS_REGEX = /^0x[0-9a-fA-F]{1,64}$/;

/**
 * Validates that a value looks like a hex address (0x-prefixed hex string, 1-64 hex chars).
 * Accepts both raw strings and HexString objects (anything with a toString() producing a valid hex).
 * @throws Error if the address is invalid
 */
export function validateAddress(address: unknown, paramName = "address"): void {
    const str = typeof address === "string" ? address : (address != null && typeof (address as { toString(): string }).toString === "function") ? String(address) : undefined;
    if (!str || !HEX_ADDRESS_REGEX.test(str)) {
        throw new Error(
            `Invalid ${paramName}: expected a 0x-prefixed hex string (1-64 hex chars), got ${JSON.stringify(String(address))}`
        );
    }
}

/**
 * Validates a Move function identifier (e.g. "0x1::coin::balance").
 * Must have exactly three "::" separated parts where the first is a hex address.
 * @throws Error if the function ID is invalid
 */
export function validateFunctionId(functionId: unknown, paramName = "function"): void {
    if (typeof functionId !== "string") {
        throw new Error(`Invalid ${paramName}: expected a string, got ${typeof functionId}`);
    }
    const parts = functionId.split("::");
    if (parts.length !== 3) {
        throw new Error(
            `Invalid ${paramName}: expected format "0xADDR::module::function", got "${functionId}"`
        );
    }
    validateAddress(parts[0], `${paramName} module address`);
    if (!parts[1] || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(parts[1])) {
        throw new Error(`Invalid ${paramName}: module name "${parts[1]}" is not a valid Move identifier`);
    }
    if (!parts[2] || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(parts[2])) {
        throw new Error(`Invalid ${paramName}: function name "${parts[2]}" is not a valid Move identifier`);
    }
}

/**
 * Validates a Move struct identifier (e.g. "0x1::coin::CoinStore").
 * @throws Error if the struct ID is invalid
 */
export function validateStructId(structId: unknown, paramName = "resourceType"): void {
    if (typeof structId !== "string") {
        throw new Error(`Invalid ${paramName}: expected a string, got ${typeof structId}`);
    }
    // Strip generics for validation (e.g. "0x1::coin::CoinStore<0x1::supra_coin::SupraCoin>")
    const baseType = structId.includes("<") ? structId.slice(0, structId.indexOf("<")) : structId;
    const parts = baseType.split("::");
    if (parts.length !== 3) {
        throw new Error(
            `Invalid ${paramName}: expected format "0xADDR::module::StructName", got "${structId}"`
        );
    }
    validateAddress(parts[0], `${paramName} module address`);
}

/**
 * Validates a generic 0x-prefixed hex string (e.g. a transaction or block hash).
 * @throws Error if the value is not a non-empty 0x-prefixed hex string
 */
export function validateHexString(value: unknown, paramName = "value"): void {
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
        throw new Error(
            `Invalid ${paramName}: expected a 0x-prefixed hex string, got ${JSON.stringify(value)}`
        );
    }
}

/**
 * Validates a transaction hash (0x-prefixed hex string).
 * @throws Error if the hash is invalid
 */
export function validateTransactionHash(hash: unknown, paramName = "transactionHash"): void {
    validateHexString(hash, paramName);
}

/**
 * Validates a coin / fungible-asset amount: a non-negative integer supplied as a
 * `number` (must be a safe integer) or a `bigint` (for values beyond 2^53-1).
 * @throws Error if the amount is negative, fractional, or not a number/bigint
 */
export function validateAmount(amount: unknown, paramName = "amount"): void {
    if (typeof amount === "bigint") {
        if (amount < 0n) {
            throw new Error(`Invalid ${paramName}: must be non-negative, got ${amount}`);
        }
        return;
    }
    if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0) {
        throw new Error(
            `Invalid ${paramName}: expected a non-negative integer (use bigint for values above 2^53-1), got ${JSON.stringify(amount)}`
        );
    }
}

/**
 * Validates a block height: a non-negative integer.
 * @throws Error if the height is invalid
 */
export function validateBlockHeight(height: unknown, paramName = "height"): void {
    if (typeof height !== "number" || !Number.isInteger(height) || height < 0) {
        throw new Error(
            `Invalid ${paramName}: expected a non-negative integer, got ${JSON.stringify(height)}`
        );
    }
}

/**
 * Validates pagination count is a positive integer within bounds.
 * @throws Error if count is invalid
 */
export function validatePaginationCount(count: unknown, paramName = "count"): void {
    if (count === undefined || count === null) return;
    if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 100) {
        throw new Error(
            `Invalid ${paramName}: expected an integer between 1 and 100, got ${JSON.stringify(count)}`
        );
    }
}
