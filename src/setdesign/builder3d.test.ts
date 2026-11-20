/**
 * The agentic 3D builder without DOM: hierarchy and groups, PBR material.set, atomic batches,
 * spatial queries, layout commands and procedural pieces, all through the command bus.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import type { SetDesignAsset, SetDesignState } from '../types';
import { createSetDesignBus } from './bus.ts';
import { createDefaultSetDesignState, normalizeSetDesignState, outlinerItems } from './sceneModel.ts';
import { worldMatrix } from './hierarchy.ts';
import { querySpatial, worldBoxes, toBlenderBox } from './spatial.ts';
import { roomParts } from './builders.ts';
import { toBlenderLocation } from './coords.ts';
import { buildBlenderScript } from './blenderExport.ts';
import * as THREE from 'three';

const setup = (initial: SetDesignState | null = createDefaultSetDesignState()) => {
  let stored: SetDesignState | null = initial;
  let n = 0;
  const bus = createSetDesignBus({ makeId: (prefix) => `${prefix}-${++n}` });
  bus.attachHost({ getScene: () => stored, setScene: (next) => { stored = next; } });
  const run = (id: string, args: Record<string, unknown> = {}) => bus.run(id, args) as any;
  const asset = (name: string) => bus.getScene().assets.find((a) => a.name === name)!;
  return { bus, run, asset, scene: () => bus.getScene() };
};

const close = (actual: number, expected: number, eps = 1e-6) => assert.ok(Math.abs(actual - expected) < eps, `expected ${expected}, got ${actual}`);
const closeVec = (actual: number[], expected: number[], eps = 1e-6) => actual.forEach((value, i) => close(value, expected[i], eps));
/** World origin of an asset in Blender coordinates. */
const worldLoc = (scene: SetDesignState, id: string) => {
  const p = new THREE.Vector3().setFromMatrixPosition(worldMatrix(scene, id));
  const b = toBlenderLocation({ x: p.x, y: p.y, z: p.z });
  return [b.x, b.y, b.z];
};

// ---------------------------------------------------------------------------
// Hierarchy

test('group.create keeps world positions, makes children parent-relative and nests in the outliner', () => {
  const { run, asset, scene } = setup();
  run('object.add_primitive', { primitive: 'box', name: 'A', location: [1, 2, 0.5] });
  run('object.add_primitive', { primitive: 'box', name: 'B', location: [3, 2, 0.5] });
  const before = { a: worldLoc(scene(), asset('A').id), b: worldLoc(scene(), asset('B').id) };
  const result = run('group.create', { objects: ['A', 'B'], name: 'Pair' });
  const group = asset('Pair');
  assert.equal(group.kind, 'group');
  assert.equal(result.id, group.id);
  assert.equal(asset('A').parentId, group.id);
  // Group origin = bottom centre of the contents.
  closeVec(worldLoc(scene(), group.id), [2, 2, 0]);
  closeVec(worldLoc(scene(), asset('A').id), before.a);
  closeVec(worldLoc(scene(), asset('B').id), before.b);
  // Local location of A relative to the group.
  const local = toBlenderLocation(asset('A').position);
  closeVec([local.x, local.y, local.z], [-1, 0, 0.5]);
  // Moving the group moves the children.
  run('object.transform', { object: 'Pair', location: [2, 5, 0], rotation: [0, 0, 90] });
  closeVec(worldLoc(scene(), asset('A').id), [2, 4, 0.5], 1e-4);
  const rows = outlinerItems(scene());
  const pair = rows.findIndex((row) => row.id === group.id);
  assert.equal(rows[pair].childCount, 2);
  assert.deepEqual(rows.slice(pair + 1, pair + 3).map((row) => [row.name, row.depth, row.parentId]), [['A', 1, group.id], ['B', 1, group.id]]);
});

