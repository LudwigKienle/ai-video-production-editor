/**
 * Primary grade ("avpe.primary-grade") — shared model for the GPU shader
 * (shader.ts) and the CPU reference (cpu.ts).
 *
 * One instance is one colour node of the Color page: primaries (lift / gamma /
 * gain / offset with RGB + master Y), log wheels, contrast / pivot,
 * saturation, hue, temperature / tint, lum mix, custom curves (Y/R/G/B and
 * Hue vs Hue / Sat / Lum), an HSL qualifier and a power window that limit the
 * correction, blur / sharpen, key gain / offset and node sizing.
 *
 * Curves are stored as undeclared string params (`curveY`, `curveR`, `curveG`,
 * `curveB`, `hueHue`, `hueSat`, `hueLum`) in the compact form "x:y,x:y" — the
 * parameter schema has no string type, and resolveParams passes unknown keys
 * through unchanged. An empty / missing string is the identity curve.
 */
import type { FxParamValues } from '../../types.ts';

export const CURVE_LUT_SIZE = 256;
/** Rows of the curve texture: Y, R, G, B, Hue→Hue, Hue→Sat, Hue→Lum, spare. */
export const CURVE_ROWS = 8;
export const CURVE_KEYS = ['curveY', 'curveR', 'curveG', 'curveB', 'hueHue', 'hueSat', 'hueLum'] as const;
export type CurveKey = (typeof CURVE_KEYS)[number];
export const HUE_CURVE_KEYS: CurveKey[] = ['hueHue', 'hueSat', 'hueLum'];

export type CurvePoint = [number, number];

export const WINDOW_TYPES = ['Aus', 'Kreis', 'Linear', 'Verlauf'] as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (values: FxParamValues, id: string, fallback: number) => {
  const v = values[id];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return fallback;
};
const bool = (values: FxParamValues, id: string, fallback: boolean) => {
  const v = values[id];
  return typeof v === 'boolean' ? v : typeof v === 'number' ? v !== 0 : fallback;
};

// ---------------------------------------------------------------------------
// Curves
// ---------------------------------------------------------------------------

export function parseCurve(text: unknown): CurvePoint[] {
  if (typeof text !== 'string' || !text.trim()) return [];
  const points: CurvePoint[] = [];
  for (const part of text.split(',')) {
    const [xs, ys] = part.split(':');
    const x = Number(xs);
    const y = Number(ys);
    if (Number.isFinite(x) && Number.isFinite(y)) points.push([clamp(x, 0, 1), clamp(y, 0, 1)]);
  }
  return points.sort((a, b) => a[0] - b[0]);
}

const fmt = (v: number) => String(Math.round(v * 10000) / 10000);

export function serializeCurve(points: CurvePoint[]): string {
  return [...points].sort((a, b) => a[0] - b[0]).map(([x, y]) => `${fmt(x)}:${fmt(y)}`).join(',');
}

/** True when the (RGB / Y) curve maps every input to itself. */
export function isIdentityCurve(points: CurvePoint[]): boolean {
  return points.every(([x, y]) => Math.abs(x - y) < 1e-4);
}

/** True when a hue curve is flat at the neutral value 0.5. */
export function isNeutralHueCurve(points: CurvePoint[]): boolean {
  return points.every(([, y]) => Math.abs(y - 0.5) < 1e-4);
}

/**
 * Monotone cubic (Fritsch–Carlson) curve through the points, sampled at
 * `size` evenly spaced inputs 0..1. Endpoints (0,0) and (1,1) are implied when
 * the user did not place points at the edges, so a curve never "jumps".
 */
