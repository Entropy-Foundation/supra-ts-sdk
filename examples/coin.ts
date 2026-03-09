import { SupraAccount } from 'supra-l1-sdk-core';
import { SupraClient, Network } from '../src/index';
import { account } from '../testAccount';


(async () => {

    // const account = SupraAccount.fromSupraAccountObject({
    //     address: "AccountAddress",
    //     privateKeyHex: `${"PrivateKey"}${"PublicKey (Without 0x)"}`,
    //     publicKeyHex: `0x${"PublicKey (Without 0x)"}`
    // });


    const supra = new SupraClient({ network: Network.TESTNET });

    // ---------------------------------------------------------------------------
    // Get coin info
    // ---------------------------------------------------------------------------
    const coinInfo = await supra.coin.getCoinInfo({ coinType: "0x1::supra_coin::SupraCoin" });

    console.log("Coin info:", coinInfo);

    // ---------------------------------------------------------------------------
    // Transfer Supra Coin
    // ---------------------------------------------------------------------------

    let txn = await supra.coin.transferSupraCoin({
        senderAccount: account,
        receiverAccountAddress: "0x2ee12e63209aee603c76e94e6fbb509629ec2617a65a858da62d862ad2818bc5",
        amount: 10000,
        optionalTransactionArgs: {
            enableTransactionWaitAndSimulationArgs: {
                enableTransactionSimulation: true,
                enableWaitForTransaction: true
            }
        }
    });

    console.log("Transaction submitted:", txn);

    // ---------------------------------------------------------------------------
    // Transfer Coin
    // ---------------------------------------------------------------------------


    let txn1 = await supra.coin.transferCoin({
        senderAccount: account,
        receiverAccountAddress: "0x2ee12e63209aee603c76e94e6fbb509629ec2617a65a858da62d862ad2818bc5",
        amount: 10000,
        coinType: "0x1::supra_coin::SupraCoin",
        optionalTransactionArgs: {
            enableTransactionWaitAndSimulationArgs: {
                enableTransactionSimulation: true,
                enableWaitForTransaction: true
            }
        }
    });

    console.log("Transaction submitted:", txn1);



})();