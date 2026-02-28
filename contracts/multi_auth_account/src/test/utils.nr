use aztec::{protocol::address::AztecAddress, test::helpers::test_environment::TestEnvironment};
use crate::MultiAuthAccount;

/// Standard test setup: deploy MultiAuthAccount with a Schnorr primary key.
/// Returns (env, contract_address, deployer, primary_key_hash, label_hash).
pub unconstrained fn setup() -> (TestEnvironment, AztecAddress, AztecAddress, Field, Field) {
    let mut env = TestEnvironment::new();

    let deployer = env.create_light_account();

    let key_type: u8 = 0; // KEY_TYPE_SCHNORR
    let primary_key_hash: Field = 0xABCDEF1234567890;
    let label_hash: Field = 0x1234;

    let initializer_call = MultiAuthAccount::interface().constructor(
        key_type,
        primary_key_hash,
        label_hash,
    );

    let contract_address =
        env.deploy("MultiAuthAccount").with_public_initializer(deployer, initializer_call);

    (env, contract_address, deployer, primary_key_hash, label_hash)
}

/// Deploy with a specific key type.
pub unconstrained fn setup_with_key_type(key_type: u8) -> (TestEnvironment, AztecAddress, AztecAddress, Field, Field) {
    let mut env = TestEnvironment::new();

    let deployer = env.create_light_account();

    let primary_key_hash: Field = 0xABCDEF1234567890;
    let label_hash: Field = 0x1234;

    let initializer_call = MultiAuthAccount::interface().constructor(
        key_type,
        primary_key_hash,
        label_hash,
    );

    let contract_address =
        env.deploy("MultiAuthAccount").with_public_initializer(deployer, initializer_call);

    (env, contract_address, deployer, primary_key_hash, label_hash)
}
