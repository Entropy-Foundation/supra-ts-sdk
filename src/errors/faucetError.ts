import { SupraError } from "./supraError";

/**
 * SupraFaucetUnavailableError is thrown when the node's faucet cannot fund an account at the moment
 * (the node answered `"TryLater"` because no faucet account is free). The request can be repeated later.
 * It derives from {@link SupraError}, not from {@link SupraAPIError}: the node answered successfully.
 * @group SupraFaucetUnavailableError
 */
export class SupraFaucetUnavailableError extends SupraError {
    constructor(message = "The faucet has no free account at the moment; try again later") {
        super(message);
        this.name = "SupraFaucetUnavailableError";
    }
}

/**
 * SupraFaucetResponseError is thrown when the faucet answers with a body that is neither `{ "Accepted": <hash> }`
 * nor `"TryLater"`. The body is available as `data`.
 * @group SupraFaucetResponseError
 */
export class SupraFaucetResponseError extends SupraError {
    readonly data: unknown;

    constructor(data: unknown) {
        super("The faucet answered with an unexpected response body");
        this.name = "SupraFaucetResponseError";
        this.data = data;
    }
}
