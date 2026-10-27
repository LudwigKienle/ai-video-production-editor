/**
 * Coordinate conventions for the set design workspace.
 *
 * Storage and rendering use three.js (Y up, metres, Euler XYZ in degrees). The UI and the
 * agent tools speak the Blender convention set designers know: Z up, Y pointing "into" the
 * scene, Euler "XYZ" in degrees (rotation Rz·Ry·Rx, i.e. three.js order 'ZYX').
 *
 *   blender (x, y, z)  ←→  three (x, z, -y)
 *
 * Meshes keep their local axes through the conversion (glTF/OBJ assets are authored Y-up and
 * Blender's importers convert them the same way). Cameras and lights look along their local -Z
 * in both programs, so their local axes are not converted.
 */
import * as THREE from 'three';
import type { SetDesignTransform } from '../types';

export type Vec3 = SetDesignTransform;
export type RotationKind = 'mesh' | 'camera' | 'light';

const DEG = Math.PI / 180;

/** Maps Blender vectors into three.js space: v_three = C · v_blender. */
const C = new THREE.Matrix4().set(
  1, 0, 0, 0,
  0, 0, 1, 0,
  0, -1, 0, 0,
  0, 0, 0, 1,
);
const C_INV = C.clone().transpose();

const clean = (value: number, digits = 4) => {
  const rounded = Number(value.toFixed(digits));
  return Object.is(rounded, -0) ? 0 : rounded;
};
const cleanVec = (v: Vec3, digits = 4): Vec3 => ({ x: clean(v.x, digits), y: clean(v.y, digits), z: clean(v.z, digits) });

export const toBlenderLocation = (v: Vec3): Vec3 => cleanVec({ x: v.x, y: -v.z, z: v.y });
export const fromBlenderLocation = (v: Vec3): Vec3 => cleanVec({ x: v.x, y: v.z, z: -v.y });

/** Mesh scale per axis: three (sx, sy, sz) is Blender (sx, sz, sy). */
export const toBlenderScale = (v: Vec3): Vec3 => cleanVec({ x: v.x, y: v.z, z: v.y });
export const fromBlenderScale = (v: Vec3): Vec3 => cleanVec({ x: v.x, y: v.z, z: v.y });

const threeRotationMatrix = (deg: Vec3) =>
  new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(deg.x * DEG, deg.y * DEG, deg.z * DEG, 'XYZ'));
const blenderRotationMatrix = (deg: Vec3) =>
  new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(deg.x * DEG, deg.y * DEG, deg.z * DEG, 'ZYX'));

const eulerDeg = (matrix: THREE.Matrix4, order: THREE.EulerOrder): Vec3 => {
  const e = new THREE.Euler().setFromRotationMatrix(matrix, order);
  return cleanVec({ x: e.x / DEG, y: e.y / DEG, z: e.z / DEG }, 3);
};

/** three.js rotation (deg, XYZ) → Blender rotation (deg, XYZ). */
export const toBlenderRotation = (deg: Vec3, kind: RotationKind = 'mesh'): Vec3 => {
  const r = C_INV.clone().multiply(threeRotationMatrix(deg));
  if (kind === 'mesh') r.multiply(C);
  return eulerDeg(r, 'ZYX');
};

/** Blender rotation (deg, XYZ) → three.js rotation (deg, XYZ). */
export const fromBlenderRotation = (deg: Vec3, kind: RotationKind = 'mesh'): Vec3 => {
  const r = C.clone().multiply(blenderRotationMatrix(deg));
  if (kind === 'mesh') r.multiply(C_INV);
  return eulerDeg(r, 'XYZ');
};

/** Direction an object with this three.js rotation looks along (its local -Z), in three.js space. */
export const forwardFromRotation = (deg: Vec3): Vec3 => {
  const v = new THREE.Vector3(0, 0, -1).applyMatrix4(threeRotationMatrix(deg));
  return { x: v.x, y: v.y, z: v.z };
};

/** three.js rotation (deg) that points a camera/light at `target` with world Y up (no roll). */
export const lookAtRotation = (position: Vec3, target: Vec3): Vec3 => {
  const eye = new THREE.Vector3(position.x, position.y, position.z);
  const at = new THREE.Vector3(target.x, target.y, target.z);
  if (eye.distanceToSquared(at) < 1e-12) return { x: 0, y: 0, z: 0 };
  const up = new THREE.Vector3(0, 1, 0);
  // Straight up/down: pick a stable up vector so lookAt stays defined.
  if (Math.abs(at.clone().sub(eye).normalize().dot(up)) > 0.9999) up.set(0, 0, -1);
  const m = new THREE.Matrix4().lookAt(eye, at, up);
  return eulerDeg(m, 'XYZ');
};

/** Pitch (positive = looking down) and heading in degrees for a camera rotation, plus roll. */
export const cameraAngles = (deg: Vec3) => {
  const m = threeRotationMatrix(deg);
  const forward = new THREE.Vector3(0, 0, -1).applyMatrix4(m);
  const right = new THREE.Vector3(1, 0, 0).applyMatrix4(m);
  const pitchDown = clean(-Math.asin(Math.max(-1, Math.min(1, forward.y))) / DEG, 2);
  // Heading in Blender terms: 0° looks along +Y (into the scene), positive turns left (counter-clockwise from above).
  const heading = clean(Math.atan2(-forward.x, -forward.z) / DEG, 2);
  // Roll: tilt of the camera's right axis against the horizon (positive = right side up).
  const roll = clean(Math.asin(Math.max(-1, Math.min(1, right.y))) / DEG, 2);
  return { pitchDown, heading, roll };
};
