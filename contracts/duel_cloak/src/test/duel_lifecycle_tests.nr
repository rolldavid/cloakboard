use crate::test::utils;
use crate::DuelCloak;

#[test]
unconstrained fn test_submit_statement_hash() {
    let (env, contract_address, keeper, _creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    let stmt_hash: Field = std::hash::pedersen_hash([0xAAAA, 0xBBBB, 0xCCCC, 0xDDDD]);

    env.call_public(keeper, dc.submit_statement_hash(stmt_hash));

    let in_pool = env.simulate_utility(dc.is_statement_in_pool(stmt_hash));
    assert_eq(in_pool, true);

    let stmt_count = env.simulate_utility(dc.get_statement_count());
    assert_eq(stmt_count, 2); // 1 from constructor + 1 new
}

#[test(should_fail_with = "only keeper")]
unconstrained fn test_submit_statement_hash_not_keeper_fails() {
    let (env, contract_address, _keeper, creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    let stmt_hash: Field = std::hash::pedersen_hash([0xAAAA, 0xBBBB, 0xCCCC, 0xDDDD]);

    // Creator is not the keeper
    env.call_public(creator, dc.submit_statement_hash(stmt_hash));
}

#[test(should_fail_with = "statement already in pool")]
unconstrained fn test_submit_duplicate_statement_fails() {
    let (env, contract_address, keeper, _creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    let stmt_hash: Field = std::hash::pedersen_hash([0xAAAA, 0xBBBB, 0xCCCC, 0xDDDD]);

    env.call_public(keeper, dc.submit_statement_hash(stmt_hash));
    // Submit again -- should fail
    env.call_public(keeper, dc.submit_statement_hash(stmt_hash));
}

#[test]
unconstrained fn test_start_duel() {
    let (env, contract_address, keeper, _creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    // Mine enough blocks to end the first duel (duration=100)
    for _ in 0..101 {
        env.mine_block();
    }

    let part1: Field = 0xAAAA;
    let part2: Field = 0xBBBB;
    let part3: Field = 0xCCCC;
    let part4: Field = 0xDDDD;
    let stmt_hash: Field = std::hash::pedersen_hash([part1, part2, part3, part4]);

    // Submit hash first
    env.call_public(keeper, dc.submit_statement_hash(stmt_hash));

    // Then start duel
    env.call_public(keeper, dc.start_duel(stmt_hash, part1, part2, part3, part4));

    let duel_count = env.simulate_utility(dc.get_duel_count());
    assert_eq(duel_count, 2);

    let duel = env.simulate_utility(dc.get_duel(1));
    assert_eq(duel.id, 1);
    assert_eq(duel.statement_part_1, part1);
    assert_eq(duel.total_votes, 0);
    assert_eq(duel.agree_votes, 0);
    assert_eq(duel.disagree_votes, 0);
}

#[test(should_fail_with = "hash mismatch")]
unconstrained fn test_start_duel_hash_mismatch_fails() {
    let (env, contract_address, keeper, _creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    // Mine enough blocks to end the first duel
    for _ in 0..101 {
        env.mine_block();
    }

    let part1: Field = 0xAAAA;
    let part2: Field = 0xBBBB;
    let part3: Field = 0xCCCC;
    let part4: Field = 0xDDDD;
    let stmt_hash: Field = std::hash::pedersen_hash([part1, part2, part3, part4]);

    env.call_public(keeper, dc.submit_statement_hash(stmt_hash));

    // Start with wrong text parts
    env.call_public(keeper, dc.start_duel(stmt_hash, 0x1111, 0x2222, 0x3333, 0x4444));
}

#[test(should_fail_with = "statement not in pool")]
unconstrained fn test_start_duel_not_in_pool_fails() {
    let (env, contract_address, keeper, _creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    // Mine enough blocks to end the first duel
    for _ in 0..101 {
        env.mine_block();
    }

    let part1: Field = 0xAAAA;
    let part2: Field = 0xBBBB;
    let part3: Field = 0xCCCC;
    let part4: Field = 0xDDDD;
    let stmt_hash: Field = std::hash::pedersen_hash([part1, part2, part3, part4]);

    // Don't submit -- go straight to start
    env.call_public(keeper, dc.start_duel(stmt_hash, part1, part2, part3, part4));
}

#[test(should_fail_with = "current duel not ended")]
unconstrained fn test_start_duel_previous_not_ended_fails() {
    let (env, contract_address, keeper, _creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    // Don't mine blocks -- first duel still active

    let part1: Field = 0xAAAA;
    let part2: Field = 0xBBBB;
    let part3: Field = 0xCCCC;
    let part4: Field = 0xDDDD;
    let stmt_hash: Field = std::hash::pedersen_hash([part1, part2, part3, part4]);

    env.call_public(keeper, dc.submit_statement_hash(stmt_hash));
    env.call_public(keeper, dc.start_duel(stmt_hash, part1, part2, part3, part4));
}

#[test]
unconstrained fn test_submit_and_start_duel() {
    let (env, contract_address, keeper, _creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    let part1: Field = 0xAAAA;
    let part2: Field = 0xBBBB;
    let part3: Field = 0xCCCC;
    let part4: Field = 0xDDDD;

    // V7: no need to wait for previous duel to end -- concurrent duels allowed
    env.call_public(keeper, dc.submit_and_start_duel(part1, part2, part3, part4, 200));

    let duel_count = env.simulate_utility(dc.get_duel_count());
    assert_eq(duel_count, 2);

    let duel = env.simulate_utility(dc.get_duel(1));
    assert_eq(duel.id, 1);
    assert_eq(duel.statement_part_1, part1);
    assert_eq(duel.statement_part_2, part2);
    assert_eq(duel.statement_part_3, part3);
    assert_eq(duel.statement_part_4, part4);
    assert_eq(duel.total_votes, 0);
    assert_eq(duel.agree_votes, 0);
    assert_eq(duel.disagree_votes, 0);
}

#[test(should_fail_with = "only keeper")]
unconstrained fn test_submit_and_start_duel_not_keeper_fails() {
    let (env, contract_address, _keeper, creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    env.call_public(creator, dc.submit_and_start_duel(0xAAAA, 0xBBBB, 0xCCCC, 0xDDDD, 200));
}

// V7: concurrent duels allowed -- test that multiple duels can be created
#[test]
unconstrained fn test_submit_and_start_duel_concurrent() {
    let (env, contract_address, keeper, _creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    // First duel still active -- this should succeed in V7
    env.call_public(keeper, dc.submit_and_start_duel(0xAAAA, 0xBBBB, 0xCCCC, 0xDDDD, 200));
    // Create another one concurrently
    env.call_public(keeper, dc.submit_and_start_duel(0x1111, 0x2222, 0x3333, 0x4444, 300));

    let duel_count = env.simulate_utility(dc.get_duel_count());
    assert_eq(duel_count, 3); // 1 from constructor + 2 new
}

#[test(should_fail_with = "duels not started yet")]
unconstrained fn test_start_duel_before_first_block_fails() {
    let (env, contract_address, keeper, _creator) = utils::setup_future_block();
    let dc = DuelCloak::at(contract_address);

    // first_duel_block is 9999, but we are at a much lower block number
    env.call_public(keeper, dc.submit_and_start_duel(0xAAAA, 0xBBBB, 0xCCCC, 0xDDDD, 200));
}

#[test]
unconstrained fn test_start_duel_no_previous_duel() {
    let (env, contract_address, keeper, _creator) = utils::setup_no_duel();
    let dc = DuelCloak::at(contract_address);

    let part1: Field = 0xAAAA;
    let part2: Field = 0xBBBB;
    let part3: Field = 0xCCCC;
    let part4: Field = 0xDDDD;

    // No previous duel, so can start immediately
    env.call_public(keeper, dc.submit_and_start_duel(part1, part2, part3, part4, 200));

    let duel_count = env.simulate_utility(dc.get_duel_count());
    assert_eq(duel_count, 1);

    let duel = env.simulate_utility(dc.get_duel(0));
    assert_eq(duel.id, 0);
    assert_eq(duel.statement_part_1, part1);
}
