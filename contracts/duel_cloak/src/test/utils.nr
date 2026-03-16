use aztec::{protocol::address::AztecAddress, test::helpers::test_environment::TestEnvironment};
use crate::DuelCloak;

/// Standard test setup: deploy DuelCloak with a first duel already started.
/// Returns (env, contract_address, keeper, creator).
pub unconstrained fn setup() -> (TestEnvironment, AztecAddress, AztecAddress, AztecAddress) {
    let mut env = TestEnvironment::new();

    let keeper = env.create_light_account();
    let creator = env.create_light_account();

    // Statement parts for the first duel
    let stmt_1: Field = 0x1111;
    let stmt_2: Field = 0x2222;
    let stmt_3: Field = 0x3333;
    let stmt_4: Field = 0x4444;

    let dummy_profile = AztecAddress::zero();

    let initializer_call = DuelCloak::interface().constructor(
        "TestCloak0000000000000000000000",
        100,
        0,
        true,
        keeper,
        0,       // _tally_mode
        creator,
        stmt_1,
        stmt_2,
        stmt_3,
        stmt_4,
        dummy_profile,
    );

    let contract_address =
        env.deploy("duel_cloak").with_public_initializer(keeper, initializer_call);

    (env, contract_address, keeper, creator)
}

/// Setup without a first duel, with a future first_duel_block.
/// Duels cannot be started until block number >= first_duel_block.
/// Returns (env, contract_address, keeper, creator).
pub unconstrained fn setup_future_block() -> (TestEnvironment, AztecAddress, AztecAddress, AztecAddress) {
    let mut env = TestEnvironment::new();

    let keeper = env.create_light_account();
    let creator = env.create_light_account();

    let initializer_call = DuelCloak::interface().constructor(
        "TestCloak0000000000000000000000",
        100,
        9999, // first_duel_block far in the future
        true,
        keeper,
        0,       // _tally_mode
        creator,
        0, 0, 0, 0, // no first duel
        AztecAddress::zero(),
    );

    let contract_address =
        env.deploy("duel_cloak").with_public_initializer(keeper, initializer_call);

    (env, contract_address, keeper, creator)
}

/// Setup without a first duel (pass zero for first_stmt_1).
/// Returns (env, contract_address, keeper, creator).
pub unconstrained fn setup_no_duel() -> (TestEnvironment, AztecAddress, AztecAddress, AztecAddress) {
    let mut env = TestEnvironment::new();

    let keeper = env.create_light_account();
    let creator = env.create_light_account();

    let initializer_call = DuelCloak::interface().constructor(
        "TestCloak0000000000000000000000",
        100,
        0,
        true,
        keeper,
        0,       // _tally_mode
        creator,
        0, 0, 0, 0, // no first duel
        AztecAddress::zero(),
    );

    let contract_address =
        env.deploy("duel_cloak").with_public_initializer(keeper, initializer_call);

    (env, contract_address, keeper, creator)
}
