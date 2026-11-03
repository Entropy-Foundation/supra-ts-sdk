import { randomBytes } from "node:crypto";
import { BCS, HexString, SupraNotFoundError, SupraRouteUnsupportedError, TransactionStatus } from "../src/index";
import type { SendTxnPayload, SupraAccount } from "../src/index";
import { createFundedAccount, createUnfundedAccount } from "./helpers/accounts";
import { describeE2E, nodeGeneration } from "./helpers/describe";
import { getE2EContext, type E2EContext } from "./helpers/env";
import { pollUntil, rawGet, rawPost } from "./helpers/raw";
import { explicitGas, sendSupra } from "./helpers/transfers";

/**
 * Routes that only `/rpc/v4` serves. A v12 node answers them; a v11.7.x node answers HTTP 404 for them, which the
 * SDK throws as `SupraRouteUnsupportedError`, except `POST /rpc/v4/transactions/simulate`, which a v11.7.x node
 * answers as `/rpc/v3` does, without the state-change fields.
 */
const onV12 = nodeGeneration() === "v12";
const onV11 = nodeGeneration() === "v11";
const testOnV12: jest.It = onV12 ? test : test.skip;
const testOnV11: jest.It = onV11 ? test : test.skip;

const SUPRA_COIN = "0x1::supra_coin::SupraCoin";

