/**
 * Automation lanes: evaluation and recording.
 *
 * Modes follow the common console convention:
 *  - off:   automation is ignored, the static fader value plays.
 *  - read:  the lane plays back.
 *  - touch: plays back; while a control is touched its moves are written,
 *           on release the lane returns to the existing data.
 *  - latch: like touch, but after release the last value keeps being written
 *           until playback stops.
 *  - write: from the start of playback every value is written over the lane.
 */

import type { AutomationMode, AutomationPoint } from './model.ts';

/** Linear interpolation; before the first point the first value holds, after the last the last value holds. */
export const evaluateAutomation = (points: AutomationPoint[] | undefined, time: number, fallback: number): number => {
  if (!points || points.length === 0 || !Number.isFinite(time)) return fallback;
  if (time <= points[0].time) return points[0].value;
  const last = points[points.length - 1];
  if (time >= last.time) return last.value;
  // binary search for the segment
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].time <= time) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  const span = b.time - a.time;
  if (span <= 0) return b.value;
  return a.value + (b.value - a.value) * ((time - a.time) / span);
};

export const isAutomationPlaying = (mode: AutomationMode): boolean => mode !== 'off';

/** Replaces every point inside [start, end] by `written` (already sorted), keeping the lane continuous at the edges. */
export const spliceAutomation = (
  points: AutomationPoint[],
  start: number,
  end: number,
  written: AutomationPoint[],
): AutomationPoint[] => {
  const pass = written.filter((p) => p.time >= start && p.time <= end);
  if (!(end >= start) || pass.length === 0) return points;
  if (points.length === 0) return thinAutomation(pass);
  // anchor the old curve just outside the pass so the rest of the lane keeps its shape
  const EDGE = 0.001;
  const before = points.filter((p) => p.time < start - EDGE);
  const after = points.filter((p) => p.time > end + EDGE);
  const result = [...before];
  if (start - EDGE >= 0) result.push({ time: start - EDGE, value: evaluateAutomation(points, start - EDGE, pass[0].value) });
  result.push(...pass);
  result.push({ time: end + EDGE, value: evaluateAutomation(points, end + EDGE, pass[pass.length - 1].value) });
  result.push(...after);
  return thinAutomation(result);
};

/** Removes points that lie on the straight line between their neighbours (tolerance in value units). */
export const thinAutomation = (points: AutomationPoint[], tolerance = 0.01): AutomationPoint[] => {
  if (points.length <= 2) return points;
  const out: AutomationPoint[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = out[out.length - 1];
    const cur = points[i];
    const next = points[i + 1];
    if (cur.time === prev.time && cur.value === prev.value) continue;
    const span = next.time - prev.time;
    const expected = span > 0 ? prev.value + (next.value - prev.value) * ((cur.time - prev.time) / span) : next.value;
    if (Math.abs(expected - cur.value) > tolerance) out.push(cur);
  }
  out.push(points[points.length - 1]);
  return out;
};

/**
 * Collects one automation pass for one parameter. Feed it the transport time
 * on every UI tick together with the control value and whether the control
 * is touched; `finish()` returns the new lane.
 */
export class AutomationRecorder {
  private written: AutomationPoint[] = [];
  private passStart: number | null = null;
  private writing = false;
  private latched = false;
  private lastValue: number | null = null;

  private mode: AutomationMode;
  private original: AutomationPoint[];
  private segments: Array<{ start: number; end: number; points: AutomationPoint[] }> = [];

  constructor(mode: AutomationMode, original: AutomationPoint[]) {
    this.mode = mode;
    this.original = original;
    if (mode === 'write') this.writing = true;
  }

  sample(time: number, value: number, touched: boolean): void {
    if (!Number.isFinite(time) || !Number.isFinite(value)) return;
    if (this.mode === 'off' || this.mode === 'read') return;
    if (this.mode === 'touch') this.writing = touched;
    if (this.mode === 'latch') {
      if (touched) this.latched = true;
      this.writing = this.latched;
    }
    if (!this.writing) {
      if (this.passStart !== null && this.mode === 'touch') this.flushTouchSegment(time);
      return;
    }
    if (this.passStart === null) this.passStart = time;
    const last = this.written[this.written.length - 1];
    if (!last || time > last.time) this.written.push({ time, value });
    this.lastValue = value;
  }

  private flushTouchSegment(time: number): void {
    if (this.passStart === null) return;
    const points = this.written;
    const end = points.length ? points[points.length - 1].time : time;
    this.segments.push({ start: this.passStart, end, points });
    this.written = [];
    this.passStart = null;
  }

  /** Ends the pass at `time` (transport stop) and returns the resulting lane. */
  finish(time: number): AutomationPoint[] {
    if (this.passStart !== null) {
      if ((this.mode === 'latch' || this.mode === 'write') && this.lastValue !== null) {
        const last = this.written[this.written.length - 1];
        if (!last || time > last.time) this.written.push({ time, value: this.lastValue });
      }
      this.flushTouchSegment(time);
    }
    let lane = this.original;
    for (const seg of this.segments) lane = spliceAutomation(lane, seg.start, seg.end, seg.points);
    this.segments = [];
    return lane;
  }
}
