import type { SupraAccount } from "../../src/index";
import type { E2EContext } from "./env";
import { rawWaitForCommit, type RawTransaction } from "./raw";

/**
 * Sends SUPRA from `sender` to `receiver` with the SDK and waits for the commit with a plain request.
 * Used to give an account some history before a test reads it back. The gas settings are explicit so
 * that the transfer does not depend on the SDK's default gas selection.
 */
export async function sendSupra(
    ctx: E2EContext,
    sender: SupraAccount,
    receiver: string,
    amount: bigint,
): Promise<RawTransaction> {
    const submitted = await ctx.supra.coin.transferSupraCoin({
        senderAccount: sender,
        receiverAccountAddress: receiver,
        amount,
        optionalTransactionArgs: {
            optionalTransactionPayloadArgs: await explicitGas(ctx),
        },
    });
    return rawWaitForCommit(ctx, submitted.hash);
}

/** Gas settings that cover a transfer to a new receiver at the node's minimum gas price. */
export async function explicitGas(ctx: E2EContext): Promise<{ maxGas: bigint; gasUnitPrice: bigint }> {
    return { maxGas: 5_000n, gasUnitPrice: await ctx.supra.getMinGasUnitPrice() };
}
