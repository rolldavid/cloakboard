use aztec::{macros::notes::note, protocol::traits::Packable};

/// Private note recording a voter's stake in a market vote.
/// Emitted during cast_market_vote, consumed during claim_reward/claim_refund.
/// Only the voter's PXE can decrypt -- stake amount, direction, and metadata are private.
///
/// Slug removed in V10 -- full slugs are resolved client-side via db_duel_id
/// and the /api/duels/slug-map endpoint (no 31-char truncation).
#[derive(Eq, Packable)]
#[note]
pub struct VoteStakeNote {
    pub duel_id: Field,
    pub direction: Field,     // 0=disagree, 1=agree, or option_index/level for multi/level
    pub stake_amount: Field,  // points consumed at vote time
    pub db_duel_id: Field,    // server DB duel ID (for client-side slug/title resolution)
}
