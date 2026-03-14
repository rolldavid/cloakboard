use crate::test::utils;
use crate::LinkRegistry;
use aztec::protocol::address::AztecAddress;

#[test]
unconstrained fn test_store_and_get_link() {
    let (env, contract_address) = utils::setup();
    let lr = LinkRegistry::at(contract_address);

    let mut env = env;
    let primary = env.create_light_account();

    let key_hash: Field = 0xDEADBEEF;
    let v0: Field = 0x1111;
    let v1: Field = 0x2222;
    let v2: Field = 0x3333;
    let v3: Field = 0x4444;

    env.call_public(primary, lr.store_link(key_hash, v0, v1, v2, v3));

    let target = env.execute_utility(lr.get_target(key_hash));
    assert_eq(target, primary);

    let (r0, r1, r2, r3) = env.execute_utility(lr.get_vault(key_hash));
    assert_eq(r0, v0);
    assert_eq(r1, v1);
    assert_eq(r2, v2);
    assert_eq(r3, v3);
}

#[test(should_fail_with = "already linked")]
unconstrained fn test_store_link_already_linked_fails() {
    let (env, contract_address) = utils::setup();
    let lr = LinkRegistry::at(contract_address);

    let mut env = env;
    let primary = env.create_light_account();

    let key_hash: Field = 0xDEADBEEF;
    env.call_public(primary, lr.store_link(key_hash, 1, 2, 3, 4));
    env.call_public(primary, lr.store_link(key_hash, 5, 6, 7, 8)); // fails
}

#[test]
unconstrained fn test_clear_link() {
    let (env, contract_address) = utils::setup();
    let lr = LinkRegistry::at(contract_address);

    let mut env = env;
    let primary = env.create_light_account();

    let key_hash: Field = 0xDEADBEEF;
    env.call_public(primary, lr.store_link(key_hash, 1, 2, 3, 4));
    env.call_public(primary, lr.clear_link(key_hash));

    let target = env.execute_utility(lr.get_target(key_hash));
    assert_eq(target, AztecAddress::zero());

    let (r0, r1, r2, r3) = env.execute_utility(lr.get_vault(key_hash));
    assert_eq(r0, 0);
    assert_eq(r1, 0);
    assert_eq(r2, 0);
    assert_eq(r3, 0);
}

#[test(should_fail_with = "not owner")]
unconstrained fn test_clear_link_not_owner_fails() {
    let (env, contract_address) = utils::setup();
    let lr = LinkRegistry::at(contract_address);

    let mut env = env;
    let primary = env.create_light_account();
    let attacker = env.create_light_account();

    let key_hash: Field = 0xDEADBEEF;
    env.call_public(primary, lr.store_link(key_hash, 1, 2, 3, 4));
    env.call_public(attacker, lr.clear_link(key_hash)); // fails
}

#[test]
unconstrained fn test_get_target_nonexistent() {
    let (env, contract_address) = utils::setup();
    let lr = LinkRegistry::at(contract_address);

    // Unlinked key_hash returns zero address
    let target = env.execute_utility(lr.get_target(0xFACEFACE));
    assert_eq(target, AztecAddress::zero());
}

#[test]
unconstrained fn test_get_vault_nonexistent() {
    let (env, contract_address) = utils::setup();
    let lr = LinkRegistry::at(contract_address);

    let (r0, r1, r2, r3) = env.execute_utility(lr.get_vault(0xFACEFACE));
    assert_eq(r0, 0);
    assert_eq(r1, 0);
    assert_eq(r2, 0);
    assert_eq(r3, 0);
}

#[test]
unconstrained fn test_multiple_links_independent() {
    let (env, contract_address) = utils::setup();
    let lr = LinkRegistry::at(contract_address);

    let mut env = env;
    let alice = env.create_light_account();
    let bob = env.create_light_account();

    let key_hash_a: Field = 0xAAAA;
    let key_hash_b: Field = 0xBBBB;

    env.call_public(alice, lr.store_link(key_hash_a, 1, 2, 3, 4));
    env.call_public(bob, lr.store_link(key_hash_b, 5, 6, 7, 8));

    // Alice's link
    let target_a = env.execute_utility(lr.get_target(key_hash_a));
    assert_eq(target_a, alice);
    let (a0, a1, a2, a3) = env.execute_utility(lr.get_vault(key_hash_a));
    assert_eq(a0, 1);
    assert_eq(a1, 2);
    assert_eq(a2, 3);
    assert_eq(a3, 4);

    // Bob's link
    let target_b = env.execute_utility(lr.get_target(key_hash_b));
    assert_eq(target_b, bob);
    let (b0, b1, b2, b3) = env.execute_utility(lr.get_vault(key_hash_b));
    assert_eq(b0, 5);
    assert_eq(b1, 6);
    assert_eq(b2, 7);
    assert_eq(b3, 8);
}

#[test]
unconstrained fn test_store_link_after_clear() {
    let (env, contract_address) = utils::setup();
    let lr = LinkRegistry::at(contract_address);

    let mut env = env;
    let primary = env.create_light_account();

    let key_hash: Field = 0xBEEF;
    env.call_public(primary, lr.store_link(key_hash, 1, 2, 3, 4));
    env.call_public(primary, lr.clear_link(key_hash));

    // Should be able to re-link now
    env.call_public(primary, lr.store_link(key_hash, 5, 6, 7, 8));

    let target = env.execute_utility(lr.get_target(key_hash));
    assert_eq(target, primary);

    let (r0, r1, r2, r3) = env.execute_utility(lr.get_vault(key_hash));
    assert_eq(r0, 5);
    assert_eq(r1, 6);
    assert_eq(r2, 7);
    assert_eq(r3, 8);
}

#[test]
unconstrained fn test_vault_round_trip() {
    let (env, contract_address) = utils::setup();
    let lr = LinkRegistry::at(contract_address);

    let mut env = env;
    let primary = env.create_light_account();

    // Use specific field values that could represent AES-encrypted data
    let key_hash: Field = 0xCAFE;
    let v0: Field = 0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f;
    let v1: Field = 0x2021222324252627282930313233343536373839404142434445464748495051;
    let v2: Field = 0x52535455565758596061626364656667686970717273747576777879808182;
    let v3: Field = 0x8485868788899091929394;

    env.call_public(primary, lr.store_link(key_hash, v0, v1, v2, v3));

    let (r0, r1, r2, r3) = env.execute_utility(lr.get_vault(key_hash));
    assert_eq(r0, v0);
    assert_eq(r1, v1);
    assert_eq(r2, v2);
    assert_eq(r3, v3);
}

#[test(should_fail_with = "already linked")]
unconstrained fn test_different_user_same_key_hash_fails() {
    let (env, contract_address) = utils::setup();
    let lr = LinkRegistry::at(contract_address);

    let mut env = env;
    let alice = env.create_light_account();
    let bob = env.create_light_account();

    let key_hash: Field = 0xDEAD;

    env.call_public(alice, lr.store_link(key_hash, 1, 2, 3, 4));
    // Different user, same key_hash -- should fail
    env.call_public(bob, lr.store_link(key_hash, 5, 6, 7, 8));
}
