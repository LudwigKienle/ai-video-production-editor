import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderLensPhysicsCpu } from './cpu.ts';
import { LENS_DEFAULT_CONTROLS, LENS_PRESET_NAMES, controlsFromParams, modelForPreset, prepareLensPhysics } from './model.ts';
import { LENS_PHYSICS } from './index.ts';
import { LENS_PHYSICS_PARITY } from './parity.ts';
import { LENS_PHYSICS_FRAGMENT } from './shader.ts';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const { width: W, height: H } = LENS_PHYSICS_PARITY;

const fileCases = readFileSync(join(fixtures, 'cases.txt'), 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const [name, ...pairs] = line.split(/\s+/);
    const params: Record<string, number> = {};
    for (const pair of pairs) {
      const [key, value] = pair.split('=');
      params[key] = Number(value);
    }
    const { frameIndex = 0, ...rest } = params;
    return { name, params: rest, frameIndex };
  });

test('Lens Physics parity cases mirror __fixtures__/cases.txt', () => {
  assert.deepEqual(LENS_PHYSICS_PARITY.cases, fileCases);
});

test('Lens Physics exposes the 20 lens presets of v0.5', () => {
  assert.equal(LENS_PRESET_NAMES.length, 20);
  const preset = LENS_PHYSICS.params.find((param) => param.id === 'lensPreset');
  assert.ok(preset && preset.type === 'choice' && preset.options.length === 20 && preset.default === 19);
  assert.equal(modelForPreset(0).bloom, 0);
  assert.equal(modelForPreset(3).swirl, Math.fround(0.42));
  assert.equal(modelForPreset(19).sharpener, Math.fround(0.055));
});

test('Lens Physics param defaults match the OFX descriptor', () => {
  const expected: Record<string, number | boolean> = {
    lensPreset: 19, effectStrength: 0.45, distortion: 0, chromaticAberration: 0.015, fringing: 0.015, coma: 0.035,
    bloom: 0.075, bloomThreshold: 0.82, vignette: 0.045, cornerColor: 0.02, swirl: 0, fStopSharpener: 0.06,
    overdrive: 0.85, outputMix: 0.55, edgeHaloGuard: 0.82, adjustmentLayerGuard: true,
  };
  assert.equal(LENS_PHYSICS.params.length, Object.keys(expected).length);
  assert.equal(LENS_PHYSICS.ofxIdentifier, 'com.buckswood.lens.physics');
  for (const param of LENS_PHYSICS.params) {
    assert.equal(param.default, expected[param.id], param.id);
    assert.equal(param.default, (LENS_DEFAULT_CONTROLS as Record<string, unknown>)[param.id], `model default ${param.id}`);
  }
  const ranges: Record<string, [number, number]> = { distortion: [-1, 1], bloomThreshold: [0.35, 1], fStopSharpener: [-1, 1], overdrive: [0, 3] };
  for (const [id, [min, max]] of Object.entries(ranges)) {
    const param = LENS_PHYSICS.params.find((p) => p.id === id);
    assert.ok(param && param.type === 'float' && param.min === min && param.max === max, id);
  }
});

for (const { name, params, frameIndex } of LENS_PHYSICS_PARITY.cases) {
  test(`Lens Physics CPU reference matches the C++ core: ${name}`, () => {
    const output = LENS_PHYSICS_PARITY.cpu(LENS_PHYSICS_PARITY.image(), params, frameIndex);
    const golden = new Float32Array(readFileSync(join(fixtures, `${name}.f32`)).buffer.slice(0));
    assert.equal(golden.length, output.data.length);
    let maxError = 0;
    let worst = -1;
    for (let i = 0; i < golden.length; i += 1) {
      const error = Math.abs(golden[i] - output.data[i]);
      if (error > maxError) {
        maxError = error;
        worst = i;
      }
    }
    // Float32 (C++) vs float64 (JS). Typical max error is ~5e-6; a sample that
    // lands within an ulp of the frame border can flip in/out of the
    // zero-outside sampler (seen: 3.4e-4 in "neutral-trims").
    assert.ok(maxError < 2e-3, `${name}: max error ${maxError} at component ${worst}`);
  });
}

test('Lens Physics at zero strength leaves SDR pixels unchanged (output is always clamped to 0..1)', () => {
  // Like the C++ core, the edge guard's luma limit still pulls HDR pixels
  // (> 1) at zero strength, so only in-range pixels are an identity.
  const image = LENS_PHYSICS_PARITY.image();
  const output = LENS_PHYSICS_PARITY.cpu(image, { lensPreset: 3, effectStrength: 0 }, 0);
  for (let p = 0; p < image.data.length; p += 4) {
    const rgb = image.data.subarray(p, p + 3);
    for (let c = 0; c < 3; c += 1) assert.ok(output.data[p + c] >= 0 && output.data[p + c] <= 1);
    assert.equal(output.data[p + 3], image.data[p + 3]);
    if (rgb.some((v) => v > 1)) continue;
    for (let c = 0; c < 3; c += 1) assert.ok(Math.abs(output.data[p + c] - rgb[c]) < 1e-5, `pixel ${p / 4}`);
  }
});

test('Lens Physics adjustment layer guard blanks empty frames only when enabled', () => {
  const blank = { width: W, height: H, data: new Float32Array(W * H * 4) };
  for (let i = 3; i < blank.data.length; i += 4) blank.data[i] = 1;
  const guarded = renderLensPhysicsCpu(blank, prepareLensPhysics(blank, controlsFromParams({ cornerColor: 1, effectStrength: 1 })));
  assert.ok(guarded.data.every((v) => v === 0));
  const unguarded = renderLensPhysicsCpu(blank, prepareLensPhysics(blank, controlsFromParams({ cornerColor: 1, effectStrength: 1, adjustmentLayerGuard: false })));
  assert.ok(unguarded.data.some((v, i) => i % 4 === 0 && v > 0), 'corner colour cast should lift the red channel');
});

test('Lens Physics shader declares every uniform it is fed', () => {
  const state = prepareLensPhysics({ width: W, height: H }, controlsFromParams({}));
  const pass = LENS_PHYSICS.passes[0];
  const uniforms = pass.uniforms?.({}, { width: W, height: H, frameIndex: 0, time: 0, quality: 'full' }) ?? {};
  assert.ok(Object.keys(uniforms).length > 10);
  for (const name of Object.keys(uniforms)) {
    assert.match(LENS_PHYSICS_FRAGMENT, new RegExp(`uniform \\w+ ${name};`), name);
  }
  assert.equal(uniforms.s_baseOverdrive, state.baseOverdrive);
});
