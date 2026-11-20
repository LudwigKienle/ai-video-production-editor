/**
 * three.js scene graph built from the set design state (no WebGL needed): groups nest their
 * children, world transforms match the document, PBR maps load with the right colour space and
 * tiling, failed maps are not fatal, and the clay pass ignores maps.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import type { SetDesignState } from '../types';
import { createSetDesignBus } from './bus.ts';
import { createDefaultSetDesignState } from './sceneModel.ts';
import { createSetScene } from './sceneBuilder.ts';
import { worldMatrix } from './hierarchy.ts';
import { worldBoxes } from './spatial.ts';

const build = () => {
  let stored: SetDesignState | null = createDefaultSetDesignState();
  let n = 0;
  const bus = createSetDesignBus({ makeId: (prefix) => `${prefix}-${++n}` });
  bus.attachHost({ getScene: () => stored, setScene: (next) => { stored = next; } });
  return bus;
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const meshes = (object: THREE.Object3D) => { const out: THREE.Mesh[] = []; object.traverse((child) => { if ((child as THREE.Mesh).isMesh) out.push(child as THREE.Mesh); }); return out; };

test('the three.js scene mirrors the hierarchy and world transforms of the state', () => {
  const bus = build();
  bus.run('build.room', { name: 'Room', location: [2, 1, 0], rotationZ: 30, openings: [{ wall: 'south', type: 'door' }] });
  bus.run('build.furniture', { type: 'table', name: 'Table', parent: 'Room', location: [0.5, 0.2, 0] });
  const state = bus.getScene();
  const set = createSetScene({ mode: 'capture' });
  set.sync(state);
  const room = state.assets.find((a) => a.name === 'Room')!;
  const roomRoot = set.objectFor(room.id)!;
  assert.equal(roomRoot.parent, set.scene, 'top-level group hangs on the scene');
  for (const asset of state.assets) {
    const root = set.objectFor(asset.id)!;
    assert.ok(root, asset.name);
    if (asset.parentId) assert.equal(root.parent, set.objectFor(asset.parentId), `${asset.name} nested under its parent`);
    root.updateWorldMatrix(true, false);
    const expected = worldMatrix(state, asset.id).elements;
    root.matrixWorld.elements.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-6, `${asset.name} world matrix[${i}]`));
    assert.equal(set.contentFor(asset.id) === null, asset.kind === 'group');
  }
  // Viewport bounds of a group enclose its parts and agree with the analytic query.
  const fromScene = set.bounds([room.id])!;
  const analytic = worldBoxes(state).get(room.id)!.box;
  for (const key of ['min', 'max'] as const) for (const axis of ['x', 'y', 'z'] as const) assert.ok(Math.abs(fromScene[key][axis] - analytic[key][axis]) < 1e-4, `${key}.${axis}`);
  // Re-parenting in the state re-parents the three.js objects; deleting a group removes its parts.
  bus.run('object.parent', { objects: ['Table'], parent: null });
  set.sync(bus.getScene());
  const table = bus.getScene().assets.find((a) => a.name === 'Table')!;
  assert.equal(set.objectFor(table.id)!.parent, set.scene);
  bus.run('object.delete', { objects: ['Room'] });
  set.sync(bus.getScene());
  assert.equal(set.objectFor(room.id), null);
  assert.ok(set.objectFor(table.id), 'the table survived');
  set.dispose();
});

test('PBR maps load with sRGB/linear colour spaces and tiling; failures are reported, clay ignores maps', async () => {
  const bus = build();
  bus.run('object.add_primitive', { primitive: 'box', name: 'Crate', dimensions: [1, 1, 1] });
  bus.run('material.set', {
    objects: ['Crate'],
    maps: { baseColor: 'https://example.com/diff.jpg', normal: 'https://example.com/nor.png', roughness: 'https://example.com/broken.png', emissive: 'https://example.com/glow.jpg' },
    repeat: [3, 2],
    emissiveIntensity: 2,
  });
  const loaded: string[] = [];
  const errors: string[] = [];
  const set = createSetScene({
    mode: 'capture',
    loadTexture: async (url) => {
      loaded.push(url);
      if (url.includes('broken')) throw new Error('404');
      return new THREE.Texture();
    },
    onTextureError: (_asset, url) => { errors.push(url); },
  });
  const state = { ...bus.getScene(), shading: 'material' as const };
  set.sync(state);
  await flush();
  const crate = state.assets.find((a) => a.name === 'Crate')!;
  const material = meshes(set.contentFor(crate.id)!)[0].material as THREE.MeshStandardMaterial;
  assert.ok(material.map, 'base colour map');
  assert.equal(material.map!.colorSpace, THREE.SRGBColorSpace);
  assert.equal(material.normalMap!.colorSpace, THREE.NoColorSpace);
  assert.equal(material.emissiveMap!.colorSpace, THREE.SRGBColorSpace);
  assert.equal(material.roughnessMap, null, 'the broken map is skipped');
  assert.deepEqual([material.map!.repeat.x, material.map!.repeat.y], [3, 2]);
  assert.equal(material.map!.wrapS, THREE.RepeatWrapping);
  assert.equal(material.emissiveIntensity, 2);
  assert.deepEqual(errors, ['https://example.com/broken.png']);
  // Solid shading and the clay pass draw without maps.
  set.sync({ ...state, shading: 'solid' });
  assert.equal((meshes(set.contentFor(crate.id)!)[0].material as THREE.MeshStandardMaterial).map, null);
  set.sync(state, { pass: 'clay' });
  assert.equal((meshes(set.contentFor(crate.id)!)[0].material as THREE.MeshStandardMaterial).map, null);
  set.dispose();
});

test('the person stand-in fills its nominal 0.5 × 0.3 × 1.75 m box', () => {
  const bus = build();
  bus.run('object.add_primitive', { primitive: 'person', name: 'Anna' });
  const state = bus.getScene();
  const set = createSetScene({ mode: 'capture' });
  set.sync(state);
  const id = state.assets[0].id;
  const box = set.bounds([id])!;
  const analytic = worldBoxes(state).get(id)!.box;
  for (const key of ['min', 'max'] as const) for (const axis of ['x', 'y', 'z'] as const) assert.ok(Math.abs(box[key][axis] - analytic[key][axis]) < 0.01, `${key}.${axis}: ${box[key][axis]} vs ${analytic[key][axis]}`);
  assert.ok(Math.abs(box.min.y) < 1e-3, 'feet on the floor');
  set.dispose();
});
