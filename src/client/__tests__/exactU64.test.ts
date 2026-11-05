import { convertU64Fields, quoteU64Fields, U64FieldError, U64_FIELDS } from "../exactU64";
import { parseJsonResponse } from "../parseResponse";
import { SupraAPIError } from "../../errors/apiError";

const MAX_U64 = "18446744073709551615";

/** Quotes the targets of `text`, parses it and converts the targets, as `parseJsonResponse` does. */
function read(text: string, paths: readonly string[]): unknown {
    return convertU64Fields(JSON.parse(quoteU64Fields(text, paths)) as unknown, paths);
}

describe("quoteU64Fields", () => {
    it("wraps a number at a target path in quotes", () => {
        expect(quoteU64Fields('{"amount":12345,"other":1}', ["amount"])).toBe('{"amount":"12345","other":1}');
    });

    it("keeps a value above 2^53 exactly", () => {
        const text = `{"amount":${MAX_U64}}`;
        expect(quoteU64Fields(text, ["amount"])).toBe(`{"amount":"${MAX_U64}"}`);
        expect(read(text, ["amount"])).toEqual({ amount: 18446744073709551615n });
    });

    it("keeps a value above 2^64 exactly, from a number and from a string", () => {
        const max = "340282366920938463463374607431768211455";
        for (const literal of [max, `"${max}"`]) {
            const text = `{"amount":${literal}}`;
            expect(read(text, ["amount"])).toEqual({ amount: 340282366920938463463374607431768211455n });
        }
    });

    it("reads the block fields of both block paths, including a u128", () => {
        const text = '{"execution_statistics":{"evm_base_fee_per_gas":1,"evm_automated_txn_gas_unit_price":2}}';
        for (const paths of [U64_FIELDS.block, U64_FIELDS.blockWithTransactions]) {
            expect(read(text, paths)).toEqual({
                execution_statistics: { evm_base_fee_per_gas: 1n, evm_automated_txn_gas_unit_price: 2n },
            });
        }
    });

    it("leaves a target value that is already a string, null or absent as it is", () => {
        const text = '{"a":"7","b":null,"d":{"x":1}}';
        expect(quoteU64Fields(text, ["a", "b", "c"])).toBe(text);
        expect(read(text, ["a", "b", "c"])).toEqual({ a: 7n, b: null, d: { x: 1 } });
    });

    it("follows the full path, not the key name", () => {
        const text = '{"data":{"burn_amount":5,"inner":{"burn_amount":6}},"burn_amount":7}';
        expect(quoteU64Fields(text, ["data.burn_amount"])).toBe(
            '{"data":{"burn_amount":"5","inner":{"burn_amount":6}},"burn_amount":7}',
        );
    });

    it("leaves a same-named key inside a Move value as a number, at any depth", () => {
        const text = JSON.stringify({
            transactions: [
                {
                    data: { burn_amount: 3 },
                    output: {
                        Move: {
                            events: [
                                {
                                    type: "0x1::m::E",
                                    data: {
                                        burn_amount: 11,
                                        nested: [{ burn_amount: 12, list: [{ burn_amount: 13 }] }],
                                    },
                                },
                            ],
                        },
                    },
                },
            ],
        });
        const quoted = quoteU64Fields(text, U64_FIELDS.blockWithTransactions);
        expect(quoted).toBe(text.replace('"burn_amount":3', '"burn_amount":"3"'));
        const parsed = read(text, U64_FIELDS.blockWithTransactions) as {
            transactions: Array<{
                data: { burn_amount: unknown };
                output: { Move: { events: Array<{ data: unknown }> } };
            }>;
        };
        expect(parsed.transactions[0]?.data.burn_amount).toBe(3n);
        expect(parsed.transactions[0]?.output.Move.events[0]?.data).toEqual({
            burn_amount: 11,
            nested: [{ burn_amount: 12, list: [{ burn_amount: 13 }] }],
        });
    });

    it("treats array elements as a wildcard and a root array as the root", () => {
        expect(
            quoteU64Fields('[{"data":{"burn_amount":1}},{"data":{"burn_amount":2}}]', U64_FIELDS.transactionList),
        ).toBe('[{"data":{"burn_amount":"1"}},{"data":{"burn_amount":"2"}}]');
        expect(
            quoteU64Fields(
                '{"data":[{"stages":[{"amount":1},{"amount":2}],"pending":{"amount":3}}]}',
                U64_FIELDS.settlements,
            ),
        ).toBe('{"data":[{"stages":[{"amount":"1"},{"amount":"2"}],"pending":{"amount":"3"}}]}');
    });

    it("is not confused by strings that contain quotes, backslashes, braces, commas or the key name", () => {
        const text =
            '{"note":"a \\" b \\\\ { , \\"amount\\": 9 }","list":["]","[","\\\\"],"amount":42,"after":"amount\\\\"}';
        expect(quoteU64Fields(text, ["amount"])).toBe(
            '{"note":"a \\" b \\\\ { , \\"amount\\": 9 }","list":["]","[","\\\\"],"amount":"42","after":"amount\\\\"}',
        );
    });

    it("does not read a string value as a key", () => {
        const text = '{"x":"amount","y":1,"amount":2}';
        expect(quoteU64Fields(text, ["amount"])).toBe('{"x":"amount","y":1,"amount":"2"}');
        expect(quoteU64Fields('{"x":"amount","amount":2}', ["x.amount"])).toBe('{"x":"amount","amount":2}');
    });

    it("matches a key written with escapes", () => {
        expect(quoteU64Fields('{"am\\u006funt":5}', ["amount"])).toBe('{"am\\u006funt":"5"}');
    });

    it("handles whitespace between tokens", () => {
        const text = '{\n  "data" :\t{ "burn_amount"\r\n:  12 , "x": 1 }\n}';
        expect(quoteU64Fields(text, ["data.burn_amount"])).toBe(
            '{\n  "data" :\t{ "burn_amount"\r\n:  "12" , "x": 1 }\n}',
        );
    });

    it("quotes any JSON number token, so that the conversion rejects what is not an integer", () => {
        expect(quoteU64Fields('{"a":1.5,"b":-3,"c":1e3}', ["a", "b", "c"])).toBe('{"a":"1.5","b":"-3","c":"1e3"}');
        for (const body of ['{"a":1.5}', '{"a":-3}', '{"a":1e3}']) {
            expect(() => read(body, ["a"])).toThrow(U64FieldError);
        }
    });

    it("leaves literals at a target path as they are", () => {
        expect(quoteU64Fields('{"a":true,"b":false}', ["a", "b"])).toBe('{"a":true,"b":false}');
    });

    it("passes malformed text through unchanged", () => {
        for (const text of [
            '{"amount":1',
            '{"amount":"1',
            '{"amount":1}}',
            '{"amount":1]',
            '["amount":1}',
            "",
            "not json",
            '{"amount":12x}',
        ]) {
            const out = quoteU64Fields(text, ["amount"]);
            expect(out).toBe(text);
            expect(() => JSON.parse(out)).toThrow();
        }
    });

    it("returns text that no path matches unchanged", () => {
        const text = '{"a":[1,2,{"b":3}]}';
        expect(quoteU64Fields(text, ["amount"])).toBe(text);
    });
});

