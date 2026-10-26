/**
 * CPU reference of Buckswood Post Plugins Fake Diagnostic v2.2 — same math as shader.ts and
 * `FakeDiagnosticCore::analyzeContext()` / `applyAssist()` / `processPixel()`
 * (include/FakeDiagnosticCore.h), single-frame path (no temporal context).
 *
 * Images are RGBA float32, row 0 = bottom (OFX convention). The sampler is the
 * OFX `FloatSampler`: nearest pixel, transparent black outside the frame (so
 * border pixels see zero neighbours, exactly like the plugin).
 */
import type { FloatImage } from '../opticsLab/cpu.ts';
import { FakeView, type PreparedFake } from './model.ts';

export type { FloatImage };

type Px = [number, number, number, number];

export type FakeScores = {
  plastic: number;
  highlight: number;
  edge: number;
  grade: number;
  texture: number;
  temporal: number;
  overall: number;
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const luma = (p: Px) => p[0] * 0.2126 + p[1] * 0.7152 + p[2] * 0.0722;
const smoothstep = (e0: number, e1: number, x: number) => {
  if (e0 === e1) return x < e0 ? 0 : 1;
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const add = (a: Px, b: Px): Px => [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]];
const mul = (a: Px, s: number): Px => [a[0] * s, a[1] * s, a[2] * s, a[3] * s];
const mix = (a: Px, b: Px, t: number): Px => {
  const u = clamp01(t);
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u];
};
const clampPixel = (p: Px): Px => [clamp01(p[0]), clamp01(p[1]), clamp01(p[2]), clamp01(p[3])];

/** FakeDiagnosticCore::hash01 — uint32 arithmetic, float32 result. */
export function hash01(x: number, y: number, z: number): number {
  let n = (Math.imul(x | 0, 15731) + Math.imul(y | 0, 789221) + Math.imul(z | 0, 1376312589)) >>> 0;
  n = ((n << 13) ^ n) >>> 0;
  const inner = (Math.imul(Math.imul(n, n), 15731) + 789221) >>> 0;
  const hashed = ((Math.imul(n, inner) + 1376312589) >>> 0) & 0x7fffffff;
  return Math.fround(Math.fround(hashed) / Math.fround(2147483647));
}

const CATEGORY_COLORS: Record<Exclude<keyof FakeScores, 'overall'>, [number, number, number]> = {
  plastic: [1, 0, 0.85],
  highlight: [1, 0.82, 0.05],
  edge: [0, 0.85, 1],
  grade: [1, 0.08, 0.02],
  texture: [0.12, 0.32, 1],
  temporal: [0, 1, 0.22],
};
const CATEGORY_ORDER = ['plastic', 'highlight', 'edge', 'grade', 'texture', 'temporal'] as const;

/** FakeDiagnosticCore::categoryColor — score-weighted blend of the category palette. */
export function categoryColor(scores: FakeScores): Px {
  const sum = Math.max(0.001, scores.plastic + scores.highlight + scores.edge + scores.grade + scores.texture + scores.temporal);
  const color: Px = [0, 0, 0, 1];
  for (const key of CATEGORY_ORDER) {
    const w = scores[key] / sum;
    const c = CATEGORY_COLORS[key];
    color[0] += c[0] * w;
    color[1] += c[1] * w;
    color[2] += c[2] * w;
  }
  color[3] = 1;
  return color;
}

export type FakeSampler = (x: number, y: number) => Px;

export function makeFakeSampler(image: FloatImage): FakeSampler {
  const { width, height, data } = image;
  return (x, y) => {
    if (x < 0 || y < 0 || x > width - 1 || y > height - 1) return [0, 0, 0, 0];
    const i = (y * width + x) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  };
}

type Analysis = { input: Px; crossBlur: Px; scores: FakeScores; temporalDifference: number };

