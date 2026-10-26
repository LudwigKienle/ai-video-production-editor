import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { hash01, looksLikeBlankAdjustment } from './cpu.ts';
import { FAKE_DIAGNOSTIC } from './index.ts';
import { FAKE_DEFAULT_CONTROLS, FAKE_VIEW_MODES, controlsFromParams, prepareFake } from './model.ts';
import { FAKE_DIAGNOSTIC_FILE_CASES, FAKE_DIAGNOSTIC_PARITY, fakeDiagnosticTestImage } from './parity.ts';
import { FAKE_DIAGNOSTIC_FRAGMENT, FAKE_GUARD_FRAGMENT } from './shader.ts';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const readF32 = (name: string) => new Float32Array(readFileSync(join(fixtures, `${name}.f32`)).buffer.slice(0));
const BOOL_PARAMS = new Set(['temporalAnalysis', 'adjustmentLayerGuard']);

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
    const { frameIndex = 0, image = 0, ...raw } = values;
    const params: Record<string, number | boolean> = {};
    for (const [key, value] of Object.entries(raw)) params[key] = BOOL_PARAMS.has(key) ? value !== 0 : value;
    return { name, params, frameIndex, image };
  });

test('Fake Diagnostic cases mirror __fixtures__/cases.txt', () => {
  assert.deepEqual(FAKE_DIAGNOSTIC_FILE_CASES, fileCases);
  assert.equal(FAKE_DIAGNOSTIC_PARITY.cases.length, fileCases.filter((entry) => entry.image === 0).length);
});

test('Fake Diagnostic test images are bit-identical to the probe input', () => {
  assert.deepEqual(Array.from(fakeDiagnosticTestImage(0).data), Array.from(readF32('input')));
  assert.deepEqual(Array.from(fakeDiagnosticTestImage(1).data), Array.from(readF32('input-blank')));
});

test('Fake Diagnostic param defaults match the OFX descriptor', () => {
  assert.deepEqual(
    FAKE_DIAGNOSTIC.params.map((param) => param.id),
    Object.keys(FAKE_DEFAULT_CONTROLS),
  );
  for (const param of FAKE_DIAGNOSTIC.params) {
    assert.equal(param.default, (FAKE_DEFAULT_CONTROLS as Record<string, unknown>)[param.id], param.id);
  }
  const view = FAKE_DIAGNOSTIC.params.find((param) => param.id === 'viewMode');
  assert.ok(view && view.type === 'choice' && view.options.length === FAKE_VIEW_MODES.length);
  assert.deepEqual(
    FAKE_DIAGNOSTIC.params.filter((param) => param.hidden).map((param) => param.id),
    ['temporalAnalysis', 'temporalOffset', 'temporalAssist'],
  );
  assert.equal(FAKE_DIAGNOSTIC.ofxIdentifier, 'com.buckswood.fake.diagnostic');
});

test('Fake Diagnostic prepare() matches the C++ seeds', () => {
  const state = prepareFake({ width: 48, height: 32, frameIndex: 9 }, controlsFromParams({ seed: 123.5 }));
  // int(123.5f * 13) = 1605, int(123.5f * 29) = 3581.
  assert.equal(state.noiseSeedBase, 9 + 1605);
  assert.equal(state.noiseSeedAlt, 9 + 3581);
  assert.ok(Math.abs(state.weightSum - 5.4) < 1e-6);
  // hash01 is a uint32 hash: spot-check range and negative coordinates.
  for (const [x, y, z] of [[0, 0, 0], [-1, 5, 221], [47, -11, 493]]) {
    const v = hash01(x, y, z);
    assert.ok(v >= 0 && v <= 1, `hash01(${x},${y},${z}) = ${v}`);
  }
});

test('Fake Diagnostic shaders keep loop bounds constant', () => {
  for (const source of [FAKE_GUARD_FRAGMENT, FAKE_DIAGNOSTIC_FRAGMENT]) {
    for (const match of source.matchAll(/for \(int \w+ = 0; \w+ < (\w+);/g)) {
      assert.match(match[1], /^\d+$/, `non-constant loop bound ${match[1]}`);
    }
  }
});

test('Fake Diagnostic adjustment-layer guard', () => {
  assert.equal(looksLikeBlankAdjustment(fakeDiagnosticTestImage(1)), true);
  assert.equal(looksLikeBlankAdjustment(fakeDiagnosticTestImage(0)), false);
});

for (const { name, params, frameIndex, image } of FAKE_DIAGNOSTIC_FILE_CASES) {
  test(`Fake Diagnostic CPU reference matches the C++ core: ${name}`, () => {
    const output = FAKE_DIAGNOSTIC_PARITY.cpu(fakeDiagnosticTestImage(image), params, frameIndex);
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
    // Float32 (C++) vs float64 (JS) arithmetic; the hash noise is bit-exact.
    assert.ok(maxError < 1e-5, `${name}: max error ${maxError} at component ${worst}`);
  });
}

test('Fake Diagnostic ignores the temporal-only params in the single-frame path', () => {
  const image = fakeDiagnosticTestImage(0);
  const base = FAKE_DIAGNOSTIC_PARITY.cpu(image, { viewMode: 3 }, 0);
  const temporal = FAKE_DIAGNOSTIC_PARITY.cpu(image, { viewMode: 3, temporalAnalysis: true, temporalOffset: 2, temporalAssist: 1 }, 0);
  assert.deepEqual(Array.from(temporal.data), Array.from(base.data));
});