describe("convertU64Fields", () => {
    it("converts a decimal string and a safe integer number, in place", () => {
        const value = { a: "18446744073709551615", b: 5, c: null };
        expect(convertU64Fields(value, ["a", "b", "c", "d"])).toBe(value);
        expect(value).toEqual({ a: 18446744073709551615n, b: 5n, c: null });
    });

    it.each([["1.5"], ["-1"], [""], ["0x10"], [" 1"], [1.5], [-1], [Number.MAX_SAFE_INTEGER + 2], [true], [{}], [[]]])(
        "rejects %p",
        (bad) => {
            expect(() => convertU64Fields({ a: bad }, ["a"])).toThrow(U64FieldError);
        },
    );

    it("reports the path of the field", () => {
        expect(() =>
            convertU64Fields({ data: [{ stages: [{ amount: 1 }, { amount: "x" }] }] }, ["data[*].stages[*].amount"]),
        ).toThrow('"data[0].stages[1].amount"');
    });

    it("does not read inherited properties", () => {
        expect(convertU64Fields(Object.create({ a: 1 }) as object, ["a"])).toEqual({});
    });
});

function response(status: number, body: string): Response {
    return new Response(body, { status });
}

describe("parseJsonResponse with u64 fields", () => {
    it("returns bigint for the number form, the string form and a value above 2^53", async () => {
        const paths = U64_FIELDS.nativeSupply;
        const number = await parseJsonResponse(
            response(
                200,
                `{"burn_owed_quants":${MAX_U64},"escrow_settled_quants":7,"escrow_balance_quants":null,"x":8}`,
            ),
            "u",
            1,
            paths,
        );
        expect(number).toEqual({
            burn_owed_quants: 18446744073709551615n,
            escrow_settled_quants: 7n,
            escrow_balance_quants: null,
            x: 8,
        });
        const string = await parseJsonResponse(
            response(200, `{"burn_owed_quants":"${MAX_U64}","escrow_settled_quants":"7","escrow_balance_quants":"9"}`),
            "u",
            1,
            paths,
        );
        expect(string).toEqual({
            burn_owed_quants: 18446744073709551615n,
            escrow_settled_quants: 7n,
            escrow_balance_quants: 9n,
        });
    });

    it("parses as before when no paths are given", async () => {
        expect(await parseJsonResponse(response(200, '{"burn_owed_quants":7}'), "u", 1)).toEqual({
            burn_owed_quants: 7,
        });
    });

    it("does not touch an error response", async () => {
        expect(await parseJsonResponse(response(404, '{"amount":7}'), "u", 1, ["amount"])).toEqual({ amount: 7 });
    });

    it("throws SupraAPIError for a value that is not an unsigned decimal integer", async () => {
        const failure = await parseJsonResponse(response(200, '{"amount":"abc"}'), "u", 1, ["amount"]).catch(
            (e: unknown) => e,
        );
        expect(failure).toBeInstanceOf(SupraAPIError);
        expect(failure).toMatchObject({ status: 200, url: "u", data: '{"amount":"abc"}' });
        expect((failure as Error).message).toContain('"amount"');
    });

    it("still reports a non-JSON body as before", async () => {
        const failure = await parseJsonResponse(response(200, "<html>"), "u", 1, ["amount"]).catch((e: unknown) => e);
        expect(failure).toMatchObject({
            status: 200,
            statusText: "Expected a JSON response but received a non-JSON body",
        });
    });
});