export function buildCurveLut(points: CurvePoint[], size = CURVE_LUT_SIZE): Float32Array {
  const out = new Float32Array(size);
  const pts: CurvePoint[] = [...points].sort((a, b) => a[0] - b[0]);
  // Merge points that share an x.
  const merged: CurvePoint[] = [];
  for (const p of pts) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last[0] - p[0]) < 1e-6) last[1] = p[1];
    else merged.push([p[0], p[1]]);
  }
  if (!merged.length || merged[0][0] > 1e-6) merged.unshift([0, 0]);
  if (merged[merged.length - 1][0] < 1 - 1e-6) merged.push([1, 1]);
  const n = merged.length;
  const xs = merged.map((p) => p[0]);
  const ys = merged.map((p) => p[1]);
  const d: number[] = [];
  for (let i = 0; i < n - 1; i += 1) d.push((ys[i + 1] - ys[i]) / Math.max(1e-9, xs[i + 1] - xs[i]));
  const m: number[] = new Array(n).fill(0);
  if (n === 2) {
    m[0] = d[0];
    m[1] = d[0];
  } else {
    m[0] = d[0];
    m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i += 1) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i += 1) {
      if (Math.abs(d[i]) < 1e-12) {
        m[i] = 0;
        m[i + 1] = 0;
        continue;
      }
      const a = m[i] / d[i];
      const b = m[i + 1] / d[i];
      const s = a * a + b * b;
      if (s > 9) {
        const t = 3 / Math.sqrt(s);
        m[i] = t * a * d[i];
        m[i + 1] = t * b * d[i];
      }
    }
  }
  let seg = 0;
  for (let k = 0; k < size; k += 1) {
    const x = k / (size - 1);
    while (seg < n - 2 && x > xs[seg + 1]) seg += 1;
    const h = Math.max(1e-9, xs[seg + 1] - xs[seg]);
    const t = clamp((x - xs[seg]) / h, 0, 1);
    const t2 = t * t;
    const t3 = t2 * t;
    const y =
      (2 * t3 - 3 * t2 + 1) * ys[seg] +
      (t3 - 2 * t2 + t) * h * m[seg] +
      (-2 * t3 + 3 * t2) * ys[seg + 1] +
      (t3 - t2) * h * m[seg + 1];
    out[k] = y;
  }
  return out;
}

/**
 * Periodic hue curve (x = hue 0..1, y = 0..1 with 0.5 neutral), sampled at
 * k / size (k = 0..size-1). Points are joined with cosine easing and the
 * curve wraps from the last point back to the first.
 */
export function buildHueCurveLut(points: CurvePoint[], size = CURVE_LUT_SIZE): Float32Array {
  const out = new Float32Array(size);
  if (!points.length) {
    out.fill(0.5);
    return out;
  }
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  if (pts.length === 1) {
    out.fill(pts[0][1]);
    return out;
  }
  for (let k = 0; k < size; k += 1) {
    const x = k / size;
    // Find the segment [a, b] around x on the circle.
    let ai = pts.length - 1;
    for (let i = 0; i < pts.length; i += 1) if (pts[i][0] <= x) ai = i;
    const bi = (ai + 1) % pts.length;
    const ax = pts[ai][0];
    let bx = pts[bi][0];
    let xx = x;
    if (bx <= ax) bx += 1;
    if (xx < ax) xx += 1;
    const t = clamp((xx - ax) / Math.max(1e-9, bx - ax), 0, 1);
    const e = (1 - Math.cos(Math.PI * t)) / 2;
    out[k] = pts[ai][1] + (pts[bi][1] - pts[ai][1]) * e;
  }
  return out;
}

export type CurveSet = Record<CurveKey, CurvePoint[]>;

export function curvesFromParams(values: FxParamValues): CurveSet {
  const set = {} as CurveSet;
  for (const key of CURVE_KEYS) set[key] = parseCurve(values[key]);
  return set;
}

export function curveTextureKey(values: FxParamValues): string {
  return `avpe.pg.curves:${CURVE_KEYS.map((key) => (typeof values[key] === 'string' ? values[key] : '')).join('|')}`;
}

/** CURVE_LUT_SIZE × CURVE_ROWS single-channel texture, row-major (row = curve). */
export function buildCurveTexture(curves: CurveSet): Float32Array {
  const data = new Float32Array(CURVE_LUT_SIZE * CURVE_ROWS);
  const rgb: CurveKey[] = ['curveY', 'curveR', 'curveG', 'curveB'];
  rgb.forEach((key, row) => data.set(buildCurveLut(curves[key]), row * CURVE_LUT_SIZE));
  HUE_CURVE_KEYS.forEach((key, i) => data.set(buildHueCurveLut(curves[key]), (4 + i) * CURVE_LUT_SIZE));
  return data;
}

