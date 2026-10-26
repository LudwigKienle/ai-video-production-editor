/**
 * CPU reference of AI Photorealizer (same math as shader.ts and
 * `PhotorealizerCore::processPixel`, src/PhotorealizerCore.cpp). Used by
 * tests, the fx-lab parity page and as a fallback without WebGL2.
 *
 * Images are RGBA float32, row 0 = bottom (OFX convention).
 */
import { sourceLooksLikeBlankAdjustment } from '../postPluginsCommon/adjustmentGuard.ts';
import type { FloatImage } from '../opticsLab/cpu.ts';
import { PHOTOREALIZER_DEFAULT_MASKS, type PreparedPhotorealizer } from './model.ts';

export type { FloatImage };

type Px = [number, number, number, number];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const luma = (r: number, g: number, b: number) => 0.2627 * r + 0.678 * g + 0.0593 * b;

/** `PhotorealizerCore::hash01` — uint32 arithmetic via Math.imul. */
export function hash01(x: number, y: number, z: number): number {
  let h = (Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663) ^ Math.imul(z | 0, 83492791)) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h & 0x00ffffff) / 16777216;
}

function softClip(value: number, knee: number, amount: number): number {
  if (value <= knee) return value;
  const over = value - knee;
  return knee + over / (1 + over * amount * 8);
}

function skinWeight(r: number, g: number, b: number): number {
  if (!(r > g && g > b)) return 0;
  const rg = r - g;
  const gb = g - b;
  const warm = (rg * gb) / (r * r + 0.001);
  const exposure = clamp01(1 - Math.abs(luma(r, g, b) - 0.52) / 0.42);
  return clamp01(warm * 3) * exposure;
}

export function photorealizerPixel(input: Px, x: number, y: number, state: PreparedPhotorealizer): Px {
  const c = state.controls;
  const masks = PHOTOREALIZER_DEFAULT_MASKS;
  let [r, g, b] = input;

  const lum0 = luma(r, g, b);
  const skin = clamp01(Math.max(masks.skin, skinWeight(r, g, b)) * c.skinRealism);
  const plastic = clamp01(masks.plastic * c.plasticReduction);
  const highlight = clamp01(Math.max(masks.highlight, (lum0 - 0.62) / 0.28));

  const chromaR = r - lum0;
  const chromaG = g - lum0;
  const chromaB = b - lum0;
  const chroma = Math.abs(chromaR) + Math.abs(chromaG) + Math.abs(chromaB);

  const neon = clamp01((chroma - 0.22) / 0.42);
  const gamutCompress = neon * c.gamutGuard;
  r = lum0 + chromaR * (1 - 0.38 * gamutCompress);
  g = lum0 + chromaG * (1 - 0.3 * gamutCompress);
  b = lum0 + chromaB * (1 - 0.34 * gamutCompress);

  r += 0.018 * skin;
  g += 0.007 * skin;
  b -= 0.02 * skin;

  const lum1 = luma(r, g, b);
  const pivot = 0.42;
  const contrast = 1 + c.microContrast * 0.18;
  const shaped = pivot + (lum1 - pivot) * contrast;
  r += shaped - lum1;
  g += shaped - lum1;
  b += shaped - lum1;

  const roll = c.highlightRealism * (0.45 + 0.55 * highlight);
  r = softClip(r, 0.74, roll);
  g = softClip(g, 0.74, roll);
  b = softClip(b, 0.74, roll);

  const lum2 = luma(r, g, b);
  const shadowMask = clamp01((0.42 - lum2) / 0.42);
  r *= 1 - shadowMask * c.shadowDepth * 0.07;
  g *= 1 - shadowMask * c.shadowDepth * 0.06;
  b *= 1 - shadowMask * c.shadowDepth * 0.04;

  const seed = state.textureSeed;
  const n1 = hash01(x, y, seed) - 0.5;
  const n2 = hash01(x + 19, y - 7, seed + 113) - 0.5;
  const n3 = hash01(x - 5, y + 23, seed + 271) - 0.5;
  const textureMask = clamp01((0.2 + plastic * 0.65 + c.smoothnessBreakup * 0.35) * masks.detail);
  const texture = c.textureAmount * textureMask * 0.018;
  r += n1 * texture;
  g += n2 * texture;
  b += n3 * texture;

  const lum3 = luma(r, g, b);
  const naturalSat = 1 - c.colorNaturalize * (0.08 + neon * 0.22 + highlight * 0.12);
  r = clamp01(lum3 + (r - lum3) * naturalSat);
  g = clamp01(lum3 + (g - lum3) * naturalSat);
  b = clamp01(lum3 + (b - lum3) * naturalSat);

  const t = clamp01(c.outputMix);
  const u = 1 - t;
  return [input[0] * u + r * t, input[1] * u + g * t, input[2] * u + b * t, input[3] * u + input[3] * t];
}

/** Whole-frame render including the OFX adjustment-layer guard. */
export function renderPhotorealizerCpu(image: FloatImage, state: PreparedPhotorealizer): FloatImage {
  const { width, height, data: src } = image;
  const data = new Float32Array(width * height * 4);
  if (state.controls.adjustmentLayerGuard && sourceLooksLikeBlankAdjustment(image)) {
    return { width, height, data };
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      data.set(photorealizerPixel([src[i], src[i + 1], src[i + 2], src[i + 3]], x, y, state), i);
    }
  }
  return { width, height, data };
}
