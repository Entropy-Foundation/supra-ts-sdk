import { SupraClient, Network } from "supra-ts-sdk";
import { account } from "./account.setup";


(async () => {
    const supra = new SupraClient({ network: Network.TESTNET });

    // ---------------------------------------------------------------------------
    // Get Fungible Asset Metadata
    // ---------------------------------------------------------------------------

    let fungibleAssetMetadata = await supra.fungibleAsset.getFungibleAssetMetadata({ assetAddress: "0xeaf7e558946473ff0798d90a7be223817f53a5b52da2540cc4cd177e2ec64f48" });

    console.log("Fungible Asset Metadata", fungibleAssetMetadata);

    // ---------------------------------------------------------------------------
    // Transfer Supra Fungible Asset
    // ---------------------------------------------------------------------------

    let txn = await supra.fungibleAsset.transferSupraFungibleAsset({
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
    // Transfer Fungible Asset
    // ---------------------------------------------------------------------------


    let txn1 = await supra.fungibleAsset.transferFungibleAsset({
        senderAccount: account,
        receiverAccountAddress: "0x2ee12e63209aee603c76e94e6fbb509629ec2617a65a858da62d862ad2818bc5",
        amount: 10000,
        assetAddress: "0x000000000000000000000000000000000000000000000000000000000000000a",
        optionalTransactionArgs: {
            enableTransactionWaitAndSimulationArgs: {
                enableTransactionSimulation: true,
                enableWaitForTransaction: true
            }
        }
    });

    console.log("Transaction submitted:", txn1);



})();