use aztec::{protocol::address::AztecAddress, test::helpers::test_environment::TestEnvironment};
use crate::VoteHistory;

/// Standard test setup: deploy VoteHistory (no initializer).
/// Returns (env, contract_address).
pub unconstrained fn setup() -> (TestEnvironment, AztecAddress) {
    let mut env = TestEnvironment::new();
    let contract_address = env.deploy("vote_history").without_initializer();
    (env, contract_address)
}
