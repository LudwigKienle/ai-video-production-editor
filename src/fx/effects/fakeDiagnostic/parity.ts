/**
 * Fake Diagnostic parity kit: synthetic frames and cases shared by the golden
 * tests (CPU reference vs the original C++ core, see
 * scripts/fx-probes/fake-diagnostic-probe.cpp) and the fx-lab GPU-vs-CPU check.
 *
 * `FAKE_DIAGNOSTIC_FILE_CASES` mirrors __fixtures__/cases.txt (enforced by the
 * test). The parity `cases` exclude the blank-frame cases (`image: 1`) because
 * the parity contract has a single `image()`; the guard is covered by the
 * golden tests.
 */
import type { FxParamValues } from '../../types.ts';
import { renderFakeDiagnosticCpu, type FloatImage } from './cpu.ts';
import { controlsFromParams, prepareFake } from './model.ts';

const W = 48;
const H = 32;

/**
 * kind 0: smooth saturated midtones (left), a textured half (right), a
 * saturated red block, a clipped highlight with an HDR core (1.25) and
 * half-transparent bottom rows. kind 1: near-black opaque "adjustment layer".
 * Row 0 = bottom. Identical to the probe's `Img`.
 */
export function fakeDiagnosticTestImage(kind: 0 | 1 = 0): FloatImage {
  const data = new Float32Array(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * 4;
      if (kind === 1) {
        data.fill(((x + y) % 7 === 0 ? 3 : 2) / 255, i, i + 3);
        data[i + 3] = 1;
        continue;
      }
      let r: number;
      let g: number;
      let b: number;
      if (x < 24) {
        r = 140 + x;
        g = 97 + y;
        b = 77;
      } else {
        const n = ((x * 37 + y * 61) % 17) - 8;
        r = g = b = 115 + 3 * n;
      }
      if (x >= 4 && x <= 12 && y >= 22 && y <= 29) {
        r = 250;
        g = 20;
        b = 10;
      }
      const d2 = (x - 36) ** 2 + (y - 22) ** 2;
      if (d2 < 20) {
        r = 255;
        g = 253;
        b = 248;
      }
      data[i] = r / 255;
      data[i + 1] = g / 255;
      data[i + 2] = b / 255;
      if (d2 < 4) data.fill(1.25, i, i + 3);
      data[i + 3] = y < 2 ? 128 / 255 : 1;
    }
  }
  return { width: W, height: H, data };
}

export type ParityCase = { name: string; params: FxParamValues; frameIndex: number };
/** Golden-file case: `image` selects the synthetic frame (0 = main, 1 = blank). */
export type FakeFileCase = ParityCase & { image: 0 | 1 };

export const FAKE_DIAGNOSTIC_FILE_CASES: FakeFileCase[] = [
  { name: 'overlay', params: { viewMode: 0 }, frameIndex: 0, image: 0 },
  { name: 'problem-matte', params: { viewMode: 1 }, frameIndex: 0, image: 0 },
  { name: 'reality-assist', params: { viewMode: 2 }, frameIndex: 0, image: 0 },
  { name: 'assist-overlay', params: { viewMode: 3, correctionStrength: 0.8 }, frameIndex: 0, image: 0 },
  { name: 'category-colors', params: { viewMode: 4 }, frameIndex: 0, image: 0 },
  { name: 'temporal-matte', params: { viewMode: 5 }, frameIndex: 0, image: 0 },
  { name: 'temporal-diff', params: { viewMode: 6, overlayStrength: 1 }, frameIndex: 0, image: 0 },
  {
    name: 'weighted-matte',
    params: { viewMode: 1, sensitivity: 2.5, plasticWeight: 2, edgeWeight: 0, temporalWeight: 0, textureWeight: 1.6 },
    frameIndex: 0,
    image: 0,
  },
  {
    name: 'assist-strong',
    params: { viewMode: 2, correctionStrength: 1, microContrast: -0.8, edgeSoften: 1, highlightRolloff: 1, gamutGuard: 1, sensorTexture: 1, seed: 123.5 },
    frameIndex: 9,
    image: 0,
  },
  { name: 'blank-guard', params: { viewMode: 1 }, frameIndex: 0, image: 1 },
  { name: 'blank-unguarded', params: { viewMode: 1, adjustmentLayerGuard: false, sensitivity: 3 }, frameIndex: 0, image: 1 },
];

export const FAKE_DIAGNOSTIC_PARITY = {
  effectId: 'buckswood-post-plugins.fake-diagnostic',
  width: W,
  height: H,
  image: () => fakeDiagnosticTestImage(0),
  cases: FAKE_DIAGNOSTIC_FILE_CASES.filter((entry) => entry.image === 0).map(({ name, params, frameIndex }): ParityCase => ({ name, params, frameIndex })),
  cpu: (image: FloatImage, params: FxParamValues, frameIndex: number): FloatImage =>
    renderFakeDiagnosticCpu(image, prepareFake({ width: image.width, height: image.height, frameIndex }, controlsFromParams(params))),
};
