import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
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
      <div className="py-4 max-w-lg mx-auto">
        <h1 className="text-xl font-bold text-foreground mb-6">Create a Duel</h1>

        {/* Points progress */}
        <div className="bg-surface border border-border rounded-lg p-5 mb-5 text-center">
          <p className="text-sm font-medium text-foreground mb-3">
            You need <span className="text-accent">{threshold} whisper points</span> to create a duel
          </p>
          <div className="w-full bg-surface-hover rounded-full h-2.5 mb-2">
            <div
              className="h-full bg-accent rounded-full transition-all"
              style={{ width: `${Math.min((points / threshold) * 100, 100)}%` }}
            />
          </div>
          <p className="text-xs text-foreground-muted">
            {points} / {threshold} points
          </p>
        </div>

        {/* How it works */}
        <div className="bg-surface border border-border rounded-lg p-5 mb-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">How it works</h2>
          <div className="space-y-4">
            <div className="flex gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-accent/10 text-accent text-xs font-bold flex items-center justify-center">1</span>
              <div>
                <p className="text-sm font-medium text-foreground">Vote on duels</p>
                <p className="text-xs text-foreground-muted">Cast anonymous votes on existing duels to earn whisper points.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-accent/10 text-accent text-xs font-bold flex items-center justify-center">2</span>
              <div>
                <p className="text-sm font-medium text-foreground">Reach {threshold} points</p>
                <p className="text-xs text-foreground-muted">Once you hit the threshold, you can create your own duel and wager points on it.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-accent/10 text-accent text-xs font-bold flex items-center justify-center">3</span>
              <div>
                <p className="text-sm font-medium text-foreground">Earn rewards</p>
                <p className="text-xs text-foreground-muted">If your duel gets votes, you earn points back based on engagement. Low engagement means you lose your wager.</p>
              </div>
            </div>
          </div>
        </div>

        {/* CTA */}
        <Link
          to="/"
          className="block w-full text-center py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors"
        >
          Go vote to earn points
        </Link>
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
