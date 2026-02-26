interface VoteButtonsProps {
  onVote: (support: boolean) => void;
  isVoting: boolean;
  disabled: boolean;
}

export function VoteButtons({ onVote, isVoting, disabled }: VoteButtonsProps) {
  return (
    <div className="flex gap-3">
      <button
        onClick={() => onVote(true)}
        disabled={disabled || isVoting}
        className="flex-1 py-3 px-4 bg-status-success/10 hover:bg-status-success/20 text-status-success border border-status-success/30 rounded-md font-medium transition-colors disabled:opacity-40"
      >
        Agree
      </button>
      <button
        onClick={() => onVote(false)}
        disabled={disabled || isVoting}
        className="flex-1 py-3 px-4 bg-status-error/10 hover:bg-status-error/20 text-status-error border border-status-error/30 rounded-md font-medium transition-colors disabled:opacity-40"
      >
        Disagree
      </button>
    </div>
  );
}
