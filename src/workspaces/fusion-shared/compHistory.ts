/**
 * Undo history for one composition. Rapid edits with the same coalesce key
 * (slider drags, typing) within `windowMs` collapse into one undo step.
 */
export type History<T> = { past: T[]; present: T; future: T[]; lastKey: string | null; lastAt: number };

export const createHistory = <T,>(present: T): History<T> => ({ past: [], present, future: [], lastKey: null, lastAt: 0 });

export function pushHistory<T>(history: History<T>, next: T, options: { key?: string | null; now?: number; windowMs?: number; limit?: number } = {}): History<T> {
  if (next === history.present) return history;
  const now = options.now ?? Date.now();
  const key = options.key ?? null;
  const windowMs = options.windowMs ?? 600;
  const limit = options.limit ?? 100;
  if (key && key === history.lastKey && now - history.lastAt < windowMs) {
    return { ...history, present: next, future: [], lastAt: now };
  }
  const past = [...history.past, history.present];
  if (past.length > limit) past.splice(0, past.length - limit);
  return { past, present: next, future: [], lastKey: key, lastAt: now };
}

export function undoHistory<T>(history: History<T>): History<T> {
  if (!history.past.length) return history;
  const previous = history.past[history.past.length - 1];
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future], lastKey: null, lastAt: 0 };
}

export function redoHistory<T>(history: History<T>): History<T> {
  if (!history.future.length) return history;
  const [next, ...rest] = history.future;
  return { past: [...history.past, history.present], present: next, future: rest, lastKey: null, lastAt: 0 };
}
