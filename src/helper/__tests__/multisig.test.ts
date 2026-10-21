import { deriveMultisigAccountAddress } from "../multisig";

describe("deriveMultisigAccountAddress", () => {
    // Recorded from the localnets: `create_with_owners` sent by the creator with sequence number 0, and the address
    // that `0x1::multisig_account::get_next_multisig_account_address` returned before the transaction.
    test.each([
        [
            "v12.0.0.rc6",
            "0x4c63be4719d1a095adc13097878089179f82c5a7a4c61931eace441aea5f37d8",
            "0x99c3eb769a3fe9f9cf8146ed9236cb8bf1a59b96d9611de399112b355dc2c965",
        ],
        [
            "v11.7.0",
            "0x7bb41ca95c5a96e4aa1b0167a0a6f7f34166c9fa273b97e53a656ea9357717f9",
            "0x8bbbabaf2eb63412554078fe1276d8085e94101f41bd58490b0810872698b631",
        ],
    ])("derives the address the node %s reports", (_node, creatorAddress, expected) => {
        expect(deriveMultisigAccountAddress({ creatorAddress, sequenceNumber: 0n })).toBe(expected);
        expect(deriveMultisigAccountAddress({ creatorAddress, sequenceNumber: 0 })).toBe(expected);
    });

    test("a different sequence number or creator gives a different address", () => {
        const creatorAddress = "0x1234";
        const first = deriveMultisigAccountAddress({ creatorAddress, sequenceNumber: 0n });
        expect(deriveMultisigAccountAddress({ creatorAddress, sequenceNumber: 1n })).not.toBe(first);
        expect(deriveMultisigAccountAddress({ creatorAddress: "0x1235", sequenceNumber: 0n })).not.toBe(first);
        expect(first).toMatch(/^0x[0-9a-f]{64}$/);
    });

    test("a short address is padded as the framework reads it", () => {
        expect(deriveMultisigAccountAddress({ creatorAddress: "0x1", sequenceNumber: 3n })).toBe(
            deriveMultisigAccountAddress({ creatorAddress: `0x${"0".repeat(63)}1`, sequenceNumber: 3n }),
        );
    });

    test.each([[-1n], [1n << 64n], [1.5]])("refuses the sequence number %s", (sequenceNumber) => {
        expect(() => deriveMultisigAccountAddress({ creatorAddress: "0x1", sequenceNumber })).toThrow(RangeError);
    });

    test("refuses an address that is not hex", () => {
        expect(() => deriveMultisigAccountAddress({ creatorAddress: "0xzz", sequenceNumber: 0n })).toThrow(RangeError);
    });
});
