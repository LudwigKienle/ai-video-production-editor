/**
 * Parity kit for AI Photorealizer: the synthetic probe frame, the golden
 * cases (identical to `__fixtures__/cases.txt`, which the C++ probe consumes)
 * and the CPU reference. Used by `photorealizer.test.ts` and the fx-lab dev
 * page (GPU vs CPU).
 */
import type { FxParamValues } from '../../types.ts';
import { renderPhotorealizerCpu, type FloatImage } from './cpu.ts';
import { controlsFromParams, preparePhotorealizer } from './model.ts';

const W = 40;
const H = 24;

/**
 * Same synthetic frame as scripts/fx-probes/photorealizer-probe.cpp
 * (row 0 = bottom): gradients, alpha ramp, two HDR spots, a skin-tone patch
 * and a neon-green patch.
 */
function image(): FloatImage {
  const f = Math.fround;
  const data = new Float32Array(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * 4;
      data[i] = x / (W - 1);
      data[i + 1] = y / (H - 1);
      data[i + 2] = f(0.5 + f(0.5 * f(Math.sin(f(f(x * 0.7) + f(y * 0.3))))));
      data[i + 3] = x / (W - 1);
      if ((x - 10) ** 2 + (y - 8) ** 2 < 6) data.fill(3, i, i + 3);
      if ((x - 30) ** 2 + (y - 16) ** 2 < 4) data.set([1.6, 1.4, 1.2], i);
      if (x >= 14 && x <= 19 && y >= 2 && y <= 7) data.set([0.82, 0.6, 0.46], i);
      if (x >= 22 && x <= 26 && y >= 18 && y <= 22) data.set([0.05, 1, 0.15], i);
    }
  }
  return { width: W, height: H, data };
}

type ParityCase = { name: string; params: FxParamValues; frameIndex: number };

const c = (name: string, params: FxParamValues = {}, frameIndex = 0): ParityCase => ({ name, params, frameIndex });

const ZERO = {
  plasticReduction: 0,
  skinRealism: 0,
  highlightRealism: 0,
  colorNaturalize: 0,
  textureAmount: 0,
  microContrast: 0,
  gamutGuard: 0,
  shadowDepth: 0,
  smoothnessBreakup: 0,
};

const cases: ParityCase[] = [
  c('defaults'),
  c('bypass', { outputMix: 0 }),
  c('deplastic-subtle', { plasticReduction: 0.45, skinRealism: 0.35, highlightRealism: 0.5, colorNaturalize: 0.35, textureAmount: 0.18, microContrast: 0.2, gamutGuard: 0.6, shadowDepth: 0.2, smoothnessBreakup: 0.3, outputMix: 0.7 }),
  c('skin-texture', { plasticReduction: 0.8, skinRealism: 0.9, highlightRealism: 0.65, colorNaturalize: 0.45, textureAmount: 0.55, microContrast: 0.3, gamutGuard: 0.7, shadowDepth: 0.3, smoothnessBreakup: 0.75, outputMix: 1 }),
  c('strong', { plasticReduction: 1, skinRealism: 0.8, highlightRealism: 1, colorNaturalize: 0.85, textureAmount: 0.8, microContrast: 0.7, gamutGuard: 1, shadowDepth: 0.7, smoothnessBreakup: 0.9, outputMix: 1 }),
  c('texture-seed-frame', { textureAmount: 1, seed: 42.5 }, 13),
  c('texture-large-seed', { textureAmount: 1, plasticReduction: 1, smoothnessBreakup: 1, seed: 1000 }, 240),
  c('highlight-only', { ...ZERO, highlightRealism: 1 }),
  c('gamut-naturalize', { ...ZERO, colorNaturalize: 1, gamutGuard: 1 }),
  c('shadow-contrast', { shadowDepth: 1, microContrast: 1, textureAmount: 0 }),
  c('half-mix', { outputMix: 0.5, plasticReduction: 1, skinRealism: 1, textureAmount: 1 }, 3),
];

function cpu(source: FloatImage, params: FxParamValues, frameIndex: number): FloatImage {
  return renderPhotorealizerCpu(source, preparePhotorealizer({ frameIndex }, controlsFromParams(params)));
}

export const PHOTOREALIZER_PARITY = {
  effectId: 'buckswood-post-plugins.ai-photorealizer',
  width: W,
  height: H,
  image,
  cases,
  cpu,
};
