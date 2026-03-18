import { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Category, DuelType } from '@/lib/api/duelClient';
import { createDuel, evaluateStatement, fetchStakingInfo, suggestDuel } from '@/lib/api/duelClient';
import { useAppStore } from '@/store';
import { useNavigate } from 'react-router-dom';
import { DuelCreationModal } from '@/components/DuelCreationModal';
import { usePointsGate } from '@/hooks/usePointsGate';
import { getAztecClient } from '@/lib/aztec/client';

interface CreateDuelWizardProps {
  categories: Category[];
  onCategoriesRefresh: () => void;
}

type Step = 'statement' | 'refine' | 'type' | 'options' | 'timing' | 'stake' | 'review';

const DURATION_PRESETS = [
  { label: '1 hour', seconds: 3600 },
  { label: '24 hours', seconds: 86400 },
  { label: '1 week', seconds: 604800 },
  { label: '1 month', seconds: 2592000 },
];

const STAKE_PRESETS = [10, 50, 100, 500];

function computeMultiplier(amount: number, minStake: number = 10): string {
  return Math.sqrt(Math.max(amount, minStake) / minStake).toFixed(2);
}

function estimateReward(votes: number, stakeAmount: number, avgVotes: number): number {
  const minVotes = parseInt((import.meta as any).env?.VITE_MIN_VOTES_THRESHOLD || '5', 10);
  if (votes < minVotes) return 0;
  const minStake = 10;
  const ratio = votes / Math.max(avgVotes, 1);
  const baseReward = 60 * Math.log(1 + ratio);
  const stakeMultiplier = Math.sqrt(Math.max(stakeAmount, minStake) / minStake);
  return Math.min(500, Math.floor(baseReward * stakeMultiplier));
}

const fadeSlide = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -12 },
  transition: { duration: 0.2, ease: 'easeOut' },
};

