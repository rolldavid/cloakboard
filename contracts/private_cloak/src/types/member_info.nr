use aztec::protocol_types::traits::{Deserialize, Serialize, Packable};

/// Member information stored for each Cloak member
#[derive(Deserialize, Serialize, Eq, Packable)]
pub struct MemberInfo {
    /// Voting power for this member
    pub voting_power: u128,
    /// Block number when member joined
    pub joined_at: u32,
    /// Role: 0=member, 1=moderator, 2=admin
    pub role: u8,
    /// Nullifier from domain proof (prevents same account joining twice)
    pub domain_proof_nullifier: Field,
}

impl MemberInfo {
    pub fn new() -> Self {
        Self {
            voting_power: 0,
            joined_at: 0,
            role: 0,
            domain_proof_nullifier: 0,
        }
    }

    pub fn is_member(self) -> bool {
        self.voting_power > 0
    }

    pub fn is_admin(self) -> bool {
        self.role >= 2
    }

    pub fn is_moderator(self) -> bool {
        self.role >= 1
    }
}

/// Pending member awaiting approval
#[derive(Deserialize, Serialize, Eq, Packable)]
pub struct PendingMember {
    /// Hash of the domain proof
    pub domain_proof_hash: Field,
    /// Username hash chosen by the member
    pub username_hash: Field,
    /// Block number when join was requested
    pub requested_at: u32,
    /// Status: 0=pending, 1=approved, 2=rejected
    pub status: u8,
}

impl PendingMember {
    pub fn new() -> Self {
        Self {
            domain_proof_hash: 0,
            username_hash: 0,
            requested_at: 0,
            status: 0,
        }
    }

    pub fn is_pending(self) -> bool {
        self.status == 0
    }

    pub fn is_approved(self) -> bool {
        self.status == 1
    }

    pub fn is_rejected(self) -> bool {
        self.status == 2
    }
}
