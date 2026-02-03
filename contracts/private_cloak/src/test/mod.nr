mod cloak_tests {
    use crate::PrivateCloak;
    use aztec::test::{
        helpers::cheatcodes,
        mocks::mock_note::MockNote,
    };
    use aztec::protocol_types::address::AztecAddress;

    // Test environment setup helper
    fn setup_cloak() -> (AztecAddress, PrivateCloak) {
        let admin = cheatcodes::create_account();
        let cloak = PrivateCloak::deploy(
            "Test Cloak",
            admin,
            100,  // voting_duration
            2,    // quorum_threshold
            AztecAddress::zero(),  // upgrade_authority
        );
        (admin, cloak)
    }

    #[test]
    fn test_constructor() {
        let (admin, cloak) = setup_cloak();
        assert(cloak.get_member_count() == 0);
        assert(cloak.get_proposal_count() == 0);
    }

    #[test]
    fn test_add_member() {
        let (admin, cloak) = setup_cloak();
        let member = cheatcodes::create_account();

        cheatcodes::set_msg_sender(admin);
        cloak.add_member(member, 100);

        // Advance block to process private-to-public
        cheatcodes::advance_block_by(1);

        assert(cloak.get_member_count() == 1);
        assert(cloak.balance_of_private(member) == 100);
    }

    #[test(should_fail)]
    fn test_add_member_not_admin() {
        let (admin, cloak) = setup_cloak();
        let non_admin = cheatcodes::create_account();
        let member = cheatcodes::create_account();

        cheatcodes::set_msg_sender(non_admin);
        cloak.add_member(member, 100);  // Should fail
    }

    #[test]
    fn test_create_proposal() {
        let (admin, cloak) = setup_cloak();

        // Add admin as member first
        cheatcodes::set_msg_sender(admin);
        cloak.add_member(admin, 100);
        cheatcodes::advance_block_by(1);

        // Create proposal
        cloak.create_proposal(
            "Test Proposal",
            "Description",
            0,
            admin,
            1000,
        );
        cheatcodes::advance_block_by(1);

        let proposal = cloak.get_proposal(0);
        assert(!proposal.executed);
        assert(proposal.proposal_type == 0);
    }

    #[test]
    fn test_voting_flow() {
        let (admin, cloak) = setup_cloak();
        let member1 = cheatcodes::create_account();
        let member2 = cheatcodes::create_account();

        // Setup members
        cheatcodes::set_msg_sender(admin);
        cloak.add_member(admin, 100);
        cloak.add_member(member1, 100);
        cloak.add_member(member2, 100);
        cheatcodes::advance_block_by(1);

        // Create proposal
        cloak.create_proposal("Test", "Test", 0, admin, 0);
        cheatcodes::advance_block_by(1);

        // Vote
        cheatcodes::set_msg_sender(admin);
        cloak.cast_vote(0, true);
        cheatcodes::advance_block_by(1);

        cheatcodes::set_msg_sender(member1);
        cloak.cast_vote(0, true);
        cheatcodes::advance_block_by(1);

        cheatcodes::set_msg_sender(member2);
        cloak.cast_vote(0, false);
        cheatcodes::advance_block_by(1);

        let tally = cloak.get_vote_tally(0);
        assert(tally.yes_votes == 200);
        assert(tally.no_votes == 100);
        assert(tally.total_votes == 300);
    }

    #[test(should_fail)]
    fn test_double_vote_prevention() {
        let (admin, cloak) = setup_cloak();

        cheatcodes::set_msg_sender(admin);
        cloak.add_member(admin, 100);
        cheatcodes::advance_block_by(1);

        cloak.create_proposal("Test", "Test", 0, admin, 0);
        cheatcodes::advance_block_by(1);

        cloak.cast_vote(0, true);
        cheatcodes::advance_block_by(1);

        cloak.cast_vote(0, false);  // Should fail - already voted
    }
}
