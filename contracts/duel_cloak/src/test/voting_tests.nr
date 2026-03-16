// V10: Legacy cast_vote tests removed.
// Market voting (cast_market_vote) requires cross-contract calls to UserProfile
// which cannot be tested in the single-contract test harness.
// Tally logic is exercised by apply_vote/apply_vote_option/apply_vote_level
// which are public #[only_self] functions enqueued by market vote functions.
