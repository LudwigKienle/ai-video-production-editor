import test from 'node:test';
import assert from 'node:assert/strict';

import { renderPrimaryGradeCpu, gradePixel, qualifierMask, windowMask, lgg, type FloatImage } from './cpu.ts';
import {
  CURVE_LUT_SIZE,
  buildCurveLut,
  buildCurveTexture,
  buildHueCurveLut,
  curvesFromParams,
  parseCurve,
  prepareGrade,
  serializeCurve,
} from './model.ts';
import { PRIMARY_GRADE, PRIMARY_GRADE_ID } from './index.ts';
import type { FxParamValues } from '../../types.ts';

const W = 24;
const H = 16;
const defaults = (): FxParamValues => Object.fromEntries(PRIMARY_GRADE.params.map((p) => [p.id, p.default]));

function testImage(): FloatImage {
  const data = new Float32Array(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * 4;
      data[i] = x / (W - 1);
      data[i + 1] = y / (H - 1);
      data[i + 2] = 0.5 + 0.5 * Math.sin(x * 0.7 + y * 0.3);
      data[i + 3] = 1;
    }
  }
  return { width: W, height: H, data };
}

const grade = (values: FxParamValues, rgb: [number, number, number]) => {
  const s = prepareGrade(values, { width: W, height: H });
  return gradePixel(s, buildCurveTexture(curvesFromParams(values)), rgb);
};

test('id has no plugin brand and every param has a unique id', () => {
  assert.equal(PRIMARY_GRADE_ID, 'avpe.primary-grade');
  assert.equal(PRIMARY_GRADE.id, PRIMARY_GRADE_ID);
  const ids = PRIMARY_GRADE.params.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(PRIMARY_GRADE.passes.map((p) => p.id), ['grade', 'blurH', 'blurV', 'compose', 'sizing']);
});

test('identity at defaults (whole node incl. masks/blur/sizing)', () => {
  const img = testImage();
  const out = renderPrimaryGradeCpu(img, defaults());
  for (let i = 0; i < img.data.length; i += 1) assert.ok(Math.abs(out.data[i] - img.data[i]) < 1e-6, `index ${i}`);
});

test('identity also with no params at all', () => {
  const img = testImage();
  const out = renderPrimaryGradeCpu(img, {});
  for (let i = 0; i < img.data.length; i += 1) assert.ok(Math.abs(out.data[i] - img.data[i]) < 1e-6);
});

test('wheels are monotonic in their parameter', () => {
  const inputs: Array<[number, number, number]> = [[0.05, 0.2, 0.4], [0.3, 0.5, 0.6], [0.8, 0.7, 0.95]];
  const sweep = (id: string, from: number, to: number, channel: number, lumMix = 1) => {
    for (const rgb of inputs) {
      let prev = -Infinity;
      for (let k = 0; k <= 10; k += 1) {
        const v = grade({ ...defaults(), lumMix, [id]: from + ((to - from) * k) / 10 }, rgb)[channel];
        assert.ok(v >= prev - 1e-9, `${id} not monotonic at step ${k}: ${v} < ${prev}`);
        prev = v;
      }
    }
  };
  sweep('liftR', -0.5, 0.5, 0);
  sweep('gammaG', -0.8, 0.8, 1);
  sweep('gainB', 0.2, 2, 2);
  sweep('offsetR', -0.3, 0.3, 0);
  for (const lumMix of [0, 0.5, 1]) {
    sweep('liftY', -0.4, 0.4, 1, lumMix);
    sweep('gammaY', -0.8, 0.8, 1, lumMix);
    sweep('gainY', 0.3, 2, 1, lumMix);
  }
});

test('lift moves black, gain moves white, gamma keeps endpoints', () => {
  assert.ok(Math.abs(lgg(0, 0.1, 0, 1) - 0.1) < 1e-12);
  assert.ok(Math.abs(lgg(1, 0.1, 0, 1) - 1) < 1e-12);
  assert.ok(Math.abs(lgg(1, 0, 0, 1.5) - 1.5) < 1e-12);
  assert.ok(Math.abs(lgg(0, 0, 0.5, 1)) < 1e-12);
  assert.ok(Math.abs(lgg(1, 0, 0.5, 1) - 1) < 1e-12);
  assert.ok(lgg(0.5, 0, 0.5, 1) > 0.5, 'positive gamma brightens mids');
});

