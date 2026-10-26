/**
 * CPU reference of Optics Lab (same math as shader.ts / the C++ core).
 * Used by tests and as a fallback where WebGL2 is unavailable.
 *
 * Images are RGBA float32, row 0 = bottom (OFX convention).
 */
import { opticsAsset, sampleLuma } from './assets.ts';
import type { PreparedOptics } from './model.ts';

export type FloatImage = { width: number; height: number; data: Float32Array };

type Px = [number, number, number, number];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smoothstep = (e0: number, e1: number, v: number) => {
  const t = clamp01((v - e0) / Math.max(0.00001, e1 - e0));
  return t * t * (3 - 2 * t);
};
const luma = (p: Px | number[]) => 0.2627 * p[0] + 0.678 * p[1] + 0.0593 * p[2];

export function makeSampler(image: FloatImage) {
  const { width, height, data } = image;
  return (x: number, y: number): Px => {
    const sx = Math.min(width - 1, Math.max(0, x));
    const sy = Math.min(height - 1, Math.max(0, y));
    const x0 = Math.floor(sx);
    const y0 = Math.floor(sy);
    const x1 = Math.min(width - 1, x0 + 1);
    const y1 = Math.min(height - 1, y0 + 1);
    const tx = sx - x0;
    const ty = sy - y0;
    const i00 = (y0 * width + x0) * 4;
    const i10 = (y0 * width + x1) * 4;
    const i01 = (y1 * width + x0) * 4;
    const i11 = (y1 * width + x1) * 4;
    const u = 1 - tx;
    const v = 1 - ty;
    const out: Px = [0, 0, 0, 0];
    for (let c = 0; c < 4; c += 1) {
      out[c] = (data[i00 + c] * u + data[i10 + c] * tx) * v + (data[i01 + c] * u + data[i11 + c] * tx) * ty;
    }
    return out;
  };
}

export function hashNoise(x: number, y: number, frame: number, seed: number): number {
  let h = Math.imul(x | 0, 0x8da6b343) >>> 0;
  h = (h ^ (Math.imul(y | 0, 0xd8163841) >>> 0)) >>> 0;
  h = (h ^ (Math.imul(frame | 0, 0xcb1ab31f) >>> 0)) >>> 0;
  h = (h ^ (Math.imul(Math.trunc(seed * 4096 + 0.5) >>> 0, 0x165667b1) >>> 0)) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h & 0x00ffffff) / 8388607.5 - 1;
}

function proceduralIris(x: number, y: number, blades: number, roundness: number, rotation: number) {
  if (blades < 3) return clamp01(1 - smoothstep(0.88, 1.02, Math.sqrt(x * x + y * y)));
  const sector = (2 * Math.PI) / blades;
  let theta = Math.atan2(y, x) - rotation;
  theta -= sector * Math.floor(theta / sector + 0.5);
  const polygonRadius = Math.cos(Math.PI / blades) / Math.max(0.05, Math.cos(theta));
  const boundary = polygonRadius * (1 - roundness) + roundness;
  const radius = Math.sqrt(x * x + y * y);
  return clamp01(1 - smoothstep(boundary * 0.82, boundary, radius));
}

const DEFOCUS_OFFSETS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [0.707, 0.707], [-0.707, 0.707], [0.707, -0.707], [-0.707, -0.707],
  [0.383, 0.924], [-0.383, 0.924], [0.383, -0.924], [-0.383, -0.924],
];
const GLOW_OFFSETS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [0.707, 0.707], [-0.707, 0.707], [0.707, -0.707], [-0.707, -0.707],
];

