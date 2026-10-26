/**
 * CPU reference of Lens Physics (same math as shader.ts / the C++ core
 * `LensPhysicsCore::processPixel`, LensPhysicsCore.h). Used by tests, the
 * fx-lab parity page and as a fallback where WebGL2 is unavailable.
 *
 * Images are RGBA float32, row 0 = bottom (OFX convention).
 */
import { sourceLooksLikeBlankAdjustment } from '../postPluginsCommon/adjustmentGuard.ts';
import type { FloatImage } from '../opticsLab/cpu.ts';
import type { LensModel, PreparedLensPhysics } from './model.ts';

export type { FloatImage };

type Px = [number, number, number, number];
type Sampler = (x: number, y: number) => Px;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const clamp = (v: number, low: number, high: number) => Math.min(high, Math.max(low, v));
const smoothstep = (e0: number, e1: number, v: number) => {
  const t = clamp01((v - e0) / Math.max(0.0001, e1 - e0));
  return t * t * (3 - 2 * t);
};
const luma = (p: Px) => 0.2627 * p[0] + 0.678 * p[1] + 0.0593 * p[2];
const safeDiv = (a: number, b: number) => (b === 0 ? 0 : a / b);
const mixPx = (a: Px, b: Px, t: number): Px => {
  const u = 1 - t;
  return [a[0] * u + b[0] * t, a[1] * u + b[1] * t, a[2] * u + b[2] * t, a[3] * u + b[3] * t];
};

/**
 * The OFX plugin's FloatSampler: bilinear, but transparent black for any
 * coordinate outside [0, w-1] × [0, h-1] — no edge clamping. This differs from
 * the engine's clamped `bw_sample` on purpose (it is what Resolve renders).
 */
export function makeLensSampler(image: FloatImage): Sampler {
  const { width, height, data } = image;
  const maxX = width - 1;
  const maxY = height - 1;
  return (x: number, y: number): Px => {
    if (!(x >= 0 && x <= maxX && y >= 0 && y <= maxY)) return [0, 0, 0, 0];
    const x0 = Math.trunc(x);
    const y0 = Math.trunc(y);
    const x1 = Math.min(maxX, x0 + 1);
    const y1 = Math.min(maxY, y0 + 1);
    const tx = x - x0;
    const ty = y - y0;
    const u = 1 - tx;
    const v = 1 - ty;
    const i00 = (y0 * width + x0) * 4;
    const i10 = (y0 * width + x1) * 4;
    const i01 = (y1 * width + x0) * 4;
    const i11 = (y1 * width + x1) * 4;
    const out: Px = [0, 0, 0, 0];
    for (let c = 0; c < 4; c += 1) {
      out[c] = (data[i00 + c] * u + data[i10 + c] * tx) * v + (data[i01 + c] * u + data[i11 + c] * tx) * ty;
    }
    return out;
  };
}

const BLOOM_OFFSETS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [0.707, 0.707], [-0.707, 0.707], [0.707, -0.707], [-0.707, -0.707],
] as const;

