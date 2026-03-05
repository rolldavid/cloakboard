use crate::test::utils;
use crate::UserProfile;

#[test]
unconstrained fn test_set_and_get_username() {
    let (env, contract_address, _keeper, _authorized_caller) = utils::setup();
    let up = UserProfile::at(contract_address);

    let mut env = env;
    let alice = env.create_light_account();

    let name_field: Field = 0x416C696365; // "Alice" as compressed
    env.call_private(alice, up.set_username(name_field));

    let retrieved = env.simulate_utility(up.get_my_username(alice));
    assert_eq(retrieved, name_field);
}

#[test]
unconstrained fn test_set_username_overwrite() {
    let (env, contract_address, _keeper, _authorized_caller) = utils::setup();
    let up = UserProfile::at(contract_address);

    let mut env = env;
    let alice = env.create_light_account();

    let name_1: Field = 0x416C696365; // "Alice"
    let name_2: Field = 0x426F620000; // "Bob"

    env.call_private(alice, up.set_username(name_1));
    env.call_private(alice, up.set_username(name_2));

    // get_my_username returns the last (most recently inserted) note
    let retrieved = env.simulate_utility(up.get_my_username(alice));
    assert_eq(retrieved, name_2);
}

#[test]
unconstrained fn test_get_username_empty() {
    let (env, contract_address, _keeper, _authorized_caller) = utils::setup();
    let up = UserProfile::at(contract_address);

    let mut env = env;
    let alice = env.create_light_account();

    // New user has no username -- returns 0
    let retrieved = env.simulate_utility(up.get_my_username(alice));
    assert_eq(retrieved, 0);
}

#[test]
unconstrained fn test_different_users_different_usernames() {
    let (env, contract_address, _keeper, _authorized_caller) = utils::setup();
    let up = UserProfile::at(contract_address);

    let mut env = env;
    let alice = env.create_light_account();
    let bob = env.create_light_account();

    let alice_name: Field = 0x416C696365;
    let bob_name: Field = 0x426F620000;

    env.call_private(alice, up.set_username(alice_name));
    env.call_private(bob, up.set_username(bob_name));

    let alice_retrieved = env.simulate_utility(up.get_my_username(alice));
    assert_eq(alice_retrieved, alice_name);

    let bob_retrieved = env.simulate_utility(up.get_my_username(bob));
    assert_eq(bob_retrieved, bob_name);
}
