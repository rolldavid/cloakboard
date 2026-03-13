import { Link } from 'react-router-dom';

export function CreateDuelCTA() {
  return (
    <Link
      to="/create"
      className="group block rounded-lg border border-accent/20 bg-gradient-to-br from-accent/5 to-accent/10 p-5 hover:border-accent/40 transition-all"
    >
      <div className="flex flex-col items-center text-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-accent/15 flex items-center justify-center group-hover:bg-accent/25 transition-colors">
          <svg className="w-5 h-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">Got a hot take?</p>
          <p className="text-xs text-foreground-muted mt-1 leading-relaxed">
            Create a duel and put your points where your mouth is.
          </p>
        </div>
        <span className="text-xs font-semibold text-accent group-hover:underline">
          Create a duel &rarr;
        </span>
      </div>
    </Link>
  );
}
