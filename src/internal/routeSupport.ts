import { SupraNotFoundError, SupraRouteUnsupportedError } from "../errors/apiError";

/** The API version of the `/rpc/v4` routes, the one the operations of this module call. */
export const V4_RPC_VERSION = "v4";

/** The first node release that serves the routes only `/rpc/v4` has. */
export const V4_ROUTES_MIN_NODE_RELEASE = "supra_node_v12.0.0";

/**
 * Whether the body of a 404 is one the node writes for a request it routed: a JSON object whose `message` names the
 * requested resource (`id`, compared case-insensitively). A node that has no handler for the route answers 404 with
 * an empty body or the plain-text rejection of the route it matched instead, and a gateway answers with its own
 * body, which does not name the resource.
 */
function isHandlerNotFoundBody(data: unknown, id: string): boolean {
    if (typeof data !== "object" || data === null) {
        return false;
    }
    const message = (data as { message?: unknown }).message;
    return typeof message === "string" && message.toLowerCase().includes(id.toLowerCase());
}

/**
 * Runs a request to a route that only nodes from {@link V4_ROUTES_MIN_NODE_RELEASE} serve, and rethrows an HTTP 404 as
 * `SupraRouteUnsupportedError` naming `method`.
 *
 * @param args.handlerNotFoundFor - The id of the resource of a route whose handler answers 404 itself for a resource
 * it does not hold (a settlement id the node never executed): a 404 whose JSON `message` names that id is then the
 * node's answer and is rethrown unchanged, and any other 404 means the route is absent.
 */
export async function withV4RouteSupport<T>(
    args: { method: string; handlerNotFoundFor?: string },
    request: () => Promise<T>,
): Promise<T> {
    try {
        return await request();
    } catch (error) {
        if (error instanceof SupraNotFoundError && !(error instanceof SupraRouteUnsupportedError)) {
            if (args.handlerNotFoundFor !== undefined && isHandlerNotFoundBody(error.data, args.handlerNotFoundFor)) {
                throw error;
            }
            throw new SupraRouteUnsupportedError({
                status: error.status,
                statusText: error.statusText,
                url: error.url,
                data: error.data,
                method: args.method,
                minimumNodeRelease: V4_ROUTES_MIN_NODE_RELEASE,
            });
        }
        throw error;
    }
}