// ---------------------------------------------------------------------------
// Prepared state (all derived numbers shared by GPU and CPU)
// ---------------------------------------------------------------------------

export type PreparedGrade = {
  wb: [number, number, number];
  offset: [number, number, number];
  lift: [number, number, number];
  gamma: [number, number, number];
  gain: [number, number, number];
  liftY: number;
  gammaY: number;
  gainY: number;
  lumMix: number;
  logShadow: [number, number, number];
  logMid: [number, number, number];
  logHigh: [number, number, number];
  logLow: number;
  logHighRange: number;
  logActive: boolean;
  contrast: number;
  pivot: number;
  saturation: number;
  /** Rows of the hue rotation matrix (Rodrigues rotation around grey). */
  hueRows: [number[], number[], number[]];
  curvesActive: boolean;
  hueCurvesActive: boolean;
  qualEnabled: boolean;
  qualHue: number;
  qualHueWidth: number;
  qualHueSoft: number;
  qualSatLow: number;
  qualSatHigh: number;
  qualSatSoft: number;
  qualLumLow: number;
  qualLumHigh: number;
  qualLumSoft: number;
  /** Hue / sat / lum key components enabled (1/0). */
  qualUse: [number, number, number];
  qualInvert: boolean;
  winType: number;
  winCenter: [number, number];
  winSize: [number, number];
  winRotation: number;
  winSoftness: number;
  winInvert: boolean;
  /** Gaussian sigma in pixels for the blur passes (0 = none). */
  blurSigma: number;
  blurMode: number; // 0 none, 1 blur, 2 sharpen
  sharpen: number;
  keyGain: number;
  keyOffset: number;
  keyInvert: boolean;
  showMask: boolean;
  sizingActive: boolean;
  sizePan: [number, number];
  sizeZoom: number;
  sizeRotate: number;
  sizeFlip: [number, number];
};

const rgb = (values: FxParamValues, prefix: string, fallback: number): [number, number, number] => [
  num(values, `${prefix}R`, fallback),
  num(values, `${prefix}G`, fallback),
  num(values, `${prefix}B`, fallback),
];