test('saturation 0 gives grey, temperature warms', () => {
  const [r, g, b] = grade({ ...defaults(), saturation: 0 }, [0.8, 0.3, 0.1]);
  assert.ok(Math.abs(r - g) < 1e-9 && Math.abs(g - b) < 1e-9);
  const warm = grade({ ...defaults(), temperature: 50 }, [0.5, 0.5, 0.5]);
  assert.ok(warm[0] > 0.5 && warm[2] < 0.5);
});

test('hue rotation of 360° is identity and keeps grey', () => {
  const c: [number, number, number] = [0.7, 0.2, 0.4];
  const out = grade({ ...defaults(), hue: 180 }, [0.4, 0.4, 0.4]);
  out.forEach((v) => assert.ok(Math.abs(v - 0.4) < 1e-9));
  const full = grade({ ...defaults(), hue: 180 }, grade({ ...defaults(), hue: 180 }, c));
  full.forEach((v, i) => assert.ok(Math.abs(v - c[i]) < 1e-9));
});

test('curve LUT: identity, endpoints, monotone, round trip', () => {
  const id = buildCurveLut([]);
  assert.equal(id.length, CURVE_LUT_SIZE);
  for (let i = 0; i < id.length; i += 1) assert.ok(Math.abs(id[i] - i / (CURVE_LUT_SIZE - 1)) < 1e-6);
  const s = buildCurveLut([[0, 0], [0.25, 0.15], [0.75, 0.85], [1, 1]]);
  assert.ok(Math.abs(s[0]) < 1e-9 && Math.abs(s[CURVE_LUT_SIZE - 1] - 1) < 1e-6);
  for (let i = 1; i < s.length; i += 1) assert.ok(s[i] >= s[i - 1] - 1e-7, `S-curve not monotone at ${i}`);
  assert.ok(s[64] < 64 / 255, 'S-curve darkens shadows');
  const text = serializeCurve([[0.5, 0.6], [0, 0.1]]);
  assert.equal(text, '0:0.1,0.5:0.6');
  assert.deepEqual(parseCurve(text), [[0, 0.1], [0.5, 0.6]]);
  assert.deepEqual(parseCurve('garbage'), []);
  // A curve that lifts the black point maps 0 to the lifted value.
  const lifted = grade({ ...defaults(), curveY: '0:0.1,1:1' }, [0, 0, 0]);
  lifted.forEach((v) => assert.ok(Math.abs(v - 0.1) < 1e-6));
});

test('hue curves: neutral by default, periodic and targeted', () => {
  const flat = buildHueCurveLut([]);
  assert.ok(flat.every((v) => v === 0.5));
  const lut = buildHueCurveLut([[0, 0.5], [0.33, 1], [0.66, 0.5]]);
  assert.ok(Math.abs(lut[0] - 0.5) < 1e-9);
  assert.ok(lut[Math.round(0.33 * CURVE_LUT_SIZE)] > 0.95);
  // Hue vs Sat raising greens leaves pure reds untouched and saturates green.
  const values = { ...defaults(), hueSat: '0:0.5,0.33:0.8,0.66:0.5' };
  const red = grade(values, [0.8, 0.2, 0.2]);
  [0.8, 0.2, 0.2].forEach((v, i) => assert.ok(Math.abs(red[i] - v) < 1e-6));
  const green = grade(values, [0.3, 0.6, 0.3]);
  assert.ok(green[1] - green[0] > 0.3 + 1e-3);
  // Achromatic pixels are never moved by hue curves.
  const grey = grade({ ...defaults(), hueHue: '0:0.9,0.5:0.1', hueLum: '0:1' }, [0.5, 0.5, 0.5]);
  grey.forEach((v) => assert.ok(Math.abs(v - 0.5) < 1e-9));
});

