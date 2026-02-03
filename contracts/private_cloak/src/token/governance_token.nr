use dep::aztec::macros::aztec;

#[aztec]
pub contract GovernanceToken {
    use dep::aztec::{
        keys::getters::get_public_keys,
        macros::{functions::{initializer, external, view, only_self}, storage::storage},
        protocol_types::{address::AztecAddress, traits::Hash},
        state_vars::{Map, PublicMutable, PublicImmutable},
    };
    use dep::compressed_string::FieldCompressedString;

    #[storage]
    struct Storage<Context> {
        name: PublicImmutable<FieldCompressedString, Context>,
        symbol: PublicImmutable<FieldCompressedString, Context>,
        total_supply: PublicMutable<u128, Context>,
        balances: Map<AztecAddress, PublicMutable<u128, Context>, Context>,
        minters: Map<AztecAddress, PublicMutable<bool, Context>, Context>,
        admin: PublicMutable<AztecAddress, Context>,
    }

    #[external("public")]
    #[initializer]
    fn constructor(
        name: str<31>,
        symbol: str<31>,
        admin: AztecAddress,
        receivers: [AztecAddress; 10],
        amounts: [u128; 10],
        receiver_count: u8,
    ) {
        self.storage.name.initialize(FieldCompressedString::from_string(name));
        self.storage.symbol.initialize(FieldCompressedString::from_string(symbol));
        self.storage.admin.write(admin);
        self.storage.minters.at(admin).write(true);

        // Aragon-style initial distribution
        let mut total: u128 = 0;
        for i in 0..10 {
            if (i as u8) < receiver_count {
                let receiver = receivers[i];
                let amount = amounts[i];
                if amount > 0 {
                    let existing = self.storage.balances.at(receiver).read();
                    self.storage.balances.at(receiver).write(existing + amount);
                    total += amount;
                }
            }
        }
        self.storage.total_supply.write(total);
    }

    /// Mint new tokens (minter only)
    #[external("public")]
    fn mint(to: AztecAddress, amount: u128) {
        let caller = self.msg_sender().unwrap();
        assert(self.storage.minters.at(caller).read(), "not a minter");
        assert(amount > 0, "amount must be positive");

        let balance = self.storage.balances.at(to).read();
        self.storage.balances.at(to).write(balance + amount);

        let supply = self.storage.total_supply.read();
        self.storage.total_supply.write(supply + amount);
    }

    /// Transfer tokens
    #[external("public")]
    fn transfer(to: AztecAddress, amount: u128) {
        let caller = self.msg_sender().unwrap();
        let sender_balance = self.storage.balances.at(caller).read();
        assert(sender_balance >= amount, "insufficient balance");

        self.storage.balances.at(caller).write(sender_balance - amount);
        let receiver_balance = self.storage.balances.at(to).read();
        self.storage.balances.at(to).write(receiver_balance + amount);
    }

    /// Add minter (admin only)
    #[external("public")]
    fn add_minter(minter: AztecAddress) {
        let caller = self.msg_sender().unwrap();
        assert(caller.eq(self.storage.admin.read()), "not admin");
        self.storage.minters.at(minter).write(true);
    }

    /// Remove minter (admin only)
    #[external("public")]
    fn remove_minter(minter: AztecAddress) {
        let caller = self.msg_sender().unwrap();
        assert(caller.eq(self.storage.admin.read()), "not admin");
        self.storage.minters.at(minter).write(false);
    }

    /// Prove balance >= min_amount for token gating
    /// Uses private function with NSK nullifier to prevent double-use
    #[external("private")]
    fn prove_balance_gte(min_amount: u128, context_id: Field) {
        let sender = self.msg_sender().unwrap();
        let msg_sender_npk_m_hash = get_public_keys(sender).npk_m.hash();
        let secret = self.context.request_nsk_app(msg_sender_npk_m_hash);
        let nullifier = std::hash::pedersen_hash([context_id, secret]);
        self.context.push_nullifier(nullifier);

        self.enqueue_self.verify_balance_internal(sender, min_amount);
    }

    #[external("public")]
    #[only_self]
    fn verify_balance_internal(owner: AztecAddress, min_amount: u128) {
        let balance = self.storage.balances.at(owner).read();
        assert(balance >= min_amount, "insufficient token balance");
    }

    // ===== VIEW FUNCTIONS =====

    #[external("public")]
    #[view]
    fn get_name() -> pub FieldCompressedString {
        self.storage.name.read()
    }

    #[external("public")]
    #[view]
    fn get_symbol() -> pub FieldCompressedString {
        self.storage.symbol.read()
    }

    #[external("public")]
    #[view]
    fn get_total_supply() -> pub u128 {
        self.storage.total_supply.read()
    }

    #[external("public")]
    #[view]
    fn balance_of(owner: AztecAddress) -> pub u128 {
        self.storage.balances.at(owner).read()
    }

    #[external("public")]
    #[view]
    fn is_minter(address: AztecAddress) -> pub bool {
        self.storage.minters.at(address).read()
    }

    #[external("public")]
    #[view]
    fn get_admin() -> pub AztecAddress {
        self.storage.admin.read()
    }
}
