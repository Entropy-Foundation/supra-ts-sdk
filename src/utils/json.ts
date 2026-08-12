/**
 * Marker that `stringifyWithBigInt` wraps around every `bigint` before handing it
 * to `JSON.stringify`, so the quoted placeholder can be turned back into a bare
 * number literal afterwards. It contains no characters that `JSON.stringify`
 * escapes, so it survives serialization verbatim.
 */
const BIGINT_MARKER = "__supra_bigint__";
const BIGINT_PATTERN = new RegExp(`"${BIGINT_MARKER}(-?\\d+)${BIGINT_MARKER}"`, "g");

/**
 * `JSON.stringify` that emits `bigint` values as exact JSON number literals.
 *
 * A `u64` above `Number.MAX_SAFE_INTEGER` cannot survive a trip through a
 * JavaScript `number` — `Number(9007199254740993n)` is `9007199254740992` — so a
 * transaction body built that way no longer matches the transaction the caller
 * signed. Keeping the value a `bigint` all the way to serialization avoids the
 * lossy conversion, and writing it as a bare number literal keeps the wire
 * format byte-identical to what the RPC already accepts (Rust's `serde_json`
 * parses `u64`/`u128` from number literals without going through a float).
 *
 * Every other value is serialized exactly as `JSON.stringify` would, so the
 * output for a bigint-free input is unchanged.
 *
 * @param value - The value to serialize.
 * @returns The JSON text, with any `bigint` written as an exact number literal.
 * @throws If `value` is not JSON-serializable, or if a string inside `value`
 * collides with the internal marker — the serializer fails closed rather than
 * emitting a number the caller never supplied.
 */
export function stringifyWithBigInt(value: unknown): string {
    let wrapped = 0;

    const json = JSON.stringify(value, (_key, entry: unknown) => {
        if (typeof entry === "bigint") {
            wrapped += 1;
            return `${BIGINT_MARKER}${entry.toString()}${BIGINT_MARKER}`;
        }
        return entry;
    });

    if (json === undefined) {
        throw new Error("Value is not JSON-serializable");
    }

    if (wrapped === 0) {
        return json;
    }

    let unwrapped = 0;
    const result = json.replace(BIGINT_PATTERN, (_match, digits: string) => {
        unwrapped += 1;
        return digits;
    });

    if (unwrapped !== wrapped) {
        throw new Error(
            `Refusing to serialize: expected to unwrap ${wrapped} bigint value(s) but unwrapped ${unwrapped}`,
        );
    }

    return result;
}
