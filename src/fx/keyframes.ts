/**
 * Keyframe interpolation shared by clip properties (Motion, Opacity, Volume …)
 * and FX parameters. Pure functions, no DOM — covered by keyframes.test.ts.
 *
 * Semantics (compatible with the original PreviewPlayer `getKeyframeValue`
 * and the HQ FFmpeg expressions):
 * - before the first keyframe the first value holds, after the last the last;
 * - a segment k1 → k2 is shaped by the easing of k2 (the keyframe it arrives at);
 * - exception 'hold': a keyframe with easing 'hold' keeps its value until the
 *   next keyframe (outgoing step, like an NLE hold keyframe). On the arriving
 *   keyframe 'hold' has no curve of its own (treated as linear).
 */

export type KeyframeEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'hold';

export type TimedValue = { time: number; value: number; easing?: KeyframeEasing | string };

/** Two keyframes closer than this (seconds) are "at the same time". Half a frame at 30 fps. */
export const KEYFRAME_TIME_TOLERANCE = 1 / 60;

export const KEYFRAME_EASINGS: Array<{ id: KeyframeEasing; label: string; hint: string }> = [
  { id: 'linear', label: 'Linear', hint: 'Gleichmäßige Änderung bis zu diesem Keyframe' },
  { id: 'ease-in', label: 'Ease In', hint: 'Langsamer Start, beschleunigt in diesen Keyframe' },
  { id: 'ease-out', label: 'Ease Out', hint: 'Schneller Start, bremst in diesen Keyframe ab' },
  { id: 'ease-in-out', label: 'Ease In/Out', hint: 'Sanft anfahren und sanft abbremsen' },
  { id: 'hold', label: 'Halten', hint: 'Wert bleibt bis zum nächsten Keyframe stehen (Sprung)' },
];

/** Shapes 0..1 progress (same curves as the HQ FFmpeg export). */
export function easeProgress(progress: number, easing: string | undefined): number {
  const t = Math.min(1, Math.max(0, progress));
  if (easing === 'ease-in') return t * t;
  if (easing === 'ease-out') return t * (2 - t);
  if (easing === 'ease-in-out') return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  return t;
}

const byTime = <T extends TimedValue>(points: readonly T[]): T[] => [...points].sort((a, b) => a.time - b.time);

/** Value of a keyframed property at `time`; `fallback` when there are no keyframes. */
export function interpolateKeyframes(points: readonly TimedValue[] | undefined, time: number, fallback: number): number {
  if (!points || points.length === 0) return fallback;
  const sorted = byTime(points);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (time <= first.time) return first.value;
  if (time >= last.time) return last.value;
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const k1 = sorted[i];
    const k2 = sorted[i + 1];
    if (time >= k1.time && time < k2.time) {
      if (k1.easing === 'hold') return k1.value;
      const progress = (time - k1.time) / (k2.time - k1.time);
      return k1.value + (k2.value - k1.value) * easeProgress(progress, k2.easing);
    }
  }
  return fallback;
}

/** Index of the keyframe within `tolerance` of `time`, or -1. */
export function findKeyframeAt(points: readonly TimedValue[], time: number, tolerance = KEYFRAME_TIME_TOLERANCE): number {
  let best = -1;
  let bestDistance = Infinity;
  points.forEach((point, index) => {
    const distance = Math.abs(point.time - time);
    if (distance <= tolerance && distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

/** Time of the closest keyframe strictly before `time` (beyond the tolerance), or null. */
export function previousKeyframeTime(points: readonly TimedValue[], time: number, tolerance = KEYFRAME_TIME_TOLERANCE): number | null {
  let result: number | null = null;
  for (const point of points) if (point.time < time - tolerance && (result === null || point.time > result)) result = point.time;
  return result;
}

/** Time of the closest keyframe strictly after `time` (beyond the tolerance), or null. */
export function nextKeyframeTime(points: readonly TimedValue[], time: number, tolerance = KEYFRAME_TIME_TOLERANCE): number | null {
  let result: number | null = null;
  for (const point of points) if (point.time > time + tolerance && (result === null || point.time < result)) result = point.time;
  return result;
}

/**
 * Sets the value at `time`: updates the keyframe there (keeping its id and
 * easing) or inserts a new one created by `make`. Returns a sorted copy.
 */
export function upsertKeyframe<T extends TimedValue>(points: readonly T[], time: number, value: number, make: (time: number, value: number) => T, tolerance = KEYFRAME_TIME_TOLERANCE): T[] {
  const index = findKeyframeAt(points, time, tolerance);
  if (index >= 0) return byTime(points.map((point, i) => (i === index ? { ...point, value } : point)));
  return byTime([...points, make(time, value)]);
}

/** Moves keyframes by `delta` seconds, clamped to [min, max]; a block keeps its spacing. */
export function shiftKeyframeTimes<T extends TimedValue>(points: readonly T[], selected: (point: T, index: number) => boolean, delta: number, min: number, max: number): T[] {
  const picked = points.filter(selected);
  if (picked.length === 0 || delta === 0) return [...points];
  const lo = Math.min(...picked.map((point) => point.time));
  const hi = Math.max(...picked.map((point) => point.time));
  const clamped = Math.max(min - lo, Math.min(max - hi, delta));
  return byTime(points.map((point, index) => (selected(point, index) ? { ...point, time: point.time + clamped } : point)));
}

export function sortKeyframes<T extends TimedValue>(points: readonly T[]): T[] {
  return byTime(points);
}
