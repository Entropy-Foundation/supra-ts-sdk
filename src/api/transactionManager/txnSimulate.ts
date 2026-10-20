import type { NetworkConfig } from "../../utils/apiEndpoints";
import type { SendTxnPayload } from "../../types/transactionManager/transactionBuild";
import { simulateSerializedTxnInternal, simulateTxnInternal } from "../../internal/transactionManager/txnSimulate";
import type { MoveInnerAuthenticator } from "../../types/move";
import type { TransactionResponse } from "../../types/transaction";

/**
 * The Simulate class provides methods for simulating transactions on the Supra network.
 * @group Transaction
 */
export class Simulate {
    /**
     * The networkInformation property is A NetworkConfig object that contains information about the network on which the Supra client is running.
     */
    protected readonly networkInformation: NetworkConfig;

    /**
     * The constructor function takes a NetworkConfig object as a parameter and assigns it to the networkInformation property.
     * @param networkInformation - A NetworkConfig object that contains information about the network on which the Supra client is running.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     * ```
     * @group Transaction
     */
    constructor(networkInformation: NetworkConfig) {
        this.networkInformation = networkInformation;
    }

    /**
     * Simulate a transaction using the provided transaction payload.
     * The request carries a copy of the payload with zero signatures; `args.sendTxPayload` is not modified.
     * @param args.sendTxPayload -  Transaction payload
     * @returns Transaction simulation result, whose status is `Success`
     * @throws `SupraSimulationFailedError` when the simulated status is `Fail`, `PendingAfterExecution` (validation
     * failed, for example `SENDING_ACCOUNT_DOES_NOT_EXIST` or `SEQUENCE_NUMBER_TOO_NEW`) or `Invalid`; the error
     * carries the simulated transaction and its `vm_status`
     * @throws `SupraGasUnitPriceBelowMinimumError` instead when the status is `Invalid` because the gas unit price is
     * below the node's minimum (`GAS_UNIT_PRICE_BELOW_MIN_BOUND`); the `SupraSimulationFailedError` is its `cause`
     * @example
     * ```typescript
     * import { BCS, Network, SupraAccount, SupraClient } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     * const account = new SupraAccount(); // an account that holds SUPRA
     *
     * async function runExample() {
     *   const rawTxn = supra.transaction.build.rawTxnObject({
     *     senderAddress: account.address(),
     *     senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
     *     function: "0x1::supra_account::transfer",
     *     functionTypeArgs: [],
     *     functionArgs: [new SupraAccount().address().toUint8Array(), BCS.bcsSerializeUint64(10000n)],
     *     optionalTransactionPayloadArgs: { gasUnitPrice: await supra.getEstimatedGasUnitPrice() },
     *   });
     *   const sendTxPayload = await supra.transaction.build.sendTxnPayload({ senderAccount: account, rawTxn });
     *
     *   const response = await supra.transaction.simulate.simple({ sendTxPayload });
     *   console.log(response.status, response.output);
     * }
     * runExample().catch(console.error);
     * ```
     * @group Transaction
     */
    async simple(args: { sendTxPayload: SendTxnPayload }): Promise<TransactionResponse> {
        return simulateTxnInternal(args, this.networkInformation);
    }

    /**
     * Simulate a transaction using the provided Serialized raw transaction data
     * @param args.txAuthenticator - Transaction authenticator
     * @param args.serializedRawTransaction - Serialized raw transaction data
     * @returns Transaction simulation result, whose status is `Success`
     * @throws `SupraSimulationFailedError` when the simulated status is not `Success`, as for {@link Simulate.simple}
     * @throws `SupraGasUnitPriceBelowMinimumError` when the gas unit price is below the node's minimum, as for
     * {@link Simulate.simple}
     * @example
     * ```typescript
     * import { BCS, Network, SupraAccount, SupraClient } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     * const account = new SupraAccount(); // an account that holds SUPRA
     *
     * async function runExample() {
     *   const rawTxn = supra.transaction.build.rawTxnObject({
     *     senderAddress: account.address(),
     *     senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
     *     function: "0x1::supra_account::transfer",
     *     functionTypeArgs: [],
     *     functionArgs: [new SupraAccount().address().toUint8Array(), BCS.bcsSerializeUint64(10000n)],
     *     optionalTransactionPayloadArgs: { gasUnitPrice: await supra.getEstimatedGasUnitPrice() },
     *   });
     *
     *   const response = await supra.transaction.simulate.serialized({
     *     txAuthenticator: { Ed25519: { public_key: account.pubKey().toString(), signature: "0x" + "00".repeat(64) } },
     *     serializedRawTransaction: BCS.bcsToBytes(rawTxn),
     *   });
     *   console.log(response.status, response.output);
     * }
     * runExample().catch(console.error);
     * ```
     * @group Transaction
     */
    async serialized(args: {
        txAuthenticator: MoveInnerAuthenticator;
        serializedRawTransaction: Uint8Array;
    }): Promise<TransactionResponse> {
        return simulateSerializedTxnInternal(args, this.networkInformation);
    }
}
