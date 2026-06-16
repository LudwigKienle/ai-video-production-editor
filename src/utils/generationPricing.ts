import { CostRate, UsageKind, UsageProvider, UsageUnit } from '../types';

export const BILLING_MARGIN_MULTIPLIER = 1.02;

const roundUsd = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100000) / 100000;
};

export const normalizeModelForRateLookup = (model?: string | null): string => {
  if (!model) return '';
  if (model.startsWith('prunaai/z-image:')) return 'prunaai/z-image';
  if (model.startsWith('prunaai/firered-image-edit:')) return 'prunaai/firered-image-edit';
  return model;
};

const matchesModel = (left?: string | null, right?: string | null): boolean => {
  if (!left || !right) return false;
  if (left === right) return true;
  return normalizeModelForRateLookup(left) === normalizeModelForRateLookup(right);
};

export const resolveCostRate = (opts: {
  rates: CostRate[];
  provider: UsageProvider;
  kind: UsageKind;
  model?: string | null;
}): CostRate | null => {
  const { rates, provider, kind, model } = opts;
  if (!rates.length) return null;

  const scoped = rates.filter((rate) => rate.provider === provider && rate.kind === kind);
  if (!scoped.length) return null;

  if (model) {
    const exact = scoped.find((rate) => rate.model === model);
    if (exact) return exact;

    const normalized = scoped.find((rate) => matchesModel(rate.model, model));
    if (normalized) return normalized;
  }

  const fallback = scoped.find((rate) => !rate.model);
  return fallback || scoped[0] || null;
};

export type GenerationCostEstimate = {
  rate: CostRate;
  units: number;
  unitLabel: UsageUnit;
  hostedUsd: number;
  providerUsd: number;
  credits: number;
};

export const estimateGenerationCost = (opts: {
  rates: CostRate[];
  provider: UsageProvider;
  kind: UsageKind;
  model?: string | null;
  units?: number;
  marginMultiplier?: number;
}): GenerationCostEstimate | null => {
  const {
    rates,
    provider,
    kind,
    model,
    units = 1,
    marginMultiplier = BILLING_MARGIN_MULTIPLIER,
  } = opts;

  const resolvedRate = resolveCostRate({ rates, provider, kind, model });
  if (!resolvedRate) return null;

  const safeUnits = Number.isFinite(units) && units > 0 ? units : 1;
  const hostedUsd = roundUsd(resolvedRate.unitCost * safeUnits);
  const providerUnitUsd = marginMultiplier > 0 ? resolvedRate.unitCost / marginMultiplier : resolvedRate.unitCost;
  const providerUsd = roundUsd(providerUnitUsd * safeUnits);
  const credits = hostedUsd > 0 ? Math.max(1, Math.ceil(hostedUsd * 100)) : 0;

  return {
    rate: resolvedRate,
    units: safeUnits,
    unitLabel: resolvedRate.unitLabel,
    hostedUsd,
    providerUsd,
    credits,
  };
};

export const formatUsd = (amount: number): string => {
  const safe = Number.isFinite(amount) ? amount : 0;
  const abs = Math.abs(safe);
  if (abs >= 1) return `$${safe.toFixed(2)}`;
  if (abs >= 0.1) return `$${safe.toFixed(3)}`;
  return `$${safe.toFixed(4)}`;
};

export const formatUnitSummary = (units: number, unitLabel: UsageUnit): string => {
  const safeUnits = Number.isFinite(units) ? units : 0;
  const unitText = Number.isInteger(safeUnits) ? safeUnits.toFixed(0) : safeUnits.toFixed(2);
  const suffix = safeUnits === 1 ? '' : 's';
  return `${unitText} ${unitLabel}${suffix}`;
};