function applyRadialLens(
  sample: Sampler,
  srcX: number,
  srcY: number,
  dirX: number,
  dirY: number,
  tangentX: number,
  tangentY: number,
  radius: number,
  model: LensModel,
  bloomThreshold: number,
  edgeHaloGuard: number,
  overdrive: number,
): Px {
  const edge = smoothstep(0.16, 1.1, radius);

  const center = sample(srcX, srcY);
  const l = sample(srcX - 1, srcY);
  const r = sample(srcX + 1, srcY);
  const u = sample(srcX, srcY - 1);
  const d = sample(srcX, srcY + 1);
  const gradient = Math.abs(luma(r) - luma(l)) + Math.abs(luma(d) - luma(u));
  const centerY = luma(center);
  const silhouetteRisk = smoothstep(0.2, 0.72, gradient) * (1 - smoothstep(0.12, 0.46, centerY));
  const silhouetteGuard = 1 - silhouetteRisk * (0.72 + clamp01(edgeHaloGuard) * 0.22);
  const od = Math.max(0, overdrive);
  const caPx = model.chromaticAberration * od * edge * edge * 4.2 * silhouetteGuard;
  const red = sample(srcX + dirX * caPx, srcY + dirY * caPx);
  const blue = sample(srcX - dirX * caPx, srcY - dirY * caPx);
  const rgb: Px = [red[0], center[1], blue[2], center[3]];

  const fringe = clamp01(model.fringing * od * edge * gradient * 1.32 * silhouetteGuard);
  rgb[0] += fringe * (0.08 + 0.05 * edge);
  rgb[1] -= fringe * 0.035;
  rgb[2] += fringe * (0.04 + 0.04 * edge);

  const threshold = Math.max(0.35, bloomThreshold);
  const bloomStrength = clamp01(model.bloom * od);
  if (bloomStrength > 0.0001) {
    const bloom = [0, 0, 0];
    let weightSum = 0;
    const radiusPx = 2 + bloomStrength * 8;
    for (const [ox, oy] of BLOOM_OFFSETS) {
      const p = sample(srcX + ox * radiusPx, srcY + oy * radiusPx);
      const hot = clamp01((luma(p) - threshold) / Math.max(0.001, 1 - threshold));
      const w = hot * hot;
      bloom[0] += p[0] * w;
      bloom[1] += p[1] * w;
      bloom[2] += p[2] * w;
      weightSum += w;
    }
    if (weightSum > 0.0001) {
      const inv = 1 / weightSum;
      const hotCenter = clamp01((luma(center) - threshold) / Math.max(0.001, 1 - threshold));
      const amount = bloomStrength * (0.18 + 0.42 * hotCenter) * silhouetteGuard;
      rgb[0] += bloom[0] * inv * amount;
      rgb[1] += bloom[1] * inv * amount;
      rgb[2] += bloom[2] * inv * amount;
    }
  }

  const comaStrength = clamp01(model.coma * od) * edge * edge * silhouetteGuard;
  if (comaStrength > 0.0001) {
    const comet = [0, 0, 0];
    let weightSum = 0;
    for (let i = 1; i <= 5; i += 1) {
      const spread = i * (1.2 + comaStrength * 4);
      const tx = tangentX * spread + dirX * spread * 0.55;
      const ty = tangentY * spread + dirY * spread * 0.55;
      const p = sample(srcX + tx, srcY + ty);
      const hot = clamp01((luma(p) - 0.58) / 0.42);
      const w = hot * (1 / i);
      comet[0] += p[0] * w;
      comet[1] += p[1] * w;
      comet[2] += p[2] * w;
      weightSum += w;
    }
    if (weightSum > 0.0001) {
      const inv = 1 / weightSum;
      rgb[0] += comet[0] * inv * comaStrength * 0.34;
      rgb[1] += comet[1] * inv * comaStrength * 0.24;
      rgb[2] += comet[2] * inv * comaStrength * 0.18;
    }
  }
  return rgb;
}

