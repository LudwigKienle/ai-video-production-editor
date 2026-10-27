import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  cameraAnglesFromRotation,
  cameraRotationFromAngles,
  personRotationYFromYaw,
  readStageHost,
  writeStageHost,
  type StoredDocument,
} from './setDesignAdapter.ts';
import { forwardVector } from './stageModel.ts';
import { ensureHost, isStageView, toStoredHost } from '../shotdesigner/planModel.ts';
import { runBlockingCommand } from '../shotdesigner/commands.ts';

const close = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

const forwardOf = (rot: { x: number; y: number; z: number }) => {
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot.x * Math.PI / 180, rot.y * Math.PI / 180, rot.z * Math.PI / 180, 'XYZ'));
  return new THREE.Vector3(0, 0, -1).applyMatrix4(m);
};

test('yaw/pitch/roll ↔ three.js Euler XYZ round-trips and looks the same way', () => {
  for (const [yaw, pitch, roll] of [[0, 0, 0], [90, 0, 0], [-135, -12, 0], [30, 20, 5], [179, -45, -8]]) {
    const rot = cameraRotationFromAngles(yaw, pitch, roll);
    const back = cameraAnglesFromRotation(rot);
    close(back.yawDeg, yaw, 0.01);
    close(back.pitchDeg, pitch, 0.01);
    close(back.rollDeg, roll, 0.01);
    const f = forwardOf(rot);
    const mine = forwardVector(yaw, pitch);
    close(f.x, mine.x); close(f.y, mine.y); close(f.z, mine.z);
  }
  // Positive roll lifts the camera's right side (same as the set design's cameraAngles).
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...Object.values(cameraRotationFromAngles(0, 0, 10)).map((d) => d * Math.PI / 180) as [number, number, number], 'XYZ'));
  assert.ok(new THREE.Vector3(1, 0, 0).applyMatrix4(m).y > 0);
});

const doc3d = (): StoredDocument => ({
  assets: [
    { id: 'wall-1', name: 'Wand', kind: 'primitive', primitive: 'box', position: { x: 0, y: 1.3, z: -3 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 6, y: 2.6, z: 0.15 } },
    // Stand-in made in 3D: rotation.y 0 → nose along +Z → faces the camera side (south) in the plan.
    { id: 'p-1', name: 'Mia', kind: 'primitive', primitive: 'person', position: { x: 1, y: 0.875, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, material: { color: '#aabbcc', roughness: 0.4 } },
  ],
  cameras: [{ id: 'cam-3d', name: 'Kamera', position: { x: 0, y: 1.5, z: 5 }, rotation: { x: 0, y: 0, z: 0 }, lensMm: 50, sensorWidthMm: 36, sensorHeightMm: 24, sensorFit: 'auto', shiftX: 0.1, clipStart: 0.05 }],
  activeCameraId: 'cam-3d',
});

test('cameras and stand-ins made in 3D appear in the Scene Map view', () => {
  const view = ensureHost(doc3d() as never);
  assert.ok(isStageView(view));
  assert.equal(view.assets.length, 1, 'persons leave the asset list of the view');
  assert.equal(view.stage.cameras[0].id, 'cam-3d');
  close(view.stage.cameras[0].focalLengthMm, 50);
  close(view.stage.cameras[0].yawDeg, 0);
  assert.equal(view.stage.activeCameraId, 'cam-3d');
  const mia = view.stage.characters[0];
  assert.equal(mia.name, 'Mia');
  close(mia.position.y, 0);
  close(Math.abs(mia.yawDeg), 180);
  close(mia.heightM, 1.75);
});

test('writing keeps 3D-owned fields and stores blocking only as references', () => {
  const base = doc3d();
  const view = ensureHost(base as never);
  const moved = runBlockingCommand(view, 'object.rotate', { id: 'cam-3d', yawDeg: 30 });
  assert.ok(moved.ok);
  const keyed = runBlockingCommand(moved.host, 'key.add', { id: 'Mia', timeS: 3, x: 2, z: 1 });
  const grown = runBlockingCommand(keyed.host, 'character.update', { id: 'Mia', heightM: 1.9, posture: 'sitting' });
  const stored = toStoredHost(ensureHost(grown.host as never), base) as unknown as StoredDocument & { stage: Record<string, unknown> };
  const cam = stored.cameras![0];
  assert.equal(cam.shiftX, 0.1, 'lens shift kept');
  assert.equal(cam.clipStart, 0.05, 'clip kept');
  close(cameraAnglesFromRotation(cam.rotation).yawDeg, 30);
  assert.equal(stored.stage.cameras, undefined, 'no camera copies in stage');
  assert.equal(stored.stage.characters, undefined, 'no character copies in stage');
  assert.ok((stored.stage.animation as { tracks: Record<string, unknown> }).tracks['p-1'], 'track references the person asset id');
  const person = stored.assets.find((a) => a.id === 'p-1')!;
  assert.equal(person.primitive, 'person');
  assert.equal(person.material?.color, '#aabbcc', 'material kept');
  assert.equal(person.character?.pose, 'sitting');
  close(person.scale.y, 1.9 / 1.75);
  close(person.position.y, 0.95);
  assert.deepEqual(stored.assets.map((a) => a.id), ['wall-1', 'p-1'], 'outliner order kept');
  close(person.rotation.y, personRotationYFromYaw(180));
});

test('read → write → read is stable', () => {
  const once = writeStageHost(readStageHost(doc3d()), doc3d());
  const twice = writeStageHost(readStageHost(once), once);
  assert.deepEqual(twice.cameras, once.cameras);
  assert.deepEqual(twice.assets, once.assets);
});

test('early Scene Map documents (cameras inside stage) migrate into the shared lists', () => {
  const legacy = { assets: [], stage: { cameras: [{ id: 'c1', name: 'A', position: { x: 0, y: 1.6, z: 3 }, yawDeg: 0, focalLengthMm: 35 }], characters: [{ id: 'h1', name: 'Ben', position: { x: 0, y: 0, z: 0 } }] } };
  const view = ensureHost(legacy as never);
  assert.equal(view.stage.cameras[0].id, 'c1');
  const stored = toStoredHost(view, null) as unknown as StoredDocument;
  assert.equal(stored.cameras?.[0].id, 'c1');
  assert.ok(stored.assets.some((a) => a.id === 'h1' && a.primitive === 'person'));
  const again = ensureHost(stored as never);
  assert.equal(again.stage.characters[0].name, 'Ben');
});

test('with a shared committer (3D command bus) the Scene Map writes stored documents and uses its undo', async () => {
  const session = await import('../shotdesigner/session.ts');
  session.resetSession();
  let doc: unknown = null;
  const stack: unknown[] = [];
  session.bindSceneMapBridge({ getSetDesign: () => doc as never, setSetDesign: (n) => { doc = n; } });
  session.setSceneMapCommitter({
    commit: (stored) => { stack.push(doc); doc = stored; },
    undo: () => { if (stack.length) doc = stack.pop(); },
    canUndo: () => stack.length > 0,
  });
  try {
    assert.ok(session.dispatch('camera.add', { x: 0, z: 4, name: 'A' }).ok);
    const stored = doc as StoredDocument;
    assert.equal(stored.cameras?.length, 1, 'camera lands in SetDesignState.cameras');
    assert.equal(session.historyState().canUndo, true);
    assert.equal(session.undo(), true);
    assert.equal(session.getHost().stage.cameras.length, 0);
  } finally {
    session.setSceneMapCommitter(null);
    session.bindSceneMapBridge(null);
    session.resetSession();
  }
});
