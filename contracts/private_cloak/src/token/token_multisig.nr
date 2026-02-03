use dep::aztec::macros::aztec;

#[aztec]
pub contract TokenMultisig {
    use dep::aztec::{
        macros::{functions::{initializer, external, view}, storage::storage},
        protocol_types::{address::AztecAddress, traits::Hash},
        state_vars::{Map, PublicMutable, PublicImmutable},
    };

    /// Pending transfer proposal
    #[derive(Serialize, Deserialize, Eq)]
    struct PendingTransfer {
        to: AztecAddress,
        amount: u128,
        executed: bool,
    }

    impl PendingTransfer {
        fn new() -> Self {
            Self {
                to: AztecAddress::zero(),
                amount: 0,
                executed: false,
            }
        }
    }

    #[storage]
    struct Storage<Context> {
        token_address: PublicImmutable<AztecAddress, Context>,
        signers: [PublicMutable<AztecAddress, Context>; 5],
        signer_count: PublicImmutable<u8, Context>,
        threshold: PublicImmutable<u8, Context>,
        nonce: PublicMutable<u64, Context>,
        pending_transfers: Map<u64, PublicMutable<PendingTransfer, Context>, Context>,
        approvals: Map<u64, Map<AztecAddress, PublicMutable<bool, Context>, Context>, Context>,
        approval_counts: Map<u64, PublicMutable<u8, Context>, Context>,
    }

    #[external("public")]
    #[initializer]
    fn constructor(
        token_address: AztecAddress,
        signers: [AztecAddress; 5],
        signer_count: u8,
        threshold: u8,
    ) {
        assert(signer_count >= 1, "need at least 1 signer");
        assert(signer_count <= 5, "max 5 signers");
        assert(threshold >= 1, "threshold must be >= 1");
        assert(threshold <= signer_count, "threshold must be <= signer count");

        self.storage.token_address.initialize(token_address);
        self.storage.signer_count.initialize(signer_count);
        self.storage.threshold.initialize(threshold);
        self.storage.nonce.write(0);

        // Store signers
        for i in 0..5 {
            if (i as u8) < signer_count {
                self.storage.signers[i].write(signers[i]);
            } else {
                self.storage.signers[i].write(AztecAddress::zero());
            }
        }
    }

    /// Propose a transfer (signer only)
    #[external("public")]
    fn propose_transfer(to: AztecAddress, amount: u128) -> pub u64 {
        let caller = self.msg_sender().unwrap();
        assert(self.is_signer_internal(caller), "not a signer");

        let current_nonce = self.storage.nonce.read();
        self.storage.pending_transfers.at(current_nonce as Field).write(PendingTransfer {
            to,
            amount,
            executed: false,
        });

        // Auto-approve by proposer
        self.storage.approvals.at(current_nonce as Field).at(caller).write(true);
        self.storage.approval_counts.at(current_nonce as Field).write(1);

        self.storage.nonce.write(current_nonce + 1);
        current_nonce
    }

    /// Approve a pending transfer (signer only)
    #[external("public")]
    fn approve_transfer(proposal_nonce: u64) {
        let caller = self.msg_sender().unwrap();
        assert(self.is_signer_internal(caller), "not a signer");

        let transfer = self.storage.pending_transfers.at(proposal_nonce as Field).read();
        assert(!transfer.executed, "already executed");

        // Check not already approved by this signer
        let already_approved = self.storage.approvals.at(proposal_nonce as Field).at(caller).read();
        assert(!already_approved, "already approved");

        self.storage.approvals.at(proposal_nonce as Field).at(caller).write(true);
        let count = self.storage.approval_counts.at(proposal_nonce as Field).read();
        self.storage.approval_counts.at(proposal_nonce as Field).write(count + 1);
    }

    /// Execute a transfer once enough approvals (anyone can call)
    #[external("public")]
    fn execute_transfer(proposal_nonce: u64) {
        let mut transfer = self.storage.pending_transfers.at(proposal_nonce as Field).read();
        assert(!transfer.executed, "already executed");

        let count = self.storage.approval_counts.at(proposal_nonce as Field).read();
        let threshold = self.storage.threshold.read();
        assert(count >= threshold, "not enough approvals");

        transfer.executed = true;
        self.storage.pending_transfers.at(proposal_nonce as Field).write(transfer);

        // NOTE: In production, this would call token.transfer(to, amount)
        // Cross-contract calls to the governance token would happen here
        // For now, the transfer execution is recorded and the token transfer
        // would be handled by the frontend or a separate execution step
    }

    // ===== INTERNAL HELPERS =====

    fn is_signer_internal(self, addr: AztecAddress) -> bool {
        let count = self.storage.signer_count.read();
        let mut found = false;
        for i in 0..5 {
            if (i as u8) < count {
                if self.storage.signers[i].read().eq(addr) {
                    found = true;
                }
            }
        }
        found
    }

    // ===== VIEW FUNCTIONS =====

    #[external("public")]
    #[view]
    fn get_proposal(proposal_nonce: u64) -> pub PendingTransfer {
        self.storage.pending_transfers.at(proposal_nonce as Field).read()
    }

    #[external("public")]
    #[view]
    fn get_approval_count(proposal_nonce: u64) -> pub u8 {
        self.storage.approval_counts.at(proposal_nonce as Field).read()
    }

    #[external("public")]
    #[view]
    fn is_signer(addr: AztecAddress) -> pub bool {
        self.is_signer_internal(addr)
    }

    #[external("public")]
    #[view]
    fn get_token_address() -> pub AztecAddress {
        self.storage.token_address.read()
    }

    #[external("public")]
    #[view]
    fn get_signer_count() -> pub u8 {
        self.storage.signer_count.read()
    }

    #[external("public")]
    #[view]
    fn get_threshold() -> pub u8 {
        self.storage.threshold.read()
    }

    #[external("public")]
    #[view]
    fn get_nonce() -> pub u64 {
        self.storage.nonce.read()
    }
}
