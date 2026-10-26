import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderFilmEmulationCpu } from './cpu.ts';
import { sinfGpuMirror } from './glslSinf.ts';
import { FILM_DEFAULT_CONTROLS, FILM_PRINTS, FILM_STOCKS, controlsFromParams, prepareFilm } from './model.ts';
import { FILM_EMULATION } from './index.ts';
import { FILM_EMULATION_CASES_TEXT, FILM_EMULATION_PARITY, parseFilmCases } from './parity.ts';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const { width: W, height: H } = FILM_EMULATION_PARITY;
const casesFile = readFileSync(join(fixtures, 'cases.txt'), 'utf8');

test('Film Emulation exposes the v2.1 descriptor (61 params, 16 stocks, 9 prints)', () => {
  assert.equal(FILM_EMULATION.params.length, 61);
  assert.equal(FILM_STOCKS.length, 16);
  assert.equal(FILM_PRINTS.length, 9);
  assert.equal(FILM_EMULATION.ofxIdentifier, 'com.buckswood.film.emulation');
  const groups = new Set(FILM_EMULATION.groups?.map((group) => group.id));
  for (const param of FILM_EMULATION.params) assert.ok(param.group && groups.has(param.group), `group of ${param.id}`);
});

test('Film Emulation param defaults match the OFX descriptor', () => {
  assert.deepEqual(
    FILM_EMULATION.params.map((param) => param.id),
    Object.keys(FILM_DEFAULT_CONTROLS),
  );
  for (const param of FILM_EMULATION.params) {
    const expected = (FILM_DEFAULT_CONTROLS as Record<string, unknown>)[param.id];
    assert.equal(param.default, expected, param.id);
    if (param.type === 'float') assert.ok(param.min <= param.default && param.default <= param.max, param.id);
    if (param.type === 'choice') assert.ok(param.default < param.options.length, param.id);
  }
});

test('Film Emulation presets only use known params within range', () => {
  const byId = new Map(FILM_EMULATION.params.map((param) => [param.id, param]));
  assert.ok((FILM_EMULATION.presets?.length ?? 0) >= 5);
  for (const preset of FILM_EMULATION.presets ?? []) {
    for (const [key, value] of Object.entries(preset.values)) {
      const param = byId.get(key);
      assert.ok(param, `${preset.id}: unknown param ${key}`);
      if (param.type === 'float') assert.ok(typeof value === 'number' && value >= param.min && value <= param.max, `${preset.id}.${key}`);
      if (param.type === 'choice') assert.ok(typeof value === 'number' && value >= 0 && value < param.options.length, `${preset.id}.${key}`);
    }
  }
});

test('parity cases are in sync with __fixtures__/cases.txt', () => {
  assert.deepEqual(FILM_EMULATION_PARITY.cases, parseFilmCases(casesFile));
  assert.equal(FILM_EMULATION_CASES_TEXT.trim(), casesFile.trim());
});

for (const { name, params, frameIndex } of FILM_EMULATION_PARITY.cases) {
  test(`Film Emulation CPU reference matches the C++ core: ${name}`, () => {
    const output = FILM_EMULATION_PARITY.cpu(FILM_EMULATION_PARITY.image(), params, frameIndex);
    const golden = new Float32Array(readFileSync(join(fixtures, `${name}.f32`)).buffer.slice(0));
    assert.equal(golden.length, output.data.length);
    let maxError = 0;
    let worst = -1;
    for (let i = 0; i < golden.length; i += 1) {
      const error = Math.abs(golden[i] - output.data[i]);
      if (!(error <= maxError)) {
        maxError = error;
        worst = i;
      }
    }
    // float32 (C++) vs float64 (JS) arithmetic; the hash is evaluated in exact float32.
    assert.ok(maxError < 2e-3, `${name}: max error ${maxError} at component ${worst}`);
  });
}

test('adjustment layer guard renders an empty adjustment layer transparent', () => {
  const blank = { width: W, height: H, data: new Float32Array(W * H * 4) };
  for (let i = 3; i < blank.data.length; i += 4) blank.data[i] = 1;
  const guarded = renderFilmEmulationCpu(blank, prepareFilm({ width: W, height: H, frameIndex: 0 }, controlsFromParams({})));
  assert.ok(guarded.data.every((v) => v === 0));
  const open = renderFilmEmulationCpu(blank, prepareFilm({ width: W, height: H, frameIndex: 0 }, controlsFromParams({ adjustmentLayerGuard: false })));
  assert.ok(open.data.some((v, i) => i % 4 === 3 && v === 1));
});

test('grain animates with the frame index and is stable per frame', () => {
  const image = FILM_EMULATION_PARITY.image();
  const a = FILM_EMULATION_PARITY.cpu(image, { grain: 0.8 }, 3);
  const b = FILM_EMULATION_PARITY.cpu(image, { grain: 0.8 }, 3);
  const c = FILM_EMULATION_PARITY.cpu(image, { grain: 0.8 }, 4);
  assert.deepEqual(Array.from(a.data), Array.from(b.data));
  assert.notDeepEqual(Array.from(a.data), Array.from(c.data));
});

test('GPU sinf (float32 mirror of the shader) is correctly rounded for >99.9 % of hash arguments', () => {
  const F = Math.fround;
  let seed = 12345;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (const range of [4, 5000, 2e5, 2e7]) {
    let mismatches = 0;
    let worstUlp = 0;
    const n = 20000;
    for (let i = 0; i < n; i += 1) {
      const a = F((rnd() * 2 - 1) * range);
      const expected = F(Math.sin(a));
      const got = sinfGpuMirror(a);
      if (got !== expected) {
        mismatches += 1;
        const ulp = 2 ** (Math.floor(Math.log2(Math.abs(expected))) - 23);
        worstUlp = Math.max(worstUlp, Math.abs(got - expected) / ulp);
      }
    }
    assert.ok(mismatches / n < 0.001, `range ${range}: ${mismatches} mismatches`);
    assert.ok(worstUlp <= 1, `range ${range}: worst ${worstUlp} ulp`);
  }
});
