/**
 * Pure part of live pages (see livePage.ts): setting descriptors, snapshot
 * and validated apply. No React, so node tests can use it.
 */
export type LiveSetting = {
  value: unknown;
  set: (value: never) => void;
  type: 'string' | 'number' | 'boolean' | 'json';
  options?: readonly unknown[];
  min?: number;
  max?: number;
};

export type LiveActionHelpers = {
  /** Resolves after the page re-rendered (or after 250 ms if nothing changed). */
  waitForCommit: () => Promise<void>;
};

export type LivePageSpec = {
  settings: Record<string, LiveSetting>;
  /** Read-only state worth showing to an agent (status, jobs, results, catalogs). */
  info?: () => Record<string, unknown>;
  /** Button handlers. `helpers.waitForCommit()` lets an action wait for React between steps. */
  actions: Record<string, (args: Record<string, unknown>, helpers: LiveActionHelpers) => unknown | Promise<unknown>>;
};

export function snapshotSettings(settings: Record<string, LiveSetting>) {
  return Object.fromEntries(Object.entries(settings).map(([key, setting]) => [key, setting.value]));
}

/** Validates and applies settings; unknown keys and bad values throw before anything is set. */
export function applySettings(settings: Record<string, LiveSetting>, values: unknown): string[] {
  if (values === undefined || values === null) return [];
  if (typeof values !== 'object' || Array.isArray(values)) throw new Error('settings must be an object.');
  const pending: Array<() => void> = [];
  for (const [key, raw] of Object.entries(values as Record<string, unknown>)) {
    const setting = settings[key];
    if (!setting) throw new Error(`Unknown setting "${key}". Known: ${Object.keys(settings).join(', ')}.`);
    let value: unknown = raw;
    if (setting.type === 'number') {
      value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Setting "${key}" must be a number.`);
      if (setting.min !== undefined) value = Math.max(setting.min, value as number);
      if (setting.max !== undefined) value = Math.min(setting.max, value as number);
    } else if (setting.type === 'boolean') {
      if (typeof raw !== 'boolean') throw new Error(`Setting "${key}" must be true or false.`);
    } else if (setting.type === 'string') {
      if (raw !== null && typeof raw !== 'string') throw new Error(`Setting "${key}" must be a string.`);
      value = raw ?? '';
    }
    if (setting.options && !setting.options.includes(value)) {
      throw new Error(`Setting "${key}" must be one of: ${setting.options.map(String).join(', ')}.`);
    }
    pending.push(() => (setting.set as (next: unknown) => void)(value));
  }
  pending.forEach((apply) => apply());
  return Object.keys(values as Record<string, unknown>);
}