test('qualifier mask selects a hue range with softness and invert', () => {
  const base = { ...defaults(), qualEnabled: true, qualHue: 120, qualHueWidth: 20, qualHueSoft: 10 };
  const s = prepareGrade(base, { width: W, height: H });
  assert.equal(qualifierMask(s, [0.2, 0.8, 0.2]), 1);
  assert.equal(qualifierMask(s, [0.8, 0.2, 0.2]), 0);
  const edge = qualifierMask(s, [0.2, 0.8, 0.2 + 0.6 * (25 / 60)]); // hue ≈ 145°
  assert.ok(edge > 0 && edge < 1, `soft edge ${edge}`);
  const inv = prepareGrade({ ...base, qualInvert: true }, { width: W, height: H });
  assert.equal(qualifierMask(inv, [0.2, 0.8, 0.2]), 0);
  const lum = prepareGrade({ ...defaults(), qualEnabled: true, qualHueOn: false, qualSatOn: false, qualLumLow: 0.6, qualLumSoft: 0 }, { width: W, height: H });
  assert.equal(qualifierMask(lum, [0.9, 0.9, 0.9]), 1);
  assert.equal(qualifierMask(lum, [0.2, 0.2, 0.2]), 0);
});

test('power windows: circle centre is inside, corners outside, gradient top/bottom', () => {
  const circle = prepareGrade({ ...defaults(), winType: 1, winSizeX: 0.3, winSizeY: 0.3, winSoftness: 0 }, { width: 100, height: 100 });
  assert.equal(windowMask(circle, 50, 50, 100, 100), 1);
  assert.equal(windowMask(circle, 2, 2, 100, 100), 0);
  const rect = prepareGrade({ ...defaults(), winType: 2, winSizeX: 0.2, winSizeY: 0.4, winSoftness: 0 }, { width: 100, height: 100 });
  assert.equal(windowMask(rect, 50, 85, 100, 100), 1);
  assert.equal(windowMask(rect, 85, 50, 100, 100), 0);
  const grad = prepareGrade({ ...defaults(), winType: 3, winSoftness: 0.2 }, { width: 100, height: 100 });
  assert.ok(windowMask(grad, 50, 99, 100, 100) > 0.99, 'top selected');
  assert.ok(windowMask(grad, 50, 0, 100, 100) < 0.01, 'bottom not selected');
  const mid = windowMask(grad, 50, 49.5, 100, 100);
  assert.ok(Math.abs(mid - 0.5) < 1e-6);
});

test('masks limit the correction to the selection', () => {
  const img = testImage();
  const out = renderPrimaryGradeCpu(img, { ...defaults(), gainY: 2, lumMix: 0, winType: 1, winX: 0.5, winY: 0.5, winSizeX: 0.2, winSizeY: 0.2, winSoftness: 0 });
  const at = (x: number, y: number) => (y * W + x) * 4;
  assert.equal(out.data[at(0, 0)], img.data[at(0, 0)], 'outside window untouched');
  const c = at(12, 8);
  assert.ok(out.data[c] > img.data[c] * 1.5, 'inside window graded');
  const key = renderPrimaryGradeCpu(img, { ...defaults(), gainY: 2, lumMix: 0, keyGain: 0 });
  for (let i = 0; i < img.data.length; i += 1) assert.ok(Math.abs(key.data[i] - img.data[i]) < 1e-9, 'key gain 0 disables');
});

test('blur averages, sharpen adds contrast, sizing flips', () => {
  const img = testImage();
  const blurred = renderPrimaryGradeCpu(img, { ...defaults(), blurRadius: 400 });
  const at = (x: number, y: number) => (y * W + x) * 4;
  // Horizontal red ramp: blur pulls the ends toward the centre.
  assert.ok(blurred.data[at(0, 5)] > img.data[at(0, 5)] + 0.05);
  assert.ok(blurred.data[at(W - 1, 5)] < img.data[at(W - 1, 5)] - 0.05);
  const sharp = renderPrimaryGradeCpu(img, { ...defaults(), sharpen: 2 });
  assert.ok(sharp.data.some((v, i) => Math.abs(v - img.data[i]) > 1e-3));
  const flipped = renderPrimaryGradeCpu(img, { ...defaults(), sizeFlipH: true });
  assert.ok(Math.abs(flipped.data[at(0, 3)] - img.data[at(W - 1, 3)]) < 1e-6);
});
