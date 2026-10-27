import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  cameraAngles,
  forwardFromRotation,
  fromBlenderLocation,
  fromBlenderRotation,
  fromBlenderScale,
  lookAtRotation,
  toBlenderLocation,
  toBlenderRotation,
  toBlenderScale,
} from './coords.ts';

const close = (actual: number, expected: number, eps = 1e-3) =>
  assert.ok(Math.abs(actual - expected) < eps, `expected ${expected}, got ${actual}`);
const closeVec = (actual: { x: number; y: number; z: number }, expected: number[], eps = 1e-3) => {
  close(actual.x, expected[0], eps);
  close(actual.y, expected[1], eps);
  close(actual.z, expected[2], eps);
};
/** three.js vector → Blender vector. */
const toB = (v: { x: number; y: number; z: number }) => ({ x: v.x, y: -v.z, z: v.y });

test('locations swap Y and Z with Blender Z up', () => {
  assert.deepEqual(toBlenderLocation({ x: 1, y: 2, z: 3 }), { x: 1, y: -3, z: 2 });
  assert.deepEqual(fromBlenderLocation({ x: 5, y: -6, z: 1.6 }), { x: 5, y: 1.6, z: 6 });
  assert.deepEqual(fromBlenderLocation(toBlenderLocation({ x: 0.3, y: -1.2, z: 7 })), { x: 0.3, y: -1.2, z: 7 });
});

test('mesh scale swaps the Y and Z factors', () => {
  assert.deepEqual(toBlenderScale({ x: 1, y: 2, z: 3 }), { x: 1, y: 3, z: 2 });
  assert.deepEqual(fromBlenderScale({ x: 10, y: 10, z: 0.05 }), { x: 10, y: 0.05, z: 10 });
});

// Oracle values read from Blender 5.2.2 (Euler XYZ → matrix columns), see setdesign-blender-plan.md.
test('camera rotation matches Blender: rot (84°, 0°, 40°) looks along Blender (-0.639, 0.762, -0.105)', () => {
  const three = fromBlenderRotation({ x: 84, y: 0, z: 40 }, 'camera');
  closeVec(toB(forwardFromRotation(three)), [-0.639266, 0.761848, -0.104528]);
  closeVec(toBlenderRotation(three, 'camera'), [84, 0, 40], 1e-2);
});

test('camera rotation (90°, 0°, 0°) in Blender looks level along +Y, which is identity in three.js', () => {
  const three = fromBlenderRotation({ x: 90, y: 0, z: 0 }, 'camera');
  closeVec(three, [0, 0, 0], 1e-3);
  closeVec(toBlenderRotation({ x: 0, y: 0, z: 0 }, 'camera'), [90, 0, 0], 1e-3);
});

test('camera rotation with roll matches Blender: rot (60°, 10°, -120°)', () => {
  const three = fromBlenderRotation({ x: 60, y: 10, z: -120 }, 'camera');
  closeVec(toB(forwardFromRotation(three)), [0.793412, -0.357821, -0.492404]);
  closeVec(toBlenderRotation(three, 'camera'), [60, 10, -120], 1e-2);
});

test('mesh rotation keeps the local axes: rot (30°, 45°, 60°)', () => {
  const three = fromBlenderRotation({ x: 30, y: 45, z: 60 }, 'mesh');
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(three.x * Math.PI / 180, three.y * Math.PI / 180, three.z * Math.PI / 180, 'XYZ'));
  // Blender local X stays three local X; Blender local Y is three local -Z.
  const xAxis = new THREE.Vector3(1, 0, 0).applyMatrix4(m);
  const yAxis = new THREE.Vector3(0, 0, -1).applyMatrix4(m);
  closeVec(toB(xAxis), [0.353553, 0.612372, -0.707107]);
  closeVec(toB(yAxis), [-0.573223, 0.739199, 0.353553]);
  closeVec(toBlenderRotation(three, 'mesh'), [30, 45, 60], 1e-2);
});

test('identity mesh rotation is identity in both programs', () => {
  assert.deepEqual(toBlenderRotation({ x: 0, y: 0, z: 0 }, 'mesh'), { x: 0, y: 0, z: 0 });
});

test('lookAtRotation aims the local -Z axis at the target', () => {
  const rotation = lookAtRotation({ x: 5, y: 1.6, z: 6 }, { x: 0, y: 1, z: 0 });
  const forward = forwardFromRotation(rotation);
  const expected = new THREE.Vector3(-5, -0.6, -6).normalize();
  closeVec(forward, [expected.x, expected.y, expected.z]);
  // Straight down stays defined.
  const down = forwardFromRotation(lookAtRotation({ x: 0, y: 5, z: 0 }, { x: 0, y: 0, z: 0 }));
  closeVec(down, [0, -1, 0]);
});

test('cameraAngles reports pitch, heading and roll in Blender terms', () => {
  const angles = cameraAngles(fromBlenderRotation({ x: 84, y: 0, z: 40 }, 'camera'));
  close(angles.pitchDown, 6, 0.05);
  close(angles.heading, 40, 0.05);
  close(angles.roll, 0, 0.05);
  const rolled = cameraAngles(fromBlenderRotation({ x: 90, y: 10, z: 0 }, 'camera'));
  close(Math.abs(rolled.roll), 10, 0.05);
});
