import type { NetworkConfig } from "../utils/apiEndpoints";
import type { InputViewFunctionData, InputViewRawFunctionData, ViewBatchResponse } from "../types/methods";
import { viewBatchInternal, viewInternal, viewRawInternal } from "../internal/methods";
import type { MoveValue } from "../types/move";
import { validateFunctionId } from "../helper/validation";

/**
 * The Methods class provides general methods for interacting with the Supra network.
 * @group Methods
 */
export class Methods {
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
     * @group Methods
     */
    constructor(networkInformation: NetworkConfig) {
        this.networkInformation = networkInformation;
    }

    /**
     * Queries a Move view function. The arguments are encoded and the results converted to TypeScript values by the
     * function's ABI, which the method reads from the node unless `args.abi` is given (`u64`, `u128` and `u256`
     * results are `bigint`).
     *
     * A parameter or return type that is or contains a type parameter (`T`, `vector<T>`, `0x1::option::Option<T>`, a
     * struct over `T`) is converted with each type parameter replaced by its type argument: `identity<T>(x: T): T`
     * called with the type argument `u64` takes a `bigint` and returns a `bigint`. An `0x1::object::Object<…>` argument
     * is given as its address; inside a `vector` or an `Option` it is sent as `{ inner: <address> }`, the form the
     * node reads there.
     *
     * A node before `supra_node_v12.0.0` reads every type parameter as `address`. A generic view whose type parameter
     * occurs in a parameter or return type (outside `0x1::object::Object<…>`) therefore needs a node from
     * `supra_node_v12.0.0` unless its type argument is `address` or `signer`, or is `0x1::object::Object<…>` and the
     * type parameter is the whole parameter or return type. For such a call the client reads `GET /rpc/v3/version`
     * and keeps a `release` once the node reports one; on a node that reports none the call throws `SupraError` before
     * the view request is sent, and the next such call reads the version again. Behind a load balancer whose nodes run
     * different releases, as during an upgrade, the node that answers the version request need not be the node that
     * answers the view. Calls with only address-like type arguments make no version request and work on both.
     * @template T - The type of the MoveValue array to be returned.
     * @param args.function - The id of the function to query, `address::module::function`.
     * @param args.typeArguments - An array of type arguments for the function, as type tags or strings. A string must be
     *   one concrete Move type (see `TypeArgument`); it is sent as written.
     * @param args.functionArguments - An array of arguments for the function.
     * @param args.abi - The ABI of the module, to skip the request that reads it.
     * @returns A Promise that resolves to an array of MoveValue objects.
     * @throws {SupraError} If a type argument that needs a node from `supra_node_v12.0.0` (see above) is given and the
     *   node reports no `release`.
     * @example
     * ```typescript
     * import { Network, SupraClient, TypeTagParser } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *    const accountAddress = "0x1";
     *    const supraCoin = new TypeTagParser("0x1::supra_coin::SupraCoin").parseTypeTag();
     *    const accountSupraBalance = await supra.methods.view({
     *        function: "0x1::coin::balance",
     *        functionArguments: [accountAddress],
     *        typeArguments: [supraCoin]
     *    });
     *    console.log("Account supra balance:", accountSupraBalance[0]);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Methods
     */
    async view<T extends Array<MoveValue>>(args: InputViewFunctionData): Promise<T> {
        validateFunctionId(args.function, "function");
        return viewInternal(args, this.networkInformation);
    }

