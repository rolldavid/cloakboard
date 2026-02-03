'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useMoltCloak } from '@/lib/hooks/useMoltCloak';
import { useCloakContext } from '@/components/cloak/shell/CloakContext';

interface Submolt {
  id: number;
  nameHash: string;
  name: string | null;
  creator: string;
}

export default function SubmoltsPage() {
  const params = useParams();
  const cloakId = params.id as string;
  const { templateId } = useCloakContext();

  const { isConnecting, isConnected, isMember } = useMoltCloak(cloakId);

  const [submolts, setSubmolts] = useState<Submolt[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSubmolts = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/v1/molt/${cloakId}/submolts`);
      if (!res.ok) throw new Error('Failed to load submolts');
      const data = await res.json();
      setSubmolts(data.submolts || []);
    } catch (err) {
      console.error('[SubmoltsPage] Load failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to load submolts');
    }
    setIsLoading(false);
  }, [cloakId]);

  useEffect(() => {
    loadSubmolts();
  }, [loadSubmolts]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setIsCreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/molt/${cloakId}/submolts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create submolt');
      }
      setNewName('');
      setShowCreateForm(false);
      await loadSubmolts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create submolt');
    }
    setIsCreating(false);
  };

  if (templateId !== 10) {
    return (
      <div className="p-6 text-center text-foreground-muted">
        Subcloaks are only available for Molt cloaks.
      </div>
    );
  }

  if (isConnecting) {
    return (
      <div className="p-6 space-y-4 animate-shimmer">
        <div className="h-8 bg-background-tertiary rounded-md w-1/4" />
        <div className="h-24 bg-background-tertiary rounded-md" />
        <div className="h-24 bg-background-tertiary rounded-md" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-sm text-foreground-muted">
            {submolts.length} {submolts.length === 1 ? 'community' : 'communities'}
          </p>
        </div>
        {isMember && (
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm rounded-md transition-colors"
          >
            New Subcloak
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-status-error/10 border border-status-error rounded-md text-status-error text-sm">
          {error}
        </div>
      )}

      {/* Create Form */}
      {showCreateForm && (
        <div className="mb-6 bg-card border border-border rounded-md p-4">
          <label className="block text-sm font-medium text-foreground-secondary mb-2">
            Subcloak Name
          </label>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. dev-talk, memes, governance"
            maxLength={31}
            className="w-full bg-background-secondary border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <div className="flex justify-between items-center mt-3">
            <span className="text-xs text-foreground-muted">Max 31 characters</span>
            <div className="flex gap-2">
              <button
                onClick={() => setShowCreateForm(false)}
                className="px-3 py-1.5 text-sm text-foreground-muted hover:text-foreground-secondary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={isCreating || !newName.trim()}
                className="px-4 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm rounded-md transition-colors disabled:opacity-50"
              >
                {isCreating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Submolts List */}
      {isLoading ? (
        <div className="space-y-3 animate-shimmer">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-background-tertiary rounded-md" />
          ))}
        </div>
      ) : submolts.length === 0 ? (
        <div className="text-center py-16 bg-background-secondary rounded-md">
          <svg className="w-12 h-12 mx-auto text-foreground-muted mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <p className="text-foreground-muted">No subcloaks yet.</p>
          {isMember && (
            <p className="text-sm text-foreground-muted mt-1">Create the first sub-community.</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {submolts.map((submolt) => (
            <div
              key={submolt.id}
              className="bg-card border border-border rounded-md p-4 flex items-center justify-between hover:border-border-hover transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="px-2 py-1 bg-accent/10 text-accent rounded text-sm font-medium">
                  sc/{submolt.id}
                </span>
                <div>
                  <p className="text-foreground font-medium text-sm">
                    {submolt.name || `Subcloak #${submolt.id}`}
                  </p>
                  <p className="text-xs text-foreground-muted">
                    Created by {submolt.creator?.slice(0, 10)}...
                  </p>
                </div>
              </div>
              <a
                href={`/cloak/${cloakId}/feed?submolt=${submolt.id}`}
                className="text-sm text-accent hover:text-accent-hover transition-colors"
              >
                View posts
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
