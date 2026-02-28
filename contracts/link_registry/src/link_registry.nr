/// LinkRegistry Contract -- On-chain encrypted vault for account linking
///
/// Stores AES-256-GCM encrypted primary account keys in public storage,
/// keyed by hash of secondary method's signing key. Only the credential
/// holder can decrypt the vault to recover primary keys.
///
/// Privacy model:
/// - key_hash is SHA-256 of signing key -- not reversible to login method
/// - Vault is AES-256-GCM ciphertext -- reveals nothing without the key
/// - Link target (primary address) is public but not tied to method type

use aztec::macros::aztec;

#[aztec]
pub contract LinkRegistry {
    use aztec::{
        macros::{functions::external, storage::storage},
        protocol::address::AztecAddress,
        state_vars::{Map, PublicMutable},
    };

    #[storage]
    struct Storage<Context> {
        /// Map: hash(secondary_signing_key) -> primary Aztec address
        link_target: Map<Field, PublicMutable<AztecAddress, Context>, Context>,

        /// Map: hash(secondary_signing_key) -> encrypted vault (4 packed Fields)
        vault_0: Map<Field, PublicMutable<Field, Context>, Context>,
        vault_1: Map<Field, PublicMutable<Field, Context>, Context>,
        vault_2: Map<Field, PublicMutable<Field, Context>, Context>,
        vault_3: Map<Field, PublicMutable<Field, Context>, Context>,
    }

    /// Store a link. Caller (primary account) registers a mapping from
    /// key_hash to their address, plus the encrypted vault.
    /// Reverts if key_hash is already linked (to any account).
    #[external("public")]
    fn store_link(
        key_hash: Field,
        v0: Field,
        v1: Field,
        v2: Field,
        v3: Field,
    ) {
        let existing = self.storage.link_target.at(key_hash).read();
        assert(existing == AztecAddress::zero(), "already linked");

        self.storage.link_target.at(key_hash).write(self.msg_sender());
        self.storage.vault_0.at(key_hash).write(v0);
        self.storage.vault_1.at(key_hash).write(v1);
        self.storage.vault_2.at(key_hash).write(v2);
        self.storage.vault_3.at(key_hash).write(v3);
    }

    /// Clear a link. Only the original linker (primary account) can clear it.
    #[external("public")]
    fn clear_link(key_hash: Field) {
        let stored = self.storage.link_target.at(key_hash).read();
        assert(stored == self.msg_sender(), "not owner");

        self.storage.link_target.at(key_hash).write(AztecAddress::zero());
        self.storage.vault_0.at(key_hash).write(0);
        self.storage.vault_1.at(key_hash).write(0);
        self.storage.vault_2.at(key_hash).write(0);
        self.storage.vault_3.at(key_hash).write(0);
    }

    /// Read link target address. Returns zero if not linked.
    #[external("utility")]
    unconstrained fn get_target(key_hash: Field) -> pub AztecAddress {
        self.storage.link_target.at(key_hash).read()
    }

    /// Read encrypted vault fields.
    #[external("utility")]
    unconstrained fn get_vault(key_hash: Field) -> pub (Field, Field, Field, Field) {
        (
            self.storage.vault_0.at(key_hash).read(),
            self.storage.vault_1.at(key_hash).read(),
            self.storage.vault_2.at(key_hash).read(),
            self.storage.vault_3.at(key_hash).read(),
        )
    }
}
