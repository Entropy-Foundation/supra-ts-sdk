import { BCS, SupraAccount, type MoveFunctionId } from "supra-ts-sdk";
import { createClient, getFundedAccounts, runExample } from "./setup";

runExample(async () => {
    const supra = createClient();
    const [account] = await getFundedAccounts(supra, 1);
    if (account === undefined) {
        throw new Error("No account");
    }

    const receiverAddress = new SupraAccount().address();

    // The builders take the sequence number of the transaction. Nothing is submitted here, so the account's sequence
    // number on chain is the number of the simulated transaction.
    const senderSequenceNumber = (await supra.account.getAccountInfo({ accountAddress: account.address() }))
        .sequence_number;

    // SUPRA transfer payload
    const supraTransferPayload = {
        senderAddress: account.address(),
        senderSequenceNumber,
        function: "0x0000000000000000000000000000000000000000000000000000000000000001::supra_account::transfer" as MoveFunctionId,
        functionTypeArgs: [],
        functionArgs: [receiverAddress.toUint8Array(), BCS.bcsSerializeUint64(10_000n)],
        // The builder makes no request, so the node's gas unit price estimate is read here.
        optionalTransactionPayloadArgs: { gasUnitPrice: await supra.getEstimatedGasUnitPrice() },
    };

    // ---------------------------------------------------------------------------
    // Simulate a signed transaction
    // ---------------------------------------------------------------------------
    const supraCoinTransferRawTransaction = supra.transaction.build.rawTxnObject(supraTransferPayload);

    const sendTxnPayload = await supra.transaction.build.sendTxnPayload({
        senderAccount: account,
        rawTxn: supraCoinTransferRawTransaction,
    });

    const simulationResponse = await supra.transaction.simulate.simple({ sendTxPayload: sendTxnPayload });
    console.log("Simulation status:", simulationResponse.status);

    // ---------------------------------------------------------------------------
    // Simulate a serialized transaction with a placeholder signature
    // ---------------------------------------------------------------------------
    const supraCoinTransferSerializedRawTransaction = supra.transaction.build.rawTxnObject(supraTransferPayload);

    const simulationResponseSerialized = await supra.transaction.simulate.serialized({
        txAuthenticator: {
            Ed25519: {
                public_key: account.pubKey().toString(),
                signature: "0x" + "0".repeat(128),
            },
        },
        serializedRawTransaction: supraCoinTransferSerializedRawTransaction.toBytes(),
    });
    console.log("Simulation status:", simulationResponseSerialized.status);

    // ---------------------------------------------------------------------------
    // Shorthand: simulate with the account, or with a placeholder authenticator
    // ---------------------------------------------------------------------------
    const simulationResponse1 = await supraCoinTransferSerializedRawTransaction.simulate(account);
    console.log("Simulation status:", simulationResponse1.status);

    const simulationResponse2 = await supraCoinTransferSerializedRawTransaction.simulate({
        Ed25519: {
            public_key: account.pubKey().toString(),
            signature: "0x" + "0".repeat(128),
        },
    });
    console.log("Simulation status:", simulationResponse2.status);
});
