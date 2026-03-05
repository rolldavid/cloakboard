use aztec::{protocol::address::AztecAddress, test::helpers::test_environment::TestEnvironment};
use crate::UserProfile;

/// Standard test setup: deploy UserProfile V6 with keeper and authorized caller.
/// Returns (env, contract_address, keeper, authorized_caller).
pub unconstrained fn setup() -> (TestEnvironment, AztecAddress, AztecAddress, AztecAddress) {
    let mut env = TestEnvironment::new();

    let keeper = env.create_light_account();
    let authorized_caller = env.create_light_account();

    let initializer_call = UserProfile::interface().constructor(keeper);
    let contract_address =
        env.deploy("user_profile").with_public_initializer(keeper, initializer_call);

    // Set the authorized caller (simulates keeper linking DuelCloak)
    let up = UserProfile::at(contract_address);
    env.call_public(keeper, up.set_authorized_caller(authorized_caller));

    (env, contract_address, keeper, authorized_caller)
}
