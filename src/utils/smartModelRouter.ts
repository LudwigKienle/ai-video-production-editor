export type SmartModelIntent = 'quality' | 'speed' | 'cost' | 'balanced';

export type SmartModelCandidate<TId extends string = string> = {
  id: TId;
  label: string;
  provider: string;
  quality: number;
  speed: number;
  costEfficiency: number;
  eta?: SmartModelEta;
  strengths?: string[];
  supportsReferences?: boolean;
  requiresReferences?: boolean;
  recommendedImageSize?: '1K' | '2K' | '4K';
};

export type SmartModelEta = {
  minSeconds: number;
  maxSeconds?: number;
};

export type SmartModelScoreBreakdown = {
  quality: number;
  speed: number;
  cost: number;
  strengthBonus: number;
  referenceBonus: number;
  total: number;
};

export type SmartModelRoute<TId extends string = string> = {
  goal: string;
  intent: SmartModelIntent;
  selected: SmartModelCandidate<TId>;
  reason: string;
  scoreBreakdown: SmartModelScoreBreakdown;
  ranked: Array<{
    candidate: SmartModelCandidate<TId>;
    scoreBreakdown: SmartModelScoreBreakdown;
  }>;
};

type IntentWeights = {
  quality: number;
  speed: number;
  cost: number;
  strength: number;
  reference: number;
};

const INTENT_WEIGHTS: Record<SmartModelIntent, IntentWeights> = {
  quality: { quality: 0.6, speed: 0.12, cost: 0.12, strength: 0.16, reference: 0.04 },
  speed: { quality: 0.16, speed: 0.62, cost: 0.14, strength: 0.08, reference: 0.03 },
  cost: { quality: 0.16, speed: 0.18, cost: 0.52, strength: 0.14, reference: 0.08 },
  balanced: { quality: 0.4, speed: 0.28, cost: 0.22, strength: 0.1, reference: 0.04 },
};

const normalizeText = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ');

const hasAny = (normalizedGoal: string, keywords: string[]) =>
  keywords.some((keyword) => normalizedGoal.includes(keyword));

export const classifySmartModelGoal = (goal: string): SmartModelIntent => {
  const normalized = normalizeText(goal);

  if (
    hasAny(normalized, [
      'billig',
      'guenstig',
      'gunstig',
      'low budget',
      'kosten',
      'spar',
      'cheap',
      'budget',
      'low cost',
    ])
  ) {
    return 'cost';
  }

  if (
    hasAny(normalized, [
      'schnell',
      'vorschau',
      'preview',
      'draft',
      'rough',
      'test',
      'skizze',
      'fast',
      'quick',
    ])
  ) {
    return 'speed';
  }

  if (
    hasAny(normalized, [
      'realistisch',
      'realist',
      'photoreal',
      'produkt',
      'product',
      'commercial',
      'hero',
      'final',
      'high quality',
      'qualitaet',
      'qualitat',
      '4k',
    ])
  ) {
    return 'quality';
  }

  return 'balanced';
};

const inferGoalTags = (goal: string, intent: SmartModelIntent) => {
  const normalized = normalizeText(goal);
  const tags = new Set<string>();

  if (intent === 'quality') {
    ['quality', 'photoreal', 'realism'].forEach((tag) => tags.add(tag));
  }
  if (intent === 'speed') {
    ['preview', 'draft', 'fast'].forEach((tag) => tags.add(tag));
  }
  if (intent === 'cost') {
    ['cheap', 'budget', 'variation'].forEach((tag) => tags.add(tag));
  }

  if (hasAny(normalized, ['produkt', 'product', 'packshot'])) {
    ['product', 'commercial', 'studio'].forEach((tag) => tags.add(tag));
  }
  if (hasAny(normalized, ['variation', 'variante', 'variant', 'iterate', 'iteration'])) {
    ['variation', 'reference', 'iterate'].forEach((tag) => tags.add(tag));
  }
  if (hasAny(normalized, ['style', 'look', 'mood', 'aesthetic'])) {
    ['style', 'look'].forEach((tag) => tags.add(tag));
  }

  return tags;
};

const clampMetric = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(10, value)) / 10;
};

const roundToNearest = (value: number, nearest: number) =>
  Math.max(nearest, Math.round(value / nearest) * nearest);

