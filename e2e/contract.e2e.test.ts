import type { SupraAccount } from "../src/index";
import { TransactionStatus, TypeTagParser } from "../src/index";
import { COIN_ABI, TIMESTAMP_ABI } from "./helpers/abi";
import { createFundedAccount } from "./helpers/accounts";
import { describeE2E } from "./helpers/describe";
import { getE2EContext, type E2EContext } from "./helpers/env";
import { SUPRA_COIN_TYPE, rawSupraBalance } from "./helpers/raw";
import { explicitGas } from "./helpers/transfers";

describeE2E("contract from ABI", () => {
    let ctx: E2EContext;
    let sender: SupraAccount;

    beforeAll(async () => {
        ctx = await getE2EContext();
        sender = await createFundedAccount(ctx);
    });

    test("a view function of the proxy returns the typed result", async () => {
        const instance = ctx.supra.contract.fromABI([COIN_ABI] as const);
        const [balance] = await instance.contracts.coin.view.balance({
            functionArguments: [sender.address().toString()],
            typeArguments: [SUPRA_COIN_TYPE],
        });
        expect(typeof balance).toBe("bigint");
        expect(balance).toBe(await rawSupraBalance(ctx, sender.address().toString()));
    });

    test("a view function without arguments returns the chain's time", async () => {
        const instance = ctx.supra.contract.fromABI([TIMESTAMP_ABI] as const);
        const [now] = await instance.contracts.timestamp.view.now_microseconds({
            functionArguments: [],
            typeArguments: [],
        });
        expect(Math.abs(Number(now / 1000n) - Date.now())).toBeLessThan(10 * 60 * 1000);
    });

    test("an entry function of the proxy submits a transaction that moves the coins", async () => {
        const receiver = (await createFundedAccount(ctx)).address().toString();
        const receiverBefore = await rawSupraBalance(ctx, receiver);
        const instance = ctx.supra.contract.fromABI([COIN_ABI] as const);

        const txn = await instance.contracts.coin.entry.transfer({
            functionArguments: [sender, receiver, 777n],
            typeArguments: [new TypeTagParser(SUPRA_COIN_TYPE).parseTypeTag()],
            optionalTransactionPayloadArgs: await explicitGas(ctx),
            enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true },
        });

        expect(txn.status).toBe(TransactionStatus.Success);
        expect(await rawSupraBalance(ctx, receiver)).toBe(receiverBefore + 777n);
    });

    test("an entry function of the proxy accepts a type argument written as a string", async () => {
        // `0x1::coin::transfer` needs a receiver with a coin store.
        const receiver = (await createFundedAccount(ctx)).address().toString();
        const receiverBefore = await rawSupraBalance(ctx, receiver);
        const instance = ctx.supra.contract.fromABI([COIN_ABI] as const);

        const txn = await instance.contracts.coin.entry.transfer({
            functionArguments: [sender, receiver, 778n],
            typeArguments: [SUPRA_COIN_TYPE],
            optionalTransactionPayloadArgs: await explicitGas(ctx),
            enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true },
        });

        expect(txn.status).toBe(TransactionStatus.Success);
        expect(await rawSupraBalance(ctx, receiver)).toBe(receiverBefore + 778n);
    });
});
