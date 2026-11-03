import type { SupraAccount } from "../src/index";
import {
    BCS,
    SupraAPIError,
    SupraNotFoundError,
    TransactionStatus,
    TxnBuilderTypes,
    type MoveFunctionId,
} from "../src/index";
import { createFundedAccount, createUnfundedAccount } from "./helpers/accounts";
import { describeE2E, nodeGeneration } from "./helpers/describe";
import { getE2EContext, type E2EContext } from "./helpers/env";
import { rawWaitForCommit } from "./helpers/raw";

/**
 * A sponsored transaction with sequence number 0 from a sender that has no `Account` resource. The simulation with
 * zeroed signatures succeeds on every node. A v12 node admits the submission and the sender's `Account` is created by
 * the transaction; a v11 node refuses it with HTTP 400.
 */
describeE2E("sponsored transaction from a sender without an account", () => {
    let ctx: E2EContext;

    beforeAll(async () => {
        ctx = await getE2EContext();
    });

    async function build(sender: SupraAccount, feePayer: SupraAccount) {
        const rawTxn = ctx.supra.transaction.build.rawTxnObject({
            senderAddress: sender.address(),
            senderSequenceNumber: 0n,
            function: "0x1::supra_account::create_account" as MoveFunctionId,
            functionTypeArgs: [],
            functionArgs: [createUnfundedAccount().address().toUint8Array()],
            optionalTransactionPayloadArgs: {
                maxGas: 20_000n,
                gasUnitPrice: await ctx.supra.getEstimatedGasUnitPrice(),
            },
        });
        const target = new TxnBuilderTypes.FeePayerRawTransaction(
            rawTxn,
            [],
            new TxnBuilderTypes.AccountAddress(feePayer.address().toUint8Array()),
        );
        const senderAuthenticator = (await ctx.supra.transaction.signTransaction({
            senderAccount: sender,
            rawTxn: target,
        })) as TxnBuilderTypes.AccountAuthenticatorEd25519;
        const feePayerAuthenticator = (await ctx.supra.transaction.signTransaction({
            senderAccount: feePayer,
            rawTxn: target,
        })) as TxnBuilderTypes.AccountAuthenticatorEd25519;
        return { rawTxn, senderAuthenticator, feePayerAuthenticator };
    }

    test("the first transaction of a new sender: simulation, then submission by node generation", async () => {
        const sender = createUnfundedAccount();
        const feePayer = await createFundedAccount(ctx);
        const accountAddress = sender.address();
        expect(await ctx.supra.account.isAccountExists({ accountAddress })).toBe(false);

        const { rawTxn, senderAuthenticator, feePayerAuthenticator } = await build(sender, feePayer);

        const zeroSignature = "0x" + "00".repeat(64);
        const simulated = await ctx.supra.transaction.simulate.serialized({
            txAuthenticator: {
                FeePayer: {
                    sender: { Ed25519: { public_key: sender.pubKey().toString(), signature: zeroSignature } },
                    secondary_signer_addresses: [],
                    secondary_signers: [],
                    fee_payer_address: feePayer.address().toString(),
                    fee_payer_signer: {
                        Ed25519: { public_key: feePayer.pubKey().toString(), signature: zeroSignature },
                    },
                },
            },
            serializedRawTransaction: BCS.bcsToBytes(rawTxn),
        });
        expect(simulated.status).toBe(TransactionStatus.Success);

        const submit = () =>
            rawTxn.submitSponsorTransaction({
                feePayerAddress: feePayer.address().toString(),
                secondarySignersAccountAddress: [],
                senderAuthenticator,
                feePayerAuthenticator,
                secondarySignersAuthenticator: [],
            });

        if (nodeGeneration() === "v11") {
            const error = await submit().then(
                () => undefined,
                (reason: unknown) => reason,
            );
            expect(error).toBeInstanceOf(SupraAPIError);
            expect((error as SupraAPIError).status).toBe(400);
            expect((error as SupraAPIError).message).toContain("Failed to read the AccountResource");
            expect(await ctx.supra.account.isAccountExists({ accountAddress })).toBe(false);
            return;
        }

        // On a v12 node an absent account is a 404.
        await expect(ctx.supra.account.getAccountInfo({ accountAddress })).rejects.toBeInstanceOf(SupraNotFoundError);
        const submitted = await submit();
        const committed = await rawWaitForCommit(ctx, submitted.hash);
        expect(committed.status).toBe(TransactionStatus.Success);
        const info = await ctx.supra.account.getAccountInfo({ accountAddress });
        expect(BigInt(info.sequence_number)).toBe(1n);
    });
});
