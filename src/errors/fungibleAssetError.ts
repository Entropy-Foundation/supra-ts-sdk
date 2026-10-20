import { SupraError } from "./supraError";

/**
 * SupraInsufficientFungibleAssetBalanceError is thrown by `transferSupraFungibleAsset` and by `transferFungibleAsset`
 * for the SUPRA fungible asset (`0xa`) when the sender's fungible asset balance is below the amount to transfer. No
 * transaction is submitted.
 *
 * `0x1::primary_fungible_store::transfer` moves only the balance of the sender's primary fungible store. SUPRA held in
 * a `CoinStore` resource is not part of it. `migrateCoinToFungibleStore` moves the coin balance into the fungible
 * store; `transferSupraCoin` moves SUPRA from either form.
 * @group Errors
 */
export class SupraInsufficientFungibleAssetBalanceError extends SupraError {
    /** The address of the sender. */
    readonly senderAddress: string;
    /** The address of the fungible asset. */
    readonly assetAddress: string;
    /** The amount the transfer asked for, in the asset's smallest unit. */
    readonly amount: bigint;
    /** The sender's balance of the fungible asset store, in the asset's smallest unit. */
    readonly fungibleAssetBalance: bigint;
    /** The SUPRA the sender holds as a legacy coin, in quants. */
    readonly coinBalance: bigint;

    constructor(args: {
        senderAddress: string;
        assetAddress: string;
        amount: bigint;
        fungibleAssetBalance: bigint;
        coinBalance: bigint;
    }) {
        super(
            `The fungible asset balance of ${args.senderAddress} is ${args.fungibleAssetBalance}, below the amount ` +
                `${args.amount}. The account also holds ${args.coinBalance} as a coin balance, which a fungible asset ` +
                `transfer does not move. migrateCoinToFungibleStore moves the coin balance into the fungible asset ` +
                `store; transferSupraCoin transfers SUPRA held in either form.`,
        );
        this.name = "SupraInsufficientFungibleAssetBalanceError";
        this.senderAddress = args.senderAddress;
        this.assetAddress = args.assetAddress;
        this.amount = args.amount;
        this.fungibleAssetBalance = args.fungibleAssetBalance;
        this.coinBalance = args.coinBalance;
    }

    toJSON() {
        return {
            name: this.name,
            message: this.message,
            senderAddress: this.senderAddress,
            assetAddress: this.assetAddress,
            amount: this.amount.toString(),
            fungibleAssetBalance: this.fungibleAssetBalance.toString(),
            coinBalance: this.coinBalance.toString(),
        };
    }
}