export function lensPhysicsPixel(sample: Sampler, x: number, y: number, state: PreparedLensPhysics): Px {
  const dry = sample(x, y);
  const model = state.model;
  const controls = state.controls;
  const rawOverdrive = state.rawOverdrive;
  const baseOd = state.baseOverdrive;
  const cx = state.centerX;
  const cy = state.centerY;
  const nx = safeDiv(x - cx, cx);
  const ny = safeDiv(y - cy, cy);
  const ax = nx * state.aspect;
  const radius = Math.sqrt(ax * ax + ny * ny);
  const edge = smoothstep(0.18, 1.18, radius);

  let dirX = nx;
  let dirY = ny;
  const dirLen = Math.sqrt(dirX * dirX + dirY * dirY);
  if (dirLen > 0.0001) {
    dirX /= dirLen;
    dirY /= dirLen;
  }
  const tangentX = -dirY;
  const tangentY = dirX;

  const dryY = luma(dry);
  const dryLeftY = luma(sample(x - 1, y));
  const dryRightY = luma(sample(x + 1, y));
  const dryUpY = luma(sample(x, y - 1));
  const dryDownY = luma(sample(x, y + 1));
  const neighborMinY = Math.min(Math.min(dryLeftY, dryRightY), Math.min(dryUpY, dryDownY));
  const neighborMaxY = Math.max(Math.max(dryLeftY, dryRightY), Math.max(dryUpY, dryDownY));
  const localSpan = Math.max(neighborMaxY, dryY) - Math.min(neighborMinY, dryY);
  const crossGradient =
    Math.abs(dryRightY - dryLeftY) +
    Math.abs(dryDownY - dryUpY) +
    Math.abs(dryY - dryLeftY) * 0.5 +
    Math.abs(dryY - dryRightY) * 0.5 +
    Math.abs(dryY - dryUpY) * 0.5 +
    Math.abs(dryY - dryDownY) * 0.5;
  const edgeRisk = smoothstep(0.035, 0.26, localSpan + crossGradient * 0.26);
  const darkSilhouette = (1 - smoothstep(0.1, 0.44, dryY)) * smoothstep(0.1, 0.42, neighborMaxY - dryY);
  const brightSilhouette = smoothstep(0.54, 0.9, dryY) * smoothstep(0.1, 0.42, dryY - neighborMinY);
  const contourRisk = smoothstep(0.065, 0.34, neighborMaxY - neighborMinY);
  const silhouetteRisk = clamp01(edgeRisk * (0.34 + 0.46 * Math.max(darkSilhouette, brightSilhouette) + 0.2 * contourRisk));
  const overdrivePressure = smoothstep(0.18, 0.85, clamp01(rawOverdrive));
  const edgeGuard = clamp01(controls.edgeHaloGuard) * silhouetteRisk * (0.42 + 0.58 * overdrivePressure);
  const opticalOd = baseOd * (1 - edgeGuard * (0.62 + 0.24 * overdrivePressure));
  const od = baseOd;

  const swirlAngle = model.swirl * od * edge * edge * 0.22;
  const cosA = Math.cos(swirlAngle);
  const sinA = Math.sin(swirlAngle);
  const sx = nx * cosA - ny * sinA;
  const sy = nx * sinA + ny * cosA;

  const r2 = radius * radius;
  const radialScale = 1 + model.distortion * od * r2 + model.distortion * od * 0.35 * r2 * r2;
  const srcX = cx + sx * radialScale * cx;
  const srcY = cy + sy * radialScale * cy;

  let rgb = applyRadialLens(
    sample, srcX, srcY, dirX, dirY, tangentX, tangentY, radius, model,
    controls.bloomThreshold, controls.edgeHaloGuard, opticalOd,
  );

  const vignette = clamp01(model.vignette * od) * edge * edge;
  const vignetteGain = 1 - vignette * 0.46;
  rgb[0] *= vignetteGain;
  rgb[1] *= vignetteGain;
  rgb[2] *= vignetteGain;

  const corner = clamp01(model.cornerColor * od) * edge * edge;
  rgb[0] += corner * (model.warmBias + 0.025);
  rgb[1] += corner * 0.006;
  rgb[2] += corner * (model.blueBias - 0.018);

  if (model.sharpener !== 0) {
    const c = sample(srcX, srcY);
    const b1 = sample(srcX - 1.4, srcY);
    const b2 = sample(srcX + 1.4, srcY);
    const b3 = sample(srcX, srcY - 1.4);
    const b4 = sample(srcX, srcY + 1.4);
    const sharp = model.sharpener * od * 0.32 * (1 - edgeGuard * 0.86);
    for (let k = 0; k < 3; k += 1) {
      const blur = (b1[k] + b2[k] + b3[k] + b4[k]) * 0.25;
      rgb[k] += (c[k] - blur) * sharp;
    }
  }

  if (edgeGuard > 0.0001) {
    const maxDelta = 0.055 + (1 - edgeGuard) * 0.24 + localSpan * 0.18;
    const deltaClamped: Px = [
      dry[0] + clamp(rgb[0] - dry[0], -maxDelta, maxDelta),
      dry[1] + clamp(rgb[1] - dry[1], -maxDelta, maxDelta),
      dry[2] + clamp(rgb[2] - dry[2], -maxDelta, maxDelta),
      dry[3],
    ];
    const minAllowedY = clamp01(Math.min(neighborMinY, dryY) - (0.025 + localSpan * 0.1));
    const maxAllowedY = clamp01(Math.max(neighborMaxY, dryY) + (0.025 + localSpan * 0.1));
    const clampedY = luma(deltaClamped);
    if (clampedY < minAllowedY || clampedY > maxAllowedY) {
      const correction = clamp(clampedY, minAllowedY, maxAllowedY) - clampedY;
      deltaClamped[0] += correction;
      deltaClamped[1] += correction;
      deltaClamped[2] += correction;
    }
    rgb = mixPx(rgb, deltaClamped, edgeGuard);
    rgb = mixPx(rgb, dry, edgeGuard * 0.22);
  }

  return [clamp01(rgb[0]), clamp01(rgb[1]), clamp01(rgb[2]), dry[3]];
}

/** Whole-frame render including the OFX adjustment-layer guard. */
export function renderLensPhysicsCpu(image: FloatImage, state: PreparedLensPhysics): FloatImage {
  const { width, height } = image;
  const data = new Float32Array(width * height * 4);
  if (state.controls.adjustmentLayerGuard && sourceLooksLikeBlankAdjustment(image)) {
    return { width, height, data };
  }
  const sample = makeLensSampler(image);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data.set(lensPhysicsPixel(sample, x, y, state), (y * width + x) * 4);
    }
  }
  return { width, height, data };
}
