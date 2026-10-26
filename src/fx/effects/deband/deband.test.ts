import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEBAND } from './index.ts';
import { DEBAND_DEFAULT_CONTROLS, DEBAND_PRESET_NAMES, controlsFromParams, prepareDeband } from './model.ts';
import { DEBAND_CASES, DEBAND_PARITY, debandTestImage } from './parity.ts';
import { DEBAND_FRAGMENT } from './shader.ts';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const readF32 = (name: string) => new Float32Array(readFileSync(join(fixtures, `${name}.f32`)).buffer.slice(0));

const fileCases = readFileSync(join(fixtures, 'cases.txt'), 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const [name, ...pairs] = line.split(/\s+/);
    const values: Record<string, number> = {};
    for (const pair of pairs) {
      const [key, value] = pair.split('=');
      values[key] = Number(value);
    }
    const { frameIndex = 0, ...params } = values;
    return { name, params, frameIndex };
  });

test('Deband parity cases mirror __fixtures__/cases.txt', () => {
  assert.deepEqual(DEBAND_CASES, fileCases);
});

test('Deband test image is bit-identical to the probe input', () => {
  assert.deepEqual(Array.from(debandTestImage().data), Array.from(readF32('input')));
});

test('Deband param defaults match the OFX descriptor', () => {
  const ids = DEBAND.params.map((param) => param.id);
  assert.deepEqual(ids, Object.keys(DEBAND_DEFAULT_CONTROLS));
  for (const param of DEBAND.params) {
    assert.equal(param.default, (DEBAND_DEFAULT_CONTROLS as Record<string, unknown>)[param.id], param.id);
  }
  const preset = DEBAND.params.find((param) => param.id === 'preset');
  assert.ok(preset && preset.type === 'choice' && preset.options.length === DEBAND_PRESET_NAMES.length);
  assert.equal(DEBAND.ofxIdentifier, 'com.buckswood.deband');
});

test('Deband prepare() matches the C++ derived state', () => {
  // Values printed by deband-probe (radii / threshold) for the balanced and sky presets.
  const balanced = prepareDeband({ width: 64, height: 32, frameIndex: 0 }, controlsFromParams({}));
  assert.deepEqual([balanced.radiusSmall, balanced.radiusMedium, balanced.radiusLarge], [2, 4, 8]);
  assert.ok(Math.abs(balanced.threshold - 0.00793011) < 1e-8);
  const sky = prepareDeband({ width: 64, height: 32, frameIndex: 0 }, controlsFromParams({ preset: 2 }));
  assert.deepEqual([sky.radiusSmall, sky.radiusMedium, sky.radiusLarge], [3, 6, 11]);
  assert.ok(Math.abs(sky.threshold - 0.0367961) < 1e-7);
});

test('Deband shader keeps loop bounds constant', () => {
  for (const match of DEBAND_FRAGMENT.matchAll(/for \(int \w+ = 0; \w+ < (\w+);/g)) {
    assert.match(match[1], /^\d+$/, `non-constant loop bound ${match[1]}`);
  }
});

for (const { name, params, frameIndex } of DEBAND_CASES) {
  test(`Deband CPU reference matches the C++ core: ${name}`, () => {
    const output = DEBAND_PARITY.cpu(debandTestImage(), params, frameIndex);
    const golden = readF32(name);
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
    // Float32 (C++) vs float64 (JS). Observed max 2.6e-5 (Banding Map, where the
    // heat-map smoothsteps amplify mask rounding); all other views < 2e-6.
    assert.ok(maxError < 1e-4, `${name}: max error ${maxError} at component ${worst}`);
  });
}

test('Deband is identity at zero strength and in flat fills', () => {
  const image = debandTestImage();
  const output = DEBAND_PARITY.cpu(image, { preset: 5, strength: 0 }, 0);
  assert.deepEqual(Array.from(output.data), Array.from(image.data));
  // Intentional flat strip (x < 6) stays untouched by the default profile where
  // the largest radius (8 px) reaches neither the gradient nor the texture strip.
  const balanced = DEBAND_PARITY.cpu(image, {}, 0);
  for (let y = 0; y < 18; y += 1) {
    for (let x = 0; x < 2; x += 1) {
      const i = (y * image.width + x) * 4;
      assert.deepEqual(Array.from(balanced.data.subarray(i, i + 4)), Array.from(image.data.subarray(i, i + 4)), `flat pixel ${x},${y}`);
    }
  }
});
