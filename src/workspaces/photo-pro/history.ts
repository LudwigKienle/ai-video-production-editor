/**
 * Protokoll (history) as a pure, generic state list. Every entry holds a full
 * immutable document state; the current position can be moved freely, and a
 * new commit drops the "future" states like Photoshop does.
 */

export type HistoryEntry<T> = {
  id: number;
  label: string;
  state: T;
  /** Entries with the same key committed in quick succession merge (slider drags). */
  coalesceKey?: string;
  time: number;
};

export type History<T> = {
  entries: HistoryEntry<T>[];
  index: number;
  nextId: number;
  limit: number;
};

export const DEFAULT_HISTORY_LIMIT = 50;
export const COALESCE_WINDOW_MS = 1200;

export function createHistory<T>(state: T, label = 'Öffnen', limit = DEFAULT_HISTORY_LIMIT, now = Date.now()): History<T> {
  return { entries: [{ id: 1, label, state, time: now }], index: 0, nextId: 2, limit: Math.max(2, limit) };
}

export const currentState = <T>(h: History<T>): T => h.entries[h.index].state;
export const canUndo = <T>(h: History<T>) => h.index > 0;
export const canRedo = <T>(h: History<T>) => h.index < h.entries.length - 1;

export function commit<T>(
  h: History<T>,
  state: T,
  label: string,
  opts: { coalesceKey?: string; now?: number } = {},
): History<T> {
  const now = opts.now ?? Date.now();
  if (state === currentState(h)) return h;
  const top = h.entries[h.index];
  const atEnd = h.index === h.entries.length - 1;
  if (
    opts.coalesceKey
    && atEnd
    && h.index > 0
    && top.coalesceKey === opts.coalesceKey
    && now - top.time < COALESCE_WINDOW_MS
  ) {
    const entries = h.entries.slice();
    entries[h.index] = { ...top, state, time: now };
    return { ...h, entries };
  }
  let entries = h.entries.slice(0, h.index + 1);
  entries.push({ id: h.nextId, label, state, coalesceKey: opts.coalesceKey, time: now });
  if (entries.length > h.limit) entries = entries.slice(entries.length - h.limit);
  return { ...h, entries, index: entries.length - 1, nextId: h.nextId + 1 };
}

export const undo = <T>(h: History<T>): History<T> => (canUndo(h) ? { ...h, index: h.index - 1 } : h);
export const redo = <T>(h: History<T>): History<T> => (canRedo(h) ? { ...h, index: h.index + 1 } : h);

export function jumpTo<T>(h: History<T>, index: number): History<T> {
  const i = Math.max(0, Math.min(h.entries.length - 1, index));
  return i === h.index ? h : { ...h, index: i };
}

/** Drops the oldest `count` states (memory budget); never drops the current one. */
export function dropOldest<T>(h: History<T>, count: number): History<T> {
  const n = Math.max(0, Math.min(count, h.index));
  if (!n) return h;
  return { ...h, entries: h.entries.slice(n), index: h.index - n };
}

/** Replace the state of the current entry without creating a new one (e.g. async results). */
export function replaceCurrent<T>(h: History<T>, state: T): History<T> {
  const entries = h.entries.slice();
  entries[h.index] = { ...entries[h.index], state };
  return { ...h, entries };
}
