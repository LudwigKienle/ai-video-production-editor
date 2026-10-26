/**
 * CPU reference of Buckswood Post Plugins Deband v1.0 — same math as shader.ts and
 * `DebandCore::analyzePixel()` / `processPixel()` (include/DebandCore.h).
 * Used by tests, the fx-lab parity page and as a fallback without WebGL2.
 *
 * Images are RGBA float32, row 0 = bottom (OFX convention). The sampler is the
 * OFX `ImageSampler`: integer coordinates, clamped to the frame.
 */
import { hashNoise, type FloatImage } from '../opticsLab/cpu.ts';
import { DebandView, DebandWorkingSpace, type PreparedDeband } from './model.ts';

export type { FloatImage };

type Px = [number, number, number, number];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** DebandCore::smoothstep (note the 1e-7 denominator floor). */
const smoothstep = (e0: number, e1: number, v: number) => {
  const t = clamp01((v - e0) / Math.max(0.0000001, e1 - e0));
  return t * t * (3 - 2 * t);
};
const linearLuma = (p: Px) => 0.2627 * p[0] + 0.678 * p[1] + 0.0593 * p[2];
const LOG1P_16 = Math.log1p(16);
function perceptualLuma(p: Px, workingSpace: number): number {
  const value = linearLuma(p);
  // Only scene-linear input needs compression (display/log are perceptual already).
  if (workingSpace !== DebandWorkingSpace.SceneLinear) return value;
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.log1p(Math.abs(value) * 16)) / LOG1P_16;
}
const mix = (a: Px, b: Px, amount: number): Px => {
  const t = clamp01(amount);
  const u = 1 - t;
  return [a[0] * u + b[0] * t, a[1] * u + b[1] * t, a[2] * u + b[2] * t, a[3] * u + b[3] * t];
};
const sanitize = (p: Px, fallback: Px): Px => [
  Number.isFinite(p[0]) ? p[0] : fallback[0],
  Number.isFinite(p[1]) ? p[1] : fallback[1],
  Number.isFinite(p[2]) ? p[2] : fallback[2],
  fallback[3],
];

/** High-pass of the shared integer hash (DebandCore::blueNoise). */
function blueNoise(x: number, y: number, frame: number, seed: number): number {
  const center = hashNoise(x, y, frame, seed);
  const neighborhood =
    0.25 * (hashNoise(x - 1, y, frame, seed) + hashNoise(x + 1, y, frame, seed) + hashNoise(x, y - 1, frame, seed) + hashNoise(x, y + 1, frame, seed));
  return Math.min(1, Math.max(-1, (center - neighborhood) * 0.7));
}

function heatMap(value: number, alpha: number): Px {
  const v = clamp01(value);
  return [smoothstep(0.2, 0.75, v), smoothstep(0.02, 0.45, v) * (1 - smoothstep(0.75, 1, v)), 0.08 * (1 - v), alpha];
}

export type IntSampler = (x: number, y: number) => Px;

export function makeIntSampler(image: FloatImage): IntSampler {
  const { width, height, data } = image;
  return (x, y) => {
    const cx = Math.min(width - 1, Math.max(0, x));
    const cy = Math.min(height - 1, Math.max(0, y));
    const i = (cy * width + cx) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  };
}

export type DebandAnalysis = { repaired: Px; bandingMask: number; protectedDetail: number; difference: number };

const DIRECTIONS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
] as const;

