use crate::test::utils;
use crate::DuelCloak;

/// Helper: setup with 3 council members (creator + 2 council) for governance tests.
unconstrained fn setup_with_3_council() -> (
    aztec::test::helpers::test_environment::TestEnvironment,
    aztec::protocol::address::AztecAddress,
    aztec::protocol::address::AztecAddress,
    aztec::protocol::address::AztecAddress,
    aztec::protocol::address::AztecAddress,
    aztec::protocol::address::AztecAddress,
) {
    let (env, contract_address, keeper, creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    let mut env = env;
    let council_a = env.create_light_account();
    let council_b = env.create_light_account();

    env.call_public(creator, dc.invite_council(council_a));
    env.call_public(creator, dc.invite_council(council_b));

    (env, contract_address, keeper, creator, council_a, council_b)
}

#[test]
unconstrained fn test_propose_removal() {
    let (env, contract_address, _keeper, creator, council_a, council_b) = setup_with_3_council();
    let dc = DuelCloak::at(contract_address);

    // Creator proposes removal of council_a
    env.call_public(creator, dc.propose_removal(council_a));

    let removal_count = env.simulate_utility(dc.get_removal_count());
    assert_eq(removal_count, 1);

    let proposal = env.simulate_utility(dc.get_removal_proposal(0));
    assert_eq(proposal.id, 0);
    assert_eq(proposal.target, council_a);
    assert_eq(proposal.proposer, creator);
    assert_eq(proposal.executed, false);
    assert_eq(proposal.result, 0); // REMOVAL_PENDING

    // Proposer auto-votes remove
    let remove_votes = env.simulate_utility(dc.get_removal_remove_votes(0));
    assert_eq(remove_votes, 1);

    let keep_votes = env.simulate_utility(dc.get_removal_keep_votes(0));
    assert_eq(keep_votes, 0);
}

#[test(should_fail_with = "only council or creator")]
unconstrained fn test_propose_removal_not_council_fails() {
    let (env, contract_address, _keeper, creator, _council_a, council_b) = setup_with_3_council();
    let dc = DuelCloak::at(contract_address);

    let mut env = env;
    let member = env.create_light_account();
    env.call_public(creator, dc.invite_member(member));

    // Regular member cannot propose removal
    env.call_public(member, dc.propose_removal(council_b));
}

#[test(should_fail_with = "need at least 3 council members")]
unconstrained fn test_propose_removal_less_than_3_council_fails() {
    let (env, contract_address, _keeper, creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    let mut env = env;
    let council_a = env.create_light_account();
    env.call_public(creator, dc.invite_council(council_a));

    // Only 2 council members (creator + council_a), need >= 3
    env.call_public(creator, dc.propose_removal(council_a));
}

#[test(should_fail_with = "target must be council (not creator)")]
unconstrained fn test_propose_removal_target_not_council_fails() {
    let (env, contract_address, _keeper, creator, _council_a, _council_b) = setup_with_3_council();
    let dc = DuelCloak::at(contract_address);

    let mut env = env;
    let member = env.create_light_account();
    env.call_public(creator, dc.invite_member(member));

    // Cannot target non-council member
    env.call_public(creator, dc.propose_removal(member));
}

#[test(should_fail_with = "target must be council (not creator)")]
unconstrained fn test_propose_removal_target_creator_fails() {
    let (env, contract_address, _keeper, creator, council_a, _council_b) = setup_with_3_council();
    let dc = DuelCloak::at(contract_address);

    // Cannot target creator (role=3, not role=2)
    env.call_public(council_a, dc.propose_removal(creator));
}

#[test]
unconstrained fn test_vote_on_removal() {
    let (env, contract_address, _keeper, creator, council_a, council_b) = setup_with_3_council();
    let dc = DuelCloak::at(contract_address);

    env.call_public(creator, dc.propose_removal(council_a));

    // council_b votes to keep
    env.call_public(council_b, dc.vote_on_removal(0, true));

    let keep_votes = env.simulate_utility(dc.get_removal_keep_votes(0));
    assert_eq(keep_votes, 1);

    let remove_votes = env.simulate_utility(dc.get_removal_remove_votes(0));
    assert_eq(remove_votes, 1); // proposer auto-voted remove
}

#[test(should_fail_with = "already voted")]
unconstrained fn test_vote_on_removal_already_voted_fails() {
    let (env, contract_address, _keeper, creator, council_a, _council_b) = setup_with_3_council();
    let dc = DuelCloak::at(contract_address);

    env.call_public(creator, dc.propose_removal(council_a));

    // Creator already voted (auto-vote on propose), voting again should fail
    env.call_public(creator, dc.vote_on_removal(0, true));
}

#[test]
unconstrained fn test_execute_removal_removes() {
    let (env, contract_address, _keeper, creator, council_a, council_b) = setup_with_3_council();
    let dc = DuelCloak::at(contract_address);

    env.call_public(creator, dc.propose_removal(council_a));

    // council_b votes to remove
    env.call_public(council_b, dc.vote_on_removal(0, false));

    // Mine blocks past the voting period (duration=100)
    for _ in 0..101 {
        env.mine_block();
    }

    env.call_public(creator, dc.execute_removal(0));

    let proposal = env.simulate_utility(dc.get_removal_proposal(0));
    assert_eq(proposal.executed, true);
    assert_eq(proposal.result, 1); // REMOVAL_REMOVED

    // council_a should be demoted to MEMBER
    let role = env.simulate_utility(dc.get_member_role(council_a));
    assert_eq(role, 1); // ROLE_MEMBER

    let council_count = env.simulate_utility(dc.get_council_count());
    assert_eq(council_count, 2); // creator + council_b
}

#[test]
unconstrained fn test_execute_removal_keeps() {
    let (env, contract_address, _keeper, creator, council_a, council_b) = setup_with_3_council();
    let dc = DuelCloak::at(contract_address);

    env.call_public(creator, dc.propose_removal(council_a));

    // council_b votes to keep
    env.call_public(council_b, dc.vote_on_removal(0, true));

    // Mine blocks past the voting period
    for _ in 0..101 {
        env.mine_block();
    }

    env.call_public(creator, dc.execute_removal(0));

    let proposal = env.simulate_utility(dc.get_removal_proposal(0));
    assert_eq(proposal.executed, true);
    assert_eq(proposal.result, 2); // REMOVAL_KEPT

    // council_a should still be COUNCIL
    let role = env.simulate_utility(dc.get_member_role(council_a));
    assert_eq(role, 2); // ROLE_COUNCIL
}

#[test(should_fail_with = "voting not ended")]
unconstrained fn test_execute_removal_before_end_fails() {
    let (env, contract_address, _keeper, creator, council_a, _council_b) = setup_with_3_council();
    let dc = DuelCloak::at(contract_address);

    env.call_public(creator, dc.propose_removal(council_a));

    // Don't mine blocks -- voting period not over
    env.call_public(creator, dc.execute_removal(0));
}

#[test(should_fail_with = "already executed")]
unconstrained fn test_execute_removal_already_executed_fails() {
    let (env, contract_address, _keeper, creator, council_a, council_b) = setup_with_3_council();
    let dc = DuelCloak::at(contract_address);

    env.call_public(creator, dc.propose_removal(council_a));
    env.call_public(council_b, dc.vote_on_removal(0, true));

    for _ in 0..101 {
        env.mine_block();
    }

    env.call_public(creator, dc.execute_removal(0));
    // Execute again -- should fail
    env.call_public(creator, dc.execute_removal(0));
}
