import test from 'node:test';
import assert from 'node:assert/strict';

import {
  aimAngles,
  cameraFovDeg,
  camerasAt,
  charactersAt,
  focalForHorizontalFov,
  forwardVector,
  normalizeStage,
  sampleTrack,
  wrapDeg,
} from '../scene/stageModel.ts';
import { createPlanAsset, createWall, elementCorners, ensureHost, planElementOf, wallEnds } from './planModel.ts';
import { runBlockingBatch, runBlockingCommand, BLOCKING_COMMANDS, describeCommands } from './commands.ts';
import { axisWarnings, shotFacts, shotSizeFromCoverage, subjectsInFrame, viewCone } from './shotGeometry.ts';
import { orderedShots, shotRows, syncShots } from './shotList.ts';

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

const run = (host: unknown, id: string, params: Record<string, unknown>, t = 0) => {
  const out = runBlockingCommand(host as never, id, params, t);
  if (!out.ok) throw new Error(out.error);
  return out;
};

test('normalizeStage survives garbage and keeps valid data', () => {
  for (const raw of [null, undefined, 42, 'x', [], { cameras: 'no', characters: [null, 5], animation: { tracks: { a: [{ timeS: 'nan' }] } } }]) {
    const s = normalizeStage(raw);
    assert.equal(s.version, 1);
    assert.ok(Array.isArray(s.cameras));
    assert.ok(s.animation.durationS > 0);
  }
  const s = normalizeStage({ cameras: [{ id: 'c', focalLengthMm: 1e9, position: { x: '2' } }], characters: [{ id: 'c' }] });
  assert.equal(s.cameras[0].focalLengthMm, 2000);
  assert.equal(s.cameras[0].position.x, 2);
  assert.notEqual(s.characters[0].id, '');
  assert.equal(s.activeCameraId, 'c');
});

test('optics: focal length ↔ field of view on Super 35', () => {
  const fov = cameraFovDeg({ focalLengthMm: 35, sensorWidthMm: 24.89, sensorHeightMm: 18.66, sensorFit: 'auto' }, 16 / 9);
  close(fov.horizontal, 39.13, 0.05);
  close(focalForHorizontalFov(fov.horizontal), 35, 1e-6);
  assert.ok(fov.vertical < fov.horizontal);
});

test('yaw convention: 0 looks down -Z, +90 looks down -X', () => {
  const f0 = forwardVector(0);
  close(f0.x, 0); close(f0.z, -1);
  const f90 = forwardVector(90);
  close(f90.x, -1); close(f90.z, 0, 1e-9);
  const aim = aimAngles({ x: 0, y: 1.6, z: 0 }, { x: 3, y: 1.6, z: 0 });
  close(aim.yawDeg, -90);
  close(wrapDeg(190), -170);
});

test('sampleTrack interpolates position and takes the short way round for yaw', () => {
  const keys = normalizeStage({ animation: { durationS: 10, tracks: { a: [
    { id: 'k1', timeS: 0, position: { x: 0, y: 0, z: 0 }, yawDeg: 170, easing: 'linear' },
    { id: 'k2', timeS: 2, position: { x: 4, y: 0, z: 0 }, yawDeg: -170, easing: 'linear' },
  ] } } }).animation.tracks.a;
  const mid = sampleTrack(keys, 1);
  assert.ok(mid);
  close(mid!.position.x, 2);
  close(Math.abs(mid!.yawDeg), 180);
  assert.equal(sampleTrack(keys, -5)!.position.x, 0);
  assert.equal(sampleTrack(keys, 50)!.position.x, 4);
  assert.equal(sampleTrack([], 1), null);
});