export function analyzeDebandPixel(sample: IntSampler, x: number, y: number, state: PreparedDeband): DebandAnalysis {
  const dry = sample(x, y);
  const c = state.controls;
  if (c.strength <= 0.000001) return { repaired: dry, bandingMask: 0, protectedDetail: 0, difference: 0 };

  const ws = c.workingSpace;
  const centerY = perceptualLuma(dry, ws);
  const leftY = perceptualLuma(sample(x - 1, y), ws);
  const rightY = perceptualLuma(sample(x + 1, y), ws);
  const upY = perceptualLuma(sample(x, y - 1), ws);
  const downY = perceptualLuma(sample(x, y + 1), ws);

  const gradientX = Math.abs(rightY - leftY) * 0.5;
  const gradientY = Math.abs(downY - upY) * 0.5;
  const edgeMagnitude = Math.sqrt(gradientX * gradientX + gradientY * gradientY);
  const localRoughness = 0.25 * (Math.abs(leftY - centerY) + Math.abs(rightY - centerY) + Math.abs(upY - centerY) + Math.abs(downY - centerY));

  const { threshold, noiseFloor } = state;
  const radii = [state.radiusSmall, state.radiusMedium, state.radiusLarge];
  const candidate: Px = [0, 0, 0, 0];
  let candidateWeight = 0;
  let contourEvidence = 0;
  let farSpan = 0;
  for (let scale = 0; scale < 3; scale += 1) {
    const radius = radii[scale];
    const scaleWeight = scale === 0 ? 0.75 : scale === 1 ? 1 : 0.85;
    for (const [dx, dy] of DIRECTIONS) {
      const negative = sample(x - dx * radius, y - dy * radius);
      const positive = sample(x + dx * radius, y + dy * radius);
      const negativeY = perceptualLuma(negative, ws);
      const positiveY = perceptualLuma(positive, ws);
      const pairRange = Math.max(Math.abs(negativeY - centerY), Math.abs(positiveY - centerY));
      const pairSpan = Math.abs(positiveY - negativeY);
      const residual = Math.abs(0.5 * (negativeY + positiveY) - centerY);
      const rangeWeight = 1 - smoothstep(threshold * 1.4, threshold * 4.5, pairRange);
      const residualWeight = 0.2 + 0.8 * smoothstep(noiseFloor * 0.2, threshold * 0.85, residual);
      const weight = scaleWeight * rangeWeight * residualWeight;
      if (weight > 0.000001) {
        for (let k = 0; k < 4; k += 1) candidate[k] += 0.5 * (negative[k] + positive[k]) * weight;
        candidateWeight += weight;
      }
      const transition = smoothstep(noiseFloor * 0.35, threshold * 1.8, pairSpan);
      const terrace = smoothstep(noiseFloor * 0.2, threshold * 0.8, residual);
      contourEvidence = Math.max(contourEvidence, transition * (0.3 + 0.7 * terrace) * rangeWeight);
      farSpan = Math.max(farSpan, pairSpan * rangeWeight);
    }
  }

  if (candidateWeight <= 0.000001) return { repaired: dry, bandingMask: 0, protectedDetail: 1, difference: 0 };
  const inv = 1 / candidateWeight;
  for (let k = 0; k < 4; k += 1) candidate[k] *= inv;
  candidate[3] = dry[3];

  const reconstructionResidual = Math.abs(perceptualLuma(candidate, ws) - centerY);
  const residualScore = smoothstep(noiseFloor * 0.15, threshold * 0.7, reconstructionResidual);
  const strongTransitionGuard = 1 - smoothstep(threshold * 1.4, threshold * 4, reconstructionResidual);

  const edgeStart = threshold * (2.5 - 1.7 * c.edgeProtection);
  const edgeGuard = 1 - smoothstep(edgeStart, edgeStart * 3.5, edgeMagnitude);
  const textureStart = threshold * (1.55 - 1.2 * c.textureProtection);
  const textureGuard = 1 - smoothstep(textureStart, textureStart * 3.25, localRoughness);
  const intentionalFlatGuard = smoothstep(noiseFloor * 0.3, threshold * 0.9, farSpan);

  const detectorGain = 0.45 + 1.55 * c.detection;
  const bandingMask = clamp01(
    detectorGain * (0.55 * residualScore + 0.45 * contourEvidence) * strongTransitionGuard * edgeGuard * textureGuard * intentionalFlatGuard,
  );
  const protectedDetail = clamp01(1 - edgeGuard * textureGuard);

  const lumaDelta = linearLuma(candidate) - linearLuma(dry);
  const lumaOnly: Px = [dry[0] + lumaDelta, dry[1] + lumaDelta, dry[2] + lumaDelta, dry[3]];
  let repaired = mix(lumaOnly, candidate, c.chromaRepair);
  repaired = mix(dry, repaired, c.strength * bandingMask);

  const ditherMask = clamp01(intentionalFlatGuard * edgeGuard * textureGuard * (0.2 + 0.8 * Math.max(bandingMask, contourEvidence)));
  if (c.dither > 0.000001 && ditherMask > 0.000001) {
    const noiseFrame = c.ditherMotion === 1 ? state.frameIndex : 0;
    const delta = blueNoise(x, y, noiseFrame, c.seed) * state.codeStep * c.dither * ditherMask;
    repaired[0] += delta;
    repaired[1] += delta;
    repaired[2] += delta;
  }
  repaired[3] = dry[3];
  repaired = sanitize(repaired, dry);

  const difference = Math.max(Math.abs(repaired[0] - dry[0]), Math.abs(repaired[1] - dry[1]), Math.abs(repaired[2] - dry[2]));
  return { repaired, bandingMask, protectedDetail, difference };
}

export function debandPixel(sample: IntSampler, x: number, y: number, state: PreparedDeband): Px {
  const dry = sample(x, y);
  const analysis = analyzeDebandPixel(sample, x, y, state);
  let output: Px;
  switch (state.controls.viewMode) {
    case DebandView.BandingMap:
      output = heatMap(analysis.bandingMask, dry[3]);
      break;
    case DebandView.ProtectedDetail: {
      const p = analysis.protectedDetail;
      output = [0.05 + 0.1 * p, 0.15 + 0.7 * p, 0.2 + 0.8 * p, dry[3]];
      break;
    }
    case DebandView.Difference: {
      const r = analysis.repaired;
      output = [0.5 + (r[0] - dry[0]) * 12, 0.5 + (r[1] - dry[1]) * 12, 0.5 + (r[2] - dry[2]) * 12, dry[3]];
      break;
    }
    default:
      output = mix(dry, analysis.repaired, state.controls.outputMix);
      break;
  }
  output[3] = dry[3];
  return sanitize(output, dry);
}

export function renderDebandCpu(image: FloatImage, state: PreparedDeband): FloatImage {
  const sample = makeIntSampler(image);
  const out = new Float32Array(image.width * image.height * 4);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      out.set(debandPixel(sample, x, y, state), (y * image.width + x) * 4);
    }
  }
  return { width: image.width, height: image.height, data: out };
}
