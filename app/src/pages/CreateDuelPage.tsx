import { useEffect, useState, useCallback } from 'react';
import { fetchCategories, type Category } from '@/lib/api/duelClient';
import { CreateDuelWizard } from '@/components/wizard/CreateDuelWizard';
import { usePointsGate } from '@/hooks/usePointsGate';

export function CreateDuelPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const { canCreate, checking, points, threshold, prove } = usePointsGate();

  const loadCategories = useCallback(async () => {
    try {
      const cats = await fetchCategories();
      setCategories(cats);
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { loadCategories(); }, [loadCategories]);

  // Eagerly trigger certification when the page opens so it completes
  // while the user fills out the form (proof + mining takes ~30-60s)
  useEffect(() => {
    if (canCreate && !checking) {
      prove().catch(() => {});
    }
  }, [canCreate, checking, prove]);

  if (checking) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!canCreate) {
    return (
      <div className="py-4">
        <h1 className="text-xl font-bold text-foreground mb-6">Create a Duel</h1>
        <div className="max-w-md mx-auto bg-surface border border-border rounded-lg p-6 text-center">
          <div className="text-3xl mb-3">&#128274;</div>
          <h2 className="text-base font-semibold text-foreground mb-2">
            {threshold} Whisper Points required
          </h2>
          <p className="text-sm text-foreground-muted mb-4">
            You need at least {threshold} whisper points to create a duel. Vote on existing duels to earn points.
          </p>
          <div className="w-full bg-surface-hover rounded-full h-2 mb-2">
            <div
              className="h-full bg-accent rounded-full transition-all"
              style={{ width: `${Math.min((points / threshold) * 100, 100)}%` }}
            />
          </div>
          <p className="text-xs text-foreground-muted">
            {points} / {threshold} points
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="py-4">
      <h1 className="text-xl font-bold text-foreground mb-6">Create a Duel</h1>
      <CreateDuelWizard categories={categories} onCategoriesRefresh={loadCategories} />
    </div>
  );
}
