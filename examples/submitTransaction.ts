import { BCS, HexString, SupraAccount, TxnBuilderTypes } from 'supra-l1-sdk-core';
import { SupraClient, Network } from '../src/index';
import { MoveFunctionId } from '../src/types/move';
import { account, feePayerAccount, secondarySignerAccount } from '../testAccount';

(async () => {
    const supra = new SupraClient({ network: Network.TESTNET });

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

    // Supra Coin Transfer Payload
    let supraTransferPayload = {
        senderAddress: account.address(),
        senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
        function: "0x0000000000000000000000000000000000000000000000000000000000000001::supra_account::transfer" as MoveFunctionId,
        functionTypeArgs: [],
        functionArgs: [receiverAddress.toUint8Array(), BCS.bcsSerializeUint64(10000)]
    }

    // ---------------------------------------------------------------------------
    // Submit simple transaction
    // ---------------------------------------------------------------------------

    let supraCoinTransferRawTransaction = supra.transaction.build.rawTxnObject(supraTransferPayload)

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

    let supraCoinTransferSerializedRawTransaction = supra.transaction.build.rawTxnObject(supraTransferPayload).toBytes();

    let raw_txn = TxnBuilderTypes.RawTransaction.deserialize(
        new BCS.Deserializer(supraCoinTransferSerializedRawTransaction),
    );

    let signature = supra.transaction.signTransaction({ senderAccount: account, rawTxn: raw_txn })

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

    let supraCoinTransferSponsoredRawTransaction = supra.transaction.build.rawTxnObject(supraTransferPayload);

    // Creating Sponsor Transaction Payload
    let sponsorTransactionPayload = new TxnBuilderTypes.FeePayerRawTransaction(
        supraCoinTransferSponsoredRawTransaction,
        [],
        new TxnBuilderTypes.AccountAddress(feePayerAccount.address().toUint8Array())
    );

    // Generating sender authenticator
    let sponsorTxnSenderAuthenticator = supra.transaction.signTransaction({
        senderAccount: account,
        rawTxn: sponsorTransactionPayload
    }) as TxnBuilderTypes.AccountAuthenticatorEd25519;

    // Generating sponsor authenticator
    let feePayerAuthenticator = supra.transaction.signTransaction({
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
    // Note: The `0x7c6033ca961856298e1412fddf5ebb732c247436046d33016a5bd10f7e090a07::wrapper` module is deployed on testnet
    let multiAgentRawTransaction = supra.transaction.build.rawTxnObject({
        senderAddress: account.address(),
        senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
        function: "0x7c6033ca961856298e1412fddf5ebb732c247436046d33016a5bd10f7e090a07::wrapper::two_signers" as MoveFunctionId,
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
    let multiAgentSenderAuthenticator = supra.transaction.signTransaction({
        senderAccount: account,
        rawTxn: multiAgentTransactionPayload
    }) as TxnBuilderTypes.AccountAuthenticatorEd25519;

    // Generating Secondary Signer authenticator
    let secondarySignerAuthenticator = supra.transaction.signTransaction({
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