use crate::test::utils;
use crate::UserProfile;

#[test]
unconstrained fn test_add_and_get_points() {
    let (env, contract_address) = utils::setup();
    let up = UserProfile::at(contract_address);

    let mut env = env;
    let alice = env.create_light_account();

    env.call_private(alice, up.add_points(10));

    let points = env.simulate_utility(up.get_my_points(alice));
    assert_eq(points, 10);
}

#[test]
unconstrained fn test_add_points_multiple() {
    let (env, contract_address) = utils::setup();
    let up = UserProfile::at(contract_address);

    let mut env = env;
    let alice = env.create_light_account();

    env.call_private(alice, up.add_points(10));
    env.call_private(alice, up.add_points(25));

    let points = env.simulate_utility(up.get_my_points(alice));
    assert_eq(points, 35);
}

#[test]
unconstrained fn test_add_points_different_users() {
    let (env, contract_address) = utils::setup();
    let up = UserProfile::at(contract_address);

    let mut env = env;
    let alice = env.create_light_account();
    let bob = env.create_light_account();

    env.call_private(alice, up.add_points(10));
    env.call_private(bob, up.add_points(50));

    let alice_points = env.simulate_utility(up.get_my_points(alice));
    assert_eq(alice_points, 10);

    let bob_points = env.simulate_utility(up.get_my_points(bob));
    assert_eq(bob_points, 50);
}

#[test]
unconstrained fn test_get_points_empty() {
    let (env, contract_address) = utils::setup();
    let up = UserProfile::at(contract_address);

    let mut env = env;
    let alice = env.create_light_account();

    // New user has no points
    let points = env.simulate_utility(up.get_my_points(alice));
    assert_eq(points, 0);
}

#[test]
unconstrained fn test_prove_min_points_sufficient() {
    let (env, contract_address) = utils::setup();
    let up = UserProfile::at(contract_address);

    let mut env = env;
    let alice = env.create_light_account();

    env.call_private(alice, up.add_points(100));

    // Should succeed -- alice has 100, threshold is 50
    env.call_private(alice, up.prove_min_points(50));

    // After prove, points should be consolidated but still 100
    let points = env.simulate_utility(up.get_my_points(alice));
    assert_eq(points, 100);
}

#[test(should_fail_with = "insufficient whisper points")]
unconstrained fn test_prove_min_points_insufficient_fails() {
    let (env, contract_address) = utils::setup();
    let up = UserProfile::at(contract_address);

    let mut env = env;
    let alice = env.create_light_account();

    env.call_private(alice, up.add_points(5));
    env.call_private(alice, up.prove_min_points(100)); // only has 5
}

#[test]
unconstrained fn test_prove_min_points_exact_threshold() {
    let (env, contract_address) = utils::setup();
    let up = UserProfile::at(contract_address);

    let mut env = env;
    let alice = env.create_light_account();

    env.call_private(alice, up.add_points(50));

    // Exact match should succeed (>= threshold)
    env.call_private(alice, up.prove_min_points(50));

    let points = env.simulate_utility(up.get_my_points(alice));
    assert_eq(points, 50);
}

#[test]
unconstrained fn test_prove_min_points_consolidates() {
    let (env, contract_address) = utils::setup();
    let up = UserProfile::at(contract_address);

    let mut env = env;
    let alice = env.create_light_account();

    // Add points in multiple notes
    env.call_private(alice, up.add_points(10));
    env.call_private(alice, up.add_points(20));
    env.call_private(alice, up.add_points(30));

    // prove_min_points pops all notes and re-emits a consolidated one
    env.call_private(alice, up.prove_min_points(50));

    // Total should still be correct
    let points = env.simulate_utility(up.get_my_points(alice));
    assert_eq(points, 60);
}
