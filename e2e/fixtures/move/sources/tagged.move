/// Entry and view functions used by the end-to-end tests: functions with an unconstrained type
/// parameter, and functions whose arguments exercise the encoding of `vector<u8>`, `Option` and
/// several signers.
module sdk_e2e::tagged {
    use std::option::{Self, Option};

    /// Abort code of `with_bytes` for a `vector<u8>` that is not the expected value.
    const E_BYTES: u64 = 1;
    /// Abort code of `with_bytes` for a `u64` that is not the expected value.
    const E_TAG: u64 = 2;
    /// Result of the `option_*` views for an `Option` that is `None`.
    const NONE_U64: u64 = 1000;

    /// Succeeds for every type argument.
    public entry fun tagged<T>(_account: &signer) {}

    #[view]
    public fun echo<T>(value: u64): u64 {
        value
    }

    /// Succeeds with two signers.
    public entry fun two_signers(_a: &signer, _b: &signer) {}

    /// Succeeds with three signers and one value argument.
    public entry fun three_signers(_a: &signer, _b: &signer, _c: &signer, _value: u8) {}

    /// Aborts unless `bytes` is `0x0001ff7f` and `tag` is 7.
    public entry fun with_bytes(_account: &signer, bytes: vector<u8>, tag: u64) {
        assert!(bytes == x"0001ff7f", E_BYTES);
        assert!(tag == 7, E_TAG);
    }

    #[view]
    public fun echo_bytes(bytes: vector<u8>): vector<u8> {
        bytes
    }

    #[view]
    public fun option_u8(value: Option<u8>): u64 {
        if (option::is_some(&value)) (*option::borrow(&value) as u64) else NONE_U64
    }

    #[view]
    public fun option_u64(value: Option<u64>): u64 {
        if (option::is_some(&value)) *option::borrow(&value) else NONE_U64
    }

    #[view]
    public fun option_address(value: Option<address>): address {
        if (option::is_some(&value)) *option::borrow(&value) else @0x0
    }

    #[view]
    public fun option_bytes(value: Option<vector<u8>>): vector<u8> {
        if (option::is_some(&value)) *option::borrow(&value) else x"ffffff"
    }
}