test('walls and elements are 3D box assets with matching plan footprint', () => {
  const wall = createWall(0, 0, 4, 0);
  const el = planElementOf(wall);
  close(el.w, 4);
  close(el.x, 2);
  const [a, b] = wallEnds(el);
  close(a[0], 0); close(b[0], 4); close(a[1], 0, 1e-9);
  const diag = createWall(0, 0, 3, 3);
  const [p, q] = wallEnds(planElementOf(diag));
  close(p[0], 0); close(p[1], 0); close(q[0], 3); close(q[1], 3);
  const table = createPlanAsset({ category: 'table', x: 1, z: 2 });
  assert.equal(table.kind, 'primitive');
  assert.equal(table.primitive, 'box');
  close(table.position.y, 0.375);
  assert.equal(elementCorners(planElementOf(table)).length, 4);
});

test('commands: build a dialogue scene, shots follow the cameras', () => {
  let host: unknown = ensureHost(null);
  host = run(host, 'character.add', { name: 'Anna', x: -1, z: 0, yawDeg: -90 }).host;
  host = run(host, 'character.add', { name: 'Ben', x: 1, z: 0, yawDeg: 90 }).host;
  host = run(host, 'camera.add', { x: 0, z: 4, aimAt: 'Anna', focalLengthMm: 50 }).host;
  host = run(host, 'camera.add', { x: 0, z: 6, yawDeg: 0, focalLengthMm: 24 }).host;
  const h = ensureHost(host as never);
  assert.equal(h.stage.characters.length, 2);
  assert.equal(h.stage.cameras.map((c) => c.name).join(), 'A,B');
  assert.equal(h.stage.shots.length, 2);
  const rows = shotRows(h.stage);
  assert.deepEqual(rows.map((r) => r.code), ['1A', '2A']);
  assert.ok(rows[1].subjectNames.includes('Anna') && rows[1].subjectNames.includes('Ben'));
  // Deleting the camera removes its shot.
  const camA = h.stage.cameras[0].id;
  const after = ensureHost(run(h, 'object.delete', { id: camA }).host as never);
  assert.equal(after.stage.shots.length, 1);
  assert.equal(after.stage.shots[0].number, 1);
});

test('key.add creates a start mark and move then writes into the key at the playhead', () => {
  let host: unknown = ensureHost(null);
  const add = run(host, 'character.add', { name: 'Anna', x: 0, z: 0 });
  host = add.host;
  const id = String(add.result.id);
  host = run(host, 'key.add', { id, timeS: 4, x: 3, z: -2 }).host;
  let h = ensureHost(host as never);
  assert.equal(h.stage.animation.tracks[id].length, 2);
  close(charactersAt(h.stage, 2)[0].position.x, 1.5, 0.01);
  host = run(h, 'object.move', { id, x: 5, z: -2 }, 4).host;
  h = ensureHost(host as never);
  assert.equal(h.stage.animation.tracks[id].length, 2);
  close(charactersAt(h.stage, 4)[0].position.x, 5);
  // retime: half speed doubles the move time
  h = ensureHost(run(h, 'track.retime', { id, factor: 2 }).host as never);
  close(h.stage.animation.tracks[id][1].timeS, 8);
});

test('camera follow keeps the character in frame while it walks', () => {
  let host: unknown = ensureHost(null);
  const chr = run(host, 'character.add', { name: 'Anna', x: 0, z: 0 });
  host = chr.host;
  host = run(host, 'key.add', { id: chr.result.id, timeS: 5, x: 4, z: 0 }).host;
  const cam = run(host, 'camera.add', { x: 0, z: 5, aimAt: 'Anna', follow: true });
  const h = ensureHost(cam.host as never);
  const camAt5 = camerasAt(h.stage, 5)[0];
  assert.equal(subjectsInFrame(camAt5, charactersAt(h.stage, 5)).length, 1);
  const shot = h.stage.shots[0];
  const facts = shotFacts(h.stage, shot);
  assert.ok(facts.moves.includes('pan'), facts.moveLabel);
});

