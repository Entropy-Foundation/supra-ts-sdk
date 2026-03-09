import { BCS, HexString, SupraAccount, TxnBuilderTypes } from 'supra-l1-sdk-core';
import { SupraClient, Network } from '../src/index';
import { MoveFunctionId } from '../src/types/move';
import { MILLISECONDS_PER_SECOND } from '../src/utils/constants';
import { account } from '../testAccount';

(async () => {
    const supra = new SupraClient({ network: Network.TESTNET });

    // const account = SupraAccount.fromSupraAccountObject({
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
    // Build serialized raw transaction object
    // ---------------------------------------------------------------------------

    let supraCoinTransferSimpleTransaction = await supra.transaction.build.simple({
        senderAddress: account.address(),
        senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
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

    let supraCoinTransferRawTransaction = supra.transaction.build.rawTxnObject(supraTransferPayload)


    // Generating serialized `rawTxn` using `rawTxn` Object
    // and sending transaction using generated serialized `rawTxn`
    let supraCoinTransferRawTransactionSerializer = new BCS.Serializer();
    supraCoinTransferRawTransaction.serialize(
        supraCoinTransferRawTransactionSerializer
    );

    // You use can above serialized payload to send transaction.
    let txn2 = await supra.transaction.submit.submitSerializedRawTransaction({
        senderAccount: account,
        serializedRawTransaction: supraCoinTransferRawTransactionSerializer.getBytes(),
        enableTransactionWaitAndSimulationArgs: {
            enableTransactionSimulation: true,
            enableWaitForTransaction: true
        }
    });

    console.log("Transaction submitted:", txn2);

    // ---------------------------------------------------------------------------
    // Build send transaction payload 
    // ---------------------------------------------------------------------------

    let supraCoinTransferSendTxnPayload = supra.transaction.build.sendTxnPayload({
        senderAccount: account,
        rawTxn: supraCoinTransferRawTransaction
    })

    // You use can above serialized payload to send transaction.
    let txn3 = await fetch("https://rpc-testnet.supra.com/rpc/v3/transactions/submit", {
        method: "POST",
        body: JSON.stringify(supraCoinTransferSendTxnPayload),
        headers: {
            "Content-Type": "application/json"
        }
    });

    console.log("Transaction submitted:", await txn3.json());


    // ---------------------------------------------------------------------------
    // Build serialized raw transaction object
    // ---------------------------------------------------------------------------

    let supraCoinTransferSerializedRawTransaction = supra.transaction.build.serialized.rawTxnObject(supraTransferPayload)

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

    let supraCoinTransferSerializedScriptRawTransaction = supra.transaction.build.serialized.scriptRawTxnObject({
        senderAddress: account.address(),
        senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
        scriptCode: Uint8Array.from(Buffer.from(moveScriptCodeHex, "hex")),
        scriptTypeArgs: [],
        scriptArgs: [new TxnBuilderTypes.TransactionArgumentU64(BigInt(1000))]
    })

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

    let supraCoinTransferAutomationSerializedRawTransaction = supra.transaction.build.serialized.automationRegistrationRawTxnObject({
        senderAddress: account.address(),
        senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
        function: "0x0000000000000000000000000000000000000000000000000000000000000001::supra_account::transfer" as MoveFunctionId,
        functionTypeArgs: [],
        functionArgs: [receiverAddress.toUint8Array(), BCS.bcsSerializeUint64(1000)],
        automationMaxGasAmount: BigInt(500),
        automationGasPriceCap: BigInt(100),
        automationFeeCapForEpoch: BigInt(1000000000),
        automationExpirationTimestampSecs: BigInt(Math.floor(Date.now() / MILLISECONDS_PER_SECOND) + 2 * 60 * 60),
        automationAuxData: [],
    });

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

    let multisigAccountAddress = new HexString(
        "0x5ccc30b127e0be0b83f226aed2d7387eee261390f1548483530e15d0208cba65"
    );

    let supraCoinTransferSerializedMultisigHashedRawTransaction = supra.transaction.build.serialized.multisigProposalTxRawTxnObject(
        {
            senderAddress: account.address(),
            senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
            multisigAddress: multisigAccountAddress,
            function: "0000000000000000000000000000000000000000000000000000000000000001::supra_account::transfer",
            functionTypeArgs: [],
            functionArgs: [receiverAddress.toUint8Array(), BCS.bcsSerializeUint64(1000)]
        }
    );

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
    let supraCoinTransferSerializedMultisigRawTransaction = supra.transaction.build.serialized.multisigRawTxnObject(
        {
            senderAddress: account.address(),
            senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
            multisigAddress: multisigAccountAddress,
            function: "0000000000000000000000000000000000000000000000000000000000000001::supra_account::transfer",
            functionTypeArgs: [],
            functionArgs: [receiverAddress.toUint8Array(), BCS.bcsSerializeUint64(1000)]
        }
    );

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