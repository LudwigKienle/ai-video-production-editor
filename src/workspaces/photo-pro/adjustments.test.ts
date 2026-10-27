import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyAdjustment, brightnessContrastLut, colorBalanceLuts, curvesLut, defaultAdjustment, exposureLut,
  hslToRgb, isIdentityAdjustment, lookFilter, lookFromAiFilters, rgbToHsl,
} from './adjustments.ts';

const px = (...rgba: number[]) => new Uint8ClampedArray(rgba);

test('defaults are identities', () => {
  for (const type of ['brightnessContrast', 'hueSaturation', 'exposure', 'curves', 'colorBalance', 'look'] as const) {
    assert.ok(isIdentityAdjustment(defaultAdjustment(type)), type);
  }
  const data = px(10, 120, 250, 255);
  applyAdjustment(data, defaultAdjustment('curves'));
  assert.deepEqual([...data], [10, 120, 250, 255]);
});

test('curves: identity, monotone, hits control points', () => {
  const id = curvesLut([[0, 0], [255, 255]]);
  for (let i = 0; i < 256; i += 1) assert.equal(id[i], i);
  const s = curvesLut([[0, 0], [64, 40], [192, 215], [255, 255]]);
  assert.equal(s[64], 40);
  assert.equal(s[192], 215);
  for (let i = 1; i < 256; i += 1) assert.ok(s[i] >= s[i - 1], `monotone at ${i}`);
});

test('brightness/contrast and exposure move tones in the right direction', () => {
  const bright = brightnessContrastLut(60, 0);
  assert.ok(bright[128] > 128 && bright[0] === 0 && bright[255] === 255);
  const contrast = brightnessContrastLut(0, 50);
  assert.ok(contrast[200] > 200 && contrast[50] < 50);
  const up = exposureLut(1, 0, 1);
  assert.ok(up[100] > 100);
  const down = exposureLut(-1, 0, 1);
  assert.ok(down[100] < 100);
  assert.equal(exposureLut(0, 0, 1)[77], 77);
});

test('hue/saturation: greys stay grey, desaturation removes colour, hue rotates', () => {
  const grey = px(128, 128, 128, 255);
  applyAdjustment(grey, { type: 'hueSaturation', hue: 90, saturation: 80, lightness: 0 });
  assert.deepEqual([...grey], [128, 128, 128, 255]);
  const red = px(200, 30, 30, 255);
  applyAdjustment(red, { type: 'hueSaturation', hue: 0, saturation: -100, lightness: 0 });
  assert.equal(red[0], red[1]);
  assert.equal(red[1], red[2]);
  const [h] = rgbToHsl(...([0, 200, 0] as [number, number, number]));
  assert.equal(h, 120);
  assert.deepEqual(hslToRgb(0, 1, 0.5), [255, 0, 0]);
});

test('colour balance shifts channels; preserve luminosity keeps luma', () => {
  const [r, , b] = colorBalanceLuts({ type: 'colorBalance', shadows: [0, 0, 0], midtones: [50, 0, -50], highlights: [0, 0, 0], preserveLuminosity: false });
  assert.ok(r[128] > 128 && b[128] < 128);
  const data = px(128, 128, 128, 255);
  applyAdjustment(data, { type: 'colorBalance', shadows: [0, 0, 0], midtones: [60, 0, 0], highlights: [0, 0, 0], preserveLuminosity: true });
  const l = 0.299 * data[0] + 0.587 * data[1] + 0.114 * data[2];
  assert.ok(Math.abs(l - 128) <= 1.5, `luma ${l}`);
  assert.ok(data[0] > data[1]);
});

test('invert and transparent pixels', () => {
  const data = px(0, 100, 255, 255, 5, 5, 5, 0);
  applyAdjustment(data, { type: 'invert' });
  assert.deepEqual([...data.slice(0, 3)], [255, 155, 0]);
  const t = px(5, 5, 5, 0);
  applyAdjustment(t, { type: 'hueSaturation', hue: 0, saturation: -100, lightness: 50 });
  assert.deepEqual([...t], [5, 5, 5, 0], 'fully transparent pixels are skipped');
});

test('neural look values are normalised like the old Adjust panel', () => {
  const look = lookFromAiFilters({ brightness: 180, contrast: 110, saturate: 90, hueRotate: 350, blur: 1.4 });
  assert.deepEqual(look, { type: 'look', brightness: 150, contrast: 110, saturate: 90, hue: -10, blur: 1 });
  assert.equal(lookFilter(look), 'brightness(150%) contrast(110%) saturate(90%) hue-rotate(-10deg) blur(1px)');
});
