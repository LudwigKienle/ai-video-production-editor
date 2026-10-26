import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderOpticsLabCpu, type FloatImage } from './cpu.ts';
import { OPTICS_DEFAULT_CONTROLS, OPTICS_PRESET_NAMES, controlsFromParams, modelForPreset, prepareOptics } from './model.ts';
import { OPTICS_LAB } from './index.ts';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const W = 40;
const H = 24;

/** Same synthetic frame as the C++ probe (row 0 = bottom). */
function testImage(): FloatImage {
  const data = new Float32Array(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * 4;
      data[i] = x / (W - 1);
      data[i + 1] = y / (H - 1);
      data[i + 2] = 0.5 + 0.5 * Math.sin(Math.fround(Math.fround(x * 0.7) + Math.fround(y * 0.3)));
      data[i + 3] = x / (W - 1);
      if ((x - 10) ** 2 + (y - 8) ** 2 < 6) data.fill(3, i, i + 3);
      if ((x - 30) ** 2 + (y - 16) ** 2 < 4) data.set([1.6, 1.4, 1.2], i);
    }
  }
  return { width: W, height: H, data };
}

const cases = readFileSync(join(fixtures, 'cases.txt'), 'utf8')
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
    return { name, values };
  });

test('Optics Lab exposes all 21 lens recipes of v1.3.1', () => {
  assert.equal(OPTICS_PRESET_NAMES.length, 21);
  const lens = OPTICS_LAB.params.find((param) => param.id === 'preset');
  assert.ok(lens && lens.type === 'choice' && lens.options.length === 21);
  assert.equal(modelForPreset(20).irisBlades, 9);
  assert.equal(modelForPreset(0).grain, 0);
});

test('Optics Lab param defaults match the OFX descriptor', () => {
  for (const param of OPTICS_LAB.params) {
    const expected = (OPTICS_DEFAULT_CONTROLS as Record<string, unknown>)[param.id];
    assert.notEqual(expected, undefined, `missing control ${param.id}`);
    assert.equal(param.default, expected, param.id);
  }
});

for (const { name, values } of cases) {
  test(`Optics Lab CPU reference matches the C++ core: ${name}`, () => {
    const { frameIndex = 0, ...params } = values;
    const state = prepareOptics({ width: W, height: H, frameIndex }, controlsFromParams(params));
    const output = renderOpticsLabCpu(testImage(), state);
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
    // Float32 (C++) vs float64 (JS) arithmetic: allow a small tolerance.
    assert.ok(maxError < 2e-3, `${name}: max error ${maxError} at component ${worst}`);
  });
}

test('Optics Lab is identity at zero strength', () => {
  const image = testImage();
  const state = prepareOptics({ width: W, height: H, frameIndex: 0 }, controlsFromParams({ preset: 3, effectStrength: 0 }));
  const output = renderOpticsLabCpu(image, state);
  assert.deepEqual(Array.from(output.data), Array.from(image.data));
});
