use crate::test::utils;
use crate::MultiAuthAccount;

#[test]
unconstrained fn test_constructor_schnorr() {
    let (env, contract_address, _deployer, primary_key_hash, _label_hash) = utils::setup();
    let ma = MultiAuthAccount::at(contract_address);

    let stored_hash = env.view_public(ma.get_primary_key_hash());
    assert_eq(stored_hash, primary_key_hash);

    let stored_type = env.view_public(ma.get_primary_key_type());
    assert_eq(stored_type, 0); // KEY_TYPE_SCHNORR

    let key_count = env.view_public(ma.get_key_count());
    assert_eq(key_count, 1);
}

#[test]
unconstrained fn test_constructor_ecdsa_k256() {
    let (env, contract_address, _deployer, primary_key_hash, _label_hash) =
        utils::setup_with_key_type(1); // KEY_TYPE_ECDSA_K256
    let ma = MultiAuthAccount::at(contract_address);

    let stored_type = env.view_public(ma.get_primary_key_type());
    assert_eq(stored_type, 1);
}

#[test]
unconstrained fn test_constructor_ecdsa_r1() {
    let (env, contract_address, _deployer, primary_key_hash, _label_hash) =
        utils::setup_with_key_type(2); // KEY_TYPE_ECDSA_R1
    let ma = MultiAuthAccount::at(contract_address);

    let stored_type = env.view_public(ma.get_primary_key_type());
    assert_eq(stored_type, 2);
}

#[test(should_fail_with = "invalid key type")]
unconstrained fn test_constructor_invalid_key_type_fails() {
    let _result = utils::setup_with_key_type(5);
}

#[test]
unconstrained fn test_get_key_count() {
    let (env, contract_address, _deployer, _primary_key_hash, _label_hash) = utils::setup();
    let ma = MultiAuthAccount::at(contract_address);

    let count = env.view_public(ma.get_key_count());
    assert_eq(count, 1);
}

#[test]
unconstrained fn test_is_key_authorized() {
    let (env, contract_address, _deployer, primary_key_hash, _label_hash) = utils::setup();
    let ma = MultiAuthAccount::at(contract_address);

    // Primary key (Schnorr, type=0) should be authorized
    let is_authorized = env.view_public(ma.is_key_authorized(0, primary_key_hash));
    assert_eq(is_authorized, true);

    // A random key should not be authorized
    let is_not_authorized = env.view_public(ma.is_key_authorized(0, 0xBADBAD));
    assert_eq(is_not_authorized, false);
}

#[test]
unconstrained fn test_get_primary_key_hash() {
    let (env, contract_address, _deployer, primary_key_hash, _label_hash) = utils::setup();
    let ma = MultiAuthAccount::at(contract_address);

    let stored = env.view_public(ma.get_primary_key_hash());
    assert_eq(stored, primary_key_hash);
}

#[test]
unconstrained fn test_get_key_label() {
    let (env, contract_address, _deployer, primary_key_hash, label_hash) = utils::setup();
    let ma = MultiAuthAccount::at(contract_address);

    let stored_label = env.view_public(ma.get_key_label(0, primary_key_hash));
    assert_eq(stored_label, label_hash);
}

#[test]
unconstrained fn test_get_key_label_nonexistent() {
    let (env, contract_address, _deployer, _primary_key_hash, _label_hash) = utils::setup();
    let ma = MultiAuthAccount::at(contract_address);

    // Label for a non-existent key should be 0
    let label = env.view_public(ma.get_key_label(0, 0xBADBAD));
    assert_eq(label, 0);
}

#[test]
unconstrained fn test_get_display_name_hash_initial() {
    let (env, contract_address, _deployer, _primary_key_hash, _label_hash) = utils::setup();
    let ma = MultiAuthAccount::at(contract_address);

    // No display name set yet -- should be 0
    let name_hash = env.view_public(ma.get_display_name_hash());
    assert_eq(name_hash, 0);
}

#[test]
unconstrained fn test_is_key_authorized_wrong_type() {
    let (env, contract_address, _deployer, primary_key_hash, _label_hash) = utils::setup();
    let ma = MultiAuthAccount::at(contract_address);

    // Key was registered with type=0 (Schnorr)
    // Querying with type=1 (ECDSA_K256) should return false
    // because key_id = pedersen_hash([key_type, hash])
    let is_authorized = env.view_public(ma.is_key_authorized(1, primary_key_hash));
    assert_eq(is_authorized, false);
}
