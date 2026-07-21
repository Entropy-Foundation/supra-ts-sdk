import { SupraClient, Network, BCS, HexString, type MoveFunctionId } from "supra-ts-sdk";
import { account } from "./account.setup";

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
    // Simulate simple transaction
    // ---------------------------------------------------------------------------

    let supraCoinTransferRawTransaction = supra.transaction.build.rawTxnObject(supraTransferPayload)

    let sendTxnPayload = supra.transaction.build.sendTxnPayload({
        senderAccount: account,
        rawTxn: supraCoinTransferRawTransaction
    })

    let simulationResponse = await supra.transaction.simulate.simple({
        sendTxPayload: sendTxnPayload
    });

    console.log("Simulation response:", simulationResponse);


    // ---------------------------------------------------------------------------
    // Simulate serialized transaction
    // ---------------------------------------------------------------------------

    let supraCoinTransferSerializedRawTransaction = supra.transaction.build.rawTxnObject(supraTransferPayload);

    let simulationResponseSerialized = await supra.transaction.simulate.serialized({
        txAuthenticator: {
            Ed25519: {
                public_key: account.pubKey().toString(),
                signature: "0x" + "0".repeat(128),
            },
        },
        serializedRawTransaction: supraCoinTransferSerializedRawTransaction.toBytes()
    });

    console.log("Simulation response:", simulationResponseSerialized);


    // ---------------------------------------------------------------------------
    // Shorthand simulate transaction
    // ---------------------------------------------------------------------------

    let simulationResponse1 = await supraCoinTransferSerializedRawTransaction.simulate(account);

    console.log("Simulation response:", simulationResponse1);


    let simulationResponse2 = await supraCoinTransferSerializedRawTransaction.simulate({
        Ed25519: {
            public_key: account.pubKey().toString(),
            signature: "0x" + "0".repeat(128),
        },
    });

    console.log("Simulation response:", simulationResponse2);

})();