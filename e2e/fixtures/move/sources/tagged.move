/// Entry and view functions with an unconstrained type parameter, used to submit, simulate and view
/// with type arguments that are not structs.
module sdk_e2e::tagged {
    /// Succeeds for every type argument.
    public entry fun tagged<T>(_account: &signer) {}

    #[view]
    public fun echo<T>(value: u64): u64 {
        value
    }
}
