import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clampRect, combineBounds, compositeForMode, dragCropHandle, fitRatioRect, rectFromDrag, resolveCropRatio,
  roundOutRect, selectionModeFromModifiers, unionRect,
} from './selection.ts';

test('marquee drag: any direction, Shift square, Alt from centre', () => {
  assert.deepEqual(rectFromDrag({ x: 50, y: 50 }, { x: 10, y: 20 }), { x: 10, y: 20, width: 40, height: 30 });
  assert.deepEqual(rectFromDrag({ x: 0, y: 0 }, { x: 40, y: 10 }, { square: true }), { x: 0, y: 0, width: 40, height: 40 });
  assert.deepEqual(rectFromDrag({ x: 50, y: 50 }, { x: 60, y: 55 }, { fromCenter: true }), { x: 40, y: 45, width: 20, height: 10 });
  assert.deepEqual(rectFromDrag({ x: 0, y: 0 }, { x: 160, y: 10 }, { ratio: 16 / 9 }), { x: 0, y: 0, width: 160, height: 90 });
});

test('selection modes from modifiers', () => {
  assert.equal(selectionModeFromModifiers('new', true, false, false), 'new', 'nothing to add to');
  assert.equal(selectionModeFromModifiers('new', true, false, true), 'add');
  assert.equal(selectionModeFromModifiers('new', false, true, true), 'subtract');
  assert.equal(selectionModeFromModifiers('add', true, true, true), 'intersect');
  assert.equal(selectionModeFromModifiers('subtract', false, false, true), 'subtract');
  assert.equal(compositeForMode('subtract'), 'destination-out');
  assert.equal(compositeForMode('intersect'), 'destination-in');
  assert.equal(compositeForMode('add'), 'source-over');
});

test('bounds stay conservative across modes', () => {
  const a = { x: 0, y: 0, width: 10, height: 10 };
  const b = { x: 5, y: 5, width: 10, height: 10 };
  assert.deepEqual(combineBounds(a, b, 'add'), { x: 0, y: 0, width: 15, height: 15 });
  assert.deepEqual(combineBounds(a, b, 'subtract'), a);
  assert.deepEqual(combineBounds(a, b, 'intersect'), { x: 5, y: 5, width: 5, height: 5 });
  assert.deepEqual(combineBounds(a, b, 'new'), b);
  assert.equal(combineBounds(a, { x: 20, y: 20, width: 1, height: 1 }, 'intersect'), null);
  assert.deepEqual(unionRect(null, a), a);
  assert.deepEqual(clampRect({ x: -5, y: 2, width: 20, height: 4 }, 10, 10), { x: 0, y: 2, width: 10, height: 4 });
  assert.deepEqual(roundOutRect({ x: 0.5, y: 1.2, width: 2, height: 2 }), { x: 0, y: 1, width: 3, height: 3 });
});

test('crop box: ratio fit and handle dragging', () => {
  assert.deepEqual(fitRatioRect(400, 300, 1), { x: 50, y: 0, width: 300, height: 300 });
  assert.equal(resolveCropRatio(-1, 400, 200), 2);
  const start = { x: 0, y: 0, width: 100, height: 50 };
  assert.deepEqual(dragCropHandle(start, 'se', 20, 10, null), { x: 0, y: 0, width: 120, height: 60 });
  assert.deepEqual(dragCropHandle(start, 'move', 5, 5, null), { x: 5, y: 5, width: 100, height: 50 });
  const constrained = dragCropHandle(start, 'e', 100, 0, 2);
  assert.deepEqual(constrained, { x: 0, y: 0, width: 200, height: 100 });
  const tiny = dragCropHandle(start, 'w', 500, 0, null, 1);
  assert.equal(tiny.width, 1);
});
