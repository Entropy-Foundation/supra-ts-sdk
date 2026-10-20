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
    // Migrate SUPRA from the coin store to the fungible asset store
    // ---------------------------------------------------------------------------

    // A fungible asset transfer moves only the balance of the fungible asset store. An account that received SUPRA
    // as a coin migrates it first; without the migration the transfer below throws
    // SupraInsufficientFungibleAssetBalanceError.
    let balances = await supra.account.getAccountSupraBalance({ accountAddress: account.address() });
    console.log("SUPRA balance:", balances);

    if (balances.coin > 0n) {
        let migration = await supra.fungibleAsset.migrateCoinToFungibleStore({
            senderAccount: account,
            optionalTransactionArgs: {
                enableTransactionWaitAndSimulationArgs: {
                    enableWaitForTransaction: true
                }
            }
        });

        console.log("Migration submitted:", migration);
    }

    // ---------------------------------------------------------------------------
    // Transfer Supra Fungible Asset
    // ---------------------------------------------------------------------------

    let txn =await supra.fungibleAsset.transferSupraFungibleAsset({
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