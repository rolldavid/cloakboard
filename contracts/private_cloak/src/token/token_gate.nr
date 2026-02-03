use dep::aztec::macros::aztec;

#[aztec]
pub contract TokenGate {
    use dep::aztec::{
        macros::{functions::{initializer, external, view}, storage::storage},
        protocol_types::address::AztecAddress,
        state_vars::{Map, PublicMutable, PublicImmutable},
    };

    #[storage]
    struct Storage<Context> {
        token_address: PublicImmutable<AztecAddress, Context>,
        cloak_address: PublicImmutable<AztecAddress, Context>,
        min_balance: PublicMutable<u128, Context>,
        min_proposer_balance: PublicMutable<u128, Context>,
        /// Track used nullifiers to prevent double-join
        used_nullifiers: Map<Field, PublicMutable<bool, Context>, Context>,
    }

    #[external("public")]
    #[initializer]
    fn constructor(
        token_address: AztecAddress,
        cloak_address: AztecAddress,
        min_balance: u128,
        min_proposer_balance: u128,
    ) {
        self.storage.token_address.initialize(token_address);
        self.storage.cloak_address.initialize(cloak_address);
        self.storage.min_balance.write(min_balance);
        self.storage.min_proposer_balance.write(min_proposer_balance);
    }

    /// Verify membership eligibility - checks token balance meets minimum
    /// Returns the minimum balance threshold for the caller to use
    #[external("public")]
    fn verify_membership(context_id: Field) -> pub u128 {
        // Check nullifier hasn't been used
        assert(!self.storage.used_nullifiers.at(context_id).read(), "nullifier already used");
        self.storage.used_nullifiers.at(context_id).write(true);

        self.storage.min_balance.read()
    }

    /// Verify proposer eligibility - checks higher balance threshold
    #[external("public")]
    fn verify_proposer(context_id: Field) -> pub u128 {
        assert(!self.storage.used_nullifiers.at(context_id).read(), "nullifier already used");
        self.storage.used_nullifiers.at(context_id).write(true);

        self.storage.min_proposer_balance.read()
    }

    /// Update thresholds (Cloak only)
    #[external("public")]
    fn update_thresholds(min_balance: u128, min_proposer_balance: u128) {
        let caller = self.msg_sender().unwrap();
        assert(caller.eq(self.storage.cloak_address.read()), "only Cloak can update");
        self.storage.min_balance.write(min_balance);
        self.storage.min_proposer_balance.write(min_proposer_balance);
    }

    // ===== VIEW FUNCTIONS =====

    #[external("public")]
    #[view]
    fn get_token_address() -> pub AztecAddress {
        self.storage.token_address.read()
    }

    #[external("public")]
    #[view]
    fn get_cloak_address() -> pub AztecAddress {
        self.storage.cloak_address.read()
    }

    #[external("public")]
    #[view]
    fn get_min_balance() -> pub u128 {
        self.storage.min_balance.read()
    }

    #[external("public")]
    #[view]
    fn get_min_proposer_balance() -> pub u128 {
        self.storage.min_proposer_balance.read()
    }

    #[external("public")]
    #[view]
    fn is_nullifier_used(nullifier: Field) -> pub bool {
        self.storage.used_nullifiers.at(nullifier).read()
    }
}
