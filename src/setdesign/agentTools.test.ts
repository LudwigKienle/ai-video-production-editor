/**
 * MCP tests: every set design tool the "ai-video-studio" server publishes is declared, has an
 * executor, and does what its description says against an in-memory project.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import type { SetDesignState } from '../types';
import { createSetDesignBus } from './bus.ts';
import { SET_DESIGN_TOOL_DECLARATIONS, createSetDesignAgentExecutor, type CaptureRequest } from './agentTools.ts';
import { createDefaultSetDesignState } from './sceneModel.ts';
import { forwardFromRotation } from './coords.ts';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

const setup = (initial: SetDesignState | null = createDefaultSetDesignState()) => {
  let stored: SetDesignState | null = initial;
  let n = 0;
  const bus = createSetDesignBus({ makeId: (prefix) => `${prefix}-${++n}` });
  bus.attachHost({ getScene: () => stored, setScene: (next) => { stored = next; } });
  const captures: CaptureRequest[] = [];
  const media: Array<{ name: string; prompt: string }> = [];
  const shots: Array<{ shotNumber: number; imageUrl: string }> = [];
  const references: string[] = [];
  let opened = 0;
  const tools = createSetDesignAgentExecutor({
    bus,
    capture: async (request) => { captures.push(request); return { dataUrl: PNG, width: request.width, height: request.height }; },
    addMedia: async (payload) => { media.push(payload); return { id: `media-${media.length}`, url: `blob:media-${media.length}` }; },
    applyToShot: async (payload) => { shots.push(payload); },
    applyToReference: async (payload) => { references.push(payload.reference); return payload.reference; },
    openWorkspace: async () => { opened += 1; },
  });
  const call = (name: string, args: Record<string, unknown> = {}) => {
    const tool = tools[name];
    assert.ok(tool, `tool ${name} exists`);
    return tool(args) as Promise<any>;
  };
  return { bus, call, scene: () => stored!, captures, media, shots, references, opened: () => opened };
};

const close = (actual: number, expected: number, eps = 1e-3) => assert.ok(Math.abs(actual - expected) < eps, `expected ${expected}, got ${actual}`);

test('every declared set design tool has an executor and an object schema, and names are unique', () => {
  const { call } = setup();
  const names = SET_DESIGN_TOOL_DECLARATIONS.map((tool) => tool.name);
  assert.equal(new Set(names).size, names.length);
  for (const tool of SET_DESIGN_TOOL_DECLARATIONS) {
    assert.match(tool.name, /^setdesign_[a-z_]+$/);
    assert.ok(tool.description.length > 40, `${tool.name} has a description`);
    assert.equal((tool.parameters as { type: string }).type, 'object');
    assert.doesNotThrow(() => call(tool.name === 'setdesign_get_scene' ? tool.name : 'setdesign_get_scene'));
  }
  const executor = createSetDesignAgentExecutor({ bus: createSetDesignBus() });
  assert.deepEqual(Object.keys(executor).sort(), [...names].sort());
});

test('setdesign_get_scene describes a fresh set with an active camera in Blender coordinates', async () => {
  const { call } = setup(null);
  const scene = await call('setdesign_get_scene');
  assert.match(scene.coordinates, /Z up/);
  assert.equal(scene.activeCamera.name, 'Kamera');
  assert.match(scene.activeCamera.setup.de, /35 mm \(Super 35\)/);
  const camera = scene.objects.find((o: any) => o.type === 'camera');
  assert.equal(camera.active, true);
  close(camera.location.z, 1.6);
});

test('setdesign_add_primitive places a wall on the floor and names it Blender-style', async () => {
  const { call, scene } = setup();
  const first = await call('setdesign_add_primitive', { primitive: 'wall' });
  const second = await call('setdesign_add_primitive', { primitive: 'wall', location: [0, 3, 1.3], rotation: [0, 0, 90] });
  assert.equal(first.name, 'Wand');
  assert.equal(second.name, 'Wand.001');
  const wall = scene().assets.find((a) => a.id === first.id)!;
  close(wall.position.y, 1.3);
  const moved = scene().assets.find((a) => a.id === second.id)!;
  assert.deepEqual(moved.position, { x: 0, y: 1.3, z: -3 });
  await assert.rejects(call('setdesign_add_primitive', { primitive: 'teapot' }), /primitive must be one of/);
});

test('setdesign_import_model takes a URL or a file path and checks the format', async () => {
  const { call, scene } = setup();
  const model = await call('setdesign_import_model', { filePath: 'file:///tmp/sets/Sofa%20alt.glb', location: [1, 2, 0] });
  assert.equal(model.name, 'Sofa alt');
  const asset = scene().assets.find((a) => a.id === model.id)!;
  assert.equal(asset.format, 'glb');
  assert.deepEqual(asset.position, { x: 1, y: 0, z: -2 });
  await assert.rejects(call('setdesign_import_model', { url: 'https://x/model.blend' }), /Supported formats/);
  await assert.rejects(call('setdesign_import_model', {}), /url or filePath/);
});

test('setdesign_add_camera aims at an object and becomes active', async () => {
  const { call, scene } = setup();
  const crate = await call('setdesign_add_primitive', { primitive: 'box', name: 'Kiste', location: [0.5, 0.5, 0.5] });
  const cam = await call('setdesign_add_camera', { name: 'Totale', location: [5, -6, 1.6], lookAt: 'Kiste', lensMm: 24, sensorPreset: 'full-frame' });
  const stored = scene().cameras!.find((c) => c.id === cam.id)!;
  assert.equal(scene().activeCameraId, cam.id);
  assert.equal(stored.lensMm, 24);
  assert.equal(stored.sensorWidthMm, 36);
  const forward = forwardFromRotation(stored.rotation);
  const crateAsset = scene().assets.find((a) => a.id === crate.id)!;
  const to = { x: crateAsset.position.x - stored.position.x, y: crateAsset.position.y - stored.position.y, z: crateAsset.position.z - stored.position.z };
  const len = Math.hypot(to.x, to.y, to.z);
  close(forward.x, to.x / len); close(forward.y, to.y / len); close(forward.z, to.z / len);
});

test('setdesign_add_light adds a spot with temperature and Blender-style power', async () => {
  const { call, scene } = setup();
  const light = await call('setdesign_add_light', { lightType: 'spot', location: [2, -2, 3], lookAtPoint: [0, 0, 0], power: 800, temperature: 3200, spotSize: 30 });
  const stored = scene().lights.find((l) => l.id === light.id)!;
  assert.equal(stored.name, 'Spot');
  assert.equal(stored.power, 800);
  assert.equal(stored.useTemperature, true);
  assert.equal(stored.temperature, 3200);
  assert.equal(stored.spotSize, 30);
  await assert.rejects(call('setdesign_add_light', { lightType: 'laser' }), /lightType must be/);
});

test('setdesign_transform_object sets and adds in Blender coordinates', async () => {
  const { call, scene } = setup();
  const box = await call('setdesign_add_primitive', { primitive: 'box' });
  const result = await call('setdesign_transform_object', { object: box.id, location: [1, 2, 3], rotation: [0, 0, 45], scale: [2, 1, 1] });
  assert.deepEqual(result.location, { x: 1, y: 2, z: 3 });
  close(result.rotation.z, 45, 1e-2);
  assert.deepEqual(result.scale, { x: 2, y: 1, z: 1 });
  const relative = await call('setdesign_transform_object', { object: 'Würfel', location: [0, 0, 1], relative: true });
  assert.deepEqual(relative.location, { x: 1, y: 2, z: 4 });
  await assert.rejects(call('setdesign_transform_object', { object: 'Kamera', scale: [2, 2, 2] }), /Only meshes and models have a scale/);
  await assert.rejects(call('setdesign_transform_object', { object: 'nope', location: [0, 0, 0] }), /No object "nope"/);
  assert.equal(scene().assets.length, 1);
});

test('setdesign_update_object changes material, camera sensor and light properties', async () => {
  const { call, scene } = setup();
  const box = await call('setdesign_add_primitive', { primitive: 'box' });
  const updated = await call('setdesign_update_object', { object: box.id, name: 'Tresen', color: '#6b4f3a', roughness: 0.4 });
  assert.equal(updated.name, 'Tresen');
  assert.equal(scene().assets[0].material?.color, '#6b4f3a');
  const cam = await call('setdesign_update_object', { object: 'Kamera', lensMm: 85, sensorPreset: 'super16', shiftY: 0.1, focusDistance: 2.4, fStop: 2.8 });
  assert.equal(cam.lensMm, 85);
  assert.equal(cam.sensorWidthMm, 12.52);
  assert.equal(cam.shiftY, 0.1);
  const sun = await call('setdesign_update_object', { object: 'Sonne', power: 5, color: '#ffeedd' });
  assert.equal(sun.power, 5);
  await assert.rejects(call('setdesign_update_object', { object: 'Kamera', sensorPreset: 'imax' }), /sensorPreset must be one of/);
});

test('setdesign_duplicate_objects copies the selection with an offset', async () => {
  const { call, scene } = setup();
  await call('setdesign_add_primitive', { primitive: 'cylinder', name: 'Säule', location: [0, 0, 1] });
  const result = await call('setdesign_duplicate_objects', { offset: [2, 0, 0] });
  assert.equal(result.created[0].name, 'Säule.001');
  const copy = scene().assets.find((a) => a.id === result.created[0].id)!;
  close(copy.position.x, 2); close(copy.position.y, 1); close(copy.position.z, 0);
});

test('setdesign_delete_objects removes objects but keeps the last camera', async () => {
  const { call, scene } = setup();
  const box = await call('setdesign_add_primitive', { primitive: 'box' });
  await call('setdesign_delete_objects', { objects: [box.id] });
  assert.equal(scene().assets.length, 0);
  await assert.rejects(call('setdesign_delete_objects', { objects: ['Kamera'] }), /at least one camera/);
});

test('setdesign_select_objects supports replace, add, toggle and remove', async () => {
  const { call, bus } = setup();
  const a = await call('setdesign_add_primitive', { primitive: 'box' });
  const b = await call('setdesign_add_primitive', { primitive: 'sphere' });
  await call('setdesign_select_objects', { objects: [a.id] });
  await call('setdesign_select_objects', { objects: [b.id], mode: 'add' });
  assert.deepEqual(bus.getUi().selectedIds, [a.id, b.id]);
  await call('setdesign_select_objects', { objects: [a.id], mode: 'toggle' });
  assert.deepEqual(bus.getUi().selectedIds, [b.id]);
  await call('setdesign_select_objects', { objects: [] });
  assert.deepEqual(bus.getUi().selectedIds, []);
});

test('setdesign_hide_objects hides and unhides', async () => {
  const { call, scene } = setup();
  const box = await call('setdesign_add_primitive', { primitive: 'box' });
  await call('setdesign_hide_objects', { objects: [box.id] });
  assert.equal(scene().assets[0].hidden, true);
  await call('setdesign_hide_objects', { unhideAll: true });
  assert.equal(scene().assets[0].hidden, false);
});

test('setdesign_aim_object points a light at an object', async () => {
  const { call, scene } = setup();
  await call('setdesign_add_primitive', { primitive: 'person', location: [0, 0, 0.875] });
  const light = await call('setdesign_add_light', { lightType: 'area', location: [0, -3, 2.5] });
  await call('setdesign_aim_object', { object: light.id, lookAt: 'Stand-in' });
  const stored = scene().lights.find((l) => l.id === light.id)!;
  const forward = forwardFromRotation(stored.rotation!);
  assert.ok(forward.z < -0.8, 'faces into the set');
  await assert.rejects(call('setdesign_aim_object', { object: 'Stand-in', lookAtPoint: [0, 0, 0] }), /Only cameras and lights/);
});

test('setdesign_set_active_camera and setdesign_set_view look through a chosen camera', async () => {
  const { call, bus, scene } = setup();
  const close2 = await call('setdesign_add_camera', { name: 'Nah', makeActive: false });
  assert.notEqual(scene().activeCameraId, close2.id);
  await call('setdesign_set_active_camera', { object: 'Nah' });
  assert.equal(scene().activeCameraId, close2.id);
  const view = await call('setdesign_set_view', { camera: true, object: 'Kamera' });
  assert.equal(view.lookThroughCamera, true);
  assert.equal(view.camera, 'Kamera');
  await call('setdesign_set_view', { view: 'top' });
  assert.equal(bus.getUi().lookThroughCamera, false);
  assert.equal(bus.getUi().ortho, true);
  await call('setdesign_set_view', { frame: 'all' });
  await assert.rejects(call('setdesign_set_view', {}), /Pass camera, view/);
});

test('setdesign_align_camera_to_view moves the active camera to the viewport', async () => {
  const { call, scene } = setup();
  await call('setdesign_set_view', { location: [0, -8, 2], target: [0, 0, 1] });
  const result = await call('setdesign_align_camera_to_view');
  assert.deepEqual(result.location, { x: 0, y: -8, z: 2 });
  close(scene().cameras![0].position.z, 8);
});

test('setdesign_set_shading, setdesign_set_overlays, setdesign_set_output and setdesign_set_world', async () => {
  const { call, scene, bus } = setup();
  await call('setdesign_set_shading', { mode: 'rendered' });
  assert.equal(scene().shading, 'rendered');
  await call('setdesign_set_overlays', { thirds: true, passepartout: 0.5 });
  assert.equal(bus.getUi().overlays.thirds, true);
  assert.equal(bus.getUi().overlays.passepartout, 0.5);
  await call('setdesign_set_output', { width: 2048, height: 858 });
  assert.deepEqual(scene().output, { width: 2048, height: 858 });
  await assert.rejects(call('setdesign_set_output', { width: 3, height: 3 }), /between 16 and 8192/);
  await call('setdesign_set_world', { color: '#202020', strength: 0.3 });
  assert.deepEqual(scene().world, { color: '#202020', strength: 0.3 });
});

test('setdesign_history undoes and redoes scene changes but not view changes', async () => {
  const { call, scene } = setup();
  await call('setdesign_add_primitive', { primitive: 'box' });
  await call('setdesign_set_view', { view: 'front' });
  assert.deepEqual((await call('setdesign_history', { action: 'list' })).undo, ['Grundkörper hinzufügen']);
  await call('setdesign_history', { action: 'undo' });
  assert.equal(scene().assets.length, 0);
  await call('setdesign_history', { action: 'redo' });
  assert.equal(scene().assets.length, 1);
});

test('setdesign_list_commands and setdesign_run_command reach every UI command', async () => {
  const { call, bus } = setup();
  const { commands } = await call('setdesign_list_commands');
  const ids = commands.map((c: any) => c.id);
  for (const id of ['object.add_primitive', 'view.preset', 'view.frame', 'tool.set', 'workspace.tab', 'edit.undo']) assert.ok(ids.includes(id), id);
  await call('setdesign_run_command', { command: 'tool.set', args: { tool: 'rotate' } });
  assert.equal(bus.getUi().tool, 'rotate');
  await assert.rejects(call('setdesign_run_command', { command: 'object.explode' }), /Unknown set design command/);
});

test('setdesign_open_workspace shows the workspace on a tab', async () => {
  const { call, opened, bus } = setup();
  await call('setdesign_open_workspace', { tab: 'camera' });
  assert.equal(opened(), 1);
  assert.equal(bus.getUi().workspaceTab, 'camera');
});

test('setdesign_capture_frame renders the active camera and files it into media, shot and reference', async () => {
  const { call, captures, media, shots, references, scene } = setup();
  await call('setdesign_set_output', { width: 2048, height: 858 });
  const result = await call('setdesign_capture_frame', { pass: 'clay', width: 1024, shotNumber: 3, reference: 'Drehrestaurant' });
  assert.equal(captures[0].cameraId, scene().activeCameraId);
  assert.equal(captures[0].pass, 'clay');
  assert.deepEqual([captures[0].width, captures[0].height], [1024, 429]);
  assert.equal(media.length, 1);
  assert.match(media[0].prompt, /35mm lens on Super 35/);
  assert.equal(shots[0].shotNumber, 3);
  assert.equal(shots[0].imageUrl, 'blob:media-1');
  assert.deepEqual(references, ['Drehrestaurant']);
  assert.equal(result.__mcpContent[0].type, 'image');
  assert.equal(result.__mcpContent[0].mimeType, 'image/png');
  const quiet = await call('setdesign_capture_frame', { returnImage: false, addToMedia: false });
  assert.equal(quiet.__mcpContent, undefined);
  await assert.rejects(call('setdesign_capture_frame', { camera: 'Sonne' }), /No camera "Sonne"/);
  await assert.rejects(call('setdesign_capture_frame', { pass: 'normal' }), /pass must be/);
});

test('a property drag is one undo step (bus interaction around several commands)', async () => {
  const { bus, call, scene } = setup();
  const box = await call('setdesign_add_primitive', { primitive: 'box' });
  bus.beginInteraction('Eigenschaft');
  for (const z of [1, 2, 3]) bus.run('object.transform', { object: box.id, location: [0, 0, z] });
  bus.endInteraction(true);
  assert.equal(bus.history().undo.length, 2);
  bus.undo();
  close(scene().assets[0].position.y, 0.5);
});

test('Scene Map data (stage, plan, character) survives normalizing, moving, duplicating and undo', async () => {
  const base = createDefaultSetDesignState();
  const initial = {
    ...base,
    stage: { shots: [{ id: 's1' }], axisLine: { a: [0, 0], b: [1, 0] } },
    assets: [
      { id: 'p1', name: 'Anna', kind: 'primitive' as const, primitive: 'person' as const, position: { x: 0, y: 0.85, z: 0 }, rotation: { x: 0, y: 30, z: 0 }, scale: { x: 1, y: 0.97, z: 1 }, character: { referenceId: 'ref-anna', heightM: 1.7, pose: 'stand' } },
      { id: 'w1', name: 'Wand Nord', kind: 'primitive' as const, primitive: 'box' as const, position: { x: 0, y: 1.3, z: -3 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 4, y: 2.6, z: 0.12 }, plan: { category: 'wall', heightM: 2.6 } },
    ],
  };
  const { call, scene, bus } = setup(initial);
  await call('setdesign_transform_object', { object: 'Anna', location: [1, 0, 0.85] });
  const copy = await call('setdesign_duplicate_objects', { objects: ['Wand Nord'] });
  assert.deepEqual(scene().stage, initial.stage);
  assert.deepEqual(scene().assets.find((a) => a.id === 'p1')!.character, initial.assets[0].character);
  assert.deepEqual(scene().assets.find((a) => a.id === copy.created[0].id)!.plan, { category: 'wall', heightM: 2.6 });
  bus.undo(); bus.undo();
  assert.deepEqual(scene().assets.find((a) => a.id === 'p1')!.character, initial.assets[0].character);
  assert.deepEqual(scene().stage, initial.stage);
});

test('camera move tools: add, update, preset, seek, remove and export', async () => {
  const { call, scene } = setup();
  await call('setdesign_set_view', { location: [0, -8, 1.6], target: [0, 0, 1.2], fov: 40 });
  const first = await call('setdesign_add_camera_keyframe', { label: 'Start' });
  assert.equal(first.time, 0);
  const second = await call('setdesign_add_camera_keyframe', { location: [3, -6, 1.6], target: [0, 0, 1.2] });
  assert.equal(second.time, 2);
  const third = await call('setdesign_add_camera_keyframe', { from: 'camera', time: 5 });
  assert.equal(third.keyframes, 3);
  await call('setdesign_update_camera_keyframe', { id: second.id, time: 3, fov: 30 });
  const path = await call('setdesign_get_camera_path');
  assert.deepEqual(path.keyframes.map((k: any) => k.time), [0, 3, 5]);
  assert.equal(path.keyframes[1].fov, 30);
  assert.deepEqual(path.keyframes[1].location, { x: 3, y: -6, z: 1.6 });
  assert.equal(path.export.keyframes.length, 3);
  const seek = await call('setdesign_seek_camera_path', { time: 1.5 });
  assert.ok(seek.location.x > 0 && seek.location.x < 3, 'between first and second keyframe');
  close(scene().camera.position.x, seek.location.x);
  const settings = await call('setdesign_set_camera_path', { durationSeconds: 8, fps: 25, loop: true, easing: 'linear' });
  assert.deepEqual([settings.durationSeconds, settings.fps, settings.loop, settings.easing], [8, 25, true, 'linear']);
  const orbit = await call('setdesign_set_camera_path', { preset: 'orbit' });
  assert.equal(orbit.keyframes, 4);
  await assert.rejects(call('setdesign_set_camera_path', { preset: 'barrel-roll' }), /preset must be one of/);
  await call('setdesign_remove_camera_keyframes', { all: true });
  assert.equal(scene().cameraPath!.keyframes.length, 0);
  await assert.rejects(call('setdesign_seek_camera_path', { time: 1 }), /no keyframes/);
});

test('setdesign_camera_from_shot uses the storyboard shot lens, yaw and pitch', async () => {
  const { call, scene, bus } = setup();
  bus.provideServices({ getShots: () => [{ shot: 4, lensPresetId: 'lens-85mm', cameraYaw: 90, cameraPitch: 0 }] });
  const view = await call('setdesign_camera_from_shot', { shotNumber: 4 });
  close(view.location.x, 8);
  close(view.location.z, 2);
  const cam = await call('setdesign_camera_from_shot', { shotNumber: 4, apply: 'camera' });
  assert.equal(cam.lensMm, 85);
  assert.equal(scene().cameras![0].lensMm, 85);
  await assert.rejects(call('setdesign_camera_from_shot', { shotNumber: 9 }), /No storyboard shot 9/);
});

test('material presets, HDRI, preset lists, pack manifest and Blender export', async () => {
  const { call, scene } = setup();
  const presets = await call('setdesign_list_presets');
  assert.ok(presets.hdri.length > 0 && presets.materialPresets.length > 0 && presets.renderPresets.length > 0);
  assert.deepEqual(presets.cameraMoves.map((m: any) => m.id), ['push-in', 'orbit', 'crane-up', 'dolly-left']);
  const box = await call('setdesign_add_primitive', { primitive: 'box' });
  const material = presets.materialPresets[0];
  await call('setdesign_apply_material_preset', { preset: material.id, objects: [box.id] });
  if (typeof material.values.color === 'string') assert.equal(scene().assets[0].material?.color, material.values.color);
  await assert.rejects(call('setdesign_apply_material_preset', { preset: 'gold-leaf-xyz', objects: [box.id] }), /Unknown material preset/);
  await call('setdesign_set_hdri', { url: 'https://example.com/studio_small_09_2k.hdr', background: true, strength: 0.8 });
  assert.deepEqual([scene().world!.hdriUrl, scene().world!.hdriBackground, scene().world!.hdriStrength], ['https://example.com/studio_small_09_2k.hdr', true, 0.8]);
  await assert.rejects(call('setdesign_set_hdri', { url: 'https://example.com/sky.jpg' }), /hdr or .exr/);
  await call('setdesign_set_hdri', { clear: true });
  assert.equal(scene().world!.hdriUrl, undefined);
  const manifest = await call('setdesign_get_pack_manifest');
  assert.ok(manifest.manifest.items.length > 0);
  await call('setdesign_add_light', { lightType: 'spot', temperature: 3200, power: 700 });
  const exported = await call('setdesign_export_blender_script');
  assert.equal(exported.fileName, 'avpe_set.py');
  for (const needle of ["bpy.data.scenes.new('AVPE Set')", "primitive('box', 'Würfel'", 'cd.lens = 35', "cd.sensor_fit = 'AUTO'", 'scene.camera = c0', "bpy.data.lights.new('Spot', 'SPOT')", 'ld.energy = 700', 'scene.render.resolution_x = 1920']) {
    assert.ok(exported.script.includes(needle), needle);
  }
});

test('removing all keyframes of an empty camera move is fine, unknown ids are reported', async () => {
  const { call } = setup();
  assert.equal((await call('setdesign_remove_camera_keyframes', { all: true })).removed, 0);
  await assert.rejects(call('setdesign_remove_camera_keyframes', { ids: ['kf-nope'] }), /No keyframe kf-nope/);
});
