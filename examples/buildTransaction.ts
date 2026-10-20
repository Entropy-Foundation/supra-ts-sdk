import {
    BCS,
    HexString,
    MILLISECONDS_PER_SECOND,
    SupraAccount,
    TxnBuilderTypes,
    stringifyWithBigInt,
    type MoveFunctionId,
} from "supra-ts-sdk";
import { assertSuccess, createClient, getFundedAccounts, runExample } from "./setup";

runExample(async () => {
    const supra = createClient();
    const [account] = await getFundedAccounts(supra, 1);
    if (account === undefined) {
        throw new Error("No account");
    }

    const receiverAddress = new SupraAccount().address();
    const waitForCommit = { enableTransactionSimulation: true, enableWaitForTransaction: true };

    // The builders take the sequence number of the transaction. Every transaction below waits for its commit and the
    // account sends nothing else, so the account's sequence number on chain is the number of the first transaction
    // and each transaction uses the next one.
    let sequenceNumber = (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number;
    const nextSequenceNumber = (): bigint => sequenceNumber++;

    // SUPRA transfer payload
    const supraTransferPayload = () => ({
        senderAddress: account.address(),
        senderSequenceNumber: nextSequenceNumber(),
        function: "0x0000000000000000000000000000000000000000000000000000000000000001::supra_account::transfer" as MoveFunctionId,
        functionTypeArgs: [],
        functionArgs: [receiverAddress.toUint8Array(), BCS.bcsSerializeUint64(10_000n)],
    });

    // ---------------------------------------------------------------------------
    // Build a raw transaction from a function and arguments given as plain values
    // ---------------------------------------------------------------------------
    const supraCoinTransferSimpleTransaction = await supra.transaction.build.simple({
        senderAddress: account.address(),
        senderSequenceNumber: nextSequenceNumber(),
        function: "0x0000000000000000000000000000000000000000000000000000000000000001::supra_account::transfer_coins",
        functionTypeArgs: ["0x1::supra_coin::SupraCoin"],
        functionArgs: [receiverAddress.toString(), 10_000],
    });

    // Use the raw transaction above to send the transaction.
    const txn = await supra.transaction.submit.submitRawTransaction({
        senderAccount: account,
        rawTransaction: supraCoinTransferSimpleTransaction,
        enableTransactionWaitAndSimulationArgs: waitForCommit,
    });
    assertSuccess("submitRawTransaction", txn);
    console.log("Transaction committed:", txn.hash);

    // ---------------------------------------------------------------------------
    // Build a raw transaction object from serialized arguments
    // ---------------------------------------------------------------------------
    const supraCoinTransferRawTransaction = supra.transaction.build.rawTxnObject(supraTransferPayload());

    const txn2 = await supra.transaction.submit.submitSerializedRawTransaction({
        senderAccount: account,
        serializedRawTransaction: supraCoinTransferRawTransaction.toBytes(),
        enableTransactionWaitAndSimulationArgs: waitForCommit,
    });
    assertSuccess("submitSerializedRawTransaction", txn2);
    console.log("Transaction committed:", txn2.hash);

    // ---------------------------------------------------------------------------
    // Build the payload of a transaction submission request
    // ---------------------------------------------------------------------------
    const supraCoinTransferSendTxnPayload = await supra.transaction.build.sendTxnPayload({
        senderAccount: account,
        rawTxn: supra.transaction.build.rawTxnObject(supraTransferPayload()),
    });

    // Use the payload above to send the transaction with any HTTP client. The payload holds `bigint` values, which
    // `JSON.stringify` rejects; `stringifyWithBigInt` writes them as exact JSON numbers.
    const response = await fetch(`${supra.networkInformation.rpcUrl}/rpc/v3/transactions/submit`, {
        method: "POST",
        body: stringifyWithBigInt(supraCoinTransferSendTxnPayload),
        headers: {
            "Content-Type": "application/json",
        },
    });
    if (!response.ok) {
        throw new Error(`The submission returned HTTP ${response.status}: ${await response.text()}`);
    }
    const txn3Hash = (await response.json()) as string;
    console.log("Transaction submitted:", txn3Hash);
    const txn3 = await supra.transaction.waitForTransaction({ transactionHash: txn3Hash });
    assertSuccess("submit through fetch", txn3);
    console.log("Transaction committed:", txn3.hash);

    // ---------------------------------------------------------------------------
    // Build a script transaction
    // ---------------------------------------------------------------------------

    // To execute move-script
    const moveScriptCodeHex =
        "a11ceb0b060000000501000403040a050e0f071d29084620000000010002020300010304010002060c030001060c010503060c0503067369676e65720d73757072615f6163636f756e740a616464726573735f6f66087472616e736665720000000000000000000000000000000000000000000000000000000000000001000001060a000b0011000b01110102";

    const supraCoinTransferSerializedScriptRawTransaction = supra.transaction.build
        .scriptRawTxnObject({
            senderAddress: account.address(),
            senderSequenceNumber: nextSequenceNumber(),
            scriptCode: new HexString(moveScriptCodeHex).toUint8Array(),
            scriptTypeArgs: [],
            scriptArgs: [new TxnBuilderTypes.TransactionArgumentU64(1000n)],
        })
        .toBytes();

    const txn5 = await supra.transaction.submit.submitSerializedRawTransaction({
        senderAccount: account,
        serializedRawTransaction: supraCoinTransferSerializedScriptRawTransaction,
        enableTransactionWaitAndSimulationArgs: waitForCommit,
    });
    assertSuccess("script transaction", txn5);
    console.log("Transaction committed:", txn5.hash);

    // ---------------------------------------------------------------------------
    // Build an automation registration transaction
    // ---------------------------------------------------------------------------
    const supraCoinTransferAutomationSerializedRawTransaction = supra.transaction.build
        .automationRegistrationRawTxnObject({
            senderAddress: account.address(),
            senderSequenceNumber: nextSequenceNumber(),
            function: "0x0000000000000000000000000000000000000000000000000000000000000001::supra_account::transfer" as MoveFunctionId,
            functionTypeArgs: [],
            functionArgs: [receiverAddress.toUint8Array(), BCS.bcsSerializeUint64(1000n)],
            automationMaxGasAmount: 500n,
            // The cap must not be below the network's minimum gas unit price.
            automationGasPriceCap: (await supra.getMinGasUnitPrice()) * 2n,
            automationFeeCapForEpoch: 1_000_000_000n,
            automationExpirationTimestampSecs: BigInt(Math.floor(Date.now() / MILLISECONDS_PER_SECOND) + 60 * 60),
            automationAuxData: [],
        })
        .toBytes();

    const txn6 = await supra.transaction.submit.submitSerializedRawTransaction({
        senderAccount: account,
        serializedRawTransaction: supraCoinTransferAutomationSerializedRawTransaction,
        enableTransactionWaitAndSimulationArgs: waitForCommit,
    });
    assertSuccess("automation registration", txn6);
    console.log("Transaction committed:", txn6.hash);

    // ---------------------------------------------------------------------------
    // Create a multisig account that `account` owns
    // ---------------------------------------------------------------------------

    // The address of the multisig account that the creation below makes.
    const [multisigAddress] = await supra.methods.view<[string]>({
        function: "0x1::multisig_account::get_next_multisig_account_address",
        functionArguments: [account.address().toString()],
        typeArguments: [],
    });
    if (multisigAddress === undefined) {
        throw new Error("The node returned no multisig account address");
    }

    // One signature of the two owners is enough to execute a transaction.
    const multisigCreation = await supra.transaction.build.simple({
        senderAddress: account.address(),
        senderSequenceNumber: nextSequenceNumber(),
        function: "0x1::multisig_account::create_with_owners",
        functionTypeArgs: [],
        functionArgs: [[new SupraAccount().address().toString()], 1n, [], [], 3_600n],
    });
    const txn7 = await supra.transaction.submit.submitRawTransaction({
        senderAccount: account,
        rawTransaction: multisigCreation,
        enableTransactionWaitAndSimulationArgs: waitForCommit,
    });
    assertSuccess("multisig account creation", txn7);
    console.log(`Multisig account ${multisigAddress} created:`, txn7.hash);

    // The transfers of the multisig account below are paid from its balance.
    const txn8 = await supra.transaction.submit.submitSerializedRawTransaction({
        senderAccount: account,
        serializedRawTransaction: supra.transaction.build
            .rawTxnObject({
                senderAddress: account.address(),
                senderSequenceNumber: nextSequenceNumber(),
                function: "0x1::supra_account::transfer" as MoveFunctionId,
                functionTypeArgs: [],
                functionArgs: [new HexString(multisigAddress).toUint8Array(), BCS.bcsSerializeUint64(100_000n)],
            })
            .toBytes(),
        enableTransactionWaitAndSimulationArgs: waitForCommit,
    });
    assertSuccess("funding of the multisig account", txn8);

    // ---------------------------------------------------------------------------
    // Build a multisig transaction proposal
    // ---------------------------------------------------------------------------
    const multisigAccountAddress = new HexString(multisigAddress);

    const supraCoinTransferSerializedMultisigHashedRawTransaction = supra.transaction.build
        .multisigProposalTxRawTxnObject({
            senderAddress: account.address(),
            senderSequenceNumber: nextSequenceNumber(),
            multisigAddress: multisigAccountAddress,
            function: "0000000000000000000000000000000000000000000000000000000000000001::supra_account::transfer",
            functionTypeArgs: [],
            functionArgs: [receiverAddress.toUint8Array(), BCS.bcsSerializeUint64(1000n)],
        })
        .toBytes();

    const txn9 = await supra.transaction.submit.submitSerializedRawTransaction({
        senderAccount: account,
        serializedRawTransaction: supraCoinTransferSerializedMultisigHashedRawTransaction,
        enableTransactionWaitAndSimulationArgs: waitForCommit,
    });
    assertSuccess("multisig proposal", txn9);
    console.log("Transaction committed:", txn9.hash);

    // ---------------------------------------------------------------------------
    // Build a multisig transaction that executes the proposal
    // ---------------------------------------------------------------------------

    // The proposal has the creator's approval and the multisig account requires one, so it can be executed.
    const supraCoinTransferSerializedMultisigRawTransaction = supra.transaction.build
        .multisigRawTxnObject({
            senderAddress: account.address(),
            senderSequenceNumber: nextSequenceNumber(),
            multisigAddress: multisigAccountAddress,
            function: "0000000000000000000000000000000000000000000000000000000000000001::supra_account::transfer",
            functionTypeArgs: [],
            functionArgs: [receiverAddress.toUint8Array(), BCS.bcsSerializeUint64(1000n)],
        })
        .toBytes();

    const txn10 = await supra.transaction.submit.submitSerializedRawTransaction({
        senderAccount: account,
        serializedRawTransaction: supraCoinTransferSerializedMultisigRawTransaction,
        enableTransactionWaitAndSimulationArgs: waitForCommit,
    });
    assertSuccess("multisig execution", txn10);
    console.log("Transaction committed:", txn10.hash);
});
