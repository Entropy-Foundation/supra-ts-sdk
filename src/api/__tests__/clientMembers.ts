import type { SupraClient } from "../supraClient";

/**
 * One entry per member the `SupraClient` type declares. A member added to or removed from the type makes this
 * object fail `pnpm typecheck` until the list is updated; clientConfig.test.ts checks every entry against the runtime
 * object. The file is not a test file so that `tsc` compiles it.
 */
export const declaredClientMembers: Record<keyof SupraClient, true> = {
    config: true,
    networkInformation: true,
    account: true,
    transaction: true,
    contract: true,
    faucet: true,
    methods: true,
    table: true,
    coin: true,
    events: true,
    block: true,
    fungibleAsset: true,
    validateChainId: true,
    getChainId: true,
    resetSequenceNumber: true,
    getGasPrice: true,
    getMinGasUnitPrice: true,
    getEstimatedGasUnitPrice: true,
    isAccountExists: true,
    getAccountInfo: true,
    getAccountModules: true,
    getAccountModule: true,
    getAccountResource: true,
    getAccountTransactions: true,
    getAccountCoinTransactions: true,
    getAccountAutoTransactions: true,
    getTableItem: true,
    view: true,
    viewRaw: true,
    fromABI: true,
    getAccountResources: true,
    getAccountCoinsCount: true,
    getAccountSupraCoinBalance: true,
    getAccountCoinBalance: true,
    getAccountSupraBalance: true,
    isPendingTransaction: true,
    waitForTransaction: true,
    getTransactionSignatureMessage: true,
    signTransaction: true,
    deriveTransactionHash: true,
    publishPackage: true,
    getTransactionByHash: true,
    fundAccountWithFaucet: true,
    getFaucetTransaction: true,
    getCoinInfo: true,
    transferSupraCoin: true,
    transferCoin: true,
    getEventsByType: true,
    getLatestBlock: true,
    getBlockByHeight: true,
    getBlockByHash: true,
    getTransactionsByBlockHash: true,
    getFungibleAssetMetadata: true,
    transferSupraFungibleAsset: true,
    transferFungibleAsset: true,
    migrateCoinToFungibleStore: true,
    multisig: true,
    createMultisigAccount: true,
    proposeMultisigTransaction: true,
    proposeMultisigTransactionWithHash: true,
    approveMultisigTransaction: true,
    rejectMultisigTransaction: true,
    executeMultisigTransaction: true,
    executeRejectedMultisigTransaction: true,
    getMultisigSequenceNumbers: true,
    getMultisigProposal: true,
    getNextMultisigProposal: true,
};

/** `build`, `simulate` and `submit` are members of `supra.transaction`, not of the client. */
export function transactionMembersAreNotOnTheClient(client: SupraClient): void {
    // @ts-expect-error `build` is not declared on the client.
    void client.build;
    // @ts-expect-error `simulate` is not declared on the client.
    void client.simulate;
    // @ts-expect-error `submit` is not declared on the client.
    void client.submit;
}
