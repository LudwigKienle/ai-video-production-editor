/**
 * Deband parity kit: the synthetic frame and cases shared by the golden tests
 * (CPU reference vs the original C++ core, see scripts/fx-probes/deband-probe.cpp)
 * and the fx-lab GPU-vs-CPU check. `cases` mirrors __fixtures__/cases.txt
 * (enforced by deband.test.ts).
 */
import type { FxParamValues } from '../../types.ts';
import { renderDebandCpu, type FloatImage } from './cpu.ts';
import { controlsFromParams, prepareDeband } from './model.ts';

const W = 64;
const H = 32;

const clampCode = (v: number) => Math.min(255, Math.max(0, v));

/**
 * Shallow 8-bit quantised diagonal gradient (bands ~5 px wide), an
 * intentional flat strip (x < 6), a hard-edged block and a textured strip
 * (y >= 26). Row 0 = bottom. Identical to the probe's `Img`.
 */
export function debandTestImage(): FloatImage {
  const data = new Float32Array(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const t = 2 * x + y;
      let r = 76 + Math.trunc(t / 10);
      let g = 80 + Math.trunc(t / 12);
      let b = 90 + Math.trunc(x / 16);
      if (x < 6) r = g = b = 70;
      if (x >= 46 && x <= 54 && y >= 10 && y <= 20) {
        r += 110;
        g += 100;
        b += 90;
      }
      if (y >= 26) {
        const n = ((x * 7 + y * 13) % 5) - 2;
        r += 3 * n;
        g += 3 * n;
        b += 3 * n;
      }
      const i = (y * W + x) * 4;
      data[i] = clampCode(r) / 255;
      data[i + 1] = clampCode(g) / 255;
      data[i + 2] = clampCode(b) / 255;
      data[i + 3] = 1;
    }
  }
  return { width: W, height: H, data };
}

export type ParityCase = { name: string; params: FxParamValues; frameIndex: number };

export const DEBAND_CASES: ParityCase[] = [
  { name: 'balanced', params: { preset: 0 }, frameIndex: 0 },
  { name: 'subtle-10bit', params: { preset: 1 }, frameIndex: 0 },
  { name: 'sky-8bit', params: { preset: 2 }, frameIndex: 0 },
  { name: 'ai-footage', params: { preset: 3 }, frameIndex: 0 },
  { name: 'heavy-compression', params: { preset: 4 }, frameIndex: 0 },
  {
    name: 'manual-strong',
    params: { preset: 5, strength: 1, detection: 0.9, radius: 12, edgeProtection: 0.4, textureProtection: 0.3, chromaRepair: 0.8, dither: 0.6 },
    frameIndex: 0,
  },
  { name: 'banding-map', params: { preset: 2, viewMode: 1 }, frameIndex: 0 },
  { name: 'protected-detail', params: { preset: 0, viewMode: 2 }, frameIndex: 0 },
  { name: 'difference', params: { preset: 4, viewMode: 3 }, frameIndex: 0 },
  { name: 'scene-linear', params: { preset: 5, workingSpace: 3, sourcePrecision: 3, radius: 20, detection: 1 }, frameIndex: 0 },
  { name: 'frame-dither', params: { preset: 5, sourcePrecision: 1, ditherMotion: 1, seed: 37, dither: 1, outputMix: 0.6 }, frameIndex: 5 },
  { name: 'zero-strength', params: { preset: 5, strength: 0 }, frameIndex: 0 },
];

export const DEBAND_PARITY = {
  effectId: 'buckswood-post-plugins.deband',
  width: W,
  height: H,
  image: debandTestImage,
  cases: DEBAND_CASES,
  cpu: (image: FloatImage, params: FxParamValues, frameIndex: number): FloatImage =>
    renderDebandCpu(image, prepareDeband({ width: image.width, height: image.height, frameIndex }, controlsFromParams(params))),
};
