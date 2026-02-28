use aztec::{protocol::address::AztecAddress, test::helpers::test_environment::TestEnvironment};
use crate::UserProfile;

/// Standard test setup: deploy UserProfile (no initializer).
/// Returns (env, contract_address).
pub unconstrained fn setup() -> (TestEnvironment, AztecAddress) {
    let mut env = TestEnvironment::new();

    // UserProfile has no initializer -- deploy without one
    let contract_address = env.deploy("user_profile").without_initializer();

    (env, contract_address)
}