    /**
     * Queries a Move view function without type conversion or parsing: the arguments are sent as given and the
     * results are returned as the node's JSON, where `u64`, `u128` and `u256` values are strings. It does not check the
     * node's release: a node before `supra_node_v12.0.0` reads an argument of a type parameter as an `address` whatever
     * the type argument.
     * @template T - The type of the array to be returned.
     * @param args.function - The id of the function to query, `address::module::function`.
     * @param args.typeArguments - An array of type argument strings for the function.
     * @param args.functionArguments - An array of JSON-encoded arguments for the function.
     * @returns A Promise that resolves to an array of values.
     * @example
     * ```typescript
     * import { SupraClient,Network } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.TESTNET });
     *
     * async function runExample() {
     *    const accountAddress = "0x1";
     *    const accountSupraBalance = await supra.methods.viewRaw({
     *        function: "0x1::coin::balance",
     *        functionArguments: [accountAddress],
     *        typeArguments: ["0x1::supra_coin::SupraCoin"]
     *    });
     *    console.log("Account supra balance:", accountSupraBalance[0]);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Methods
     */
    async viewRaw<T extends Array<unknown>>(args: InputViewRawFunctionData): Promise<T> {
        validateFunctionId(args.function, "function");
        return viewRawInternal(args, this.networkInformation);
    }

    /**
     * Executes several Move view functions in one request (`POST /rpc/v4/view/batch`). Needs a node from
     * `supra_node_v12.0.0`; Mainnet and Testnet nodes of `supra_node_v11.7.x` answer HTTP 404, which is thrown as
     * `SupraRouteUnsupportedError`.
     *
     * Each element takes the arguments of {@link Methods.view}: the SDK reads the ABI of each module once for the
     * whole batch (unless the element has `abi`), encodes the arguments and converts the results to TypeScript
     * values (`u64`, `u128` and `u256` results are `bigint`). All elements run against one snapshot of the node's
     * Move state, in request order, and share a gas budget; an element reached after the budget is spent is not
     * executed and its entry is an `error` with status `400`.
     *
     * An element the node fails (a Move abort, `OUT_OF_GAS`, a function that does not exist) does not fail the
     * others: its entry holds `error`, with the status and message `POST /rpc/v4/view` gives for it, and no
     * exception is thrown. An element whose module ABI cannot be read, or whose arguments do not match its ABI,
     * throws before any request is sent, as `view` does.
     * @template T - The type of the array each successful element returns.
     * @param args.requests - The view functions, as for {@link Methods.view}. The node accepts 1 to 20 by default
     * (`rest_limits.view_batch.max_view_functions`, set by the operator) and answers HTTP 400 outside its range.
     * @returns A Promise that resolves to `{ state_height, results }`: `state_height` is the height of the last block
     * the node had executed in the snapshot (`null` before any), and `results` has one entry per request, in order,
     * holding `result` or `error`.
     * @throws {SupraRouteUnsupportedError} When the node does not serve the route.
     * @throws {SupraAPIError} HTTP 400 for an empty batch or one above the node's limits.
     * @example
     * ```typescript
     * import { Network, SupraClient } from "supra-ts-sdk";
     *
     * const supra = new SupraClient({ network: Network.DEVNET });
     *
     * async function runExample() {
     *    const { state_height, results } = await supra.methods.viewBatch({
     *        requests: [
     *            { function: "0x1::timestamp::now_microseconds" },
     *            { function: "0x1::coin::balance", typeArguments: ["0x1::supra_coin::SupraCoin"], functionArguments: ["0x1"] },
     *        ],
     *    });
     *    for (const entry of results) {
     *        if (entry.error) {
     *            console.log("failed", entry.error.status, entry.error.message);
     *        } else {
     *            console.log(entry.result[0]);
     *        }
     *    }
     *    console.log("as of block", state_height);
     * }
     *
     * runExample().catch(console.error);
     * ```
     * @group Methods
     */
    async viewBatch<T extends Array<MoveValue> = Array<MoveValue>>(args: {
        requests: InputViewFunctionData[];
    }): Promise<ViewBatchResponse<T>> {
        if (!Array.isArray(args.requests) || args.requests.length === 0) {
            throw new Error("Invalid requests: expected a non-empty array of view functions");
        }
        for (const request of args.requests) {
            validateFunctionId(request.function, "function");
        }
        return viewBatchInternal<T>(args, this.networkInformation);
    }
}