export function CreateDuelWizard({ categories }: CreateDuelWizardProps) {
  const { userAddress, userName, whisperPoints } = useAppStore();
  const navigate = useNavigate();
  const { prove } = usePointsGate();

  // Cooldown: 5 minutes after last duel creation (not login).
  const COOLDOWN_MS = 5 * 60 * 1000;
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  useEffect(() => {
    const createdAt = parseInt(sessionStorage.getItem('dc_duel_created_at') || '0', 10);
    if (!createdAt) return;
    const update = () => {
      const remaining = Math.max(0, COOLDOWN_MS - (Date.now() - createdAt));
      setCooldownRemaining(remaining);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  const [step, setStep] = useState<Step>('statement');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [subcategoryId, setSubcategoryId] = useState<number | null>(null);
  const [duelType, setDuelType] = useState<DuelType>('binary');
  const [options, setOptions] = useState<string[]>(['', '', '']);
  const [levelOptions, setLevelOptions] = useState<string[]>(['', '', '']);
  const chartMode = 'top_n' as const;
  const chartTopN = 5;
  const [durationSeconds, setDurationSeconds] = useState(86400);
  const [stakeAmount, setStakeAmount] = useState(10);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showCreationModal, setShowCreationModal] = useState(false);
  const [createPromise, setCreatePromise] = useState<Promise<{ id: number; slug: string }> | null>(null);

  // AI evaluation state
  const [evaluating, setEvaluating] = useState(false);
  const [suggestion, setSuggestion] = useState('');
  const [suggestedCategorySlug, setSuggestedCategorySlug] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [useSuggestion, setUseSuggestion] = useState(false);
  const [overlap, setOverlap] = useState('');

  // AI suggest state
  const [suggesting, setSuggesting] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<{ title: string; duelType: DuelType; categorySlug: string; options?: string[] } | null>(null);
  const [suggestRetryCount, setSuggestRetryCount] = useState(0);
  const [fromAiSuggest, setFromAiSuggest] = useState(false);

  // Points state — eagerly fetch on mount so it's ready before stake step
  const [avgVotes, setAvgVotes] = useState(5);
  const pointsFetchedRef = useRef(false);

  useEffect(() => {
    if (pointsFetchedRef.current) return;
    pointsFetchedRef.current = true;
    (async () => {
      try {
        // Kick off staking info + on-chain points refresh in parallel at wizard open
        const stakingInfoPromise = fetchStakingInfo().then((info) => setAvgVotes(info.avgVotes)).catch(() => {});

        const client = getAztecClient();
        if (client?.hasWallet()) {
          const profileAddress = (import.meta as any).env?.VITE_USER_PROFILE_ADDRESS;
          if (profileAddress) {
            const { UserProfileService } = await import('@/lib/aztec/UserProfileService');
            const { getUserProfileArtifact } = await import('@/lib/aztec/contracts');
            const { AztecAddress } = await import('@aztec/aztec.js/addresses');
            const { syncOptimisticPoints } = await import('@/lib/pointsTracker');
            const wallet = client.getWallet();
            const senderAddress = client.getAddress() ?? undefined;
            const paymentMethod = client.getPaymentMethod();
            const artifact = await getUserProfileArtifact();
            const addr = AztecAddress.fromString(profileAddress);
            const svc = new UserProfileService(wallet, senderAddress, paymentMethod);
            await svc.connect(addr, artifact);
            const pts = await svc.getMyPoints();
            syncOptimisticPoints(pts);
          }
        }

        await stakingInfoPromise;
      } catch (err: any) {
        console.warn('[CreateWizard] On-chain points fetch failed:', err?.message);
      }
    })();
  }, []);

  // Use optimistic points from store — on-chain may be 0 for new users until first vote
  const truePoints = whisperPoints;
  const effectiveStake = stakeAmount;
  const multiplier = computeMultiplier(effectiveStake);
  const canStake = effectiveStake >= 10 && effectiveStake <= truePoints;

  const finalTitle = useSuggestion && suggestion ? suggestion : title.trim();
  const suggestedCategory = categories.find((c) => c.slug === suggestedCategorySlug);

  const steps: Step[] = ['statement', 'refine', 'type', ...(duelType !== 'binary' ? ['options' as Step] : []), 'timing', 'stake', 'review'];
  const currentStepIdx = steps.indexOf(step);

  const canNext = () => {
    switch (step) {
      case 'statement': return title.trim().length >= 5;
      case 'refine': return categoryId !== null && !rejectionReason;
      case 'type': return true;
      case 'options': return duelType === 'level'
        ? levelOptions.filter((o) => o.trim()).length >= 2
        : options.filter((o) => o.trim()).length >= 2;
      case 'timing': return true;
      case 'stake': return canStake;
      case 'review': return true;
      default: return false;
    }
  };

  const handleEvaluate = async () => {
    setEvaluating(true);
    setError('');
    setRejectionReason('');
    setSuggestion('');
    setSuggestedCategorySlug('');
    setUseSuggestion(false);
    setOverlap('');
    try {
      const result = await evaluateStatement(title.trim());
      if (!result.approved) {
        setRejectionReason(result.reason || 'Statement was not approved. Try rephrasing.');
        setSuggestion(result.suggestion || '');
        setSuggestedCategorySlug(result.categorySlug || '');
        setOverlap(result.overlap || '');
        setEvaluating(false);
        return;
      }
      setSuggestion(result.suggestion || '');
      setSuggestedCategorySlug(result.categorySlug || '');
      setOverlap(result.overlap || '');
      // Auto-select suggested category
      const cat = categories.find((c) => c.slug === result.categorySlug);
      if (cat) setCategoryId(cat.id);
      setStep('refine');
    } catch (err: any) {
      setError(err?.message || 'Failed to evaluate statement');
    } finally {
      setEvaluating(false);
    }
  };

  const handleSuggest = async (retry = false) => {
    const theme = title.trim(); // empty is fine — server rotates categories
    const count = retry ? suggestRetryCount + 1 : 0;
    setSuggestRetryCount(count);
    setSuggesting(true);
    setError('');
    setAiSuggestion(null);
    try {
      const result = await suggestDuel(theme, count);
      setAiSuggestion(result);
    } catch (err: any) {
      setError(err?.message || 'Failed to generate suggestion');
    } finally {
      setSuggesting(false);
    }
  };

  const handleAcceptSuggestion = () => {
    if (!aiSuggestion) return;
    // Apply the suggestion
    setTitle(aiSuggestion.title);
    setUseSuggestion(false); // not using the evaluate suggestion, using AI suggestion directly
    setSuggestion(''); // clear evaluate suggestion
    setDuelType(aiSuggestion.duelType);
    // Set category — fall back to first category if AI slug doesn't match
    const cat = categories.find((c) => c.slug === aiSuggestion.categorySlug) || categories[0];
    if (cat) {
      setCategoryId(cat.id);
      // Resolve subcategory if provided
      if (aiSuggestion.subcategorySlug) {
        const sub = cat.subcategories?.find((s) => s.slug === aiSuggestion.subcategorySlug);
        if (sub) setSubcategoryId(sub.id);
        else setSubcategoryId(null);
      } else {
        setSubcategoryId(null);
      }
    }
    // Set options if provided
    if (aiSuggestion.options && aiSuggestion.options.length > 0) {
      if (aiSuggestion.duelType === 'multi') {
        setOptions(aiSuggestion.options);
      } else if (aiSuggestion.duelType === 'level') {
        setLevelOptions(aiSuggestion.options);
      }
    }
    setAiSuggestion(null);
    setRejectionReason('');
    setOverlap('');
    setFromAiSuggest(true);
    // Skip step 2 (refine) and step 3 (type) — AI already set both.
    // For binary, skip options too and go to timing.
    if (aiSuggestion.duelType === 'binary') {
      setStep('timing');
    } else {
      setStep('options');
    }
  };

  const handleRetrySuggestion = () => {
    setAiSuggestion(null);
    handleSuggest(true);
  };

  const handleNext = () => {
    if (step === 'statement') {
      handleEvaluate();
      return;
    }
    const nextIdx = currentStepIdx + 1;
    if (nextIdx < steps.length) setStep(steps[nextIdx]);
  };

  const handleBack = () => {
    if (step === 'refine') {
      setStep('statement');
      return;
    }
    // If we skipped steps via AI suggest, go back to statement
    if (fromAiSuggest && (step === 'options' || step === 'timing')) {
      setFromAiSuggest(false);
      setStep('statement');
      return;
    }
    const prevIdx = currentStepIdx - 1;
    if (prevIdx >= 0) setStep(steps[prevIdx]);
  };

  const handleSubmit = async () => {
    if (!userAddress || !userName || !categoryId || !canStake) return;
    setSubmitting(true);
    setError('');

    const eligible = await prove();
    if (!eligible) {
      setError('Eligibility verification failed. You need at least 10 whisper points to create a duel.');
      setSubmitting(false);
      return;
    }

    const promise = (async () => {
      const { waitForCertification } = await import('@/lib/wallet/backgroundWalletService');
      const pending = waitForCertification();
      if (pending) {
        try { await pending; } catch { /* ok */ }
      }

      const client = getAztecClient();
      if (client?.hasWallet()) {
        const profileAddress = (import.meta as any).env?.VITE_USER_PROFILE_ADDRESS;
        if (profileAddress) {
          const { UserProfileService } = await import('@/lib/aztec/UserProfileService');
          const { getUserProfileArtifact } = await import('@/lib/aztec/contracts');
          const { AztecAddress } = await import('@aztec/aztec.js/addresses');

          const wallet = client.getWallet();
          const senderAddress = client.getAddress() ?? undefined;
          const paymentMethod = client.getPaymentMethod();
          const artifact = await getUserProfileArtifact();
          const addr = AztecAddress.fromString(profileAddress);

          const svc = new UserProfileService(wallet, senderAddress, paymentMethod);
          await svc.connect(addr, artifact);
          await svc.stakePoints(BigInt(0), BigInt(effectiveStake));

          const { addOptimisticPoints } = await import('@/lib/pointsTracker');
          addOptimisticPoints(-effectiveStake);

          import('@/lib/wallet/backgroundWalletService').then(({ refreshPointsOnChain }) =>
            refreshPointsOnChain().catch(() => {}),
          );
        }
      }

      const result = await createDuel(
        { address: userAddress, name: userName },
        {
          title: finalTitle,
          description: description.trim() || undefined,
          duelType,
          timingType: 'duration',
          categoryId,
          subcategoryId: subcategoryId || undefined,
          durationSeconds,
          stakeAmount: effectiveStake,
          options: duelType === 'multi'
            ? options.filter((o) => o.trim())
            : duelType === 'level'
            ? levelOptions.filter((o) => o.trim())
            : undefined,
          chartMode: duelType === 'multi' ? chartMode : undefined,
          chartTopN: duelType === 'multi' ? chartTopN : undefined,
        },
      );
      return { id: result.id, slug: result.slug };
    })();

    setCreatePromise(promise);
    setShowCreationModal(true);
  };

  const handleCreationComplete = useCallback((_duelId: number, duelSlug?: string) => {
    // Set 5-minute cooldown between duel creations
    sessionStorage.setItem('dc_duel_created_at', String(Date.now()));
    setShowCreationModal(false);
    setCreatePromise(null);
    setSubmitting(false);
    navigate(duelSlug ? `/d/${duelSlug}` : '/');
  }, [navigate]);

  const handleCreationError = useCallback((errorMsg: string) => {
    setError(errorMsg);
    setSubmitting(false);
    setTimeout(() => {
      setShowCreationModal(false);
      setCreatePromise(null);
    }, 3000);
  }, []);

  return (
    <div className="max-w-xl mx-auto">
      {/* Progress bar */}
      <div className="flex items-center gap-1 mb-8">
        {steps.map((_, i) => (
          <div
            key={i}
            className={`h-0.5 flex-1 rounded-full transition-all duration-500 ${
              i <= currentStepIdx ? 'bg-accent' : 'bg-surface-hover'
            }`}
          />
        ))}
      </div>



      {error && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400"
        >
          {error}
        </motion.div>
      )}

      <AnimatePresence mode="wait">
        {/* ─── Step 1: Statement ─── */}
        {step === 'statement' && (
          <motion.div key="statement" {...fadeSlide} className="space-y-5">
            <div>
              <h2 className="text-lg font-bold text-foreground">Make a statement</h2>
              <p className="text-sm text-foreground-muted mt-1">
                Write a bold, debatable claim — or describe a theme and let AI suggest one.
              </p>
            </div>

            <div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={title}
                  onChange={(e) => { setTitle(e.target.value); setRejectionReason(''); setAiSuggestion(null); }}
                  placeholder="e.g. Remote work makes teams more productive"
                  maxLength={200}
                  autoFocus
                  className="flex-1 px-4 py-3.5 text-base rounded-xl border border-border bg-background text-foreground placeholder-foreground-muted/50 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-colors"
                />
                <button
                  onClick={handleSuggest}
                  disabled={suggesting}
                  title="AI will generate a duel prompt from your theme"
                  className="shrink-0 px-3 py-2 rounded-xl border border-accent/30 bg-accent/5 text-accent hover:bg-accent/10 transition-colors disabled:opacity-50 flex items-center gap-1.5 text-sm font-medium"
                >
                  {suggesting ? (
                    <span className="w-4 h-4 border-2 border-accent/40 border-t-accent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                    </svg>
                  )}
                  Suggest
                </button>
              </div>
              <div className="flex justify-between mt-1.5">
                <span className="text-[11px] text-foreground-muted">{title.trim().length}/200</span>
                {title.trim().length > 0 && title.trim().length < 5 && (
                  <span className="text-[11px] text-amber-400">Too short</span>
                )}
              </div>
            </div>

            {/* AI Suggestion card */}
            {aiSuggestion && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 bg-accent/5 border border-accent/20 rounded-xl space-y-3"
              >
                <div className="flex items-start gap-2">
                  <svg className="w-4 h-4 text-accent shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{aiSuggestion.title}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-accent/10 text-accent font-medium">
                        {aiSuggestion.duelType === 'binary' ? 'Agree/Disagree' : aiSuggestion.duelType === 'multi' ? 'Multi-option' : 'Level/Scale'}
                      </span>
                      <span className="text-[11px] text-foreground-muted">
                        {categories.find((c) => c.slug === aiSuggestion.categorySlug)?.name || aiSuggestion.categorySlug}
                      </span>
                    </div>
                    {aiSuggestion.options && aiSuggestion.options.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {aiSuggestion.options.map((opt, i) => (
                          <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-surface-hover text-foreground-muted">{opt}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleAcceptSuggestion}
                    className="flex-1 py-2 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors"
                  >
                    Accept
                  </button>
                  <button
                    onClick={handleRetrySuggestion}
                    disabled={suggesting}
                    className="flex-1 py-2 text-sm font-medium rounded-lg border border-border text-foreground-muted hover:text-foreground hover:bg-surface-hover transition-colors disabled:opacity-50"
                  >
                    {suggesting ? 'Generating...' : 'Try another'}
                  </button>
                </div>
              </motion.div>
            )}

            {rejectionReason && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg"
              >
                <p className="text-sm text-red-400">{rejectionReason}</p>
                <p className="text-xs text-foreground-muted mt-1.5">Try rephrasing your statement to be more debatable.</p>
              </motion.div>
            )}

            {!aiSuggestion && (
              <div className="bg-surface-hover/50 rounded-xl p-4 space-y-2.5">
                <p className="text-xs font-medium text-foreground-muted uppercase tracking-wide">Tips for great statements</p>
                <div className="space-y-1.5 text-xs text-foreground-secondary">
                  <p>"Social media does more harm than good for democracy"</p>
                  <p>"Which city has the best quality of life?"</p>
                  <p>"AI-generated art should be eligible for copyright"</p>
                  <p>Or just type a theme like "cats" and click Suggest</p>
                </div>
              </div>
            )}

          </motion.div>
        )}

        {/* ─── Step 2: Refine ─── */}
        {step === 'refine' && (
          <motion.div key="refine" {...fadeSlide} className="space-y-5">
            <h2 className="text-lg font-bold text-foreground">Refine & categorize</h2>

            {/* Suggestion */}
            {suggestion && suggestion !== title.trim() && (
              <div className="space-y-2">
                <p className="text-xs text-foreground-muted uppercase tracking-wide">Suggested reframe</p>
                <button
                  onClick={() => setUseSuggestion(!useSuggestion)}
                  className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                    useSuggestion
                      ? 'border-accent bg-accent/5'
                      : 'border-border hover:border-border-hover'
                  }`}
                >
                  <p className="text-sm font-medium text-foreground leading-snug">{suggestion}</p>
                  <p className="text-[11px] text-foreground-muted mt-1.5">
                    {useSuggestion ? 'Using this version' : 'Tap to use this version'}
                  </p>
                </button>
                {useSuggestion && (
                  <p className="text-[11px] text-foreground-muted">
                    Your original: "{title.trim()}"
                  </p>
                )}
              </div>
            )}

            {/* Overlap warning */}
            {overlap && (
              <div className="p-3 bg-amber-500/8 border border-amber-500/15 rounded-xl">
                <p className="text-xs text-amber-400">A similar duel is already live:</p>
                <p className="text-sm text-foreground mt-1">"{overlap}"</p>
                <p className="text-[11px] text-foreground-muted mt-1">You can still create yours, but consider a different angle.</p>
              </div>
            )}

            {/* Category selection */}
            <div className="space-y-2">
              <p className="text-xs text-foreground-muted uppercase tracking-wide">
                Category
                {suggestedCategory && (
                  <span className="text-accent ml-1 normal-case">(suggested: {suggestedCategory.name})</span>
                )}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => setCategoryId(cat.id)}
                    className={`p-3 text-left rounded-xl border transition-all ${
                      categoryId === cat.id
                        ? 'border-accent bg-accent/5 shadow-sm shadow-accent/10'
                        : cat.slug === suggestedCategorySlug
                          ? 'border-accent/30 hover:border-accent/50'
                          : 'border-border hover:border-border-hover'
                    }`}
                  >
                    <span className="text-sm font-medium text-foreground">{cat.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {/* ─── Step 3: Type ─── */}
        {step === 'type' && (
          <motion.div key="type" {...fadeSlide} className="space-y-5">
            <h2 className="text-lg font-bold text-foreground">Choose how people vote</h2>

            <div className="space-y-3">
              {([
                {
                  key: 'binary' as DuelType,
                  label: 'Agree / Disagree',
                  desc: 'Simple binary vote — the classic debate format',
                  preview: (
                    <div className="flex gap-2 mt-3">
                      <div className="flex-1 py-2 rounded-lg bg-green-500/10 border border-green-500/20 text-center text-xs font-medium text-green-400">Agree</div>
                      <div className="flex-1 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-center text-xs font-medium text-red-400">Disagree</div>
                    </div>
                  ),
                },
                {
                  key: 'multi' as DuelType,
                  label: 'Multiple Choice',
                  desc: 'Up to 50 options — community picks the best answer',
                  preview: (
                    <div className="flex gap-1.5 mt-3">
                      {['Option A', 'Option B', 'Option C'].map((o) => (
                        <div key={o} className="flex-1 py-1.5 rounded-md bg-accent/10 border border-accent/20 text-center text-[10px] font-medium text-accent">{o}</div>
                      ))}
                    </div>
                  ),
                },
                {
                  key: 'level' as DuelType,
                  label: 'Scale Rating',
                  desc: 'Rate on a scale — see the full distribution',
                  preview: (
                    <div className="flex gap-0.5 mt-3 items-end h-8">
                      {[2, 4, 7, 10, 8, 5, 3].map((h, i) => (
                        <div
                          key={i}
                          className="flex-1 rounded-sm bg-accent/30"
                          style={{ height: `${h * 10}%` }}
                        />
                      ))}
                    </div>
                  ),
                },
              ]).map(({ key, label, desc, preview }) => (
                <button
                  key={key}
                  onClick={() => setDuelType(key)}
                  className={`w-full p-4 text-left rounded-xl border-2 transition-all ${
                    duelType === key
                      ? 'border-accent bg-accent/5 shadow-sm shadow-accent/10'
                      : 'border-border hover:border-border-hover'
                  }`}
                >
                  <div className="text-sm font-semibold text-foreground">{label}</div>
                  <div className="text-xs text-foreground-muted mt-0.5">{desc}</div>
                  {preview}
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {/* ─── Step: Options (multi) ─── */}
        {step === 'options' && duelType === 'multi' && (
          <motion.div key="options-multi" {...fadeSlide} className="space-y-4">
            <h2 className="text-lg font-bold text-foreground">Add options</h2>
            <p className="text-sm text-foreground-muted">At least 2 required. Up to 50.</p>
            <div className="space-y-2">
              {options.map((opt, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    type="text"
                    value={opt}
                    onChange={(e) => {
                      const updated = [...options];
                      updated[i] = e.target.value;
                      setOptions(updated);
                    }}
                    placeholder={`Option ${i + 1}`}
                    maxLength={200}
                    className="flex-1 px-3 py-2.5 text-sm rounded-xl border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-accent/50"
                  />
                  {options.length > 2 && (
                    <button
                      onClick={() => setOptions(options.filter((_, j) => j !== i))}
                      className="px-2 text-foreground-muted hover:text-red-400 transition-colors"
                    >
                      x
                    </button>
                  )}
                </div>
              ))}
              {options.length < 20 && (
                <button
                  onClick={() => setOptions([...options, ''])}
                  className="text-sm text-accent hover:text-accent-hover transition-colors"
                >
                  + Add option
                </button>
              )}
            </div>

          </motion.div>
        )}

        {/* ─── Step: Options (level) ─── */}
        {step === 'options' && duelType === 'level' && (
          <motion.div key="options-level" {...fadeSlide} className="space-y-4">
            <h2 className="text-lg font-bold text-foreground">Define the scale</h2>
            <p className="text-sm text-foreground-muted">2 to 10 levels. These are fixed after creation.</p>
            <div className="space-y-2">
              {levelOptions.map((opt, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    type="text"
                    value={opt}
                    onChange={(e) => {
                      const updated = [...levelOptions];
                      updated[i] = e.target.value;
                      setLevelOptions(updated);
                    }}
                    placeholder={`Level ${i + 1}`}
                    maxLength={100}
                    className="flex-1 px-3 py-2.5 text-sm rounded-xl border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-accent/50"
                  />
                  {levelOptions.length > 2 && (
                    <button
                      onClick={() => setLevelOptions(levelOptions.filter((_, j) => j !== i))}
                      className="px-2 text-foreground-muted hover:text-red-400 transition-colors"
                    >
                      x
                    </button>
                  )}
                </div>
              ))}
              {levelOptions.length < 10 && (
                <button
                  onClick={() => setLevelOptions([...levelOptions, ''])}
                  className="text-sm text-accent hover:text-accent-hover transition-colors"
                >
                  + Add level
                </button>
              )}
            </div>
          </motion.div>
        )}

        {/* ─── Step: Timing ─── */}
        {step === 'timing' && (
          <motion.div key="timing" {...fadeSlide} className="space-y-5">
            <h2 className="text-lg font-bold text-foreground">How long should it run?</h2>
            <div className="grid grid-cols-2 gap-2">
              {DURATION_PRESETS.map((preset) => (
                <button
                  key={preset.seconds}
                  onClick={() => setDurationSeconds(preset.seconds)}
                  className={`p-4 rounded-xl border-2 text-center transition-all ${
                    durationSeconds === preset.seconds
                      ? 'border-accent bg-accent/5 shadow-sm shadow-accent/10'
                      : 'border-border hover:border-border-hover'
                  }`}
                >
                  <span className={`text-sm font-semibold ${durationSeconds === preset.seconds ? 'text-accent' : 'text-foreground'}`}>
                    {preset.label}
                  </span>
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {/* ─── Step: Stake ─── */}
        {step === 'stake' && (
          <motion.div key="stake" {...fadeSlide} className="space-y-6">
            <h2 className="text-lg font-bold text-foreground">Wager</h2>

            {/* Balance */}
            <div className="text-center">
              <div className="text-xs text-foreground-muted uppercase tracking-wide">You have</div>
              <div className="text-3xl font-bold text-foreground tabular-nums mt-1">
                {truePoints} <span className="text-base font-medium text-foreground-muted">pts</span>
              </div>
            </div>

            {/* Bet selector */}
            <div className="space-y-2">
              <div className="text-xs text-foreground-muted uppercase tracking-wide">Wager Amount</div>
              <div className="flex gap-2">
                {STAKE_PRESETS.map((preset) => {
                  const affordable = preset <= truePoints;
                  return (
                    <button
                      key={preset}
                      onClick={() => setStakeAmount(preset)}
                      disabled={!affordable}
                      className={`flex-1 py-2.5 text-sm font-semibold rounded-xl transition-all ${
                        stakeAmount === preset
                          ? 'bg-accent text-white shadow-sm shadow-accent/20'
                          : affordable
                            ? 'bg-surface-hover text-foreground-muted hover:text-foreground'
                            : 'bg-surface-hover/50 text-foreground-muted/30 cursor-not-allowed'
                      }`}
                    >
                      {preset}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* What happens */}
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="grid grid-cols-3 divide-x divide-border">
                {[
                  ...(avgVotes >= 10 ? [
                    { label: `${Math.round(avgVotes)} votes`, votes: Math.round(avgVotes) },
                    { label: `${Math.round(avgVotes * 2)} votes`, votes: Math.round(avgVotes * 2) },
                    { label: `${Math.round(avgVotes * 5)} votes`, votes: Math.round(avgVotes * 5) },
                  ] : [
                    { label: '15 votes', votes: 15 },
                    { label: '50 votes', votes: 50 },
                    { label: '200 votes', votes: 200 },
                  ]),
                ].map(({ label, votes }) => {
                  const reward = estimateReward(votes, effectiveStake, avgVotes);
                  return (
                    <div key={label} className="p-3 text-center">
                      <div className="text-lg font-bold text-green-400 tabular-nums">+{reward}</div>
                      <div className="text-[11px] text-foreground-muted mt-0.5">{label}</div>
                    </div>
                  );
                })}
              </div>
              <div className="border-t border-border p-3 text-center bg-red-500/5">
                <div className="text-lg font-bold text-red-400 tabular-nums">-{effectiveStake}</div>
                <div className="text-[11px] text-foreground-muted mt-0.5">&lt;{parseInt((import.meta as any).env?.VITE_MIN_VOTES_THRESHOLD || '5', 10)} votes — you lose your wager</div>
              </div>
            </div>

            <p className="text-[11px] text-foreground-muted/60 text-center">
              {multiplier}x multiplier applied. Higher bets earn more.
            </p>
          </motion.div>
        )}

        {/* ─── Step: Review ─── */}
        {step === 'review' && (
          <motion.div key="review" {...fadeSlide} className="space-y-5">
            <h2 className="text-lg font-bold text-foreground">Ready to launch</h2>
            <div className="bg-surface border border-border rounded-xl p-5 space-y-3">
              <div className="text-xs text-accent font-medium uppercase tracking-wide">
                {categories.find((c) => c.id === categoryId)?.name || 'Category'}
              </div>
              <div className="text-base font-semibold text-foreground">{finalTitle}</div>
              {description && <div className="text-sm text-foreground-secondary">{description}</div>}
              <div className="flex items-center gap-2 text-xs text-foreground-muted pt-1">
                <span className="px-2 py-0.5 rounded-md bg-surface-hover font-medium uppercase">{duelType}</span>
                <span>
                  {DURATION_PRESETS.find((p) => p.seconds === durationSeconds)?.label || `${durationSeconds}s`}
                </span>
                <span>·</span>
                <span>{effectiveStake} pts ({multiplier}x)</span>
              </div>
              {duelType === 'multi' && options.filter((o) => o.trim()).length > 0 && (
                <div className="space-y-1 pt-2 border-t border-border">
                  {options.filter((o) => o.trim()).map((opt, i) => (
                    <div key={i} className="text-sm text-foreground-secondary">{i + 1}. {opt}</div>
                  ))}
                </div>
              )}
              {duelType === 'level' && levelOptions.filter((o) => o.trim()).length > 0 && (
                <div className="space-y-1 pt-2 border-t border-border">
                  {levelOptions.filter((o) => o.trim()).map((opt, i) => (
                    <div key={i} className="text-sm text-foreground-secondary">{i + 1}. {opt}</div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Navigation */}
      <div className="flex justify-between mt-8">
        <button
          onClick={handleBack}
          disabled={currentStepIdx === 0}
          className="px-4 py-2.5 text-sm font-medium text-foreground-muted hover:text-foreground disabled:opacity-0 transition-colors"
        >
          Back
        </button>
        {step === 'review' ? (
          cooldownRemaining > 0 ? (
            <div className="flex items-center gap-2 px-6 py-2.5 text-sm text-foreground-muted">
              <span className="w-3.5 h-3.5 border-2 border-foreground-muted/40 border-t-foreground-muted rounded-full animate-spin shrink-0" />
              Go Live in {Math.ceil(cooldownRemaining / 1000)}s
            </div>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="px-6 py-2.5 text-sm font-semibold bg-accent text-white rounded-xl hover:bg-accent-hover disabled:opacity-50 transition-colors shadow-sm shadow-accent/20"
            >
              {submitting ? 'Creating...' : 'Go Live'}
            </button>
          )
        ) : (step === 'statement' && aiSuggestion) ? (
          null
        ) : (
          <button
            onClick={handleNext}
            disabled={!canNext() || evaluating}
            className="px-6 py-2.5 text-sm font-semibold bg-accent text-white rounded-xl hover:bg-accent-hover disabled:opacity-50 transition-colors shadow-sm shadow-accent/20"
          >
            {evaluating ? (
              <span className="inline-flex items-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Evaluating...
              </span>
            ) : (
              'Continue'
            )}
          </button>
        )}
      </div>

      <DuelCreationModal
        isOpen={showCreationModal}
        createPromise={createPromise}
        onComplete={handleCreationComplete}
        onError={handleCreationError}
      />
    </div>
  );
}
