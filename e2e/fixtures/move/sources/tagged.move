/// Entry and view functions used by the end-to-end tests: functions with an unconstrained type
/// parameter, and functions whose arguments exercise the encoding of `vector<u8>`, `Option`,
/// fixed-point numbers and several signers.
module sdk_e2e::tagged {
    use std::fixed_point32::{Self, FixedPoint32};
    use std::fixed_point64::{Self, FixedPoint64};
    use std::option::{Self, Option};
    use std::vector;

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

    /// The raw values of the fixed-point arguments last given to `store_fixed`.
    struct Fixed has key {
        value32: FixedPoint32,
        value64: FixedPoint64,
        list32: vector<u64>,
        option64: Option<u128>,
    }

    /// Stores the fixed-point arguments under the signer's address.
    public entry fun store_fixed(
        account: &signer,
        value32: FixedPoint32,
        value64: FixedPoint64,
        list32: vector<FixedPoint32>,
        option64: Option<FixedPoint64>,
    ) {
        let raw32 = vector::empty<u64>();
        vector::for_each_ref(&list32, |v| vector::push_back(&mut raw32, fixed_point32::get_raw_value(*v)));
        let raw64 = if (option::is_some(&option64)) {
            option::some(fixed_point64::get_raw_value(*option::borrow(&option64)))
        } else {
            option::none()
        };
        move_to(account, Fixed { value32, value64, list32: raw32, option64: raw64 });
    }

    #[view]
    public fun raw32(value: FixedPoint32): u64 {
        fixed_point32::get_raw_value(value)
    }

    #[view]
    public fun raw64(value: FixedPoint64): u128 {
        fixed_point64::get_raw_value(value)
    }

    #[view]
    public fun echo_fixed32(value: FixedPoint32): FixedPoint32 {
        value
    }

    #[view]
    public fun echo_fixed64(value: FixedPoint64): FixedPoint64 {
        value
    }

    #[view]
    public fun raw32_list(values: vector<FixedPoint32>): vector<u64> {
        let raw = vector::empty<u64>();
        vector::for_each_ref(&values, |v| vector::push_back(&mut raw, fixed_point32::get_raw_value(*v)));
        raw
    }
}
