use crate::test::utils;
use crate::VoteHistory;

#[test]
unconstrained fn test_record_and_get_vote_agree() {
    let (env, contract_address) = utils::setup();
    let vh = VoteHistory::at(contract_address);

    let mut env = env;
    let alice = env.create_light_account();

    let duel_id: Field = 42;
    let cloak_addr: Field = 0xABCD;
    let direction: Field = 1; // agree

    env.call_private(alice, vh.record_vote(duel_id, cloak_addr, direction));

    let result = env.execute_utility(vh.get_my_vote_for_duel(alice, duel_id, cloak_addr));
    assert_eq(result, 1);
}

#[test]
unconstrained fn test_record_and_get_vote_disagree() {
    let (env, contract_address) = utils::setup();
    let vh = VoteHistory::at(contract_address);

    let mut env = env;
    let alice = env.create_light_account();

    let duel_id: Field = 42;
    let cloak_addr: Field = 0xABCD;
    let direction: Field = 0; // disagree

    env.call_private(alice, vh.record_vote(duel_id, cloak_addr, direction));

    let result = env.execute_utility(vh.get_my_vote_for_duel(alice, duel_id, cloak_addr));
    assert_eq(result, 0);
}

#[test]
unconstrained fn test_get_vote_not_found() {
    let (env, contract_address) = utils::setup();
    let vh = VoteHistory::at(contract_address);

    let mut env = env;
    let alice = env.create_light_account();

    let result = env.execute_utility(vh.get_my_vote_for_duel(alice, 999, 0xBEEF));
    assert_eq(result, 2); // not found
}

#[test]
unconstrained fn test_multiple_duels_different_cloaks() {
    let (env, contract_address) = utils::setup();
    let vh = VoteHistory::at(contract_address);

    let mut env = env;
    let alice = env.create_light_account();

    // Vote on duel 1, cloak A: agree
    env.call_private(alice, vh.record_vote(1, 0xAA, 1));
    // Vote on duel 2, cloak B: disagree
    env.call_private(alice, vh.record_vote(2, 0xBB, 0));
    // Vote on duel 1, cloak B: disagree
    env.call_private(alice, vh.record_vote(1, 0xBB, 0));

    assert_eq(env.execute_utility(vh.get_my_vote_for_duel(alice, 1, 0xAA)), 1);
    assert_eq(env.execute_utility(vh.get_my_vote_for_duel(alice, 2, 0xBB)), 0);
    assert_eq(env.execute_utility(vh.get_my_vote_for_duel(alice, 1, 0xBB)), 0);
}

#[test]
unconstrained fn test_different_users_independent() {
    let (env, contract_address) = utils::setup();
    let vh = VoteHistory::at(contract_address);

    let mut env = env;
    let alice = env.create_light_account();
    let bob = env.create_light_account();

    let duel_id: Field = 1;
    let cloak: Field = 0xAA;

    env.call_private(alice, vh.record_vote(duel_id, cloak, 1)); // agree
    env.call_private(bob, vh.record_vote(duel_id, cloak, 0));   // disagree

    assert_eq(env.execute_utility(vh.get_my_vote_for_duel(alice, duel_id, cloak)), 1);
    assert_eq(env.execute_utility(vh.get_my_vote_for_duel(bob, duel_id, cloak)), 0);
}

#[test]
unconstrained fn test_same_duel_different_cloaks() {
    let (env, contract_address) = utils::setup();
    let vh = VoteHistory::at(contract_address);

    let mut env = env;
    let alice = env.create_light_account();

    let duel_id: Field = 5;
    let cloak_a: Field = 0x1111;
    let cloak_b: Field = 0x2222;

    env.call_private(alice, vh.record_vote(duel_id, cloak_a, 1)); // agree on cloak A
    env.call_private(alice, vh.record_vote(duel_id, cloak_b, 0)); // disagree on cloak B

    assert_eq(env.execute_utility(vh.get_my_vote_for_duel(alice, duel_id, cloak_a)), 1);
    assert_eq(env.execute_utility(vh.get_my_vote_for_duel(alice, duel_id, cloak_b)), 0);

    // Unrelated combo should return not found
    assert_eq(env.execute_utility(vh.get_my_vote_for_duel(alice, duel_id, 0x9999)), 2);
}
