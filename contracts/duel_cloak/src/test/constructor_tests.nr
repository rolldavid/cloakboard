use crate::test::utils;
use crate::DuelCloak;

#[test]
unconstrained fn test_constructor_with_first_duel() {
    let (env, contract_address, keeper, creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    // Verify duel was created
    let duel_count = env.simulate_utility(dc.get_duel_count());
    assert_eq(duel_count, 1);

    let duel = env.simulate_utility(dc.get_duel(0));
    assert_eq(duel.id, 0);
    assert_eq(duel.statement_part_1, 0x1111);
    assert_eq(duel.statement_part_2, 0x2222);
    assert_eq(duel.statement_part_3, 0x3333);
    assert_eq(duel.statement_part_4, 0x4444);
    assert_eq(duel.total_votes, 0);
    assert_eq(duel.agree_votes, 0);
    assert_eq(duel.disagree_votes, 0);

    // Verify membership
    let role = env.simulate_utility(dc.get_member_role(creator));
    assert_eq(role, 3); // ROLE_CREATOR

    let member_count = env.simulate_utility(dc.get_member_count());
    assert_eq(member_count, 1);

    // Verify keeper
    let stored_keeper = env.simulate_utility(dc.get_keeper());
    assert_eq(stored_keeper, keeper);

    // Verify statement count
    let stmt_count = env.simulate_utility(dc.get_statement_count());
    assert_eq(stmt_count, 1);
}

#[test]
unconstrained fn test_constructor_without_first_duel() {
    let (env, contract_address, _keeper, _creator) = utils::setup_no_duel();
    let dc = DuelCloak::at(contract_address);

    let duel_count = env.simulate_utility(dc.get_duel_count());
    assert_eq(duel_count, 0);

    let stmt_count = env.simulate_utility(dc.get_statement_count());
    assert_eq(stmt_count, 0);
}

#[test]
unconstrained fn test_constructor_creator_is_member() {
    let (env, contract_address, _keeper, creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    let role = env.simulate_utility(dc.get_member_role(creator));
    assert_eq(role, 3); // ROLE_CREATOR

    let member_count = env.simulate_utility(dc.get_member_count());
    assert_eq(member_count, 1);

    let council_count = env.simulate_utility(dc.get_council_count());
    assert_eq(council_count, 1);
}

#[test]
unconstrained fn test_constructor_sets_config() {
    let (env, contract_address, _keeper, _creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    let duration = env.simulate_utility(dc.get_duel_duration());
    assert_eq(duration, 100);

    let first_block = env.simulate_utility(dc.get_first_duel_block());
    assert_eq(first_block, 0);

    let viewable = env.simulate_utility(dc.get_is_publicly_viewable());
    assert_eq(viewable, true);
}
