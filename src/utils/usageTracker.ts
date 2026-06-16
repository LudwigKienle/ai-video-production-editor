import { UsageEntry } from '../types';

type UsageListener = (entry: UsageEntry) => void;

const listeners = new Set<UsageListener>();

const buildId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `usage_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

export const subscribeUsage = (listener: UsageListener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const recordUsage = (
  entry: Omit<UsageEntry, 'id' | 'createdAt'> & { id?: string; createdAt?: string },
) => {
  const normalized: UsageEntry = {
    id: entry.id || buildId(),
    createdAt: entry.createdAt || new Date().toISOString(),
    provider: entry.provider,
    model: entry.model,
    kind: entry.kind,
    units: entry.units,
    unitLabel: entry.unitLabel,
    note: entry.note,
  };
  listeners.forEach((listener) => listener(normalized));
  return normalized;
};