test('group.ungroup and object.parent keep the world transform; cycles are refused', () => {
  const { run, asset, scene } = setup();
  run('object.add_primitive', { primitive: 'box', name: 'Child', location: [1, 0, 0.5] });
  run('group.create', { objects: ['Child'], name: 'G', location: [0, 0, 0] });
  run('object.transform', { object: 'G', location: [0, 0, 1], rotation: [0, 0, 45], scale: [2, 2, 2] });
  const world = worldLoc(scene(), asset('Child').id);
  run('group.ungroup', { objects: ['G'] });
  assert.equal(scene().assets.some((a) => a.name === 'G'), false);
  assert.equal(asset('Child').parentId, undefined);
  closeVec(worldLoc(scene(), asset('Child').id), world, 1e-4);
  close(asset('Child').scale.x, 2, 1e-5);

  run('object.add_primitive', { primitive: 'box', name: 'P', location: [5, 0, 0.5] });
  run('object.parent', { objects: ['Child'], parent: 'P' });
  closeVec(worldLoc(scene(), asset('Child').id), world, 1e-4);
  assert.throws(() => run('object.parent', { objects: ['P'], parent: 'Child' }), /loop/);
  // keepWorld=false keeps the numbers: the child jumps with its parent.
  const localBefore = { ...asset('Child').position };
  run('object.parent', { objects: ['Child'], parent: null, keepWorld: false });
  assert.deepEqual(asset('Child').position, localBefore);
  assert.equal(asset('Child').parentId, undefined);
});

test('duplicate and delete work on whole groups; space=world transforms children in world terms', () => {
  const { run, asset, scene } = setup();
  run('build.furniture', { type: 'table', name: 'Tisch', location: [0, 0, 0] });
  const parts = scene().assets.filter((a) => a.parentId === asset('Tisch').id).length;
  assert.equal(parts, 5);
  const dup = run('object.duplicate', { objects: ['Tisch'], offset: [2, 0, 0] });
  const copy = scene().assets.find((a) => a.id === dup.created[0].id)!;
  assert.equal(copy.kind, 'group');
  assert.equal(scene().assets.filter((a) => a.parentId === copy.id).length, 5);
  closeVec(worldLoc(scene(), copy.id), [2, 0, 0]);
  // A part moved to a world position.
  const leg = scene().assets.find((a) => a.parentId === copy.id && a.name.includes('Leg'))!;
  run('object.transform', { object: leg.id, location: [10, 0, 0.5], space: 'world' });
  closeVec(worldLoc(scene(), leg.id), [10, 0, 0.5], 1e-4);
  const total = scene().assets.length;
  run('object.delete', { objects: [copy.id] });
  assert.equal(scene().assets.length, total - 6);
  assert.equal(scene().assets.some((a) => a.parentId === copy.id), false);
});

