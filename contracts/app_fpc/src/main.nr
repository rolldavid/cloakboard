/// App-Gated FPC -- Sponsored fee payment restricted to approved users.
///
/// Unlike the public SponsoredFPC (anyone can drain), this contract
/// only sponsors transactions from addresses the admin has approved.
/// The admin (keeper) approves users when they authenticate.
///
/// Privacy: The approved set is public storage (account addresses are
/// already visible from deployment). Vote directions remain private.

use aztec::macros::aztec;

#[aztec]
pub contract AppFPC {
    use aztec::{
        macros::{functions::{initializer, external, only_self}, storage::storage},
        protocol::address::AztecAddress,
        state_vars::{Map, PublicMutable, PublicImmutable},
    };

    #[storage]
    struct Storage<Context> {
        admin: PublicImmutable<AztecAddress, Context>,
        approved: Map<AztecAddress, PublicMutable<bool, Context>, Context>,
    }

    #[external("public")]
    #[initializer]
    fn constructor(admin: AztecAddress) {
        self.storage.admin.initialize(admin);
    }

    /// Admin-only: approve a user address for sponsored transactions.
    #[external("public")]
    fn approve(user: AztecAddress) {
        assert(self.msg_sender() == self.storage.admin.read(), "only admin");
        self.storage.approved.at(user).write(true);
    }

    /// Admin-only: revoke approval for a user address.
    #[external("public")]
    fn revoke(user: AztecAddress) {
        assert(self.msg_sender() == self.storage.admin.read(), "only admin");
        self.storage.approved.at(user).write(false);
    }

    /// Sponsor a transaction unconditionally.
    /// Uses the same name as SponsoredFPC so SponsoredFeePaymentMethod works.
    #[external("private")]
    fn sponsor_unconditionally() {
        // No-op: the protocol handles fee payment by debiting the fee payer's
        // public fee juice balance. This function exists only as the entrypoint
        // that the FeePaymentMethod calls to designate this contract as fee payer.
    }

    /// View: check if a user is approved.
    #[external("utility")]
    unconstrained fn is_approved(user: AztecAddress) -> bool {
        self.storage.approved.at(user).read()
    }

    /// View: read the admin address.
    #[external("utility")]
    unconstrained fn get_admin() -> AztecAddress {
        self.storage.admin.read()
    }
}
