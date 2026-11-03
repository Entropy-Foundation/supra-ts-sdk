/**
 * Exact reading of the `u64` fields that a node renders as JSON numbers.
 *
 * `JSON.parse` turns every number into an IEEE 754 double, which cannot hold a `u64` above 2^53 - 1. The fields
 * listed in {@link U64_FIELDS} can exceed that value, and a later node release renders them as decimal strings.
 * {@link quoteU64Fields} wraps the number tokens at those paths in quotes before the text is parsed, and
 * {@link convertU64Fields} turns the parsed values into `bigint`, so a field reads the same from either form.
 *
 * A path names a field from the root of the response, with `[*]` for the elements of an array: `data[*].amount`.
 * Matching by full path, never by key name, keeps the numbers inside Move values (event data, resources, view
 * results) as they are.
 */

/** The paths of the `u64` fields of each response that the SDK reads, as sent by node releases that render them. */
export const U64_FIELDS = {
    /** `GET /rpc/v4/supply/native`. */
    nativeSupply: ["burn_owed_quants", "escrow_settled_quants", "escrow_balance_quants"],
    /** `GET /rpc/v4/transactions/settlements/{settlement_id}`. */
    settlement: ["pending.amount", "stages[*].amount"],
    /** `GET /rpc/v4/transactions/settlements`. */
    settlements: ["data[*].pending.amount", "data[*].stages[*].amount"],
    /** `GET /rpc/v3|v4/transactions/{hash}`. */
    transaction: ["data.burn_amount"],
    /** The transaction feeds of an account: `transactions`, `coin_transactions`, `fa_transactions`, `automated_transactions`. */
    transactionList: ["[*].data.burn_amount"],
    /** `GET /rpc/v3|v4/accounts/{address}/history`. */
    accountHistory: ["[*].transaction.data.burn_amount"],
    /** `POST /rpc/v4/transactions/by_hashes`. */
    transactionsByHashes: ["transactions[*].transaction.data.burn_amount"],
    /** `GET /rpc/v3|v4/block` and `/block/{block_hash}`. */
    block: ["execution_statistics.evm_base_fee_per_gas"],
    /** `GET /rpc/v3|v4/block/height/{height}`, which can carry the block's transactions. */
    blockWithTransactions: ["execution_statistics.evm_base_fee_per_gas", "transactions[*].data.burn_amount"],
} as const satisfies Record<string, readonly string[]>;

/** A field that does not hold a non-negative integer that `bigint` can represent exactly. */
export class U64FieldError extends Error {
    constructor(
        readonly path: string,
        readonly value: unknown,
    ) {
        super(`Expected an unsigned decimal integer at "${path}" but received ${describeValue(value)}`);
        this.name = "U64FieldError";
    }
}

