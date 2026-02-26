import { useState, useEffect, useRef, useCallback } from 'react';
import { apiUrl } from '@/lib/api';

type NameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

interface CloakNameInputProps {
  value: string;
  onChange: (name: string) => void;
  placeholder?: string;
}

function nameToSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function CloakNameInput({ value, onChange, placeholder = 'e.g., My Cloak' }: CloakNameInputProps) {
  const [status, setStatus] = useState<NameStatus>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const abortRef = useRef<AbortController>();

  const slug = nameToSlug(value);

  const checkAvailability = useCallback(async (name: string) => {
    const s = nameToSlug(name);
    if (!s || s.length === 0) {
      setStatus('idle');
      setStatusMessage('');
      return;
    }

    if (!/[a-z0-9]/.test(s)) {
      setStatus('invalid');
      setStatusMessage('Must contain at least one letter or number');
      return;
    }

    setStatus('checking');
    setStatusMessage('Checking availability...');

    // Cancel previous request
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      const res = await fetch(
        apiUrl(`/api/cloaks/check-name?name=${encodeURIComponent(name)}`),
        { signal: abortRef.current.signal },
      );
      const data = await res.json();

      if (data.available) {
        setStatus('available');
        setStatusMessage('Available');
      } else {
        setStatus('taken');
        setStatusMessage(data.reason || 'This name is taken');
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      // If check-name endpoint doesn't exist yet, assume available
      setStatus('available');
      setStatusMessage('Available (unverified)');
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!value.trim()) {
      setStatus('idle');
      setStatusMessage('');
      return;
    }

    if (value.length > 31) {
      setStatus('invalid');
      setStatusMessage('Name must be 31 characters or less');
      return;
    }

    debounceRef.current = setTimeout(() => checkAvailability(value), 400);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, checkAvailability]);

  const statusColor =
    status === 'available'
      ? 'text-status-success'
      : status === 'taken' || status === 'invalid'
        ? 'text-status-error'
        : 'text-foreground-muted';

  const statusIcon =
    status === 'checking' ? (
      <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
        <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
      </svg>
    ) : status === 'available' ? (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    ) : status === 'taken' || status === 'invalid' ? (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    ) : null;

  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-foreground">
        Cloak Name <span className="text-status-error">*</span>
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={31}
        className="w-full px-3 py-2 text-sm bg-background border border-border rounded-md text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent transition-colors"
      />
      <div className="flex items-center justify-between text-xs">
        <span className="text-foreground-muted">
          {value.length}/31 characters
          {slug && <span className="ml-2">· URL: /{slug}</span>}
        </span>
        {statusMessage && (
          <span className={`flex items-center gap-1 ${statusColor}`}>
            {statusIcon}
            {statusMessage}
          </span>
        )}
      </div>
    </div>
  );
}

export { nameToSlug };