test('old scenes without parentId stay unchanged; broken parent links are dropped', () => {
  const legacy = createDefaultSetDesignState();
  legacy.assets = [
    { id: 'a', name: 'Alt', kind: 'primitive', primitive: 'box', position: { x: 1, y: 0.5, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, material: { color: '#ff0000' } },
  ];
  const normalized = normalizeSetDesignState(legacy);
  assert.deepEqual(normalized.assets, legacy.assets);
  const broken = normalizeSetDesignState({
    ...legacy,
    assets: [
      { ...legacy.assets[0], id: 'x', parentId: 'missing' },
      { ...legacy.assets[0], id: 'y', name: 'Y', parentId: 'z' },
      { ...legacy.assets[0], id: 'z', name: 'Z', parentId: 'y' },
    ],
  });
  assert.deepEqual(broken.assets.map((a) => a.parentId), [undefined, undefined, undefined]);
});

// ---------------------------------------------------------------------------
// Materials

test('material.set stores PBR values and maps, applies to group contents, validates input', () => {
  const { run, asset, scene } = setup();
  run('build.furniture', { type: 'chair', name: 'Stuhl' });
  run('object.add_model', { url: 'https://example.com/lamp.glb', name: 'Lampe' });
  const result = run('material.set', {
    objects: ['Stuhl', 'Lampe'],
    color: '8A6F55',
    roughness: 1.4,
    metalness: 0.1,
    emissive: '#000000',
    maps: { baseColor: 'https://example.com/diff.jpg', normal: '/textures/nor_gl.png', roughness: 'data:image/png;base64,AAA' },
    repeat: [2, 3],
    displacementScale: 0.01,
    name: 'Poly Haven · brown_planks_09',
    attribution: { author: 'Poly Haven', license: 'CC0', url: 'https://polyhaven.com' },
  });
  const parts = scene().assets.filter((a) => a.parentId === asset('Stuhl').id);
  assert.equal(result.objects.length, parts.length + 1);
  for (const part of parts) {
    assert.equal(part.material!.color, '#8a6f55');
    assert.equal(part.material!.roughness, 1);
    assert.deepEqual(part.material!.repeat, [2, 3]);
    assert.equal(part.material!.maps!.normal, 'file:///textures/nor_gl.png');
    assert.equal(part.material!.name, 'Poly Haven · brown_planks_09');
    assert.equal(part.material!.attribution!.license, 'CC0');
  }
  assert.equal(asset('Stuhl').material, undefined, 'groups hold no material');
  assert.equal(asset('Lampe').material!.replaceModelMaterials, true);
  // Merge, remove one map, clear all.
  run('material.set', { objects: ['Lampe'], maps: { ao: 'https://example.com/ao.jpg', normal: '' } });
  assert.deepEqual(Object.keys(asset('Lampe').material!.maps!).sort(), ['ao', 'baseColor', 'roughness']);
  run('material.set', { objects: ['Lampe'], clearMaps: true, opacity: 0.5 });
  assert.equal(asset('Lampe').material!.maps, undefined);
  assert.equal(asset('Lampe').material!.transparent, true);
  assert.throws(() => run('material.set', { objects: ['Lampe'], maps: { diffuse: 'https://x/y.jpg' } }), /Unknown map "diffuse"/);
  assert.throws(() => run('material.set', { objects: ['Lampe'], maps: { normal: 'textures/n.png' } }), /file:\/\/, https:\/\/ or data:/);
  assert.throws(() => run('material.set', { objects: ['Lampe'], color: 'red' }), /hex colour/);
  assert.throws(() => run('material.set', { objects: ['Kamera'] }), /camera/);
});

// ---------------------------------------------------------------------------
// Batch

test('scene.batch is atomic, one undo step, resolves names/aliases and returns every result', () => {
  const { bus, run, scene } = setup();
  const before = scene();
  const result = run('scene.batch', {
    label: 'Küche bauen',
    commands: [
      { command: 'build.room', args: { name: 'Kitchen', width: 4, depth: 3 }, as: 'room' },
      { command: 'object.add_primitive', args: { primitive: 'box', name: 'Counter', dimensions: [2, 0.6, 0.9], parent: '$room' } },
      { command: 'material.set', args: { objects: ['Counter'], color: '#ffffff' } },
      { command: 'object.drop_to_floor', args: { objects: ['$2'] } },
    ],
  });
  assert.equal(result.steps, 4);
  assert.equal(result.results.length, 4);
  assert.ok(result.created.room.startsWith('grp-'));
  const counter = scene().assets.find((a) => a.name === 'Counter')!;
  assert.equal(counter.parentId, result.created.room);
  assert.equal(result.results[1].id, counter.id);
  assert.deepEqual(bus.history().undo, ['Küche bauen']);
  const boxes = worldBoxes(scene());
  close(boxes.get(counter.id)!.box.min.y, 0, 1e-6);

  // Failure in the last step: nothing changes, no undo step.
  const mid = scene();
  assert.throws(() => run('scene.batch', { commands: [
    { command: 'object.add_primitive', args: { primitive: 'box', name: 'Ghost' } },
    { command: 'material.set', args: { objects: ['Ghost'], color: '#00ff00' } },
    { command: 'object.transform', args: { object: 'DoesNotExist', location: [0, 0, 0] } },
  ] }), /Step 3 \(object\.transform\) failed: No object "DoesNotExist".*Nothing was changed/);
  assert.equal(scene(), mid);
  assert.equal(scene().assets.some((a) => a.name === 'Ghost'), false);
  assert.deepEqual(bus.history().undo, ['Küche bauen']);
  assert.throws(() => run('scene.batch', { commands: [{ command: 'edit.undo' }] }), /undo\/redo cannot run inside a batch/);
  assert.throws(() => run('scene.batch', { commands: [{ command: 'object.add_primitive', args: { primitive: 'box', parent: '$nope' } }] }), /Unknown reference \$nope/);

  bus.undo();
  assert.deepEqual(scene().assets, before.assets);
});

// ---------------------------------------------------------------------------
// Spatial queries

test('setdesign query values for primitives are exact (boxes, floor contact, overlaps, distances, camera)', () => {
  const { run, scene } = setup();
  run('object.add_primitive', { primitive: 'box', name: 'Box', dimensions: [2, 1, 0.5], location: [1, 2, 0.25] });
  run('object.add_primitive', { primitive: 'cylinder', name: 'Cyl', dimensions: [0.4, 0.4, 1], location: [5, 0, 1.5] });
  run('object.add_primitive', { primitive: 'sphere', name: 'Ball', dimensions: [0.5, 0.5, 0.5], location: [1.5, 2, 0.6] });
  run('object.add_primitive', { primitive: 'box', name: 'Post', dimensions: [0.2, 0.2, 2], location: [-3, 0, 0.8] });
  run('object.add_primitive', { primitive: 'box', name: 'Turned', dimensions: [2, 1, 1], location: [-6, 0, 0.5], rotation: [0, 0, 90] });
  const q = querySpatial(scene());
  const get = (name: string) => q.objects.find((o) => o.name === name)!;
  assert.deepEqual(get('Box').bounds, { min: [0, 1.5, 0], max: [2, 2.5, 0.5] });
  assert.deepEqual(get('Box').dimensions, [2, 1, 0.5]);
  assert.equal(get('Box').boundsSource, 'analytic');
  assert.equal(get('Box').floor!.status, 'on_floor');
  assert.deepEqual(get('Cyl').bounds, { min: [4.8, -0.2, 1], max: [5.2, 0.2, 2] });
  assert.equal(get('Cyl').floor!.status, 'floating');
  assert.equal(get('Cyl').floor!.gap, 1);
  // The ball rests on the box (bottom at 0.35 < box top 0.5 → overlap) …
  assert.deepEqual(get('Ball').bounds.min, [1.25, 1.75, 0.35]);
  assert.equal(get('Ball').floor!.status, 'supported');
  assert.deepEqual(q.overlaps.map((o) => [o.a, o.b]), [['Box', 'Ball']]);
  assert.deepEqual(q.overlaps[0].depth, [0.5, 0.5, 0.15]);
  assert.equal(get('Post').floor!.status, 'sunk');
  assert.deepEqual(q.sunk.map((s) => s.name), ['Post']);
  assert.deepEqual(get('Turned').dimensions, [1, 2, 1]);
  assert.deepEqual(q.floating.map((f) => f.name), ['Cyl']);

  const d = querySpatial(scene(), {}, { pairs: [['Box', 'Cyl']], camera: null });
  assert.equal(d.distances[0].gap, Math.round(Math.hypot(2.8, 1.3, 0.5) * 1000) / 1000);
  assert.equal(d.camera, null);

  // A camera at -Y looking along +Y sees the box in the middle, not the post behind it.
  run('object.add_camera', { name: 'Cam', location: [1, -8, 0.25], lookAtPoint: [1, 2, 0.25], lensMm: 35 });
  run('object.add_primitive', { primitive: 'box', name: 'Behind', location: [1, -12, 0.5] });
  const view = querySpatial(scene(), {}, { camera: 'Cam' });
  const hit = view.camera!.visible.find((h) => h.name === 'Box')!;
  assert.equal(hit.horizontal, 'center');
  assert.equal(hit.vertical, 'middle');
  assert.ok(hit.framePercent > 0 && hit.framePercent < 20, `${hit.framePercent}`);
  close(hit.distance, 9.5, 1e-3);
  assert.ok(view.camera!.outside.includes('Behind'));
  assert.ok(view.camera!.outside.includes('Cyl'), 'Cyl is 4 m to the right at 8 m: outside a 35 mm frame');
  run('object.add_primitive', { primitive: 'box', name: 'RightBox', dimensions: [0.2, 0.2, 0.2], location: [2.8, 2, 0.25] });
  const right = querySpatial(scene(), {}, { camera: 'Cam', objects: ['RightBox'] }).camera!.visible[0];
  assert.equal(right.name, 'RightBox');
  assert.equal(right.horizontal, 'right');
});

test('layout commands: drop_to_floor, align and place_on move whole groups by their bounds', () => {
  const { run, scene, asset } = setup();
  run('build.furniture', { type: 'table', name: 'Tisch' });
  run('object.add_primitive', { primitive: 'box', name: 'Vase', dimensions: [0.2, 0.2, 0.3], location: [3, 3, 2] });
  run('object.place_on', { object: 'Vase', target: 'Tisch', offset: [0.3, 0] });
  let q = querySpatial(scene(), {}, { camera: null });
  const vase = q.objects.find((o) => o.name === 'Vase')!;
  assert.deepEqual(vase.bounds.min, [0.2, -0.1, 0.75]);
  assert.equal(vase.floor!.status, 'supported');
  run('object.transform', { object: 'Vase', location: [0, 0, 3], space: 'world' });
  run('object.drop_to_floor', { objects: ['Vase'], toSurface: true });
  q = querySpatial(scene(), {}, { camera: null });
  close(q.objects.find((o) => o.name === 'Vase')!.zMin, 0.75, 1e-6);
  run('object.drop_to_floor', { objects: ['Vase'] });
  close(querySpatial(scene(), {}, { camera: null }).objects.find((o) => o.name === 'Vase')!.zMin, 0, 1e-6);
  // Lift the table group, then drop it: all parts move.
  run('object.transform', { object: 'Tisch', location: [0, 0, 0.4] });
  run('object.drop_to_floor', { objects: ['Tisch'] });
  close(worldBoxes(scene()).get(asset('Tisch').id)!.box.min.y, 0, 1e-6);
  // Align the vase's left face to the table's right face.
  run('object.align', { objects: ['Vase'], to: 'Tisch', axis: 'x', side: 'min', targetSide: 'max', offset: 0.1 });
  close(toBlenderBox(worldBoxes(scene()).get(asset('Vase').id)!.box).min[0], 0.9, 1e-3);
  run('object.align', { objects: ['Vase'], to: 2.5, axis: 'y', side: 'center' });
  close(toBlenderBox(worldBoxes(scene()).get(asset('Vase').id)!.box).min[1], 2.4, 1e-3);
  assert.throws(() => run('object.align', { objects: ['Vase'], to: 'Tisch', axis: 'w' }), /axis must be x, y or z/);
  // A cup on a thin sheet on the table rests on the sheet (not "floating").
  run('object.add_primitive', { primitive: 'box', name: 'Sheet', dimensions: [0.3, 0.2, 0.01], location: [-0.3, 0, 0.755] });
  run('object.add_primitive', { primitive: 'cylinder', name: 'Cup', dimensions: [0.08, 0.08, 0.1], location: [-0.3, 0, 0.81] });
  const cup = querySpatial(scene(), {}, { camera: null }).objects.find((o) => o.name === 'Cup')!;
  assert.deepEqual(cup.floor, { status: 'supported', supportedBy: 'Sheet' });
});

// ---------------------------------------------------------------------------
// Procedural pieces

test('build.room cuts real openings: segments around doors/windows, no overlaps, on the floor', () => {
  const { run, scene } = setup();
  const result = run('build.room', {
    name: 'Room', width: 4, depth: 3, height: 2.6, wallThickness: 0.12, ceiling: true,
    openings: [
      { wall: 'south', type: 'door', offset: -1 },
      { wall: 'north', type: 'window', offset: 0.5, width: 1.2 },
      { wall: 'north', type: 'window', offset: -1.2, width: 0.8, height: 1, sill: 1 },
      { wall: 'east', type: 'door', width: 1 },
    ],
    materials: { walls: { color: '#e0ddd5', roughness: 0.9 }, floor: { color: '#7a6a58' } },
  });
  const names = scene().assets.filter((a) => a.parentId === result.id).map((a) => a.name).sort();
  assert.ok(names.includes('Room/Wall West'));
  assert.ok(names.includes('Room/Wall South A') && names.includes('Room/Wall South B') && names.includes('Room/Wall South Lintel Door 1'));
  assert.ok(names.includes('Room/Wall North Sill Window 1') && names.includes('Room/Wall North Lintel Window 2') && names.includes('Room/Wall North C'));
  assert.ok(!names.includes('Room/Wall South Sill Door 1'), 'doors have no sill piece');
  const q = querySpatial(scene(), {}, { camera: null });
  assert.deepEqual(q.overlaps, [], JSON.stringify(q.overlaps));
  assert.deepEqual(q.floating, []);
  assert.deepEqual(q.sunk, []);
  const box = (name: string) => q.objects.find((o) => o.name === name)!;
  assert.deepEqual(box('Room/Floor').bounds, { min: [-2.12, -1.62, -0.05], max: [2.12, 1.62, 0] });
  assert.equal(box('Room/Floor').floor!.status, 'ground');
  assert.deepEqual(box('Room/Wall West').bounds, { min: [-2.12, -1.5, 0], max: [-2, 1.5, 2.6] });
  // South door at offset -1, width 0.9: hole from x -1.45 to -0.55, lintel from 2.1 to 2.6.
  assert.deepEqual(box('Room/Wall South A').bounds, { min: [-2.12, -1.62, 0], max: [-1.45, -1.5, 2.6] });
  assert.deepEqual(box('Room/Wall South Lintel Door 1').bounds, { min: [-1.45, -1.62, 2.1], max: [-0.55, -1.5, 2.6] });
  assert.equal(box('Room/Wall South Lintel Door 1').floor!.status, 'supported');
  assert.equal(box('Room/Ceiling').floor!.status, 'supported');
  // Wall area: full wall minus holes (volume check per wall, in m²·thickness).
  const volume = (prefix: string) => q.objects.filter((o) => o.name.startsWith(prefix)).reduce((sum, o) => sum + o.dimensions[0] * o.dimensions[1] * o.dimensions[2], 0);
  close(volume('Room/Wall North'), (4.24 * 2.6 - 1.2 * 1.2 - 0.8 * 1) * 0.12, 1e-6);
  close(volume('Room/Wall East'), (3 * 2.6 - 1 * 2.1) * 0.12, 1e-6);
  // Openings come back with world centres for doors/windows.
  const door = result.openings.find((o: { wall: string }) => o.wall === 'south');
  assert.deepEqual(door.center, [-1, -1.56, 1.05]);
  assert.deepEqual(door.bottomCenter, [-1, -1.56, 0]);
  assert.equal(door.rotationZ, 180);
  assert.equal(scene().assets.find((a) => a.name === 'Room/Wall West')!.material!.color, '#e0ddd5');
  assert.throws(() => roomParts({ width: 4, depth: 3, height: 2.6, wallThickness: 0.12, floor: true, ceiling: false, openings: [{ wall: 'north', type: 'door', offset: 1.8 }], materials: {} }), /does not fit/);
  assert.throws(() => roomParts({ width: 4, depth: 3, height: 2.6, wallThickness: 0.12, floor: true, ceiling: false, openings: [{ wall: 'north', type: 'door' }, { wall: 'north', type: 'window', offset: 0.3 }], materials: {} }), /overlap/);
});

test('rotated and moved room keeps its openings in place', () => {
  const { run, scene } = setup();
  const result = run('build.room', { name: 'R', location: [10, 5, 0], rotationZ: 90, openings: [{ wall: 'south', type: 'door' }] });
  const door = result.openings[0];
  // South wall faces -Y locally; after 90° it faces +X → the door sits at x = 10 + 1.56.
  closeVec(door.center, [11.56, 5, 1.05], 1e-3);
  const q = querySpatial(scene(), {}, { camera: null });
  assert.deepEqual(q.overlaps, []);
});

test('build.scatter is deterministic per seed, keeps minDistance and stands copies on the surface', () => {
  const layout = (seed: number) => {
    const { run, scene } = setup();
    run('build.furniture', { type: 'table', name: 'Tisch', size: [3, 2, 0.75] });
    const result = run('build.scatter', { primitive: 'box', dimensions: [0.1, 0.1, 0.2], area: { onObject: 'Tisch' }, count: 12, seed, minDistance: 0.3, scaleRange: [0.8, 1.2] });
    const q = querySpatial(scene(), {}, { camera: null });
    const copies = q.objects.filter((o) => result.objects.includes(o.name));
    return { result, copies };
  };
  const a = layout(42);
  const b = layout(42);
  const c = layout(7);
  assert.equal(a.result.placed, 12);
  assert.deepEqual(a.copies.map((o) => o.center), b.copies.map((o) => o.center));
  assert.notDeepEqual(a.copies.map((o) => o.center), c.copies.map((o) => o.center));
  for (const copy of a.copies) {
    close(copy.zMin, 0.75, 1e-4);
    assert.equal(copy.floor!.status, 'supported');
  }
  for (let i = 0; i < a.copies.length; i += 1) for (let j = i + 1; j < a.copies.length; j += 1) {
    const [p, q] = [a.copies[i].location, a.copies[j].location];
    assert.ok(Math.hypot(p[0] - q[0], p[1] - q[1]) >= 0.3 - 1e-3);
  }
  // Scattering an existing group copies it with its parts, on the floor.
  const { run, scene } = setup();
  run('build.furniture', { type: 'chair', name: 'Stuhl' });
  const r = run('build.scatter', { object: 'Stuhl', area: { center: [0, 0], size: [6, 6] }, count: 5, seed: 3, minDistance: 1 });
  assert.equal(r.placed, 5);
  const q = querySpatial(scene(), {}, { camera: null });
  for (const name of r.objects) close(q.objects.find((o) => o.name === name)!.zMin, 0, 1e-4);
  assert.equal(scene().assets.filter((asset) => /^Stuhl(\.\d{3})?$/.test(asset.name) && asset.kind === 'group').length, 6);
});

test('build.array, build.stairs and build.furniture produce real sizes without overlaps', () => {
  const { run, scene, asset } = setup();
  run('build.furniture', { type: 'chair', name: 'Stuhl', location: [0, 0, 0] });
  const array = run('build.array', { object: 'Stuhl', count: 4, offset: [0.6, 0, 0] });
  assert.equal(array.copies.length, 3);
  assert.equal(asset('Stuhl').parentId, array.id);
  const q1 = querySpatial(scene(), {}, { camera: null });
  const chairs = q1.objects.filter((o) => o.type === 'group' && o.name.startsWith('Stuhl') && o.name !== 'Stuhl Array').map((o) => o.location[0]).sort();
  closeVec(chairs, [0, 0.6, 1.2, 1.8]);
  assert.deepEqual(q1.overlaps, []);

  const stairs = run('build.stairs', { steps: 10, rise: 0.18, run: 0.27, width: 1.2, location: [5, 0, 0] });
  assert.equal(stairs.totalRise, 1.8);
  closeVec(stairs.topEdge, [5, 2.7, 1.8]);
  assert.deepEqual(stairs.dimensions, [1.2, 2.7, 1.8]);

  for (const type of ['table', 'chair', 'sofa', 'bed', 'shelf', 'door', 'window', 'lamp']) {
    run('build.furniture', { type, name: `F-${type}`, location: [0, 10, type === 'window' ? 0.9 : 0] });
  }
  const q = querySpatial(scene(), {}, { camera: null });
  const own = (name: string) => q.objects.find((o) => o.name === name)!;
  assert.deepEqual(own('F-table').dimensions, [1.6, 0.9, 0.75]);
  assert.deepEqual(own('F-chair').dimensions, [0.45, 0.5, 0.9]);
  assert.equal(own('F-door').zMin, 0);
  assert.equal(own('F-window').zMin, 0.9);
  // Within one piece nothing overlaps (different pieces stand at the same spot on purpose).
  for (const type of ['table', 'chair', 'sofa', 'bed', 'shelf', 'door', 'window', 'lamp']) {
    const parts = q.objects.filter((o) => o.parent === `F-${type}`).map((o) => o.name);
    assert.ok(parts.length >= 3, type);
    assert.deepEqual(q.overlaps.filter((o) => parts.includes(o.a) && parts.includes(o.b)), [], type);
    for (const part of parts.filter((p) => !p.endsWith('/Glass') && type !== 'window')) assert.notEqual(own(part).floor!.status, 'floating', part);
  }
  const lamp = run('build.furniture', { type: 'lamp', withLight: true });
  assert.ok(scene().lights.some((l) => l.name === lamp.light && l.power === 40));
  assert.throws(() => run('build.furniture', { type: 'piano' }), /type must be one of/);
});

test('primitives take real dimensions; Blender export nests children and builds PBR materials', () => {
  const { run, asset, scene } = setup();
  run('object.add_primitive', { primitive: 'cylinder', name: 'Säule', dimensions: [0.3, 0.3, 2.5] });
  const pillar = asset('Säule');
  assert.deepEqual(pillar.scale, { x: 0.3, y: 2.5, z: 0.3 });
  close(pillar.position.y, 1.25);
  run('object.add_primitive', { primitive: 'plane', name: 'Boden', dimensions: [6, 4, 0] });
  assert.deepEqual(asset('Boden').scale, { x: 3, y: 1, z: 2 });
  run('object.transform', { object: 'Säule', dimensions: [0.5, 0.5, 3] });
  assert.deepEqual(asset('Säule').scale, { x: 0.5, y: 3, z: 0.5 });
  run('build.room', { name: 'Raum', openings: [{ wall: 'north', type: 'window' }] });
  run('material.set', { objects: ['Raum/Floor'], maps: { baseColor: 'https://example.com/floor_diff.jpg', normal: 'https://example.com/floor_nor.png' }, repeat: [4, 3], name: 'Floor Planks', attribution: { author: 'Poly Haven', license: 'CC0' } });
  const script = buildBlenderScript(scene());
  assert.match(script, /def pbr_material\(/);
  assert.match(script, /pbr_material\('Floor Planks', .*\{'baseColor': 'https:\/\/example.com\/floor_diff.jpg', 'normal': 'https:\/\/example.com\/floor_nor.png'\}, \(4, 3\)/);
  assert.match(script, /# Material Floor Planks: Poly Haven, CC0/);
  const room = asset('Raum');
  assert.match(script, new RegExp(`objs\\['${room.id}'\\] = o\\d+`));
  const children = scene().assets.filter((a) => a.parentId === room.id);
  for (const child of children) assert.ok(script.includes(`objs['${child.id}'].parent = objs['${room.id}']`));
  assert.match(script, /empty_display_type = 'PLAIN_AXES'/);
});

test('describe and outliner handle a full built set', () => {
  const { run, scene } = setup();
  run('scene.batch', { commands: [
    { command: 'build.room', args: { name: 'Studio', width: 5, depth: 4, openings: [{ wall: 'south', type: 'door' }] } },
    { command: 'build.furniture', args: { type: 'sofa', location: [0, 1.4, 0] } },
    { command: 'object.add_primitive', args: { primitive: 'box', name: 'Floater', location: [0, 0, 1.5] } },
  ] });
  const rows = outlinerItems(scene());
  const studio = rows.find((r) => r.name === 'Studio')!;
  assert.ok(studio.childCount > 5);
  assert.ok(rows.filter((r) => r.parentId === studio.id).every((r) => r.depth === 1));
  const assets: SetDesignAsset[] = scene().assets;
  assert.equal(rows.filter((r) => r.kind === 'asset').length, assets.length);
});