test('shot size follows distance and lens', () => {
  assert.equal(shotSizeFromCoverage(0.15), 'CU');
  assert.equal(shotSizeFromCoverage(1), 'FS');
  let host: unknown = ensureHost(null);
  host = run(host, 'character.add', { name: 'Anna', x: 0, z: 0 }).host;
  const near = ensureHost(run(host, 'camera.add', { x: 0, z: 1.2, aimAt: 'Anna', focalLengthMm: 85 }).host as never);
  const far = ensureHost(run(host, 'camera.add', { x: 0, z: 12, aimAt: 'Anna', focalLengthMm: 24 }).host as never);
  const order = ['ECU', 'CU', 'MCU', 'MS', 'MLS', 'FS', 'WS', 'EWS'];
  const nearSize = shotFacts(near.stage, near.stage.shots[0]).size!;
  const farSize = shotFacts(far.stage, far.stage.shots[0]).size!;
  assert.ok(order.indexOf(nearSize) < order.indexOf(farSize), `${nearSize} vs ${farSize}`);
});

test('180° line: crossing cameras are flagged', () => {
  let host: unknown = ensureHost(null);
  host = run(host, 'character.add', { name: 'A', x: -1, z: 0 }).host;
  host = run(host, 'character.add', { name: 'B', x: 1, z: 0 }).host;
  host = run(host, 'scene.setLineOfAction', { aId: 'A', bId: 'B' }).host;
  host = run(host, 'camera.add', { x: 0, z: 3, aimAt: 'A' }).host;
  host = run(host, 'camera.add', { x: 0, z: -3, aimAt: 'B' }).host;
  const h = ensureHost(host as never);
  const warnings = axisWarnings(h.stage, orderedShots(h.stage));
  assert.equal(warnings.length, 1);
});

test('templates, versions, reorder, detach and freeze/restore', () => {
  const tpl = runBlockingBatch(null, [
    { command: 'scene.applyTemplate', params: { templateId: 'dialog-two' } },
    { command: 'shot.add', params: { cameraId: 'A', startS: 2, endS: 6, description: 'Reaktion' } },
    { command: 'scene.freeze', params: { name: 'v1' } },
  ]);
  assert.ok(tpl.ok, tpl.ok ? '' : tpl.error);
  if (!tpl.ok) return;
  let h = ensureHost(tpl.host as never);
  assert.equal(h.stage.cameras.length, 3);
  assert.ok(h.stage.lineOfAction);
  assert.equal(axisWarnings(h.stage, orderedShots(h.stage)).length, 0, 'template stays on one side of the line');
  assert.deepEqual(h.stage.shots.map((s) => `${s.number}${s.version}`).sort(), ['1A', '1B', '2A', '3A']);
  h = ensureHost(run(h, 'shot.reorder', { id: '1B', toIndex: 0 }).host as never);
  assert.equal(orderedShots(h.stage)[0].version, 'B');
  h = ensureHost(run(h, 'shot.detach', { id: '3A' }).host as never);
  h = ensureHost(run(h, 'object.delete', { id: 'C' }).host as never);
  assert.ok(h.stage.shots.some((s) => s.detached), 'detached shot survives');
  h = ensureHost(run(h, 'scene.restore', { id: 'v1' }).host as never);
  assert.equal(h.stage.cameras.length, 3);
});

test('every command validates input and never throws', () => {
  for (const command of BLOCKING_COMMANDS) {
    const out = runBlockingCommand({ assets: 'bad' } as never, command.id, { id: 'nope', x: 'NaN', z: {}, templateId: 'nope', aspectRatio: -1 }, Number.NaN);
    assert.equal(typeof out.ok, 'boolean');
  }
  assert.equal(runBlockingCommand(null, 'does.not.exist').ok, false);
  assert.ok(describeCommands().every((c) => c.params.type === 'object'));
  assert.equal(viewCone(normalizeStage({ cameras: [{}] }).cameras[0]).length, 3);
  assert.equal(syncShots(normalizeStage(null)).shots.length, 0);
});
