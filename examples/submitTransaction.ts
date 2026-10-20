import { BCS, SupraAccount, TxnBuilderTypes, type MoveFunctionId } from "supra-ts-sdk";
import { assertSuccess, createClient, getFundedAccounts, runExample } from "./setup";
import { publishTwoSignersModule } from "./twoSignersModule";

runExample(async () => {
    const supra = createClient();
    const [account, feePayerAccount, secondarySignerAccount] = await getFundedAccounts(supra, 3);
    if (account === undefined || feePayerAccount === undefined || secondarySignerAccount === undefined) {
        throw new Error("Missing accounts");
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
    // Submit a serialized raw transaction; the SDK signs it
    // ---------------------------------------------------------------------------
    const supraCoinTransferRawTransaction = supra.transaction.build.rawTxnObject(supraTransferPayload());

    const txn = await supra.transaction.submit.submitSerializedRawTransaction({
        senderAccount: account,
        serializedRawTransaction: supraCoinTransferRawTransaction.toBytes(),
        enableTransactionWaitAndSimulationArgs: waitForCommit,
    });
    assertSuccess("submitSerializedRawTransaction", txn);
    console.log("Transaction committed:", txn.hash);

    // ---------------------------------------------------------------------------
    // Submit a serialized transaction with its signature
    // ---------------------------------------------------------------------------
    const supraCoinTransferSerializedRawTransaction = supra.transaction.build
        .rawTxnObject(supraTransferPayload())
        .toBytes();

    const rawTxn = TxnBuilderTypes.RawTransaction.deserialize(
        new BCS.Deserializer(supraCoinTransferSerializedRawTransaction),
    );

    const signature = await supra.transaction.signTransaction({ senderAccount: account, rawTxn });

    const txn1 = await supra.transaction.submit.submitSerializedRawTransactionAndSignature({
        senderPubkey: account.pubKey(),
        signature,
        serializedRawTransaction: supraCoinTransferSerializedRawTransaction,
        enableTransactionWaitAndSimulationArgs: waitForCommit,
    });
    assertSuccess("submitSerializedRawTransactionAndSignature", txn1);
    console.log("Transaction committed:", txn1.hash);

    // ---------------------------------------------------------------------------
    // Submit a sponsored transaction: the fee payer pays the gas
    // ---------------------------------------------------------------------------
    const supraCoinTransferSponsoredRawTransaction = supra.transaction.build.rawTxnObject(supraTransferPayload());

    // The payload that the sender and the fee payer sign
    const sponsorTransactionPayload = new TxnBuilderTypes.FeePayerRawTransaction(
        supraCoinTransferSponsoredRawTransaction,
        [],
        new TxnBuilderTypes.AccountAddress(feePayerAccount.address().toUint8Array()),
    );

    const sponsorTxnSenderAuthenticator = await supra.transaction.signTransaction({
        senderAccount: account,
        rawTxn: sponsorTransactionPayload,
    });

    const feePayerAuthenticator = await supra.transaction.signTransaction({
        senderAccount: feePayerAccount,
        rawTxn: sponsorTransactionPayload,
    });

    const txn2 = await supra.transaction.submit.submitSponsorTransaction({
        feePayerAddress: feePayerAccount.address().toString(),
        secondarySignersAccountAddress: [],
        rawTxn: supraCoinTransferSponsoredRawTransaction,
        senderAuthenticator: sponsorTxnSenderAuthenticator,
        feePayerAuthenticator,
        secondarySignersAuthenticator: [],
        enableTransactionWaitAndSimulationArgs: waitForCommit,
    });
    assertSuccess("submitSponsorTransaction", txn2);
    console.log("Transaction committed:", txn2.hash);

    // ---------------------------------------------------------------------------
    // Submit a multi-agent transaction
    // ---------------------------------------------------------------------------

    // The network has no framework entry function that takes two signers. The example publishes a module with one,
    // `two_signers(a: &signer, b: &signer)`, under the address of the secondary signer.
    const twoSignersFunction = await publishTwoSignersModule(supra, secondarySignerAccount);

    const multiAgentRawTransaction = supra.transaction.build.rawTxnObject({
        senderAddress: account.address(),
        senderSequenceNumber: nextSequenceNumber(),
        function: twoSignersFunction as MoveFunctionId,
        functionTypeArgs: [],
        functionArgs: [],
    });

    // The payload that the sender and the secondary signer sign
    const multiAgentTransactionPayload = new TxnBuilderTypes.MultiAgentRawTransaction(multiAgentRawTransaction, [
        new TxnBuilderTypes.AccountAddress(secondarySignerAccount.address().toUint8Array()),
    ]);

    const multiAgentSenderAuthenticator = await supra.transaction.signTransaction({
        senderAccount: account,
        rawTxn: multiAgentTransactionPayload,
    });

    const secondarySignerAuthenticator = await supra.transaction.signTransaction({
        senderAccount: secondarySignerAccount,
        rawTxn: multiAgentTransactionPayload,
    });

    const txn3 = await supra.transaction.submit.submitMultiAgentTransaction({
        secondarySignersAccountAddress: [secondarySignerAccount.address().toString()],
        rawTxn: multiAgentRawTransaction,
        senderAuthenticator: multiAgentSenderAuthenticator,
        secondarySignersAuthenticator: [secondarySignerAuthenticator],
        enableTransactionWaitAndSimulationArgs: waitForCommit,
    });
    assertSuccess("submitMultiAgentTransaction", txn3);
    console.log("Transaction committed:", txn3.hash);
});
