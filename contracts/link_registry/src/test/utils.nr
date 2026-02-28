use aztec::{protocol::address::AztecAddress, test::helpers::test_environment::TestEnvironment};
use crate::LinkRegistry;

/// Standard test setup: deploy LinkRegistry (no initializer).
/// Returns (env, contract_address).
pub unconstrained fn setup() -> (TestEnvironment, AztecAddress) {
    let mut env = TestEnvironment::new();
    let contract_address = env.deploy("link_registry").without_initializer();
    (env, contract_address)
}
