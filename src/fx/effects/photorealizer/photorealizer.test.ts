import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { hash01, renderPhotorealizerCpu } from './cpu.ts';
import { PHOTOREALIZER_DEFAULT_CONTROLS, controlsFromParams, preparePhotorealizer } from './model.ts';
import { AI_PHOTOREALIZER } from './index.ts';
import { PHOTOREALIZER_PARITY } from './parity.ts';
import { PHOTOREALIZER_FRAGMENT } from './shader.ts';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const { width: W, height: H } = PHOTOREALIZER_PARITY;

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

test('Photorealizer parity cases mirror __fixtures__/cases.txt', () => {
  assert.deepEqual(PHOTOREALIZER_PARITY.cases, fileCases);
});

test('Photorealizer param defaults match the OFX descriptor', () => {
  const expected: Record<string, [number | boolean, number?, number?]> = {
    plasticReduction: [0.65, 0, 1], skinRealism: [0.55, 0, 1], highlightRealism: [0.7, 0, 1], colorNaturalize: [0.55, 0, 1],
    textureAmount: [0.3, 0, 1], microContrast: [0.35, 0, 1], gamutGuard: [0.75, 0, 1], shadowDepth: [0.35, 0, 1],
    smoothnessBreakup: [0.45, 0, 1], outputMix: [1, 0, 1], seed: [1, 1, 1000], adjustmentLayerGuard: [true],
  };
  assert.equal(AI_PHOTOREALIZER.params.length, Object.keys(expected).length);
  assert.equal(AI_PHOTOREALIZER.ofxIdentifier, 'com.buckswood.ai.photorealizer');
  for (const param of AI_PHOTOREALIZER.params) {
    const [def, min, max] = expected[param.id];
    assert.equal(param.default, def, param.id);
    assert.equal(param.default, (PHOTOREALIZER_DEFAULT_CONTROLS as Record<string, unknown>)[param.id], `model default ${param.id}`);
    if (param.type === 'float') assert.deepEqual([param.min, param.max], [min, max], param.id);
  }
});

test('Photorealizer presets set every slider', () => {
  for (const preset of AI_PHOTOREALIZER.presets ?? []) {
    assert.equal(Object.keys(preset.values).length, 10, preset.id);
  }
  const standard = AI_PHOTOREALIZER.presets?.find((p) => p.id === 'default');
  for (const [key, value] of Object.entries(standard?.values ?? {})) {
    assert.equal(value, (PHOTOREALIZER_DEFAULT_CONTROLS as Record<string, unknown>)[key], key);
  }
});

test('Photorealizer hash01 matches uint32 C++ arithmetic', () => {
  // Reference values computed with the C++ core's hash (BigInt emulation).
  const ref = (x: number, y: number, z: number) => {
    const m = (a: bigint) => a & 0xffffffffn;
    let h = m(m(BigInt.asUintN(32, BigInt(x)) * 73856093n) ^ m(BigInt.asUintN(32, BigInt(y)) * 19349663n) ^ m(BigInt.asUintN(32, BigInt(z)) * 83492791n));
    h ^= h >> 16n;
    h = m(h * 0x85ebca6bn);
    h ^= h >> 13n;
    h = m(h * 0xc2b2ae35n);
    h ^= h >> 16n;
    return Number(h & 0xffffffn) / 16777216;
  };
  for (const [x, y, z] of [[0, 0, 0], [-5, 23, 997], [1919, -7, 1110], [3839, 2159, 1000000], [-1, -1, -1]]) {
    assert.equal(hash01(x, y, z), ref(x, y, z), `${x},${y},${z}`);
  }
  assert.equal(preparePhotorealizer({ frameIndex: 13 }, controlsFromParams({ seed: 42.5 })).textureSeed, 42372 + 13 * 17);
});

for (const { name, params, frameIndex } of PHOTOREALIZER_PARITY.cases) {
  test(`Photorealizer CPU reference matches the C++ core: ${name}`, () => {
    const output = PHOTOREALIZER_PARITY.cpu(PHOTOREALIZER_PARITY.image(), params, frameIndex);
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
    // Float32 (C++) vs float64 (JS); observed max error ~1.5e-6.
    assert.ok(maxError < 2e-3, `${name}: max error ${maxError} at component ${worst}`);
  });
}

test('Photorealizer at zero mix is the identity', () => {
  const image = PHOTOREALIZER_PARITY.image();
  const output = PHOTOREALIZER_PARITY.cpu(image, { outputMix: 0 }, 0);
  assert.deepEqual(Array.from(output.data), Array.from(image.data));
});

test('Photorealizer adjustment layer guard blanks empty frames only when enabled', () => {
  const blank = { width: W, height: H, data: new Float32Array(W * H * 4) };
  for (let i = 3; i < blank.data.length; i += 4) blank.data[i] = 1;
  const guarded = renderPhotorealizerCpu(blank, preparePhotorealizer({ frameIndex: 0 }, controlsFromParams({ textureAmount: 1 })));
  assert.ok(guarded.data.every((v) => v === 0));
  const unguarded = renderPhotorealizerCpu(blank, preparePhotorealizer({ frameIndex: 0 }, controlsFromParams({ textureAmount: 1, adjustmentLayerGuard: false })));
  assert.ok(unguarded.data.some((v, i) => i % 4 === 3 && v === 1));
});

test('Photorealizer shader declares every uniform it is fed', () => {
  const uniforms = AI_PHOTOREALIZER.passes[0].uniforms?.({}, { width: W, height: H, frameIndex: 5, time: 0, quality: 'full' }) ?? {};
  assert.equal(uniforms.s_textureSeed, 997 + 5 * 17);
  for (const name of Object.keys(uniforms)) {
    assert.match(PHOTOREALIZER_FRAGMENT, new RegExp(`uniform \\w+ ${name};`), name);
  }
});
