import { SupraAccount } from "supra-l1-sdk-core";
import { SupraClient } from "../../../../api/supraClient";
import type { SubmitTransactionResponse } from "../../../../types/transactionManager/transactionSubmit";
import { monotonicClock } from "../../../chainTime";
import type { MockNode } from "./mockNode";

/** Helpers for tests that send SUPRA transfers of one client to a `MockNode`. */

export const RPC_URL = "http://node.test";
export const RECEIVER = "0x" + "ab".repeat(32);

export function newClient(config: { txExpirySecs?: number } = {}): SupraClient {
    return new SupraClient({ rpcUrl: RPC_URL, chainId: 255, ...config });
}

export interface TransferOptions {
    amount?: bigint;
    maxGas?: bigint | undefined;
    simulate?: boolean;
    wait?: boolean;
    waitTimeoutMs?: number;
    /** Seconds since the Unix epoch. */
    txExpiryTime?: bigint;
    sequenceNumber?: bigint;
}

export function transfer(
    supra: SupraClient,
    sender: SupraAccount,
    options: TransferOptions = {},
): Promise<SubmitTransactionResponse> {
    return supra.coin.transferSupraCoin({
        senderAccount: sender,
        receiverAccountAddress: RECEIVER,
        amount: options.amount ?? 1_000n,
        optionalTransactionArgs: {
            optionalTransactionPayloadArgs: {
                ...(options.maxGas === undefined ? {} : { maxGas: options.maxGas }),
                ...(options.txExpiryTime === undefined ? {} : { txExpiryTime: options.txExpiryTime }),
                ...(options.sequenceNumber === undefined ? {} : { sequenceNumber: options.sequenceNumber }),
            },
            enableTransactionWaitAndSimulationArgs: {
                enableWaitForTransaction: options.wait ?? false,
                enableTransactionSimulation: options.simulate ?? false,
                ...(options.waitTimeoutMs === undefined ? {} : { waitTimeoutMs: options.waitTimeoutMs }),
            },
        },
    });
}

/**
 * The client's clocks: the wall clock is the real clock plus `offsetMs`, through a mock of `Date.now`, and the
 * monotonic clock is the real one plus `monotonicOffsetMs`, through a mock of the SDK's `monotonicClock.now`.
 * `advance` moves both clocks and the node's clock forward together; changing `offsetMs` alone steps only the wall
 * clock.
 */
export class ClientClock {
    offsetMs: number;
    monotonicOffsetMs = 0;
    private readonly realNow: () => number;

    constructor(offsetMs = 0) {
        this.offsetMs = offsetMs;
        const realNow = Date.now.bind(Date);
        const realMonotonicNow = performance.now.bind(performance);
        this.realNow = realNow;
        jest.spyOn(Date, "now").mockImplementation(() => realNow() + this.offsetMs);
        jest.spyOn(monotonicClock, "now").mockImplementation(() => realMonotonicNow() + this.monotonicOffsetMs);
    }

    /** The real time, without the offset. */
    real(): number {
        return this.realNow();
    }

    advance(node: MockNode, ms: number): void {
        this.offsetMs += ms;
        this.monotonicOffsetMs += ms;
        node.advance(ms);
    }
}

/** Rejects with "blocked" when `promise` has not settled within `ms` milliseconds. */
export function within<T>(promise: Promise<T>, ms = 2_000): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("blocked")), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
