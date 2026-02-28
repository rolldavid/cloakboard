/**
 * DuelFeed — Main feed component showing active/past duels and statement input.
 */

import { useState, useEffect, useCallback } from 'react';
import { apiUrl } from '@/lib/api';
import { buildAuthHeaders } from '@/lib/api/authToken';
import { ActiveDuelCard } from './ActiveDuelCard';
import { StatementInput } from './StatementInput';
import type { DuelInfo } from '@/lib/templates/duelTypes';
import { useAppStore } from '@/store/index';
import { useDuelService } from '@/hooks/useDuelService';

interface DuelFeedProps {
  cloakAddress: string;
}

export function DuelFeed({ cloakAddress }: DuelFeedProps) {
  const { isAuthenticated, userAddress } = useAppStore();
  const { service: duelService } = useDuelService(cloakAddress);
  const [activeDuel, setActiveDuel] = useState<DuelInfo | null>(null);
  const [pastDuels, setPastDuels] = useState<DuelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const fetchDuels = useCallback(async () => {
    try {
      const response = await fetch(apiUrl(`/api/duels/sync?cloakAddress=${encodeURIComponent(cloakAddress)}`));
      if (!response.ok) throw new Error('Failed to load duels');
      const data = await response.json();

      if (data.duels && Array.isArray(data.duels)) {
        const active = data.duels.find((d: DuelInfo) => !d.isTallied);
        const past = data.duels.filter((d: DuelInfo) => d.isTallied);
        setActiveDuel(active ?? null);
        setPastDuels(past);
      }
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to load duels');
    } finally {
      setLoading(false);
    }
  }, [cloakAddress]);

  useEffect(() => {
    fetchDuels();
    const interval = setInterval(fetchDuels, 30_000);
    return () => clearInterval(interval);
  }, [fetchDuels]);

  const handleSubmitStatement = async (text: string) => {
    setIsSubmitting(true);
    setSubmitSuccess(false);
    try {
      const response = await fetch(apiUrl('/api/submit-statement'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...buildAuthHeaders(userAddress ? { address: userAddress, name: '' } : undefined),
        },
        body: JSON.stringify({ cloakAddress, text }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to submit statement');
      }
      setSubmitSuccess(true);
      setTimeout(() => setSubmitSuccess(false), 3000);
    } catch (err: any) {
      setError(err?.message || 'Submit failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <svg className="w-6 h-6 animate-spin text-foreground-muted" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Statement Submission */}
      {isAuthenticated && (
        <div className="space-y-2">
          <StatementInput onSubmit={handleSubmitStatement} isSubmitting={isSubmitting} />
          {submitSuccess && (
            <p className="text-sm text-status-success">Statement submitted successfully</p>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-status-error/10 border border-status-error/30 rounded-md p-3">
          <p className="text-sm text-status-error">{error}</p>
        </div>
      )}

      {/* Active Duel */}
      {activeDuel ? (
        <ActiveDuelCard
          duel={activeDuel}
          isLoggedIn={isAuthenticated}
          service={duelService}
          onVoted={fetchDuels}
        />
      ) : (
        <div className="bg-card border border-border rounded-md p-8 text-center">
          <p className="text-foreground-muted">No active duel right now</p>
          <p className="text-xs text-foreground-muted mt-1">
            Submit a statement to get things started
          </p>
        </div>
      )}

      {/* Past Duels */}
      {pastDuels.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-foreground-secondary">Past Duels</h3>
          {pastDuels.map((duel) => (
            <div key={duel.id} className="bg-card border border-border rounded-md overflow-hidden">
              <div className="px-6 py-3 bg-background-tertiary border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-foreground-muted" />
                  <span className="text-sm font-medium text-foreground-muted">Ended</span>
                  <span className="text-xs text-foreground-muted">#{duel.id}</span>
                </div>
              </div>
              <div className="px-6 py-4 text-center">
                <p className="text-lg font-bold text-foreground">
                  {duel.statementText?.replace(/\0/g, '').trim() || '(No statement)'}
                </p>
              </div>
              <div className="px-6 pb-4">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-status-success font-medium">Agree: {duel.agreeVotes}</span>
                  <span className="text-status-error font-medium">Disagree: {duel.disagreeVotes}</span>
                </div>
                <div className="h-3 bg-background-tertiary rounded-full overflow-hidden flex">
                  <div
                    className="bg-status-success transition-all duration-500"
                    style={{ width: `${duel.totalVotes > 0 ? (duel.agreeVotes / duel.totalVotes) * 100 : 50}%` }}
                  />
                  <div
                    className="bg-status-error transition-all duration-500"
                    style={{ width: `${duel.totalVotes > 0 ? (duel.disagreeVotes / duel.totalVotes) * 100 : 50}%` }}
                  />
                </div>
                <p className="text-xs text-foreground-muted text-center mt-2">
                  {duel.totalVotes} vote{duel.totalVotes !== 1 ? 's' : ''} total
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
