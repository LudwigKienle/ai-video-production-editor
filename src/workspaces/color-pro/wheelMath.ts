/**
 * Colour wheel ↔ RGB parameter mapping. A wheel's puck position is the
 * BT.709 colour difference (Cb, Cr) of the wheel's RGB triplet, so pushing the
 * puck toward a colour moves the vectorscope trace in the same direction.
 * The luma of the triplet (its "Y" part) is kept when the puck moves.
 */
import type { FxParamValues } from '../../fx/types.ts';
import { chroma709 } from './scopes.ts';

export type WheelKind = 'lift' | 'gamma' | 'gain' | 'offset' | 'logShadow' | 'logMid' | 'logHigh';

/** Neutral value of the RGB channels (gain is a multiplier). */
export const wheelBase = (kind: WheelKind) => (kind === 'gain' ? 1 : 0);
/** Chroma magnitude at the edge of the wheel. */
export const wheelRange = (kind: WheelKind) => (kind === 'gain' ? 0.5 : kind === 'gamma' ? 0.4 : kind.startsWith('log') ? 0.6 : 0.25);
export const wheelHasMaster = (kind: WheelKind) => kind === 'lift' || kind === 'gamma' || kind === 'gain';

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

export function wheelChannels(values: FxParamValues, kind: WheelKind): [number, number, number] {
  const base = wheelBase(kind);
  return [num(values[`${kind}R`], base), num(values[`${kind}G`], base), num(values[`${kind}B`], base)];
}

/** Puck position (−1..1, y up) of the wheel. */
export function wheelPosition(values: FxParamValues, kind: WheelKind): { x: number; y: number } {
  const base = wheelBase(kind);
  const [r, g, b] = wheelChannels(values, kind).map((v) => v - base);
  const [cb, cr] = chroma709(r, g, b);
  const range = wheelRange(kind);
  return { x: cb / range, y: cr / range };
}

/** RGB params for a new puck position; keeps the luma of the triplet. */
export function wheelPatch(values: FxParamValues, kind: WheelKind, x: number, y: number): FxParamValues {
  const base = wheelBase(kind);
  const [r0, g0, b0] = wheelChannels(values, kind).map((v) => v - base);
  const keep = luma(r0, g0, b0);
  const len = Math.hypot(x, y);
  const k = len > 1 ? 1 / len : 1;
  const range = wheelRange(kind);
  const cb = x * k * range;
  const cr = y * k * range;
  const r = keep + 1.5748 * cr;
  const g = keep - 0.187324 * cb - 0.468124 * cr;
  const b = keep + 1.8556 * cb;
  const round = (v: number) => Math.round(v * 100000) / 100000;
  return { [`${kind}R`]: round(base + r), [`${kind}G`]: round(base + g), [`${kind}B`]: round(base + b) };
}

/** Moves all three channels together (the wheel "jog" for wheels without a Y master, e.g. Offset). */
export function wheelGangPatch(values: FxParamValues, kind: WheelKind, delta: number): FxParamValues {
  const [r, g, b] = wheelChannels(values, kind);
  const round = (v: number) => Math.round(v * 100000) / 100000;
  return { [`${kind}R`]: round(r + delta), [`${kind}G`]: round(g + delta), [`${kind}B`]: round(b + delta) };
}

/** Resets the wheel (RGB + master). */
export function wheelResetPatch(kind: WheelKind): FxParamValues {
  const base = wheelBase(kind);
  const patch: FxParamValues = { [`${kind}R`]: base, [`${kind}G`]: base, [`${kind}B`]: base };
  if (wheelHasMaster(kind)) patch[`${kind}Y`] = base;
  return patch;
}
