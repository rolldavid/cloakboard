import { useState, useCallback } from 'react';
import type { Category, DuelType, TimingType, Recurrence } from '@/lib/api/duelClient';
import { createDuel } from '@/lib/api/duelClient';
import { useAppStore } from '@/store';
import { useNavigate } from 'react-router-dom';
import { DuelCreationModal } from '@/components/DuelCreationModal';
import { usePointsGate } from '@/hooks/usePointsGate';

interface CreateDuelWizardProps {
  categories: Category[];
  onCategoriesRefresh: () => void;
}

type Step = 'category' | 'type' | 'content' | 'options' | 'timing' | 'review';

const DURATION_PRESETS = [
  { label: '1 hour', seconds: 3600 },
  { label: '1 day', seconds: 86400 },
  { label: '1 week', seconds: 604800 },
  { label: '1 month', seconds: 2592000 },
  { label: '1 year', seconds: 31536000 },
  { label: 'Never ends', seconds: 0 },
];

export function CreateDuelWizard({ categories, onCategoriesRefresh }: CreateDuelWizardProps) {
  const { userAddress, userName } = useAppStore();
  const navigate = useNavigate();
  const { prove } = usePointsGate();

  const [step, setStep] = useState<Step>('category');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [subcategoryId, setSubcategoryId] = useState<number | null>(null);
  const [duelType, setDuelType] = useState<DuelType>('binary');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [levelOptions, setLevelOptions] = useState<string[]>(['', '']);
  const [chartMode, setChartMode] = useState<'top_n' | 'threshold'>('top_n');
  const [chartTopN, setChartTopN] = useState(5);
  const [timingType, setTimingType] = useState<TimingType>('duration');
  const [durationSeconds, setDurationSeconds] = useState(86400);
  const [endsAt, setEndsAt] = useState('');
  const [recurrence, setRecurrence] = useState<Recurrence>('monthly');
  const [showStartTime, setShowStartTime] = useState(false);
  const [startTime, setStartTime] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showCreationModal, setShowCreationModal] = useState(false);
  const [createPromise, setCreatePromise] = useState<Promise<{ id: number; slug: string }> | null>(null);

  const selectedCategory = categories.find((c) => c.id === categoryId);

  const steps: Step[] = ['category', 'type', 'content', ...(duelType !== 'binary' ? ['options' as Step] : []), 'timing', 'review'];
  const currentStepIdx = steps.indexOf(step);

  const canNext = () => {
    switch (step) {
      case 'category': return subcategoryId !== null;
      case 'type': return true;
      case 'content': return title.trim().length > 0;
      case 'options': return duelType === 'level'
        ? levelOptions.filter((o) => o.trim()).length >= 2
        : options.filter((o) => o.trim()).length >= 2;
      case 'timing': return true;
      case 'review': return true;
      default: return false;
    }
  };

  const handleNext = () => {
    const nextIdx = currentStepIdx + 1;
    if (nextIdx < steps.length) setStep(steps[nextIdx]);
  };

  const handleBack = () => {
    const prevIdx = currentStepIdx - 1;
    if (prevIdx >= 0) setStep(steps[prevIdx]);
  };


  const handleSubmit = async () => {
    if (!userAddress || !userName || !subcategoryId) return;
    setSubmitting(true);
    setError('');

    // Verify on-chain eligibility before creating
    const eligible = await prove();
    if (!eligible) {
      setError('Eligibility verification failed. You need at least 10 whisper points to create a duel.');
      setSubmitting(false);
      return;
    }

    const promise = (async () => {
      const result = await createDuel(
        { address: userAddress, name: userName },
        {
          title: title.trim(),
          description: description.trim() || undefined,
          duelType,
          timingType,
          subcategoryId,
          endsAt: timingType === 'end_time' ? endsAt : undefined,
          startsAt: timingType === 'duration' && showStartTime && startTime ? new Date(startTime).toISOString() : undefined,
          durationSeconds: timingType === 'duration' && durationSeconds > 0 ? durationSeconds : undefined,
          recurrence: timingType === 'recurring' ? recurrence : undefined,
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

  const handleCreationComplete = useCallback((duelId: number, duelSlug?: string) => {
    setShowCreationModal(false);
    setCreatePromise(null);
    setSubmitting(false);
    navigate(`/d/${duelSlug || duelId}`);
  }, [navigate]);

  const handleCreationError = useCallback((errorMsg: string) => {
    setError(errorMsg);
    setSubmitting(false);
    // Keep modal open — it shows the error phase
    setTimeout(() => {
      setShowCreationModal(false);
      setCreatePromise(null);
    }, 3000);
  }, []);

  return (
    <div className="max-w-xl mx-auto">
      {/* Progress */}
      <div className="flex items-center gap-1 mb-6">
        {steps.map((s, i) => (
          <div
            key={s}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i <= currentStepIdx ? 'bg-accent' : 'bg-surface-hover'
            }`}
          />
        ))}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-500">
          {error}
        </div>
      )}

      {/* Step: Category */}
      {step === 'category' && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-foreground">Choose a category</h2>

          <div className="grid grid-cols-2 gap-2">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => { setCategoryId(cat.id); setSubcategoryId(null); }}
                className={`p-3 text-left rounded-lg border transition-colors ${
                  categoryId === cat.id
                    ? 'border-accent bg-accent/10'
                    : 'border-border hover:border-border-hover'
                }`}
              >
                <span className="text-sm font-medium text-foreground">{cat.name}</span>
              </button>
            ))}
          </div>

          {selectedCategory && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-foreground-secondary">Subcategory</h3>
              <div className="flex flex-wrap gap-2">
                {selectedCategory.subcategories.map((sub) => (
                  <button
                    key={sub.id}
                    onClick={() => setSubcategoryId(sub.id)}
                    className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                      subcategoryId === sub.id
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-border text-foreground-secondary hover:border-border-hover'
                    }`}
                  >
                    {sub.name}
                  </button>
                ))}
              </div>

            </div>
          )}
        </div>
      )}

      {/* Step: Type */}
      {step === 'type' && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-foreground">Duel type</h2>
          <div className="space-y-2">
            {([
              { key: 'binary' as DuelType, label: 'Binary', desc: 'Agree or Disagree — simple yes/no vote' },
              { key: 'multi' as DuelType, label: 'Multi-Item', desc: 'Up to 50 options — community picks one' },
              { key: 'level' as DuelType, label: 'Level Vote', desc: 'Rate 1-10 — see the distribution' },
            ]).map(({ key, label, desc }) => (
              <button
                key={key}
                onClick={() => setDuelType(key)}
                className={`w-full p-4 text-left rounded-lg border transition-colors ${
                  duelType === key
                    ? 'border-accent bg-accent/10'
                    : 'border-border hover:border-border-hover'
                }`}
              >
                <div className="text-sm font-medium text-foreground">{label}</div>
                <div className="text-xs text-foreground-muted mt-0.5">{desc}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step: Content */}
      {step === 'content' && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-foreground">What's the question?</h2>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Enter your duel question..."
            maxLength={200}
            className="w-full px-4 py-3 text-base rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add context or description (optional)"
            rows={3}
            maxLength={2000}
            className="w-full px-4 py-3 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-accent resize-none"
          />
        </div>
      )}

      {/* Step: Options (multi + level) */}
      {step === 'options' && duelType === 'multi' && (
        <div className="space-y-4">
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
                  className="flex-1 px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                />
                {options.length > 2 && (
                  <button
                    onClick={() => setOptions(options.filter((_, j) => j !== i))}
                    className="px-2 text-foreground-muted hover:text-red-500"
                  >
                    x
                  </button>
                )}
              </div>
            ))}
            {options.length < 50 && (
              <button
                onClick={() => setOptions([...options, ''])}
                className="text-sm text-accent hover:text-accent-hover"
              >
                + Add option
              </button>
            )}
          </div>

          {/* Chart display criteria */}
          <div className="pt-4 border-t border-border space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Chart display</h3>
            <p className="text-xs text-foreground-muted">How should options appear on the trend chart?</p>
            <div className="space-y-2">
              <button
                onClick={() => setChartMode('top_n')}
                className={`w-full p-3 text-left rounded-lg border transition-colors ${
                  chartMode === 'top_n' ? 'border-accent bg-accent/10' : 'border-border hover:border-border-hover'
                }`}
              >
                <div className="text-sm font-medium text-foreground">Top N options</div>
                <div className="text-xs text-foreground-muted mt-0.5">Show the top options by vote count</div>
                {chartMode === 'top_n' && (
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs text-foreground-secondary">Show top</span>
                    <select
                      value={chartTopN}
                      onChange={(e) => setChartTopN(parseInt(e.target.value, 10))}
                      className="px-2 py-1 text-sm rounded border border-border bg-background text-foreground"
                    >
                      {[3, 5, 7, 10].map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                    <span className="text-xs text-foreground-secondary">options</span>
                  </div>
                )}
              </button>
              <button
                onClick={() => setChartMode('threshold')}
                className={`w-full p-3 text-left rounded-lg border transition-colors ${
                  chartMode === 'threshold' ? 'border-accent bg-accent/10' : 'border-border hover:border-border-hover'
                }`}
              >
                <div className="text-sm font-medium text-foreground">Threshold</div>
                <div className="text-xs text-foreground-muted mt-0.5">Show all options with &gt;1% of votes (max 10)</div>
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 'options' && duelType === 'level' && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-foreground">Add levels</h2>
          <p className="text-sm text-foreground-muted">2 to 10 fixed options. These cannot be changed after creation.</p>
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
                  className="flex-1 px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                />
                {levelOptions.length > 2 && (
                  <button
                    onClick={() => setLevelOptions(levelOptions.filter((_, j) => j !== i))}
                    className="px-2 text-foreground-muted hover:text-red-500"
                  >
                    x
                  </button>
                )}
              </div>
            ))}
            {levelOptions.length < 10 && (
              <button
                onClick={() => setLevelOptions([...levelOptions, ''])}
                className="text-sm text-accent hover:text-accent-hover"
              >
                + Add level
              </button>
            )}
          </div>
        </div>
      )}

      {/* Step: Timing */}
      {step === 'timing' && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-foreground">Timing</h2>
          <div className="flex gap-2">
            {([
              { key: 'duration' as TimingType, label: 'Duration' },
              { key: 'end_time' as TimingType, label: 'End Time' },
              { key: 'recurring' as TimingType, label: 'Recurring' },
            ]).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTimingType(key)}
                className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                  timingType === key
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border text-foreground-secondary hover:border-border-hover'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {timingType === 'duration' && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {DURATION_PRESETS.map((preset) => (
                  <button
                    key={preset.seconds}
                    onClick={() => setDurationSeconds(preset.seconds)}
                    className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                      durationSeconds === preset.seconds
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-border text-foreground-secondary hover:border-border-hover'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => {
                  setShowStartTime((v) => {
                    if (v) setStartTime('');
                    return !v;
                  });
                }}
                className="flex items-center gap-2.5 text-sm text-foreground-secondary cursor-pointer group"
              >
                <span
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                    showStartTime ? 'bg-accent' : 'bg-border'
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
                      showStartTime ? 'translate-x-[18px]' : 'translate-x-[3px]'
                    }`}
                  />
                </span>
                <span className="group-hover:text-foreground transition-colors">Schedule start time</span>
              </button>

              {showStartTime && (
                <input
                  type="datetime-local"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  min={new Date().toISOString().slice(0, 16)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                />
              )}
            </div>
          )}

          {timingType === 'end_time' && (
            <input
              type="datetime-local"
              value={endsAt ? endsAt.slice(0, 16) : ''}
              onChange={(e) => setEndsAt(e.target.value ? new Date(e.target.value).toISOString() : '')}
              min={new Date().toISOString().slice(0, 16)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
            />
          )}

          {timingType === 'recurring' && (
            <div className="space-y-2">
              {([
                { key: 'daily' as Recurrence, label: 'Daily', desc: 'Resets at midnight UTC' },
                { key: 'monthly' as Recurrence, label: 'Monthly', desc: 'Resets on the 1st of each month' },
                { key: 'yearly' as Recurrence, label: 'Yearly', desc: 'Resets on January 1' },
              ]).map(({ key, label, desc }) => (
                <button
                  key={key}
                  onClick={() => setRecurrence(key)}
                  className={`w-full p-3 text-left rounded-lg border transition-colors ${
                    recurrence === key
                      ? 'border-accent bg-accent/10'
                      : 'border-border hover:border-border-hover'
                  }`}
                >
                  <div className="text-sm font-medium text-foreground">{label}</div>
                  <div className="text-xs text-foreground-muted mt-0.5">{desc}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Step: Review */}
      {step === 'review' && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-foreground">Review</h2>
          <div className="bg-surface border border-border rounded-lg p-4 space-y-2">
            <div className="text-xs text-accent font-medium">
              {selectedCategory?.name} / {selectedCategory?.subcategories.find((s) => s.id === subcategoryId)?.name || 'New'}
            </div>
            <div className="text-base font-semibold text-foreground">{title}</div>
            {description && <div className="text-sm text-foreground-secondary">{description}</div>}
            <div className="flex gap-2 text-xs text-foreground-muted">
              <span className="uppercase font-medium">{duelType}</span>
              <span>·</span>
              <span>
                {timingType === 'duration' && (durationSeconds === 0 ? 'Never ends' : `${DURATION_PRESETS.find((p) => p.seconds === durationSeconds)?.label || durationSeconds + 's'}`)}
                {timingType === 'duration' && showStartTime && startTime && ` · Starts ${new Date(startTime).toLocaleString()}`}
                {timingType === 'end_time' && endsAt && `Ends ${new Date(endsAt).toLocaleString()}`}
                {timingType === 'recurring' && recurrence === 'daily' && 'Daily (resets at midnight UTC)'}
                {timingType === 'recurring' && recurrence === 'monthly' && 'Monthly (resets on the 1st)'}
                {timingType === 'recurring' && recurrence === 'yearly' && 'Yearly (resets Jan 1)'}
              </span>
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
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between mt-6">
        <button
          onClick={handleBack}
          disabled={currentStepIdx === 0}
          className="px-4 py-2 text-sm font-medium text-foreground-muted hover:text-foreground disabled:opacity-30"
        >
          Back
        </button>
        {step === 'review' ? (
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-6 py-2 text-sm font-medium bg-accent text-white rounded-lg hover:bg-accent-hover disabled:opacity-50"
          >
            {submitting ? 'Creating...' : 'Create Duel'}
          </button>
        ) : (
          <button
            onClick={handleNext}
            disabled={!canNext()}
            className="px-6 py-2 text-sm font-medium bg-accent text-white rounded-lg hover:bg-accent-hover disabled:opacity-50"
          >
            Next
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
