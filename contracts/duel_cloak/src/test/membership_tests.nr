use crate::test::utils;
use crate::DuelCloak;

#[test]
unconstrained fn test_invite_member() {
    let (env, contract_address, _keeper, creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    let mut env = env;
    let alice = env.create_light_account();

    env.call_public(creator, dc.invite_member(alice));

    let role = env.execute_utility(dc.get_member_role(alice));
    assert_eq(role, 1); // ROLE_MEMBER

    let count = env.execute_utility(dc.get_member_count());
    assert_eq(count, 2); // creator + alice
}

#[test]
unconstrained fn test_invite_council() {
    let (env, contract_address, _keeper, creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    let mut env = env;
    let alice = env.create_light_account();

    env.call_public(creator, dc.invite_council(alice));

    let role = env.execute_utility(dc.get_member_role(alice));
    assert_eq(role, 2); // ROLE_COUNCIL

    let member_count = env.execute_utility(dc.get_member_count());
    assert_eq(member_count, 2);

    let council_count = env.execute_utility(dc.get_council_count());
    assert_eq(council_count, 2);
}

#[test(should_fail_with = "only council or creator")]
unconstrained fn test_invite_member_not_council_fails() {
    let (env, contract_address, _keeper, _creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    let mut env = env;
    let nobody = env.create_light_account();
    let target = env.create_light_account();

    env.call_public(nobody, dc.invite_member(target));
}

#[test(should_fail_with = "only council or creator")]
unconstrained fn test_invite_council_not_council_fails() {
    let (env, contract_address, _keeper, _creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    let mut env = env;
    let nobody = env.create_light_account();
    let target = env.create_light_account();

    env.call_public(nobody, dc.invite_council(target));
}

#[test]
unconstrained fn test_invite_existing_member_noop() {
    let (env, contract_address, _keeper, creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    let mut env = env;
    let alice = env.create_light_account();

    env.call_public(creator, dc.invite_member(alice));
    let count_before = env.execute_utility(dc.get_member_count());

    // Re-invite: should be a no-op (existing role != ROLE_NONE)
    env.call_public(creator, dc.invite_member(alice));
    let count_after = env.execute_utility(dc.get_member_count());

    assert_eq(count_before, count_after);
}

#[test]
unconstrained fn test_promote_member_to_council() {
    let (env, contract_address, _keeper, creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    let mut env = env;
    let alice = env.create_light_account();

    // First invite as member
    env.call_public(creator, dc.invite_member(alice));
    let role_before = env.execute_utility(dc.get_member_role(alice));
    assert_eq(role_before, 1); // ROLE_MEMBER

    // Promote to council
    env.call_public(creator, dc.invite_council(alice));
    let role_after = env.execute_utility(dc.get_member_role(alice));
    assert_eq(role_after, 2); // ROLE_COUNCIL

    // Member count should NOT increase (already a member)
    let member_count = env.execute_utility(dc.get_member_count());
    assert_eq(member_count, 2); // creator + alice

    // Council count should increase
    let council_count = env.execute_utility(dc.get_council_count());
    assert_eq(council_count, 2); // creator + alice
}

#[test]
unconstrained fn test_creator_can_invite() {
    let (env, contract_address, _keeper, creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    let mut env = env;
    let alice = env.create_light_account();

    // Creator (role=3) should be able to invite (>= ROLE_COUNCIL)
    env.call_public(creator, dc.invite_member(alice));

    let role = env.execute_utility(dc.get_member_role(alice));
    assert_eq(role, 1);
}

#[test]
unconstrained fn test_council_can_invite() {
    let (env, contract_address, _keeper, creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    let mut env = env;
    let council_member = env.create_light_account();
    let alice = env.create_light_account();

    // Creator makes council_member a council
    env.call_public(creator, dc.invite_council(council_member));

    // Council member invites alice
    env.call_public(council_member, dc.invite_member(alice));

    let role = env.execute_utility(dc.get_member_role(alice));
    assert_eq(role, 1);
}

#[test(should_fail_with = "only council or creator")]
unconstrained fn test_member_cannot_invite() {
    let (env, contract_address, _keeper, creator) = utils::setup();
    let dc = DuelCloak::at(contract_address);

    let mut env = env;
    let member = env.create_light_account();
    let target = env.create_light_account();

    // Creator makes member a regular member
    env.call_public(creator, dc.invite_member(member));

    // Regular member should NOT be able to invite
    env.call_public(member, dc.invite_member(target));
}
