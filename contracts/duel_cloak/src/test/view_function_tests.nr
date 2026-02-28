use crate::test::utils;
use crate::DuelCloak;

#[test]
unconstrained fn test_get_keeper() {
    let (env, contract_address, keeper, _creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    let stored_keeper = env.simulate_utility(dc.get_keeper());
    assert_eq(stored_keeper, keeper);
}

#[test]
unconstrained fn test_get_active_duel() {
    let (env, contract_address, _keeper, _creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    let active_duel = env.simulate_utility(dc.get_active_duel());
    assert_eq(active_duel.id, 0);
    assert_eq(active_duel.statement_part_1, 0x1111);
}

#[test]
unconstrained fn test_get_duel_by_id() {
    let (env, contract_address, _keeper, _creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    let duel = env.simulate_utility(dc.get_duel(0));
    assert_eq(duel.id, 0);
    assert_eq(duel.statement_part_1, 0x1111);
    assert_eq(duel.statement_part_2, 0x2222);
    assert_eq(duel.statement_part_3, 0x3333);
    assert_eq(duel.statement_part_4, 0x4444);
}

#[test]
unconstrained fn test_is_statement_in_pool() {
    let (env, contract_address, keeper, _creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    let stmt_hash: Field = std::hash::pedersen_hash([0xAAAA, 0xBBBB, 0xCCCC, 0xDDDD]);

    // Not in pool yet
    let in_pool = env.simulate_utility(dc.is_statement_in_pool(stmt_hash));
    assert_eq(in_pool, false);

    // Submit it
    env.call_public(keeper, dc.submit_statement_hash(stmt_hash));

    // Now in pool
    let in_pool_after = env.simulate_utility(dc.is_statement_in_pool(stmt_hash));
    assert_eq(in_pool_after, true);
}

#[test]
unconstrained fn test_get_current_duel_id() {
    let (env, contract_address, _keeper, _creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    let current_id = env.simulate_utility(dc.get_current_duel_id());
    assert_eq(current_id, 0);
}

#[test]
unconstrained fn test_get_duel_duration() {
    let (env, contract_address, _keeper, _creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    let duration = env.simulate_utility(dc.get_duel_duration());
    assert_eq(duration, 100);
}

#[test]
unconstrained fn test_get_is_publicly_viewable() {
    let (env, contract_address, _keeper, _creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    let viewable = env.simulate_utility(dc.get_is_publicly_viewable());
    assert_eq(viewable, true);
}

#[test]
unconstrained fn test_update_duel_duration() {
    let (env, contract_address, _keeper, creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    env.call_public(creator, dc.update_duel_duration(200));

    let duration = env.simulate_utility(dc.get_duel_duration());
    assert_eq(duration, 200);
}

#[test(should_fail_with = "only creator")]
unconstrained fn test_update_duel_duration_not_creator_fails() {
    let (env, contract_address, keeper, _creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    // Keeper is not the creator
    env.call_public(keeper, dc.update_duel_duration(200));
}

#[test]
unconstrained fn test_update_visibility() {
    let (env, contract_address, _keeper, creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    env.call_public(creator, dc.update_visibility(false));

    let viewable = env.simulate_utility(dc.get_is_publicly_viewable());
    assert_eq(viewable, false);
}

#[test(should_fail_with = "only creator")]
unconstrained fn test_update_visibility_not_creator_fails() {
    let (env, contract_address, keeper, _creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    env.call_public(keeper, dc.update_visibility(false));
}

#[test]
unconstrained fn test_get_allowed_account_class_id() {
    let (env, contract_address, _keeper, _creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    let class_id = env.simulate_utility(dc.get_allowed_account_class_id());
    assert_eq(class_id, 0);
}

#[test]
unconstrained fn test_get_removal_count_initial() {
    let (env, contract_address, _keeper, _creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    let count = env.simulate_utility(dc.get_removal_count());
    assert_eq(count, 0);
}
