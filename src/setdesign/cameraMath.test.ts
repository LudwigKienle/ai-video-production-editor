import test from 'node:test';
import assert from 'node:assert/strict';

import {
  describeCamera,
  fitCameraFrame,
  horizontalFovDeg,
  lensForVerticalFov,
  verticalFovDeg,
  viewOffsetForShift,
} from './cameraMath.ts';
import { fromBlenderRotation } from './coords.ts';
import type { SetDesignCameraObject } from '../types';

const close = (actual: number, expected: number, eps = 0.01) =>
  assert.ok(Math.abs(actual - expected) < eps, `expected ${expected}, got ${actual}`);

const cam = (patch: Partial<SetDesignCameraObject> = {}): SetDesignCameraObject => ({
  id: 'c1',
  name: 'Kamera',
  position: { x: 0, y: 1.6, z: 5 },
  rotation: { x: 0, y: 0, z: 0 },
  lensMm: 50,
  sensorWidthMm: 36,
  ...patch,
});

test('50 mm on a 36 mm sensor gives the textbook 39.6° horizontal view', () => {
  close(horizontalFovDeg(cam(), 16 / 9), 39.598);
  // Landscape: width governs, vertical follows the aspect ratio.
  close(verticalFovDeg(cam(), 16 / 9), 22.895);
});

test('auto fit puts the sensor width on the long side of portrait frames', () => {
  // 9:16 portrait: the 36 mm now spans the frame height.
  close(verticalFovDeg(cam(), 9 / 16), 39.598);
  close(verticalFovDeg(cam({ sensorFit: 'horizontal' }), 9 / 16), 2 * Math.atan(Math.tan(39.598 * Math.PI / 360) * 16 / 9) * 180 / Math.PI, 0.02);
  close(verticalFovDeg(cam({ sensorFit: 'vertical', sensorHeightMm: 24 }), 16 / 9), 26.991);
});

test('Super 35 at 35 mm (the Colonius plate) frames 39.15° horizontally', () => {
  close(horizontalFovDeg(cam({ lensMm: 35, sensorWidthMm: 24.89 }), 16 / 9), 39.148);
});

test('lensForVerticalFov inverts verticalFovDeg', () => {
  for (const lensMm of [18, 24, 35, 50, 85, 135]) {
    const camera = cam({ lensMm, sensorWidthMm: 24.89 });
    close(lensForVerticalFov(verticalFovDeg(camera, 16 / 9), camera, 16 / 9), lensMm, 0.02);
  }
});

test('lens shift moves the frame by its larger dimension', () => {
  assert.deepEqual(viewOffsetForShift(0.1, 0, 1920, 1080), { x: 192, y: -0 });
  assert.deepEqual(viewOffsetForShift(0, 0.25, 1080, 1920), { x: 0, y: -480 });
});

test('fitCameraFrame letterboxes the output frame in the viewport', () => {
  const frame = fitCameraFrame(1000, 1000, 16 / 9, 0);
  close(frame.width, 1000);
  close(frame.height, 562.5);
  close(frame.y, 218.75);
});

test('describeCamera writes a sober set-up line in German and English', () => {
  const camera = cam({ lensMm: 35, sensorWidthMm: 24.89, position: { x: 0, y: 1.6, z: 5 }, rotation: fromBlenderRotation({ x: 82, y: 0, z: 0 }, 'camera') });
  const text = describeCamera(camera, 16 / 9);
  assert.equal(text.de, '35 mm (Super 35), Kamerahöhe 1,60 m, 8° Aufsicht, Bildwinkel 39° horizontal');
  assert.equal(text.en, '35mm lens on Super 35, camera 1.60 m above the floor, tilted down 8°, 39° horizontal field of view');
  const level = describeCamera(cam(), 16 / 9);
  assert.match(level.de, /gerade/);
  assert.match(level.en, /on full frame/);
});
