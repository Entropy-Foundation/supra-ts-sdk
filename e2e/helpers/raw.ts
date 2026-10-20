import type { E2EContext } from "./env";

/**
 * Plain `fetch` requests to the node. The harness uses these where a test must not depend on the SDK
 * code under test: funding accounts, reading balances and waiting for commits.
 */

export interface RawResponse<T> {
    status: number;
    headers: Headers;
    body: T;
}

export async function rawGet<T = unknown>(ctx: E2EContext, path: string): Promise<RawResponse<T>> {
    const response = await fetch(`${ctx.rpcUrl}${path}`);
    return { status: response.status, headers: response.headers, body: await readBody<T>(response) };
}

export async function rawPost<T = unknown>(ctx: E2EContext, path: string, payload: unknown): Promise<RawResponse<T>> {
    const response = await fetch(`${ctx.rpcUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    return { status: response.status, headers: response.headers, body: await readBody<T>(response) };
}

async function readBody<T>(response: Response): Promise<T> {
    const text = await response.text();
    try {
        return JSON.parse(text) as T;
    } catch {
        return text as unknown as T;
    }
}

export const SUPRA_COIN_TYPE = "0x1::supra_coin::SupraCoin";

/** The SUPRA balance of an account in Quants, read through the `0x1::coin::balance` view function. */
export async function rawSupraBalance(ctx: E2EContext, address: string): Promise<bigint> {
    const response = await rawPost<{ result: string[] }>(ctx, "/rpc/v3/view", {
        function: "0x1::coin::balance",
        type_arguments: [SUPRA_COIN_TYPE],
        arguments: [address],
    });
    if (response.status !== 200) {
        throw new Error(`view 0x1::coin::balance returned HTTP ${response.status}: ${JSON.stringify(response.body)}`);
    }
    return BigInt(response.body.result[0] ?? "0");
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls `read` until `done` accepts its value, or throws after `timeoutMs`. */
export async function pollUntil<T>(
    description: string,
    read: () => Promise<T>,
    done: (value: T) => boolean,
    timeoutMs = 180_000,
    intervalMs = 500,
): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        let value: T | undefined;
        let failure: unknown;
        try {
            value = await read();
            if (done(value)) {
                return value;
            }
        } catch (error) {
            failure = error;
        }
        if (Date.now() >= deadline) {
            throw new Error(
                `Timed out after ${timeoutMs} ms waiting for ${description}` +
                    (failure !== undefined ? `: ${String(failure)}` : ""),
            );
        }
        await sleep(intervalMs);
    }
}

/** Waits until the node reports the transaction as committed, and returns the node's JSON for it. */
export async function rawWaitForCommit(ctx: E2EContext, hash: string, timeoutMs = 180_000): Promise<RawTransaction> {
    return pollUntil(
        `transaction ${hash} to commit`,
        async () => {
            const response = await rawGet<RawTransaction>(ctx, `/rpc/v3/transactions/${hash}`);
            if (response.status !== 200) {
                throw new Error(`HTTP ${response.status}`);
            }
            return response.body;
        },
        (txn) => txn.status !== "Pending",
        timeoutMs,
    );
}

/** The fields of the node's transaction JSON that the harness reads. */
export interface RawTransaction {
    hash: string;
    status: string;
    txn_type?: string;
    header?: {
        sender: { Move: string };
        sequence_number: number | string;
        max_gas_amount: number | string;
        gas_unit_price: number | string;
        expiration_timestamp: { microseconds_since_unix_epoch: number | string };
        chain_id: number;
    };
    payload?: unknown;
    authenticator?: unknown;
    output?: {
        Move?: { events?: Array<{ type: string; data: unknown }>; gas_used?: number | string; vm_status?: string };
    } | null;
    block_header?: { height: number; hash: string } | null;
}
