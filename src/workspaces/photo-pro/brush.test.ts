import test from 'node:test';
import assert from 'node:assert/strict';

import { dabSpacing, dabsBounds, hardnessStops, hexToRgb, interpolateDabs, rgbToHex, stepBrushSize } from './brush.ts';

test('dabs are evenly spaced across pointer events', () => {
  const a = interpolateDabs({ x: 0, y: 0 }, { x: 10, y: 0 }, 4, 0);
  assert.deepEqual(a.points.map((p) => p.x), [4, 8]);
  assert.equal(a.carry, 2);
  const b = interpolateDabs({ x: 10, y: 0 }, { x: 13, y: 0 }, 4, a.carry);
  assert.deepEqual(b.points.map((p) => p.x), [12]);
  assert.equal(b.carry, 1);
  const c = interpolateDabs({ x: 13, y: 0 }, { x: 14, y: 0 }, 4, b.carry);
  assert.equal(c.points.length, 0);
  assert.equal(c.carry, 2);
  assert.equal(dabSpacing(100), 25);
});

test('hardness stops, bounds, size steps and colour helpers', () => {
  assert.deepEqual(hardnessStops(1)[0], [0, 1]);
  assert.equal(hardnessStops(0.5).length, 4);
  assert.deepEqual(dabsBounds([{ x: 10, y: 10 }], 10), { x: 3, y: 3, width: 14, height: 14 });
  assert.equal(stepBrushSize(45, 1), 50);
  assert.equal(stepBrushSize(1, -1), 1);
  assert.deepEqual(hexToRgb('#ff8000'), [255, 128, 0]);
  assert.equal(rgbToHex(255, 128, 0), '#ff8000');
});
