import { SupraError } from "./supraError";

/**
 * SupraChainIdMismatchError is thrown before a transaction is signed when the chain ID the SDK would sign for is not
 * the chain ID of the node the client is configured for. Nothing is signed or sent when it is thrown.
 *
 * The client reads the node's chain ID before its first signature (see `SupraConfig.verifyChainId`). The error is
 * raised when the configured chain ID differs from the node's, and when the chain ID inside the transaction to sign
 * differs from the node's; `transactionChainId` is set in the second case. `validateChainId()` throws it as well.
 * @group Errors
 */
export class SupraChainIdMismatchError extends SupraError {
    /** The chain ID of the client's configuration (the predefined network's, or `chainId` of a custom configuration). */
    readonly configuredChainId: number;
    /** The chain ID the node reported. */
    readonly nodeChainId: number;
    /** The chain ID of the transaction to sign, when it is the one that differs from the node's. */
    readonly transactionChainId: number | undefined;

    constructor(args: { configuredChainId: number; nodeChainId: number; transactionChainId?: number }) {
        super(
            args.transactionChainId === undefined
                ? `The configured chain ID ${args.configuredChainId} does not match the node's chain ID ${args.nodeChainId}`
                : `The transaction's chain ID ${args.transactionChainId} does not match the node's chain ID ${args.nodeChainId}`,
        );
        this.name = "SupraChainIdMismatchError";
        this.configuredChainId = args.configuredChainId;
        this.nodeChainId = args.nodeChainId;
        this.transactionChainId = args.transactionChainId;
    }
}