export function analyzeFakePixel(sample: FakeSampler, x: number, y: number, state: PreparedFake): Analysis {
  const c = sample(x, y);
  const l = sample(x - 1, y);
  const r = sample(x + 1, y);
  const u = sample(x, y - 1);
  const d = sample(x, y + 1);
  const cy = luma(c);
  const ly = luma(l);
  const ry = luma(r);
  const uy = luma(u);
  const dy = luma(d);
  const d1y = luma(sample(x - 1, y - 1));
  const d2y = luma(sample(x + 1, y - 1));
  const d3y = luma(sample(x - 1, y + 1));
  const d4y = luma(sample(x + 1, y + 1));

  const detail =
    (Math.abs(cy - ly) + Math.abs(cy - ry) + Math.abs(cy - uy) + Math.abs(cy - dy) + Math.abs(cy - d1y) + Math.abs(cy - d2y) + Math.abs(cy - d3y) + Math.abs(cy - d4y)) *
    0.125;
  const gx = ry - ly;
  const gy = dy - uy;
  const gradient = Math.sqrt(gx * gx + gy * gy);
  const maxChannel = Math.max(c[0], c[1], c[2]);
  const minChannel = Math.min(c[0], c[1], c[2]);
  const saturation = (maxChannel - minChannel) / Math.max(0.001, maxChannel);
  const midtoneMask = smoothstep(0.06, 0.28, cy) * (1 - smoothstep(0.78, 0.98, cy));
  const brightMask = smoothstep(0.74, 1, cy);
  const clipped = Math.max(smoothstep(0.965, 1.02, c[0]), Math.max(smoothstep(0.965, 1.02, c[1]), smoothstep(0.965, 1.02, c[2])));
  const localClean = 1 - smoothstep(0.012, 0.085, detail);

  const scores: FakeScores = {
    plastic: clamp01(localClean * midtoneMask * (0.45 + 0.55 * smoothstep(0.06, 0.55, saturation))),
    highlight: clamp01(brightMask * (0.35 + 0.65 * clipped)),
    edge: clamp01(smoothstep(0.1, 0.42, gradient) * (0.35 + 0.65 * localClean)),
    grade: clamp01(Math.max(smoothstep(0.68, 1, saturation), smoothstep(0.92, 1.06, maxChannel))),
    texture: clamp01(localClean * (1 - smoothstep(0.12, 0.38, gradient)) * midtoneMask),
    // Single-frame path: no neighbouring frames, temporal risk is 0.
    temporal: 0,
    overall: 0,
  };
  const k = state.controls;
  scores.overall = clamp01(
    (k.sensitivity *
      (scores.plastic * k.plasticWeight +
        scores.highlight * k.highlightWeight +
        scores.edge * k.edgeWeight +
        scores.grade * k.gradeWeight +
        scores.texture * k.textureWeight +
        scores.temporal * k.temporalWeight)) /
      state.weightSum,
  );
  return { input: c, crossBlur: mul(add(add(add(add(c, l), r), u), d), 0.2), scores, temporalDifference: 0 };
}

const KNEE = 0.72;
function rollChannel(v: number, roll: number): number {
  if (v <= KNEE) return v;
  const compressed = KNEE + (1 - Math.exp(-(v - KNEE) * 3.2)) * 0.28;
  return v + (compressed - v) * roll;
}

/** FakeDiagnosticCore::applyAssist ("Reality Match Assist"). */
export function applyAssist(x: number, y: number, analysis: Analysis, state: PreparedFake): Px {
  const k = state.controls;
  const { input, crossBlur: blur, scores } = analysis;
  const detail: Px = [input[0] - blur[0], input[1] - blur[1], input[2] - blur[2], input[3] - blur[3]];
  const correction = clamp01(k.correctionStrength) * scores.overall;

  let out = add(input, mul(detail, k.microContrast * correction));
  out = mix(out, blur, k.edgeSoften * correction * scores.edge);
  const yv = luma(out);
  out = mix(out, [yv, yv, yv, out[3]], k.gamutGuard * correction * scores.grade * 0.45);

  const roll = k.highlightRolloff * correction * scores.highlight;
  if (roll > 0) {
    out[0] = rollChannel(out[0], roll);
    out[1] = rollChannel(out[1], roll);
    out[2] = rollChannel(out[2], roll);
  }

  const noiseBase = hash01(x, y, state.noiseSeedBase) - 0.5;
  const noiseAlt = hash01(x + 17, y - 11, state.noiseSeedAlt) - 0.5;
  const textureAmount = k.sensorTexture * correction * (0.35 + 0.65 * scores.texture) * 0.045;
  out[0] += noiseBase * textureAmount;
  out[1] += (noiseBase * 0.55 + noiseAlt * 0.45) * textureAmount;
  out[2] += noiseAlt * textureAmount;
  // Temporal smoothing needs a temporal average: skipped (single-frame path).
  out[3] = input[3];
  return clampPixel(out);
}