export const formatSmartModelEta = (eta?: SmartModelEta | null): string | null => {
  if (!eta || !Number.isFinite(eta.minSeconds)) return null;
  const minSeconds = Math.max(1, eta.minSeconds);
  const maxSeconds = Number.isFinite(eta.maxSeconds) && eta.maxSeconds ? Math.max(minSeconds, eta.maxSeconds) : minSeconds;
  const midpoint = (minSeconds + maxSeconds) / 2;

  if (maxSeconds >= 180 && maxSeconds - minSeconds >= 60) {
    const minMinutes = Math.max(1, Math.round(minSeconds / 60));
    const maxMinutes = Math.max(minMinutes, Math.round(maxSeconds / 60));
    return minMinutes === maxMinutes ? `~${minMinutes} min` : `${minMinutes}-${maxMinutes} min`;
  }

  if (midpoint >= 120) {
    return `~${Math.max(2, Math.round(midpoint / 60))} min`;
  }

  return `~${roundToNearest(midpoint, 5)}s`;
};

const scoreCandidate = <TId extends string>(
  candidate: SmartModelCandidate<TId>,
  weights: IntentWeights,
  goalTags: Set<string>,
  hasReferences: boolean,
): SmartModelScoreBreakdown => {
  const strengths = (candidate.strengths || []).map((strength) => normalizeText(strength));
  const matchedStrengths = Array.from(goalTags).filter((tag) =>
    strengths.some((strength) => strength.includes(tag) || tag.includes(strength)),
  );
  const strengthBonus = Math.min(1, matchedStrengths.length / 3) * weights.strength;
  const referenceBonus = hasReferences && candidate.supportsReferences ? weights.reference : 0;

  const quality = clampMetric(candidate.quality) * weights.quality;
  const speed = clampMetric(candidate.speed) * weights.speed;
  const cost = clampMetric(candidate.costEfficiency) * weights.cost;
  const total = quality + speed + cost + strengthBonus + referenceBonus;

  return {
    quality,
    speed,
    cost,
    strengthBonus,
    referenceBonus,
    total,
  };
};

const buildReason = <TId extends string>(
  intent: SmartModelIntent,
  selected: SmartModelCandidate<TId>,
  hasReferences: boolean,
) => {
  const focus =
    intent === 'quality'
      ? 'quality and realism'
      : intent === 'speed'
        ? 'speed and preview turnaround'
        : intent === 'cost'
          ? 'cost control'
          : 'balanced quality, speed, and cost';
  const referenceNote = hasReferences && selected.supportsReferences ? ' It can use the current reference set.' : '';
  return `${selected.label} is the best match for ${focus}.${referenceNote}`;
};

export const routeSmartModel = <TId extends string>(opts: {
  goal: string;
  candidates: SmartModelCandidate<TId>[];
  availableProviders?: string[];
  hasReferences?: boolean;
}): SmartModelRoute<TId> => {
  const { goal, candidates, availableProviders, hasReferences = false } = opts;
  if (!candidates.length) {
    throw new Error('Smart model router needs at least one candidate.');
  }

  const availableSet = availableProviders?.length ? new Set(availableProviders) : null;
  const viable = availableSet
    ? candidates.filter((candidate) => availableSet.has(candidate.provider))
    : candidates;
  const referenceReady = viable.filter((candidate) => !candidate.requiresReferences || hasReferences);
  const pool = referenceReady.length > 0 ? referenceReady : viable.length > 0 ? viable : candidates;
  const intent = classifySmartModelGoal(goal);
  const weights = INTENT_WEIGHTS[intent];
  const goalTags = inferGoalTags(goal, intent);
  const ranked = pool
    .map((candidate, index) => ({
      candidate,
      scoreBreakdown: scoreCandidate(candidate, weights, goalTags, hasReferences),
      index,
    }))
    .sort((left, right) => {
      const scoreDelta = right.scoreBreakdown.total - left.scoreBreakdown.total;
      if (Math.abs(scoreDelta) > 0.000001) return scoreDelta;
      return left.index - right.index;
    });

  const top = ranked[0];
  return {
    goal,
    intent,
    selected: top.candidate,
    reason: buildReason(intent, top.candidate, hasReferences),
    scoreBreakdown: top.scoreBreakdown,
    ranked: ranked.map(({ candidate, scoreBreakdown }) => ({ candidate, scoreBreakdown })),
  };
};
