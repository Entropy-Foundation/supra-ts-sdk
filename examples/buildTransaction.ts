import { MILLISECONDS_PER_SECOND, BCS, HexString, TxnBuilderTypes, type MoveFunctionId } from "supra-ts-sdk";
import { account } from "./account.setup";
import { createClient, fundAccountsIfRequested, usesCustomNode } from "./client.setup";

(async () => {
    const supra = createClient();
    await fundAccountsIfRequested(supra, [account]);

    // const account = SupraAccount.fromSupraAccountObject({
    //     address: "AccountAddress",
    //     privateKeyHex: `${"PrivateKey"}${"PublicKey (Without 0x)"}`,
    //     publicKeyHex: `0x${"PublicKey (Without 0x)"}`
    // });


    let receiverAddress = new HexString(
        // "1000000000000000000000000000000000000000000000000000000000000000"
        "0x2ee12e63209aee603c76e94e6fbb509629ec2617a65a858da62d862ad2818bc5"
    );

    // The builders take the sequence number of the transaction. Every transaction below waits for its commit, so the
    // account's sequence number on chain is the number of the next transaction.
    const nextSequenceNumber = async () =>
        (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number;

    // Supra Coin Transfer Payload
    const supraTransferPayload = async () => ({
        senderAddress: account.address(),
        senderSequenceNumber: await nextSequenceNumber(),
        function: "0x0000000000000000000000000000000000000000000000000000000000000001::supra_account::transfer" as MoveFunctionId,
        functionTypeArgs: [],
        functionArgs: [receiverAddress.toUint8Array(), BCS.bcsSerializeUint64(10000)]
    });

    // ---------------------------------------------------------------------------
    // Build serialized raw transaction object
    // ---------------------------------------------------------------------------

    let supraCoinTransferSimpleTransaction = await supra.transaction.build.simple({
        senderAddress: account.address(),
        senderSequenceNumber: await nextSequenceNumber(),
        function: "0x0000000000000000000000000000000000000000000000000000000000000001::supra_account::transfer_coins",
        functionTypeArgs: ["0x1::supra_coin::SupraCoin"],
        functionArgs: ["0x2ee12e63209aee603c76e94e6fbb509629ec2617a65a858da62d862ad2818bc5", 10000],

    })

    // You use can above serialized payload to send transaction.
    let txn = await supra.transaction.submit.submitRawTransaction({
        senderAccount: account,
        rawTransaction: supraCoinTransferSimpleTransaction,
        enableTransactionWaitAndSimulationArgs: {
            enableTransactionSimulation: true,
            enableWaitForTransaction: true
        }
    });

    console.log("Transaction submitted:", txn);

    // ---------------------------------------------------------------------------
    // Build non-serialized raw transaction object
    // ---------------------------------------------------------------------------

    let supraCoinTransferRawTransaction = supra.transaction.build.rawTxnObject(await supraTransferPayload())

    // You use can above serialized payload to send transaction.
    let txn2 = await supra.transaction.submit.submitSerializedRawTransaction({
        senderAccount: account,
        serializedRawTransaction: supraCoinTransferRawTransaction.toBytes(),
        enableTransactionWaitAndSimulationArgs: {
            enableTransactionSimulation: true,
            enableWaitForTransaction: true
        }
    });

    console.log("Transaction submitted:", txn2);

    // ---------------------------------------------------------------------------
    // Build send transaction payload
    // ---------------------------------------------------------------------------

    let supraCoinTransferSendTxnPayload = await supra.transaction.build.sendTxnPayload({
        senderAccount: account,
        rawTxn: supra.transaction.build.rawTxnObject(await supraTransferPayload())
    })

    // You use can above payload to send the transaction with any HTTP client. The payload holds `u64` fields as
    // `bigint`, which JSON.stringify cannot serialize; the values here are far below 2^53, so a number is exact.
    let txn3 = await fetch(`${supra.networkInformation.rpcUrl}/rpc/v3/transactions/submit`, {
        method: "POST",
        body: JSON.stringify(supraCoinTransferSendTxnPayload, (_key, value) => typeof value === "bigint" ? Number(value) : value),
        headers: {
            "Content-Type": "application/json"
        }
    });

    let txn3Hash = await txn3.json();
    console.log("Transaction submitted:", txn3Hash);
    console.log("Transaction committed:", await supra.transaction.waitForTransaction({ transactionHash: txn3Hash }));


    // ---------------------------------------------------------------------------
    // Build serialized raw transaction object
    // ---------------------------------------------------------------------------

    let supraCoinTransferSerializedRawTransaction = supra.transaction.build.rawTxnObject(await supraTransferPayload()).toBytes();

    // You use can above serialized payload to send transaction.
    let txn4 = await supra.transaction.submit.submitSerializedRawTransaction({
        senderAccount: account,
        serializedRawTransaction: supraCoinTransferSerializedRawTransaction,
        enableTransactionWaitAndSimulationArgs: {
            enableTransactionSimulation: true,
            enableWaitForTransaction: true
        }
    });

    console.log("Transaction submitted:", txn4);


    // ---------------------------------------------------------------------------
    // Build serialized script raw transaction object
    // ---------------------------------------------------------------------------

    // To execute move-script
    let moveScriptCodeHex =
        "a11ceb0b060000000501000403040a050e0f071d29084620000000010002020300010304010002060c030001060c010503060c0503067369676e65720d73757072615f6163636f756e740a616464726573735f6f66087472616e736665720000000000000000000000000000000000000000000000000000000000000001000001060a000b0011000b01110102";

    let supraCoinTransferSerializedScriptRawTransaction = supra.transaction.build.scriptRawTxnObject({
        senderAddress: account.address(),
        senderSequenceNumber: await nextSequenceNumber(),
        scriptCode: new HexString(moveScriptCodeHex).toUint8Array(),
        scriptTypeArgs: [],
        scriptArgs: [new TxnBuilderTypes.TransactionArgumentU64(BigInt(1000))]
    }).toBytes();

    // You use can above serialized payload to send transaction.
    let txn5 = await supra.transaction.submit.submitSerializedRawTransaction({
        senderAccount: account,
        serializedRawTransaction: supraCoinTransferSerializedScriptRawTransaction,
        enableTransactionWaitAndSimulationArgs: {
            enableTransactionSimulation: true,
            enableWaitForTransaction: true
        }
    });

    console.log("Transaction submitted:", txn5);


    // ---------------------------------------------------------------------------
    // Build serialized automation registration payload object
    // ---------------------------------------------------------------------------

    let supraCoinTransferAutomationSerializedRawTransaction = supra.transaction.build.automationRegistrationRawTxnObject({
        senderAddress: account.address(),
        senderSequenceNumber: await nextSequenceNumber(),
        function: "0x0000000000000000000000000000000000000000000000000000000000000001::supra_account::transfer" as MoveFunctionId,
        functionTypeArgs: [],
        functionArgs: [receiverAddress.toUint8Array(), BCS.bcsSerializeUint64(1000)],
        automationMaxGasAmount: BigInt(500),
        // The cap must not be below the network's minimum gas unit price.
        automationGasPriceCap: (await supra.getMinGasUnitPrice()) * BigInt(2),
        automationFeeCapForEpoch: BigInt(1000000000),
        automationExpirationTimestampSecs: BigInt(Math.floor(Date.now() / MILLISECONDS_PER_SECOND) + 60 * 60),
        automationAuxData: [],
    }).toBytes();

    // You use can above serialized payload to send transaction.
    let txn6 = await supra.transaction.submit.submitSerializedRawTransaction({
        senderAccount: account,
        serializedRawTransaction: supraCoinTransferAutomationSerializedRawTransaction,
        enableTransactionWaitAndSimulationArgs: {
            enableTransactionSimulation: true,
            enableWaitForTransaction: true
        }
    });

    console.log("Transaction submitted:", txn6);


    // ---------------------------------------------------------------------------
    // Build serialized multisig transaction proposal raw transaction object
    // ---------------------------------------------------------------------------

    // The multisig account must exist on the network. The default is an account on Testnet; on any other node, set
    // SUPRA_EXAMPLES_MULTISIG_ADDRESS to a multisig account whose owner is `account`.
    const multisigAddress = process.env["SUPRA_EXAMPLES_MULTISIG_ADDRESS"]
        ?? (usesCustomNode() ? undefined : "0x5ccc30b127e0be0b83f226aed2d7387eee261390f1548483530e15d0208cba65");

    if (multisigAddress === undefined) {
        console.log("Skipping the multisig transactions: set SUPRA_EXAMPLES_MULTISIG_ADDRESS to a multisig account on this network.");
        return;
    }

    let multisigAccountAddress = new HexString(multisigAddress);

    let supraCoinTransferSerializedMultisigHashedRawTransaction = supra.transaction.build.multisigProposalTxRawTxnObject(
        {
            senderAddress: account.address(),
            senderSequenceNumber: await nextSequenceNumber(),
            multisigAddress: multisigAccountAddress,
            function: "0000000000000000000000000000000000000000000000000000000000000001::supra_account::transfer",
            functionTypeArgs: [],
            functionArgs: [receiverAddress.toUint8Array(), BCS.bcsSerializeUint64(1000)]
        }
    ).toBytes();

    // You use can above serialized payload to send transaction.
    let txn7 = await supra.transaction.submit.submitSerializedRawTransaction({
        senderAccount: account,
        serializedRawTransaction: supraCoinTransferSerializedMultisigHashedRawTransaction,
        enableTransactionWaitAndSimulationArgs: {
            enableTransactionSimulation: true,
            enableWaitForTransaction: true
        }
    });

    console.log("Transaction submitted:", txn7);

    // ---------------------------------------------------------------------------
    // Build serialized multisig raw transaction object
    // ---------------------------------------------------------------------------

    // Executing multisig transaction.
    // Note: The used multisig account only require single approval which is provided at the time of
    // txn creation hence no need of approval.
    let supraCoinTransferSerializedMultisigRawTransaction = supra.transaction.build.multisigRawTxnObject(
        {
            senderAddress: account.address(),
            senderSequenceNumber: await nextSequenceNumber(),
            multisigAddress: multisigAccountAddress,
            function: "0000000000000000000000000000000000000000000000000000000000000001::supra_account::transfer",
            functionTypeArgs: [],
            functionArgs: [receiverAddress.toUint8Array(), BCS.bcsSerializeUint64(1000)]
        }
    ).toBytes();

    // You use can above serialized payload to send transaction.
    let txn8 = await supra.transaction.submit.submitSerializedRawTransaction({
        senderAccount: account,
        serializedRawTransaction: supraCoinTransferSerializedMultisigRawTransaction,
        enableTransactionWaitAndSimulationArgs: {
            enableTransactionSimulation: true,
            enableWaitForTransaction: true
        }
    });

    console.log("Transaction submitted:", txn8);

})();