export function fakeDiagnosticPixel(sample: FakeSampler, x: number, y: number, state: PreparedFake): Px {
  const analysis = analyzeFakePixel(sample, x, y, state);
  const { input, scores } = analysis;
  const k = state.controls;
  const view = k.viewMode;
  const category = categoryColor(scores);

  if (view === FakeView.ProblemMatte) return [scores.overall, scores.overall, scores.overall, input[3]];
  if (view === FakeView.CategoryColors) {
    const level = Math.max(0.18, scores.overall);
    return [category[0] * level, category[1] * level, category[2] * level, input[3]];
  }
  if (view === FakeView.TemporalStabilityMatte) return [scores.temporal, scores.temporal, scores.temporal, input[3]];
  if (view === FakeView.TemporalDifferenceOverlay) {
    const diff = analysis.temporalDifference;
    const diffColor: Px = [0, clamp01(diff * 4), clamp01(1 - diff * 5), input[3]];
    const color = mix(diffColor, [0, 1, 0.22, input[3]], scores.temporal);
    return clampPixel(mix(input, color, k.overlayStrength * Math.max(diff, scores.temporal)));
  }
  if (view === FakeView.RealityMatchAssist) return applyAssist(x, y, analysis, state);

  const base = view === FakeView.AssistWithOverlay ? applyAssist(x, y, analysis, state) : input;
  const overlay = mix(base, category, k.overlayStrength * scores.overall);
  return clampPixel([overlay[0], overlay[1], overlay[2], input[3]]);
}

/**
 * OFX `sourceLooksLikeBlankAdjustment()`: a 9x9 grid of the source decides
 * whether the clip is an empty adjustment layer (near-black, opaque). This is
 * the only frame-global analysis of the plugin; the WebGL port runs it as a
 * one-texel reduction pass (see shader.ts), with identical sampling.
 */
export function looksLikeBlankAdjustment(image: FloatImage): boolean {
  const { width, height, data } = image;
  if (width <= 0 || height <= 0) return false;
  let maxRgb = 0;
  let alphaSum = 0;
  let samples = 0;
  const grid = 9;
  for (let gy = 0; gy < grid; gy += 1) {
    const y = Math.trunc(((height - 1) * gy) / (grid - 1));
    for (let gx = 0; gx < grid; gx += 1) {
      const x = Math.trunc(((width - 1) * gx) / (grid - 1));
      const i = (y * width + x) * 4;
      maxRgb = Math.max(maxRgb, Math.max(data[i], Math.max(data[i + 1], data[i + 2])));
      alphaSum += data[i + 3];
      samples += 1;
      if (maxRgb > Math.fround(0.015)) return false;
    }
  }
  return samples > 0 && alphaSum / samples > Math.fround(0.75) && maxRgb < Math.fround(0.015);
}

export function renderFakeDiagnosticCpu(image: FloatImage, state: PreparedFake): FloatImage {
  const out = new Float32Array(image.width * image.height * 4);
  // Blank adjustment layer: the plugin outputs transparent black.
  if (state.controls.adjustmentLayerGuard && looksLikeBlankAdjustment(image)) return { width: image.width, height: image.height, data: out };
  const sample = makeFakeSampler(image);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      out.set(fakeDiagnosticPixel(sample, x, y, state), (y * image.width + x) * 4);
    }
  }
  return { width: image.width, height: image.height, data: out };
}