function describeValue(value: unknown): string {
    if (typeof value === "string") {
        return JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}...` : value);
    }
    if (typeof value === "number") {
        return `the number ${value}`;
    }
    return Array.isArray(value) ? "an array" : typeof value;
}

/** The target paths as a tree: one level per path segment. */
interface PathNode {
    readonly children: Map<string, PathNode>;
    /** The node for the elements of an array. */
    any: PathNode | undefined;
    /** Whether a path ends here. */
    target: boolean;
}

const trieCache = new WeakMap<readonly string[], PathNode>();

function newNode(): PathNode {
    return { children: new Map(), any: undefined, target: false };
}

const SEGMENT = /\[\*\]|[^.[\]]+/g;

function trieOf(paths: readonly string[]): PathNode {
    const cached = trieCache.get(paths);
    if (cached !== undefined) {
        return cached;
    }
    const root = newNode();
    for (const path of paths) {
        let node = root;
        for (const segment of path.match(SEGMENT) ?? []) {
            if (segment === "[*]") {
                node.any ??= newNode();
                node = node.any;
            } else {
                let child = node.children.get(segment);
                if (child === undefined) {
                    child = newNode();
                    node.children.set(segment, child);
                }
                node = child;
            }
        }
        node.target = true;
    }
    trieCache.set(paths, root);
    return root;
}

const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

interface Frame {
    /** The path node of the container, `undefined` when no target lies below it. */
    readonly node: PathNode | undefined;
    readonly isObject: boolean;
    /** Whether the next string of an object is a key rather than a value. */
    expectKey: boolean;
    /** The key of the member being read, for an object; `undefined` when it does not match any path. */
    key: string | undefined;
}

function isSpace(code: number): boolean {
    return code === 0x20 || code === 0x0a || code === 0x0d || code === 0x09;
}

/** The characters that end a number or literal token. */
function endsToken(code: number): boolean {
    return (
        isSpace(code) ||
        code === 0x2c /* , */ ||
        code === 0x7d /* } */ ||
        code === 0x5d /* ] */ ||
        code === 0x3a /* : */ ||
        code === 0x22 /* " */ ||
        code === 0x7b /* { */ ||
        code === 0x5b /* [ */
    );
}

/**
 * Wraps in quotes each JSON number in `text` that sits at one of `paths`. Everything else is copied unchanged: a
 * value at a path that is already a string, `null` or any other literal stays as it is, as does a number anywhere
 * else.
 *
 * The function scans the text with a small tokenizer that tracks strings (with `\` escapes), objects, arrays and the
 * current path; it does not validate the text. Text that the tokenizer cannot follow (an unterminated string, a
 * closing bracket without its opening one) is returned unchanged, so `JSON.parse` reports it.
 *
 * @param text - The response body.
 * @param paths - The paths of the fields to quote; see {@link U64_FIELDS}.
 */
export function quoteU64Fields(text: string, paths: readonly string[]): string {
    const root = trieOf(paths);
    const frames: Frame[] = [];
    const quoteAt: Array<[number, number]> = [];
    const length = text.length;

    /** The path node of the value that starts at the current position. */
    const valueNode = (): PathNode | undefined => {
        const top = frames[frames.length - 1];
        if (top === undefined) {
            return root;
        }
        if (top.isObject) {
            return top.key === undefined ? undefined : top.node?.children.get(top.key);
        }
        return top.node?.any;
    };

    let i = 0;
    while (i < length) {
        const code = text.charCodeAt(i);
        if (isSpace(code)) {
            i++;
        } else if (code === 0x22) {
            const start = i;
            i++;
            let hasEscape = false;
            while (i < length && text.charCodeAt(i) !== 0x22) {
                if (text.charCodeAt(i) === 0x5c) {
                    hasEscape = true;
                    i++;
                }
                i++;
            }
            if (i >= length) {
                return text;
            }
            const top = frames[frames.length - 1];
            if (top?.isObject === true && top.expectKey) {
                top.expectKey = false;
                if (top.node !== undefined) {
                    top.key = hasEscape ? decodeKey(text.slice(start, i + 1)) : text.slice(start + 1, i);
                }
            }
            i++;
        } else if (code === 0x7b || code === 0x5b) {
            frames.push({ node: valueNode(), isObject: code === 0x7b, expectKey: code === 0x7b, key: undefined });
            i++;
        } else if (code === 0x7d || code === 0x5d) {
            const top = frames.pop();
            if (top === undefined || top.isObject !== (code === 0x7d)) {
                return text;
            }
            i++;
        } else if (code === 0x2c) {
            const top = frames[frames.length - 1];
            if (top?.isObject === true) {
                top.expectKey = true;
                top.key = undefined;
            }
            i++;
        } else if (code === 0x3a) {
            i++;
        } else {
            const start = i;
            while (i < length && !endsToken(text.charCodeAt(i))) {
                i++;
            }
            if (valueNode()?.target === true && JSON_NUMBER.test(text.slice(start, i))) {
                quoteAt.push([start, i]);
            }
        }
    }
    if (frames.length > 0) {
        return text;
    }
    if (quoteAt.length === 0) {
        return text;
    }

    let result = "";
    let copied = 0;
    for (const [start, end] of quoteAt) {
        result += `${text.slice(copied, start)}"${text.slice(start, end)}"`;
        copied = end;
    }
    return result + text.slice(copied);
}

/**
 * The key a quoted key with escapes stands for. In an object whose keys the tokenizer tracks, a key that does not
 * decode matches no path; `JSON.parse` reports the text.
 */
function decodeKey(quoted: string): string | undefined {
    try {
        return JSON.parse(quoted) as string;
    } catch {
        return undefined;
    }
}

/**
 * Converts, in place, the values of a parsed response at `paths` to `bigint`. A string of decimal digits and a safe
 * integer number are converted; `null` and an absent field stay as they are.
 *
 * @param value - The parsed response.
 * @param paths - The paths of the fields to convert; see {@link U64_FIELDS}.
 * @returns `value`, with the fields converted.
 * @throws {@link U64FieldError} when a field at one of the paths holds anything else.
 */
export function convertU64Fields(value: unknown, paths: readonly string[]): unknown {
    return convertAt(value, trieOf(paths), "");
}

function convertAt(value: unknown, node: PathNode, path: string): unknown {
    if (node.target) {
        return convertLeaf(value, path);
    }
    if (typeof value !== "object" || value === null) {
        return value;
    }
    if (Array.isArray(value)) {
        if (node.any !== undefined) {
            const element = node.any;
            value.forEach((item: unknown, index) => {
                value[index] = convertAt(item, element, `${path}[${index}]`);
            });
        }
        return value;
    }
    const record = value as Record<string, unknown>;
    for (const [key, child] of node.children) {
        if (Object.prototype.hasOwnProperty.call(record, key)) {
            record[key] = convertAt(record[key], child, path === "" ? key : `${path}.${key}`);
        }
    }
    return record;
}

function convertLeaf(value: unknown, path: string): unknown {
    if (value === null || value === undefined) {
        return value;
    }
    if (typeof value === "string" && /^\d+$/.test(value)) {
        return BigInt(value);
    }
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
        return BigInt(value);
    }
    throw new U64FieldError(path, value);
}
