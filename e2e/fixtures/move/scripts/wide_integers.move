// Aborts unless the arguments are the values the end-to-end test passes.
script {
    fun main(_account: &signer, a: u16, b: u32, c: u256) {
        if (a != 65535u16) abort 1;
        if (b != 4294967295u32) abort 2;
        if (c != 115792089237316195423570985008687907853269984665640564039457584007913129639935u256) abort 3;
    }
}
