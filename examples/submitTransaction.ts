import { BCS, HexString, TxnBuilderTypes, type MoveFunctionId } from "supra-ts-sdk";
import { account, feePayerAccount, secondarySignerAccount } from "./account.setup";
import { createClient, fundAccountsIfRequested, usesCustomNode } from "./client.setup";

(async () => {
    const supra = createClient();
    await fundAccountsIfRequested(supra, [account, feePayerAccount, secondarySignerAccount]);

    // const account = SupraAccount.fromSupraAccountObject({
    //     address: "AccountAddress",
    //     privateKeyHex: `${"PrivateKey"}${"PublicKey (Without 0x)"}`,
    //     publicKeyHex: `0x${"PublicKey (Without 0x)"}`
    // });

    // const feePayerAccount = SupraAccount.fromSupraAccountObject({
    //     address: "AccountAddress",
    //     privateKeyHex: `${"PrivateKey"}${"PublicKey (Without 0x)"}`,
    //     publicKeyHex: `0x${"PublicKey (Without 0x)"}`
    // });

    // const secondarySignerAccount = SupraAccount.fromSupraAccountObject({
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
    // Submit simple transaction
    // ---------------------------------------------------------------------------

    let supraCoinTransferRawTransaction = supra.transaction.build.rawTxnObject(await supraTransferPayload())

    // You use can above serialized payload to send transaction.
    let txn = await supra.transaction.submit.submitSerializedRawTransaction({
        senderAccount: account,
        serializedRawTransaction: supraCoinTransferRawTransaction.toBytes(),
        enableTransactionWaitAndSimulationArgs: {
            enableTransactionSimulation: true,
            enableWaitForTransaction: true
        }
    });

    console.log("Transaction submitted:", txn);


    // ---------------------------------------------------------------------------
    // Submit serialized transaction with signature
    // ---------------------------------------------------------------------------

    let supraCoinTransferSerializedRawTransaction = supra.transaction.build.rawTxnObject(await supraTransferPayload()).toBytes();

    let raw_txn = TxnBuilderTypes.RawTransaction.deserialize(
        new BCS.Deserializer(supraCoinTransferSerializedRawTransaction),
    );

    let signature = await supra.transaction.signTransaction({ senderAccount: account, rawTxn: raw_txn })

    // You use can above serialized payload to send transaction.
    let txn1 = await supra.transaction.submit.submitSerializedRawTransactionAndSignature({
        senderPubkey: account.pubKey(),
        signature: signature as HexString,
        serializedRawTransaction: supraCoinTransferSerializedRawTransaction,
        enableTransactionWaitAndSimulationArgs: {
            enableTransactionSimulation: true,
            enableWaitForTransaction: true
        }
    });

    console.log("Transaction submitted:", txn1);


    // ---------------------------------------------------------------------------
    // Submit sponsored transaction
    // ---------------------------------------------------------------------------

    let supraCoinTransferSponsoredRawTransaction = supra.transaction.build.rawTxnObject(await supraTransferPayload());

    // Creating Sponsor Transaction Payload
    let sponsorTransactionPayload = new TxnBuilderTypes.FeePayerRawTransaction(
        supraCoinTransferSponsoredRawTransaction,
        [],
        new TxnBuilderTypes.AccountAddress(feePayerAccount.address().toUint8Array())
    );

    // Generating sender authenticator
    let sponsorTxnSenderAuthenticator = await supra.transaction.signTransaction({
        senderAccount: account,
        rawTxn: sponsorTransactionPayload
    }) as TxnBuilderTypes.AccountAuthenticatorEd25519;

    // Generating sponsor authenticator
    let feePayerAuthenticator = await supra.transaction.signTransaction({
        senderAccount: feePayerAccount,
        rawTxn: sponsorTransactionPayload
    }) as TxnBuilderTypes.AccountAuthenticatorEd25519;


    let txn2 = await supra.transaction.submit.submitSponsorTransaction(
        {
            feePayerAddress: feePayerAccount.address().toString(),
            secondarySignersAccountAddress: [],
            rawTxn: supraCoinTransferSponsoredRawTransaction,
            senderAuthenticator: sponsorTxnSenderAuthenticator,
            feePayerAuthenticator: feePayerAuthenticator,
            secondarySignersAuthenticator: [],
            enableTransactionWaitAndSimulationArgs: {
                enableTransactionSimulation: true,
                enableWaitForTransaction: true
            }
        }
    );

    console.log("Transaction submitted:", txn2);


    // ---------------------------------------------------------------------------
    // Submit multi-agent transaction
    // ---------------------------------------------------------------------------


    // Creating RawTransaction for multi-agent RawTransaction
    // Note: The `0x7c6033ca961856298e1412fddf5ebb732c247436046d33016a5bd10f7e090a07::wrapper` module is deployed on testnet.
    // On any other node, set SUPRA_EXAMPLES_TWO_SIGNERS_FUNCTION to an entry function, without arguments, that takes
    // two signers (the sender and the secondary signer).
    const twoSignersFunction = process.env["SUPRA_EXAMPLES_TWO_SIGNERS_FUNCTION"]
        ?? (usesCustomNode() ? undefined : "0x7c6033ca961856298e1412fddf5ebb732c247436046d33016a5bd10f7e090a07::wrapper::two_signers");

    if (twoSignersFunction === undefined) {
        console.log("Skipping the multi-agent transaction: set SUPRA_EXAMPLES_TWO_SIGNERS_FUNCTION to a two-signer entry function on this network.");
        return;
    }

    let multiAgentRawTransaction = supra.transaction.build.rawTxnObject({
        senderAddress: account.address(),
        senderSequenceNumber: await nextSequenceNumber(),
        function: twoSignersFunction as MoveFunctionId,
        functionTypeArgs: [],
        functionArgs: []
    });

    // Creating Multi-Agent Transaction Payload
    let multiAgentTransactionPayload =
        new TxnBuilderTypes.MultiAgentRawTransaction(multiAgentRawTransaction, [
            new TxnBuilderTypes.AccountAddress(
                secondarySignerAccount.address().toUint8Array()
            ),
        ]);

    // Generating sender authenticator
    let multiAgentSenderAuthenticator = await supra.transaction.signTransaction({
        senderAccount: account,
        rawTxn: multiAgentTransactionPayload
    }) as TxnBuilderTypes.AccountAuthenticatorEd25519;

    // Generating Secondary Signer authenticator
    let secondarySignerAuthenticator = await supra.transaction.signTransaction({
        senderAccount: secondarySignerAccount,
        rawTxn: multiAgentTransactionPayload
    }) as TxnBuilderTypes.AccountAuthenticatorEd25519;

    // Sending Multi-Agent transaction
    let txn3 = await supra.transaction.submit.submitMultiAgentTransaction({
        secondarySignersAccountAddress: [secondarySignerAccount.address().toString()],
        rawTxn: multiAgentRawTransaction,
        senderAuthenticator: multiAgentSenderAuthenticator,
        secondarySignersAuthenticator: [secondarySignerAuthenticator],
        enableTransactionWaitAndSimulationArgs: {
            enableWaitForTransaction: true,
            enableTransactionSimulation: true,
        }
    });

    console.log("Transaction submitted:", txn3);


})();