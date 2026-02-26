import { useState } from 'react';
import { MAX_STATEMENT_LENGTH } from '@/lib/templates/duelTypes';

interface StatementInputProps {
  onSubmit: (text: string) => void;
  isSubmitting: boolean;
}

export function StatementInput({ onSubmit, isSubmitting }: StatementInputProps) {
  const [text, setText] = useState('');

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > MAX_STATEMENT_LENGTH) return;
    onSubmit(trimmed);
    setText('');
  };

  return (
    <div>
      <label className="block text-sm font-medium text-foreground-secondary mb-1">
        Submit Statement
      </label>
      <div className="flex gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleSubmit())}
          placeholder="e.g., Pineapple belongs on pizza"
          maxLength={MAX_STATEMENT_LENGTH}
          className="flex-1 px-3 py-2 bg-background border border-border rounded-md text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-ring focus:border-ring"
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!text.trim() || text.length > MAX_STATEMENT_LENGTH || isSubmitting}
          className="px-4 py-2 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white rounded-md transition-colors"
        >
          {isSubmitting ? 'Submitting...' : 'Submit'}
        </button>
      </div>
      <p className="text-xs text-foreground-muted mt-1">{text.length}/{MAX_STATEMENT_LENGTH} characters</p>
    </div>
  );
}