export function opticsLabPixel(sample: (x: number, y: number) => Px, x: number, y: number, state: PreparedOptics): Px {
  const dry = sample(x, y);
  const c = state.controls;
  const model = state.model;
  if (state.amount <= 0.000001 || c.outputMix <= 0.000001 || state.identityOutput) return dry;

  const glass = opticsAsset('glass', state.glassAsset);
  const dirtTex = opticsAsset('dirt', state.dirtAsset);
  const smudgeTex = opticsAsset('smudge', state.smudgeAsset);

  const cx = state.centerX;
  const cy = state.centerY;
  const nx = (x - cx) / Math.max(1, cx);
  const ny = (y - cy) / Math.max(1, cy);
  const ax = nx * state.aspect;
  const radius = Math.sqrt(ax * ax + ny * ny);
  const edge = smoothstep(0.12, 1.1, radius);
  const edge2 = edge * edge;

  let dirX = nx;
  let dirY = ny;
  const dirLength = Math.sqrt(dirX * dirX + dirY * dirY);
  if (dirLength > 0.0001) {
    dirX /= dirLength;
    dirY /= dirLength;
  }
  const tangentX = -dirY;
  const tangentY = dirX;

  const dryY = luma(dry);
  let guard = 0;
  if (state.needsEdgeGuard) {
    const g = Math.abs(luma(sample(x + 1, y)) - luma(sample(x - 1, y))) + Math.abs(luma(sample(x, y + 1)) - luma(sample(x, y - 1)));
    guard = c.edgeGuard * smoothstep(0.045, 0.42, g);
  }

  const swirlAngle = model.swirl * state.amount * edge2 * 0.24;
  let sx = nx;
  let sy = ny;
  if (Math.abs(swirlAngle) > 0.000001) {
    const ca = Math.cos(swirlAngle);
    const sa = Math.sin(swirlAngle);
    sx = nx * ca - ny * sa;
    sy = nx * sa + ny * ca;
  }
  const r2 = radius * radius;
  const radial = 1 + model.distortion * state.amount * r2 + model.distortion * state.amount * 0.28 * r2 * r2;
  const mappingScale = radial * state.breathingScale;
  const fullSrcX = cx + sx * mappingScale * cx;
  const fullSrcY = cy + sy * mappingScale * cy;
  const srcX = x + (fullSrcX - x) * c.outputMix;
  const srcY = y + (fullSrcY - y) * c.outputMix;
  const center = state.identityMapping ? dry : sample(srcX, srcY);

  const result: Px = [center[0], center[1], center[2], dry[3]];
  const caPixels = model.lateralCA * state.amount * edge2 * (1.2 + 2.6 * state.focalScale) * (1 - guard * 0.82);
  if (caPixels > 0.0001) {
    result[0] = sample(srcX + dirX * caPixels, srcY + dirY * caPixels)[0];
    result[2] = sample(srcX - dirX * caPixels, srcY - dirY * caPixels)[2];
  }

  const curvatureBlur = model.fieldCurvature * state.amount * edge2 * (1 - guard * 0.78) * 4;
  const astigBlur = model.astigmatism * state.amount * edge2 * (1 - guard * 0.78) * 3.2;
  const sphericalBlur = model.spherical * state.amount * (0.3 + edge * 0.7) * (1 - guard * 0.72) * 2.8;
  if (curvatureBlur + astigBlur + sphericalBlur > 0.001) {
    const rr = curvatureBlur + sphericalBlur;
    const tr = astigBlur + sphericalBlur * 0.72;
    const a = sample(srcX + dirX * rr, srcY + dirY * rr);
    const b = sample(srcX - dirX * rr, srcY - dirY * rr);
    const ta = sample(srcX + tangentX * tr, srcY + tangentY * tr);
    const tb = sample(srcX - tangentX * tr, srcY - tangentY * tr);
    const blurMix = clamp01((curvatureBlur + astigBlur + sphericalBlur) * 0.22);
    for (let k = 0; k < 3; k += 1) {
      const blur = (center[k] * 2 + a[k] + b[k] + ta[k] + tb[k]) / 6;
      result[k] = result[k] * (1 - blurMix) + blur * blurMix;
    }
  }

  const axialStrength = model.axialCA * state.amount * state.apertureScale * (1 - guard * 0.72);
  if (axialStrength > 0.0001) {
    const ar = 1 + axialStrength * 5;
    const p = [sample(srcX - ar, srcY), sample(srcX + ar, srcY), sample(srcX, srcY - ar), sample(srcX, srcY + ar)];
    const br = (p[0][0] + p[1][0] + p[2][0] + p[3][0]) * 0.25;
    const bb = (p[0][2] + p[1][2] + p[2][2] + p[3][2]) * 0.25;
    result[0] = result[0] * (1 - axialStrength * 0.22) + br * axialStrength * 0.22;
    result[2] = result[2] * (1 - axialStrength * 0.34) + bb * axialStrength * 0.34;
  }

  const comaStrength = model.coma * state.amount * edge2 * state.apertureScale * (1 - guard * 0.88);
  if (comaStrength > 0.0001) {
    const comet = [0, 0, 0];
    let weightSum = 0;
    for (let i = 1; i <= state.comaSamples; i += 1) {
      const spread = i * (1 + comaStrength * 4.5);
      const p = sample(srcX + tangentX * spread + dirX * spread * 0.48, srcY + tangentY * spread + dirY * spread * 0.48);
      const hot = smoothstep(c.bloomThreshold * 0.72, c.bloomThreshold + 0.75, luma(p));
      const w = hot / i;
      comet[0] += p[0] * w;
      comet[1] += p[1] * w;
      comet[2] += p[2] * w;
      weightSum += w;
    }
    if (weightSum > 0.0001) {
      const amount = (comaStrength * 0.34) / weightSum;
      result[0] += comet[0] * amount;
      result[1] += comet[1] * amount * 0.86;
      result[2] += comet[2] * amount * 0.72;
    }
  }

  let signedDepthError = c.focusOffset;
  if (c.depthSource === 1) {
    let depth = clamp01((clamp01(dry[3]) - c.depthNear) / (c.depthFar - c.depthNear));
    if (c.depthInvert) depth = 1 - depth;
    depth = Math.pow(Math.max(0.000001, depth), c.depthGamma);
    signedDepthError = depth - c.focusPlane;
  }
  const depthError = Math.abs(signedDepthError);
  const mirror = signedDepthError < 0 ? -1 : 1;
  const defocusStrength = model.defocus * state.amount * state.apertureScale * clamp01(depthError) * (1 - guard * 0.55);
  if (defocusStrength > 0.0005) {
    const radiusPx = Math.min(18, 0.75 + defocusStrength * 16);
    const squeeze = c.anamorphicSqueeze;
    const catEye = model.catEye * edge2;
    const horizontal = radiusPx * squeeze * (1 - catEye * 0.18);
    const vertical = (radiusPx / squeeze) * (1 - catEye * 0.52);
    const blur = [center[0] * 2, center[1] * 2, center[2] * 2];
    let weightSum = 2;
    for (let i = 0; i < state.defocusSamples; i += 1) {
      const [o0, o1] = DEFOCUS_OFFSETS[i];
      const ex = o0 * horizontal;
      const ey = o1 * vertical;
      const ox = ex * state.anamorphicCos - ey * state.anamorphicSin - dirX * catEye * radiusPx * 0.45 * mirror;
      const oy = ex * state.anamorphicSin + ey * state.anamorphicCos - dirY * catEye * radiusPx * 0.45 * mirror;
      const p = sample(srcX + ox, srcY + oy);
      let w = 1;
      if (glass) {
        w = 1 + (0.15 + sampleLuma(glass, o0 * 0.5 + 0.5, o1 * 0.5 + 0.5) * 1.7 - 1) * c.apertureInfluence;
      } else if (state.irisBlades >= 3) {
        const aw = proceduralIris(o0, o1, state.irisBlades, state.irisRoundness, state.irisRotation + (mirror < 0 ? Math.PI : 0));
        w = 1 + (0.15 + aw * 1.7 - 1) * c.apertureInfluence;
      }
      blur[0] += p[0] * w;
      blur[1] += p[1] * w;
      blur[2] += p[2] * w;
      weightSum += w;
    }
    const m = clamp01(defocusStrength * 1.24);
    for (let k = 0; k < 3; k += 1) result[k] = result[k] * (1 - m) + (blur[k] / weightSum) * m;
  }

  const bloomStrength = model.bloom * state.amount;
  const diffusionStrength = model.diffusion * state.amount;
  const halationStrength = model.halation * state.amount;
  if (bloomStrength + diffusionStrength + halationStrength > 0.0001) {
    const radiusPx = 2 + diffusionStrength * 10 + bloomStrength * 6;
    const glow = [0, 0, 0];
    let hotWeight = 0;
    for (let i = 0; i < state.glowSamples; i += 1) {
      const p = sample(srcX + GLOW_OFFSETS[i][0] * radiusPx, srcY + GLOW_OFFSETS[i][1] * radiusPx);
      const hot = smoothstep(c.bloomThreshold, c.bloomThreshold + 0.85, luma(p));
      glow[0] += p[0] * hot;
      glow[1] += p[1] * hot;
      glow[2] += p[2] * hot;
      hotWeight += hot;
    }
    if (hotWeight > 0.0001) {
      for (let k = 0; k < 3; k += 1) glow[k] /= hotWeight;
      const bloomAmount = bloomStrength * 0.34;
      const dm = clamp01(diffusionStrength * 0.42);
      const halo = halationStrength * 0.23;
      const tint = [1, 0.34, 0.1];
      for (let k = 0; k < 3; k += 1) {
        result[k] += glow[k] * bloomAmount;
        result[k] = result[k] * (1 - dm) + glow[k] * dm;
        result[k] += glow[k] * halo * tint[k];
      }
    }
  }

  const ghostStrength = model.flareGhosts * state.amount;
  if (ghostStrength > 0.0001) {
    const k = 0.42 + edge * 0.28;
    const ghost = sample(cx - (srcX - cx) * k, cy - (srcY - cy) * k);
    const hot = smoothstep(c.bloomThreshold, c.bloomThreshold + 1, luma(ghost));
    const amount = hot * ghostStrength * 0.22;
    result[0] += ghost[0] * amount * (1.05 + model.warmth);
    result[1] += ghost[1] * amount * 0.74;
    result[2] += ghost[2] * amount * (0.9 - model.warmth * 0.5);
  }

  const streakStrength = model.flareStreak * state.amount;
  if (streakStrength > 0.0001) {
    const sr = 5 + streakStrength * 28;
    const stx = state.anamorphicCos * sr;
    const sty = state.anamorphicSin * sr;
    const left = sample(srcX - stx, srcY - sty);
    const right = sample(srcX + stx, srcY + sty);
    const hl = smoothstep(c.bloomThreshold, c.bloomThreshold + 0.9, luma(left));
    const hr = smoothstep(c.bloomThreshold, c.bloomThreshold + 0.9, luma(right));
    const amount = streakStrength * 0.15;
    result[0] += (left[0] * hl + right[0] * hr) * amount * 0.3;
    result[1] += (left[1] * hl + right[1] * hr) * amount * 0.55;
    result[2] += (left[2] * hl + right[2] * hr) * amount;
  }

  const physicalStarGate = smoothstep(8, 22, c.fStop);
  const starResponse = 1 - state.starGate + state.starGate * physicalStarGate;
  const starStrength = model.starburst * state.amount * starResponse;
  if (starStrength > 0.0001) {
    const starRadius = 4 + starStrength * 18;
    const star = [0, 0, 0];
    let spokeCount = 4;
    if (state.irisBlades >= 3) {
      spokeCount = state.irisBlades % 2 === 0 ? state.irisBlades : state.irisBlades * 2;
      spokeCount = Math.min(spokeCount, state.maxStarSpokes);
    }
    for (let spoke = 0; spoke < spokeCount; spoke += 1) {
      const angle = state.irisRotation + (spoke / Math.max(1, spokeCount)) * Math.PI * 2;
      const uneven = 1 + state.starUnevenness * Math.sin(spoke * 17 + 3) * 0.28;
      const ray = sample(srcX + Math.cos(angle) * starRadius * uneven, srcY + Math.sin(angle) * starRadius * uneven);
      star[0] += ray[0];
      star[1] += ray[1];
      star[2] += ray[2];
    }
    const hot = smoothstep(c.bloomThreshold * 4, c.bloomThreshold * 4 + 2, luma(star));
    const amount = (starStrength * hot * 0.22) / Math.max(1, spokeCount);
    for (let k = 0; k < 3; k += 1) result[k] += star[k] * amount;
  }

  const sensorStrength = model.debayer * state.amount;
  const chromaStrength = model.chromaSmear * state.amount;
  if (sensorStrength + chromaStrength > 0.0001) {
    const sr = 1 + 1.8 * sensorStrength;
    const a = sample(srcX - sr, srcY);
    const b = sample(srcX + sr, srcY);
    const cb = [(a[0] + b[0]) * 0.5, center[1], (a[2] + b[2]) * 0.5];
    result[0] = result[0] * (1 - sensorStrength * 0.3) + cb[0] * sensorStrength * 0.3;
    result[2] = result[2] * (1 - sensorStrength * 0.36) + cb[2] * sensorStrength * 0.36;
    const yValue = luma(result);
    const smearMix = clamp01(chromaStrength * 0.32);
    const cbY = luma(cb);
    result[0] = result[0] * (1 - smearMix) + (yValue + (cb[0] - cbY) * 0.72) * smearMix;
    result[2] = result[2] * (1 - smearMix) + (yValue + (cb[2] - cbY) * 0.72) * smearMix;
  }

  const vignetteGain = Math.max(0, 1 - model.vignette * state.amount * edge2 * 0.58);
  result[0] *= vignetteGain;
  result[1] *= vignetteGain;
  result[2] *= vignetteGain;

  if (dirtTex && c.dirtAmount > 0.0001) {
    const u = (((x + 0.5) / state.width) * c.dirtScale) % 1;
    const v = (((y + 0.5) / state.height) * c.dirtScale) % 1;
    const dirt = clamp01(sampleLuma(dirtTex, u, v));
    const hot = smoothstep(c.bloomThreshold * 0.72, c.bloomThreshold + 0.9, dryY);
    const mask = dirt * c.dirtAmount * state.amount;
    const t = 1 - mask * (0.1 + hot * 0.24);
    result[0] = result[0] * t + mask * hot * 0.03 * (1 + model.warmth);
    result[1] = result[1] * t + mask * hot * 0.018;
    result[2] = result[2] * t + mask * hot * 0.01;
  }

  if (smudgeTex && c.smudgeAmount > 0.0001) {
    const u = (((x + 0.5) / state.width) * c.smudgeScale) % 1;
    const v = (((y + 0.5) / state.height) * c.smudgeScale) % 1;
    const smudge = clamp01(sampleLuma(smudgeTex, u, v));
    const hot = smoothstep(c.bloomThreshold * 0.68, c.bloomThreshold + 0.82, dryY);
    const mask = smudge * c.smudgeAmount * state.amount;
    const t = 1 - mask * (0.07 + hot * 0.18);
    result[0] = result[0] * t + mask * hot * 0.024 * (1 + model.warmth * 0.5);
    result[1] = result[1] * t + mask * hot * 0.019;
    result[2] = result[2] * t + mask * hot * 0.016;
  }

  const grainStrength = model.grain * state.amount * state.isoGrainScale;
  if (grainStrength > 0.0001) {
    const gx = Math.trunc(x / c.grainSize);
    const gy = Math.trunc(y / c.grainSize);
    const mono = hashNoise(gx, gy, state.frameIndex, c.grainSeed);
    const animated = hashNoise(gx + 13, gy - 7, state.frameIndex, c.grainSeed + 17);
    const noise = mono * 0.72 + animated * 0.28;
    const mask = 0.38 + 0.62 * (1 - smoothstep(0.18, 1.2, Math.max(0, dryY)));
    const amount = grainStrength * mask * 0.055;
    result[0] += noise * amount * 1.03;
    result[1] += noise * amount;
    result[2] += noise * amount * 1.08;
  }

  const m = c.outputMix;
  const out: Px = [0, 0, 0, dry[3]];
  for (let k = 0; k < 3; k += 1) {
    const v = center[k] * (1 - m) + result[k] * m;
    out[k] = Number.isFinite(v) ? v : dry[k];
  }
  return out;
}

export function renderOpticsLabCpu(image: FloatImage, state: PreparedOptics): FloatImage {
  const sample = makeSampler(image);
  const out = new Float32Array(image.width * image.height * 4);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const p = opticsLabPixel(sample, x, y, state);
      const i = (y * image.width + x) * 4;
      out[i] = p[0];
      out[i + 1] = p[1];
      out[i + 2] = p[2];
      out[i + 3] = p[3];
    }
  }
  return { width: image.width, height: image.height, data: out };
}
