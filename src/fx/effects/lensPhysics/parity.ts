/**
 * Parity kit for Lens Physics: the synthetic probe frame, the golden cases
 * (identical to `__fixtures__/cases.txt`, which the C++ probe consumes) and
 * the CPU reference. Used by `lensPhysics.test.ts` and the fx-lab dev page
 * (GPU vs CPU).
 */
import type { FxParamValues } from '../../types.ts';
import { renderLensPhysicsCpu, type FloatImage } from './cpu.ts';
import { controlsFromParams, prepareLensPhysics } from './model.ts';

const W = 40;
const H = 24;

/** Same synthetic frame as scripts/fx-probes/lens-physics-probe.cpp (row 0 = bottom). */
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
    }
  }
  return { width: W, height: H, data };
}

type ParityCase = { name: string; params: FxParamValues; frameIndex: number };

const c = (name: string, params: FxParamValues = {}, frameIndex = 0): ParityCase => ({ name, params, frameIndex });

const cases: ParityCase[] = [
  c('defaults'),
  c('neutral-trims', { lensPreset: 0 }),
  c('clean-cinema', { lensPreset: 1, effectStrength: 0.8, outputMix: 1 }),
  c('vintage-spherical', { lensPreset: 2, effectStrength: 1, outputMix: 1, overdrive: 1 }),
  c('petzval-full', { lensPreset: 3, effectStrength: 1, outputMix: 1, overdrive: 1.5 }),
  c('anamorphic-soft', { lensPreset: 4, effectStrength: 0.9, outputMix: 0.8, bloomThreshold: 0.5 }),
  c('soviet-glow', { lensPreset: 5, effectStrength: 1, outputMix: 1, bloom: 0.4, bloomThreshold: 0.4, coma: 0.5 }),
  c('ai-deplastic', { lensPreset: 6 }),
  c('helios-full', { lensPreset: 7, effectStrength: 1, outputMix: 1, overdrive: 1 }),
  c('batis-sharpen', { lensPreset: 9, effectStrength: 1, outputMix: 1, fStopSharpener: 0.8 }),
  c('atlas-overdrive', { lensPreset: 18, effectStrength: 1, outputMix: 1, overdrive: 3, edgeHaloGuard: 1, chromaticAberration: 0.4, fringing: 0.35 }),
  c('ultra-vista-unguarded', { lensPreset: 13, effectStrength: 1, outputMix: 1, overdrive: 2.5, edgeHaloGuard: 0, swirl: 0.5, distortion: -0.6 }),
  c('imax-portrait-corners', { lensPreset: 17, effectStrength: 1, outputMix: 1, vignette: 0.6, cornerColor: 0.8, fStopSharpener: -0.5 }, 12),
  c('zero-strength', { lensPreset: 5, effectStrength: 0 }),
];

function cpu(source: FloatImage, params: FxParamValues, frameIndex: number): FloatImage {
  void frameIndex; // Lens Physics is not time-dependent.
  return renderLensPhysicsCpu(source, prepareLensPhysics(source, controlsFromParams(params)));
}

export const LENS_PHYSICS_PARITY = {
  effectId: 'buckswood-post-plugins.lens-physics',
  width: W,
  height: H,
  image,
  cases,
  cpu,
};