export function hueRotationRows(degrees: number): [number[], number[], number[]] {
  const rad = (degrees * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const k = (1 - c) / 3;
  const q = Math.sqrt(1 / 3) * s;
  return [
    [c + k, k - q, k + q],
    [k + q, c + k, k - q],
    [k - q, k + q, c + k],
  ];
}

export function prepareGrade(values: FxParamValues, frame: { width: number; height: number }): PreparedGrade {
  const temp = (num(values, 'temperature', 0) / 100) * 0.3;
  const tint = (num(values, 'tint', 0) / 100) * 0.3;
  const curves = curvesFromParams(values);
  const curvesActive = (['curveY', 'curveR', 'curveG', 'curveB'] as CurveKey[]).some((key) => !isIdentityCurve(curves[key]));
  const hueCurvesActive = HUE_CURVE_KEYS.some((key) => !isNeutralHueCurve(curves[key]));
  const logShadow = rgb(values, 'logShadow', 0);
  const logMid = rgb(values, 'logMid', 0);
  const logHigh = rgb(values, 'logHigh', 0);
  const logActive = [...logShadow, ...logMid, ...logHigh].some((v) => Math.abs(v) > 1e-6);
  const blur = Math.max(0, num(values, 'blurRadius', 0));
  const sharpen = Math.max(0, num(values, 'sharpen', 0));
  const scale = frame.height / 1080;
  const blurMode = blur > 1e-4 ? 1 : sharpen > 1e-4 ? 2 : 0;
  const blurSigma = blurMode === 1 ? blur * scale : blurMode === 2 ? Math.max(0.6, 1.2 * scale) : 0;
  const pan: [number, number] = [num(values, 'sizePan', 0), num(values, 'sizeTilt', 0)];
  const zoom = Math.max(0.01, num(values, 'sizeZoom', 1));
  const rotate = num(values, 'sizeRotate', 0);
  const flip: [number, number] = [bool(values, 'sizeFlipH', false) ? 1 : 0, bool(values, 'sizeFlipV', false) ? 1 : 0];
  const sizingActive = Math.abs(pan[0]) > 1e-6 || Math.abs(pan[1]) > 1e-6 || Math.abs(zoom - 1) > 1e-6 || Math.abs(rotate) > 1e-6 || flip[0] + flip[1] > 0;
  return {
    wb: [1 + temp, 1 - tint, 1 - temp],
    offset: rgb(values, 'offset', 0),
    lift: rgb(values, 'lift', 0),
    gamma: rgb(values, 'gamma', 0),
    gain: rgb(values, 'gain', 1),
    liftY: num(values, 'liftY', 0),
    gammaY: num(values, 'gammaY', 0),
    gainY: num(values, 'gainY', 1),
    lumMix: clamp(num(values, 'lumMix', 1), 0, 1),
    logShadow,
    logMid,
    logHigh,
    logLow: clamp(num(values, 'logLowRange', 0.333), 0, 1),
    logHighRange: clamp(num(values, 'logHighRange', 0.55), 0, 1),
    logActive,
    contrast: num(values, 'contrast', 1),
    pivot: num(values, 'pivot', 0.435),
    saturation: Math.max(0, num(values, 'saturation', 1)),
    hueRows: hueRotationRows(num(values, 'hue', 0)),
    curvesActive,
    hueCurvesActive,
    qualEnabled: bool(values, 'qualEnabled', false),
    qualHue: num(values, 'qualHue', 0),
    qualHueWidth: Math.max(0, num(values, 'qualHueWidth', 30)),
    qualHueSoft: Math.max(0, num(values, 'qualHueSoft', 10)),
    qualSatLow: num(values, 'qualSatLow', 0),
    qualSatHigh: num(values, 'qualSatHigh', 1),
    qualSatSoft: Math.max(0, num(values, 'qualSatSoft', 0.05)),
    qualLumLow: num(values, 'qualLumLow', 0),
    qualLumHigh: num(values, 'qualLumHigh', 1),
    qualLumSoft: Math.max(0, num(values, 'qualLumSoft', 0.05)),
    qualUse: [bool(values, 'qualHueOn', true) ? 1 : 0, bool(values, 'qualSatOn', true) ? 1 : 0, bool(values, 'qualLumOn', true) ? 1 : 0],
    qualInvert: bool(values, 'qualInvert', false),
    winType: Math.round(clamp(num(values, 'winType', 0), 0, WINDOW_TYPES.length - 1)),
    winCenter: [num(values, 'winX', 0.5), num(values, 'winY', 0.5)],
    winSize: [Math.max(1e-4, num(values, 'winSizeX', 0.3)), Math.max(1e-4, num(values, 'winSizeY', 0.3))],
    winRotation: (num(values, 'winRotation', 0) * Math.PI) / 180,
    winSoftness: Math.max(0, num(values, 'winSoftness', 0.15)),
    winInvert: bool(values, 'winInvert', false),
    blurSigma,
    blurMode,
    sharpen,
    keyGain: num(values, 'keyGain', 1),
    keyOffset: num(values, 'keyOffset', 0),
    keyInvert: bool(values, 'keyInvert', false),
    showMask: bool(values, 'showMask', false),
    sizingActive,
    sizePan: pan,
    sizeZoom: zoom,
    sizeRotate: (rotate * Math.PI) / 180,
    sizeFlip: flip,
  };
}

/** Max gaussian half-width (taps per side) — shared by GPU loop and CPU. */
export const MAX_BLUR_TAPS = 96;
export const blurTaps = (sigma: number) => Math.min(MAX_BLUR_TAPS, Math.ceil(sigma * 3));