describeE2E("v4 operations", () => {
    let ctx: E2EContext;
    let sender: SupraAccount;

    beforeAll(async () => {
        ctx = await getE2EContext();
        sender = await createFundedAccount(ctx);
    });

    async function transferPayload(): Promise<SendTxnPayload> {
        const info = await ctx.supra.account.getAccountInfo({ accountAddress: sender.address() });
        const rawTxn = ctx.supra.transaction.build.rawTxnObject({
            senderAddress: sender.address(),
            senderSequenceNumber: info.sequence_number,
            function: "0x1::supra_account::transfer",
            functionTypeArgs: [],
            functionArgs: [
                new HexString(createUnfundedAccount().address().toString()).toUint8Array(),
                BCS.bcsSerializeUint64(5_000n),
            ],
            optionalTransactionPayloadArgs: await explicitGas(ctx),
        });
        return ctx.supra.transaction.build.sendTxnPayload({ senderAccount: sender, rawTxn });
    }

    describe("viewBatch", () => {
        const requests = [
            { function: "0x1::timestamp::now_microseconds" as const },
            { function: "0x1::chain_id::get" as const },
            { function: "0x1::coin::balance" as const, typeArguments: [SUPRA_COIN], functionArguments: ["0x1"] },
        ];

        testOnV12("executes the elements against one snapshot and converts each result", async () => {
            const response = await ctx.supra.methods.viewBatch({ requests });

            expect(typeof response.state_height).toBe("number");
            expect(response.results).toHaveLength(3);
            const [timestamp, chainId, balance] = response.results;
            expect(typeof timestamp?.result?.[0]).toBe("bigint");
            expect(chainId?.result).toEqual([ctx.chainId]);
            expect(typeof balance?.result?.[0]).toBe("bigint");

            const single = await ctx.supra.methods.view({ function: "0x1::chain_id::get" });
            expect(chainId?.result).toEqual(single);
        });

        testOnV12("reports a failing element in its entry and still answers the others", async () => {
            const response = await ctx.supra.methods.viewBatch({
                requests: [
                    { function: "0x1::chain_id::get" },
                    // A struct type argument that does not exist: the node refuses this element only.
                    { function: "0x1::coin::balance", typeArguments: ["0x1::nope::Nope"], functionArguments: ["0x1"] },
                    { function: "0x1::chain_id::get" },
                ],
            });

            expect(response.results[0]?.result).toEqual([ctx.chainId]);
            expect(response.results[1]?.error?.status).toBeGreaterThanOrEqual(400);
            expect(typeof response.results[1]?.error?.message).toBe("string");
            expect(response.results[2]?.result).toEqual([ctx.chainId]);
        });

        testOnV11("is unsupported", async () => {
            const failure = await ctx.supra.methods.viewBatch({ requests }).catch((error: unknown) => error);

            expect(failure).toBeInstanceOf(SupraRouteUnsupportedError);
            expect(failure).toMatchObject({ method: "viewBatch", status: 404 });
        });
    });

    describe("getTransactionsByHashes", () => {
        const unknownHash = `0x${randomBytes(32).toString("hex")}`;

        testOnV12(
            "answers a known hash with the transaction and an unknown one with null, in request order",
            async () => {
                const sent = await sendSupra(ctx, sender, createUnfundedAccount().address().toString(), 1_000n);

                const response = await ctx.supra.transaction.getTransactionsByHashes({
                    transactionHashes: [unknownHash, sent.hash, sent.hash],
                });

                expect(response.omitted).toEqual([]);
                expect(response.transactions.map((entry) => entry.hash)).toEqual([unknownHash, sent.hash, sent.hash]);
                expect(response.transactions[0]?.transaction).toBeNull();
                for (const entry of response.transactions.slice(1)) {
                    expect(entry.transaction?.hash).toBe(sent.hash);
                    expect(entry.transaction?.status).toBe(TransactionStatus.Success);
                }
                const single = await ctx.supra.transaction.getTransactionByHash({ transactionHash: sent.hash });
                expect(response.transactions[1]?.transaction?.status).toBe(single.status);
            },
        );

        testOnV12("returns inclusion_proof when asked, and the node's 400 for more hashes than it allows", async () => {
            const sent = await sendSupra(ctx, sender, createUnfundedAccount().address().toString(), 1_001n);

            const withProof = await ctx.supra.transaction.getTransactionsByHashes({
                transactionHashes: [sent.hash],
                include_proof: true,
            });
            expect(withProof.transactions[0]?.transaction).toHaveProperty("inclusion_proof");

            const tooMany = Array.from({ length: 101 }, () => sent.hash);
            const failure = await ctx.supra.transaction
                .getTransactionsByHashes({ transactionHashes: tooMany })
                .catch((error: unknown) => error);
            expect(failure).toMatchObject({ status: 400 });
        });

        testOnV11("is unsupported", async () => {
            const failure = await ctx.supra.transaction
                .getTransactionsByHashes({ transactionHashes: [unknownHash] })
                .catch((error: unknown) => error);

            expect(failure).toBeInstanceOf(SupraRouteUnsupportedError);
            expect(failure).toMatchObject({ method: "getTransactionsByHashes" });
        });
    });

    describe("simulate.withStateChanges", () => {
        testOnV12("reports the changes and the prior value of each changed state key", async () => {
            const sendTxPayload = await transferPayload();

            const simulated = await ctx.supra.transaction.simulate.withStateChanges({ sendTxPayload });

            expect(simulated.status).toBe(TransactionStatus.Success);
            expect(typeof simulated.state_height).toBe("number");
            expect(simulated.changes_truncated).toBe(false);
            expect(simulated.omitted).toEqual([]);
            expect(simulated.omitted_counts).toEqual({ resource: 0, resource_group: 0, module: 0, table_item: 0 });
            expect(simulated.changes?.length).toBeGreaterThan(0);
            const priorValues = simulated.prior_values ?? {};
            for (const change of simulated.changes ?? []) {
                expect(Object.keys(priorValues)).toContain(change.state_key_hash);
            }
            // The sender's account is rewritten with the next sequence number; the receiver's account is new.
            const accountWrite = simulated.changes?.find(
                (change) => change.type === "write_resource" && change.data.type === "0x1::account::Account",
            );
            expect(accountWrite).toBeDefined();
            expect(Object.values(priorValues)).toContain(null);

            // The simulation changes no state.
            const info = await ctx.supra.account.getAccountInfo({ accountAddress: sender.address() });
            expect(info.sequence_number).toBe(BigInt(sendTxPayload.Move.raw_txn.sequence_number));
        });

        testOnV11("answers as v3 does: the transaction without the state-change fields", async () => {
            const simulated = await ctx.supra.transaction.simulate.withStateChanges({
                sendTxPayload: await transferPayload(),
            });

            expect(simulated.status).toBe(TransactionStatus.Success);
            expect(simulated.state_height).toBeUndefined();
            expect(simulated.changes).toBeUndefined();
            expect(simulated.prior_values).toBeUndefined();
            expect(simulated.omitted).toBeUndefined();
            expect(simulated.omitted_counts).toBeUndefined();
            expect(simulated.changes_truncated).toBeUndefined();
        });

        test("simple keeps returning the v3 shape", async () => {
            const simulated = await ctx.supra.transaction.simulate.simple({ sendTxPayload: await transferPayload() });

            expect(simulated.status).toBe(TransactionStatus.Success);
            expect(simulated).not.toHaveProperty("changes");
        });
    });

    describe("settlements", () => {
        async function deposit(amount: bigint, evmRecipient: Uint8Array): Promise<string> {
            const info = await ctx.supra.account.getAccountInfo({ accountAddress: sender.address() });
            const rawTxn = ctx.supra.transaction.build.rawTxnObject({
                senderAddress: sender.address(),
                senderSequenceNumber: info.sequence_number,
                function: "0x1::evm_settlement::deposit_to_evm",
                functionTypeArgs: [],
                functionArgs: [BCS.bcsSerializeUint64(amount), BCS.bcsSerializeBytes(evmRecipient)],
                optionalTransactionPayloadArgs: { maxGas: 20_000n, gasUnitPrice: await ctx.supra.getMinGasUnitPrice() },
            });
            const submitted = await ctx.supra.transaction.submit.submitRawTransaction({
                senderAccount: sender,
                rawTransaction: rawTxn,
                enableTransactionWaitAndSimulationArgs: { enableWaitForTransaction: true },
            });
            expect(submitted.status).toBe(TransactionStatus.Success);
            return submitted.hash;
        }

        testOnV12("traces a Move to EVM crossing by address and by id", async () => {
            const recipientBytes = new Uint8Array(randomBytes(20));
            const recipient = `0x${Buffer.from(recipientBytes).toString("hex")}`;
            const senderAddress = sender.address().toString();

            const empty = await ctx.supra.transaction.getSettlements({ address: recipient, domain: "evm" });
            expect(empty.response).toEqual([]);

            const depositHash = await deposit(12_345n, recipientBytes);

            const bySender = await pollUntil(
                "the crossing in the sender's settlements",
                () => ctx.supra.transaction.getSettlements({ address: senderAddress, domain: "move" }),
                (page) => page.response.length > 0,
            );
            expect(bySender.response).toHaveLength(1);
            const settlement = bySender.response[0]!;
            expect(settlement.stages[0]).toMatchObject({
                stage: "recorded",
                transaction_hash: depositHash.replace(/^0x/, ""),
                amount: 12_345,
            });
            expect(settlement.stages[0]?.recipient).toEqual({ domain: "evm", address: recipient });

            const byRecipient = await ctx.supra.transaction.getSettlements({
                address: recipient,
                domain: "evm",
                options: { role: "recipient" },
            });
            expect(byRecipient.response.map((entry) => entry.settlement_id)).toEqual([settlement.settlement_id]);
            const asSender = await ctx.supra.transaction.getSettlements({
                address: recipient,
                domain: "evm",
                options: { role: "sender" },
            });
            expect(asSender.response).toEqual([]);

            const settled = await pollUntil(
                "the crossing to be credited on the EVM",
                () => ctx.supra.transaction.getSettlement({ settlementId: settlement.settlement_id }),
                (value) => value.stages.some((stage) => stage.stage === "credited_on_evm"),
            );
            expect(settled.settlement_id).toBe(settlement.settlement_id);
            expect(settled.stages.map((stage) => stage.stage)).toEqual(
                expect.arrayContaining(["recorded", "credited_on_evm"]),
            );
        });

        testOnV12("follows the cursor of a feed to its end", async () => {
            const recipientBytes = new Uint8Array(randomBytes(20));
            const recipient = `0x${Buffer.from(recipientBytes).toString("hex")}`;
            await deposit(1_001n, recipientBytes);
            await deposit(1_002n, recipientBytes);
            await pollUntil(
                "both crossings in the recipient's settlements",
                () => ctx.supra.transaction.getSettlements({ address: recipient, domain: "evm" }),
                (page) => page.response.length === 2,
            );

            const ids: string[] = [];
            let start: string | undefined;
            let requests = 0;
            do {
                const page = await ctx.supra.transaction.getSettlements({
                    address: recipient,
                    domain: "evm",
                    options: { count: 1, start },
                });
                ids.push(...page.response.map((entry) => entry.settlement_id));
                start = page.cursor;
                requests++;
                expect(requests).toBeLessThan(10);
            } while (start !== undefined);

            expect(new Set(ids).size).toBe(2);
        });

        testOnV12("an unknown settlement id is SupraNotFoundError, not an unsupported route", async () => {
            const failure = await ctx.supra.transaction
                .getSettlement({ settlementId: `0x${randomBytes(32).toString("hex")}` })
                .catch((error: unknown) => error);

            expect(failure).toBeInstanceOf(SupraNotFoundError);
            expect(failure).not.toBeInstanceOf(SupraRouteUnsupportedError);
        });

        testOnV12("pads a short address to the domain's width and rejects a longer one locally", async () => {
            const padded = await ctx.supra.transaction.getSettlements({ address: "0x1", domain: "move" });
            expect(padded.response).toEqual([]);
            const evm = await ctx.supra.transaction.getSettlements({ address: "0x01", domain: "evm" });
            expect(evm.response).toEqual([]);

            await expect(
                ctx.supra.transaction.getSettlements({ address: `0x${"11".repeat(32)}`, domain: "evm" }),
            ).rejects.toThrow("1 to 40 hex digits");
        });

        testOnV11("are unsupported", async () => {
            const address = `0x${randomBytes(20).toString("hex")}`;
            const list = await ctx.supra.transaction
                .getSettlements({ address, domain: "evm" })
                .catch((error: unknown) => error);
            const byId = await ctx.supra.transaction
                .getSettlement({ settlementId: `0x${randomBytes(32).toString("hex")}` })
                .catch((error: unknown) => error);

            expect(list).toBeInstanceOf(SupraRouteUnsupportedError);
            expect(list).toMatchObject({ method: "getSettlements" });
            expect(byId).toBeInstanceOf(SupraRouteUnsupportedError);
            expect(byId).toMatchObject({ method: "getSettlement" });
        });
    });

    describe("getNativeSupply", () => {
        testOnV12("reports the cross-VM accounting as of one height", async () => {
            const supply = await ctx.supra.fungibleAsset.getNativeSupply();

            expect(typeof supply.as_of_height).toBe("number");
            for (const wei of [supply.evm_supply_wei, supply.in_flight_wei, supply.dust_wei, supply.claimed_wei]) {
                expect(wei).toMatch(/^\d+$/);
            }
            expect(typeof supply.burn_owed_quants).toBe("number");
            expect(typeof supply.escrow_settled_quants).toBe("number");
            expect(typeof supply.in_flight.count).toBe("number");
            expect(supply.in_flight.value_wei).toMatch(/^\d+$/);
            // A fully backed mirror has no shortfall.
            expect(supply.escrow_shortfall_wei).toBe("0");

            const raw = await rawGet<{ as_of_height: number }>(ctx, "/rpc/v4/supply/native");
            expect(raw.status).toBe(200);
            expect(raw.body.as_of_height).toBeGreaterThanOrEqual(supply.as_of_height);
        });

        testOnV11("is unsupported", async () => {
            const failure = await ctx.supra.fungibleAsset.getNativeSupply().catch((error: unknown) => error);

            expect(failure).toBeInstanceOf(SupraRouteUnsupportedError);
            expect(failure).toMatchObject({ method: "getNativeSupply", status: 404 });
            const raw = await rawGet(ctx, "/rpc/v4/supply/native");
            expect(raw.status).toBe(404);
        });
    });

    test("view still reaches /rpc/v3", async () => {
        const v3 = await rawPost<{ result: unknown[] }>(ctx, "/rpc/v3/view", {
            function: "0x1::chain_id::get",
            type_arguments: [],
            arguments: [],
        });
        expect(v3.status).toBe(200);
        expect(await ctx.supra.methods.view({ function: "0x1::chain_id::get" })).toEqual(v3.body.result);
    });
});
