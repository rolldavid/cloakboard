use crate::test::utils;
use crate::DuelCloak;

#[test]
unconstrained fn test_cast_vote_agree() {
    let (env, contract_address, _keeper, _creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    let mut env = env;
    let alice = env.create_light_account();

    env.call_private(alice, dc.cast_vote(0 as Field, true));

    let duel = env.simulate_utility(dc.get_duel(0));
    assert_eq(duel.agree_votes, 1);
    assert_eq(duel.disagree_votes, 0);
    assert_eq(duel.total_votes, 1);
}

#[test]
unconstrained fn test_cast_vote_disagree() {
    let (env, contract_address, _keeper, _creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    let mut env = env;
    let alice = env.create_light_account();

    env.call_private(alice, dc.cast_vote(0 as Field, false));

    let duel = env.simulate_utility(dc.get_duel(0));
    assert_eq(duel.agree_votes, 0);
    assert_eq(duel.disagree_votes, 1);
    assert_eq(duel.total_votes, 1);
}

#[test]
unconstrained fn test_cast_vote_multiple_users() {
    let (env, contract_address, _keeper, _creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    let mut env = env;
    let alice = env.create_light_account();
    let bob = env.create_light_account();

    env.call_private(alice, dc.cast_vote(0 as Field, true));
    env.call_private(bob, dc.cast_vote(0 as Field, false));

    let duel = env.simulate_utility(dc.get_duel(0));
    assert_eq(duel.agree_votes, 1);
    assert_eq(duel.disagree_votes, 1);
    assert_eq(duel.total_votes, 2);
}

#[test(should_fail_with = "duplicate siloed nullifier")]
unconstrained fn test_cast_vote_twice_same_duel_fails() {
    let (env, contract_address, _keeper, _creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    let mut env = env;
    let alice = env.create_light_account();

    env.call_private(alice, dc.cast_vote(0 as Field, true));
    env.call_private(alice, dc.cast_vote(0 as Field, false)); // should fail
}

#[test]
unconstrained fn test_cast_vote_different_duels() {
    let (env, contract_address, keeper, _creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    let mut env = env;
    let alice = env.create_light_account();

    // Vote on first duel
    env.call_private(alice, dc.cast_vote(0 as Field, true));

    // Mine blocks to end first duel
    for _ in 0..101 {
        env.mine_block();
    }

    // Create second duel
    env.call_public(keeper, dc.submit_and_start_duel(0xAAAA, 0xBBBB, 0xCCCC, 0xDDDD));

    // Vote on second duel -- same user, should succeed
    env.call_private(alice, dc.cast_vote(1 as Field, false));

    let duel_0 = env.simulate_utility(dc.get_duel(0));
    assert_eq(duel_0.agree_votes, 1);

    let duel_1 = env.simulate_utility(dc.get_duel(1));
    assert_eq(duel_1.disagree_votes, 1);
}

#[test]
unconstrained fn test_cast_vote_three_users_agree() {
    let (env, contract_address, _keeper, _creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    let mut env = env;
    let alice = env.create_light_account();
    let bob = env.create_light_account();
    let charlie = env.create_light_account();

    env.call_private(alice, dc.cast_vote(0 as Field, true));
    env.call_private(bob, dc.cast_vote(0 as Field, true));
    env.call_private(charlie, dc.cast_vote(0 as Field, true));

    let duel = env.simulate_utility(dc.get_duel(0));
    assert_eq(duel.agree_votes, 3);
    assert_eq(duel.disagree_votes, 0);
    assert_eq(duel.total_votes, 3);
}

#[test]
unconstrained fn test_cast_vote_mixed_votes() {
    let (env, contract_address, _keeper, _creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    let mut env = env;
    let alice = env.create_light_account();
    let bob = env.create_light_account();
    let charlie = env.create_light_account();
    let dave = env.create_light_account();

    env.call_private(alice, dc.cast_vote(0 as Field, true));
    env.call_private(bob, dc.cast_vote(0 as Field, false));
    env.call_private(charlie, dc.cast_vote(0 as Field, true));
    env.call_private(dave, dc.cast_vote(0 as Field, false));

    let duel = env.simulate_utility(dc.get_duel(0));
    assert_eq(duel.agree_votes, 2);
    assert_eq(duel.disagree_votes, 2);
    assert_eq(duel.total_votes, 4);
}
