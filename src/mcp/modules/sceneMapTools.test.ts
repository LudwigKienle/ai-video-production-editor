import test from 'node:test';
import assert from 'node:assert/strict';

import { SCENE_MAP_TOOL_MODULE, toolNameForCommand } from './sceneMapTools.ts';
import { createMcpHarness, createTestContext } from '../mcpHarness.ts';
import { bindSceneMapBridge, resetSession } from '../../shotdesigner/session.ts';
import { BLOCKING_COMMANDS } from '../../shotdesigner/commands.ts';
import { createDefaultSceneMapState, createSceneMapElement } from '../../data/sceneMapTypes.ts';
import type { SceneMapState, ShotPrompt } from '../../types.ts';

type Project = { setDesign: unknown; shotPrompts: ShotPrompt[]; sceneMap: SceneMapState; opened: number };

const bind = (): Project => {
  resetSession();
  const overview = createDefaultSceneMapState();
  overview.scenes[0].elements.push(
    createSceneMapElement('character', { x: 80, y: 100 }, { label: 'Mia' }),
    createSceneMapElement('camera', { x: 80, y: 300 }, { label: 'D' }),
    createSceneMapElement('prop', { x: 200, y: 100 }, { label: 'Koffer' }),
  );
  const project: Project = { setDesign: null, shotPrompts: [{ shot: 1, prompt: '', description: 'Bestehend', characters: [], environment: null }], sceneMap: overview, opened: 0 };
  bindSceneMapBridge({
    getSetDesign: () => project.setDesign as never,
    setSetDesign: (next) => { project.setDesign = next; },
    getShotPrompts: () => project.shotPrompts,
    setShotPrompts: (next) => { project.shotPrompts = next; },
    getReferences: () => [],
    getSceneMap: () => project.sceneMap,
    setSceneMap: (next) => { project.sceneMap = next; },
    getProjectPath: () => null,
    getProjectName: () => 'Testszene',
    openSceneMap: () => { project.opened += 1; },
  });
  return project;
};

const called = new Set<string>();

const withMcp = async (fn: (call: (name: string, args?: Record<string, unknown>) => Promise<Record<string, unknown>>, project: Project) => Promise<void>) => {
  const project = bind();
  const { ctx } = createTestContext();
  const mcp = await createMcpHarness(ctx);
  try {
    await fn(async (name, args = {}) => {
      called.add(name);
      const out = await mcp.call(name, args);
      return out;
    }, project);
  } finally {
    mcp.dispose();
    bindSceneMapBridge(null);
  }
};

const ok = (out: Record<string, unknown>) => {
  assert.equal(out.ok, true, String(out.message));
  return out;
};

test('every scene map tool is published with a JSON schema and a description', async () => {
  bind();
  const { ctx } = createTestContext();
  const mcp = await createMcpHarness(ctx);
  try {
    const listed = mcp.list().filter((t) => t.name.startsWith('scene_map_'));
    assert.equal(listed.length, SCENE_MAP_TOOL_MODULE.tools.length);
    for (const command of BLOCKING_COMMANDS) assert.ok(listed.some((t) => t.name === toolNameForCommand(command.id)), `${command.id} has a tool`);
    for (const tool of listed) {
      assert.equal((tool.inputSchema as { type: string }).type, 'object', tool.name);
      assert.ok(tool.description.length > 30, `${tool.name} description`);
    }
    assert.equal(toolNameForCommand('plan.addElement'), 'scene_map_plan_add_element');
  } finally {
    mcp.dispose();
  }
});

test('floor plan, characters, cameras and blocking over MCP', async () => {
  await withMcp(async (call, project) => {
    ok(await call('scene_map_open', { view: 'plan' }));
    assert.equal(project.opened, 1);
    ok(await call('scene_map_plan_add_room', { width: 8, depth: 6, openSide: 'south' }));
    ok(await call('scene_map_plan_add_wall', { x1: -4, z1: 0, x2: -2, z2: 0 }));
    const table = ok(await call('scene_map_plan_add_element', { category: 'table', x: 0, z: -1 }));
    ok(await call('scene_map_plan_update_element', { id: table.id, w: 2, label: 'Esstisch' }));
    ok(await call('scene_map_plan_set_background', { url: 'data:image/png;base64,AA', mPerPx: 0.02, opacity: 0.4 }));
    const anna = ok(await call('scene_map_character_add', { name: 'Anna', x: -1, z: 0, yawDeg: -90 }));
    ok(await call('scene_map_character_add', { name: 'Ben', x: 1, z: 0, yawDeg: 90 }));
    ok(await call('scene_map_character_update', { id: 'Ben', heightM: 1.9, posture: 'sitting' }));
    const camA = ok(await call('scene_map_camera_add', { x: 0, z: 4, aimAt: 'Anna', focalLengthMm: 35 }));
    ok(await call('scene_map_camera_update', { id: camA.id, focalLengthMm: 50, sensor: 'fullframe', heightM: 1.5 }));
    ok(await call('scene_map_camera_aim_at', { id: 'A', targetId: 'Ben', follow: true }));
    ok(await call('scene_map_camera_set_active', { id: 'A' }));
    ok(await call('scene_map_camera_cover', { targetId: 'Anna', pattern: 'ots', otherId: 'Ben' }));
    // Blocking over time.
    const key = ok(await call('scene_map_key_add', { id: anna.id, timeS: 4, x: 2, z: 1 }));
    ok(await call('scene_map_key_update', { id: anna.id, keyId: key.keyId, easing: 'linear' }));
    ok(await call('scene_map_set_time', { timeS: 4 }));
    ok(await call('scene_map_object_move', { id: 'Anna', x: 2.5, z: 1 }));
    ok(await call('scene_map_object_rotate', { id: 'Anna', yawDeg: 45 }));
    ok(await call('scene_map_track_retime', { id: 'Anna', factor: 1.5 }));
    ok(await call('scene_map_anim_set_duration', { durationS: 12, fps: 25 }));
    ok(await call('scene_map_play', { playing: true, speed: 2 }));
    ok(await call('scene_map_play', { playing: false }));
    const plan = ok(await call('scene_map_get_plan', { timeS: 6 }));
    assert.equal((plan.characters as unknown[]).length, 2);
    assert.equal((plan.cameras as unknown[]).length, 2);
    assert.ok(((plan.tracks as Record<string, unknown[]>)[String(anna.id)]).length >= 2);
    assert.ok((plan.elements as unknown[]).length >= 5);
    // Object helpers.
    const dup = ok(await call('scene_map_object_duplicate', { id: table.id }));
    ok(await call('scene_map_object_set_flags', { id: 'Ben', locked: true }));
    ok(await call('scene_map_object_delete', { id: dup.id }));
    ok(await call('scene_map_select', { ids: [String(anna.id)] }));
    ok(await call('scene_map_set_view_options', { showCones: false, showPaths: true }));
    ok(await call('scene_map_key_delete', { id: anna.id, keyId: key.keyId }));
    ok(await call('scene_map_track_clear', { id: 'Anna' }));
    // Batch + undo/redo.
    const batch = ok(await call('scene_map_run_commands', { commands: [{ command: 'character.add', params: { name: 'C', x: 0, z: 2 } }, { command: 'camera.add', params: { x: 3, z: 3, aimAt: 'C' } }] }));
    assert.equal(batch.steps, 2);
    const undone = ok(await call('scene_map_undo'));
    assert.equal(undone.undone, true);
    assert.equal(((await call('scene_map_get_plan')).characters as unknown[]).length, 2);
    ok(await call('scene_map_redo'));
    assert.equal(((await call('scene_map_get_plan')).characters as unknown[]).length, 3);
    const failed = await call('scene_map_object_move', { id: 'gibt-es-nicht', x: 1 });
    assert.equal(failed.ok, false);
    const listed = ok(await call('scene_map_list_commands'));
    assert.ok((listed.commands as unknown[]).length === BLOCKING_COMMANDS.length);
  });
});

test('shot list, storyboard link, scene tools and exports over MCP', async () => {
  await withMcp(async (call, project) => {
    ok(await call('scene_map_scene_apply_template', { templateId: 'dialog-two' }));
    ok(await call('scene_map_scene_set_aspect', { aspectRatio: 2.39 }));
    ok(await call('scene_map_scene_set_line_of_action', { aId: 'Anna', bId: 'Ben' }));
    const shots = ok(await call('scene_map_list_shots', { order: 'setup' }));
    assert.equal((shots.shots as unknown[]).length, 3);
    assert.deepEqual(shots.axisWarnings, []);
    const added = ok(await call('scene_map_shot_add', { cameraId: 'A', startS: 2, endS: 5, description: 'Reaktion' }));
    assert.equal(added.code, '1B');
    ok(await call('scene_map_shot_update', { id: '1B', size: 'CU', move: 'dolly', lensMm: 85, props: 'Tasse', crew: 'Fokus', gear: 'Slider', notes: 'leise' }));
    ok(await call('scene_map_shot_reorder', { id: '1B', toIndex: 0 }));
    ok(await call('scene_map_shot_detach', { id: '3A', detached: true }));
    ok(await call('scene_map_shot_link', { id: '2A', storyboardShot: 1 }));
    ok(await call('scene_map_capture_frame', { shotId: '2A' }));
    const view = ok(await call('scene_map_render_view', { cameraId: 'B', widthPx: 480 }));
    assert.ok(String(view.svg).startsWith('<svg'));
    assert.ok((view.visible as string[]).includes('Anna'));
    const planSvg = ok(await call('scene_map_render_plan', { widthPx: 800 }));
    assert.ok(String(planSvg.svg).includes('180°'));
    const sb = ok(await call('scene_map_send_to_storyboard', {}));
    assert.ok(project.shotPrompts.length >= 4, 'new storyboard shots created');
    assert.ok(project.shotPrompts.find((s) => s.shot === 1)?.cameraAngle?.includes('mm'), 'linked shot updated');
    assert.ok((sb.links as unknown[]).length >= 4);
    ok(await call('scene_map_shot_delete', { id: '1B' }));
    ok(await call('scene_map_scene_freeze', { name: 'Fassung 1' }));
    ok(await call('scene_map_object_delete', { id: 'C' }));
    ok(await call('scene_map_scene_restore', { id: 'Fassung 1' }));
    // Exports (PNG needs the app canvas; headless it reports a clear error).
    const json = ok(await call('scene_map_export', { format: 'json' }));
    assert.equal(JSON.parse(String(json.text)).format, 'avpe-blocking');
    const csv = ok(await call('scene_map_export', { format: 'csv' }));
    assert.ok(String(csv.text).includes('Shot'));
    const svg = ok(await call('scene_map_export', { format: 'svg' }));
    assert.ok(String(svg.text).startsWith('<svg'));
    const pdf = ok(await call('scene_map_export', { format: 'pdf', title: 'Küche' }));
    assert.ok(Buffer.from(String(pdf.base64), 'base64').toString('latin1').startsWith('%PDF'));
    const xlsx = ok(await call('scene_map_export', { format: 'xlsx' }));
    assert.equal(Buffer.from(String(xlsx.base64), 'base64').subarray(0, 2).toString(), 'PK');
    const png = await call('scene_map_export', { format: 'png' });
    assert.equal(png.ok, false);
    const save = await call('scene_map_export', { format: 'json', saveToProject: true });
    assert.equal(save.ok, false, 'no project folder → clear error');
  });
});

test('classic overview tools and import into the camera plan', async () => {
  await withMcp(async (call, project) => {
    const overview = ok(await call('scene_map_overview_get'));
    assert.equal((overview.scenes as unknown[]).length, 1);
    const scene = ok(await call('scene_map_overview_add_scene', { name: 'Flur' }));
    ok(await call('scene_map_overview_select_scene', { sceneId: project.sceneMap.scenes[0].id }));
    const el = ok(await call('scene_map_overview_add_element', { type: 'light', x: 10, y: 20, label: 'Fenster' }));
    ok(await call('scene_map_overview_update_element', { elementId: el.elementId, rotation: 90, linkedShotNumbers: [1] }));
    ok(await call('scene_map_overview_delete_element', { elementId: el.elementId }));
    assert.equal(project.sceneMap.scenes.length, 2);
    assert.ok(scene.sceneId);
    const imported = ok(await call('scene_map_import_overview', {}));
    assert.equal(imported.imported, 3);
    const plan = ok(await call('scene_map_get_plan'));
    assert.equal((plan.characters as Array<{ name: string }>)[0].name, 'Mia');
    assert.equal((plan.cameras as Array<{ name: string }>)[0].name, 'D');
  });
});

test('every published scene map tool was exercised by an MCP test', () => {
  const missing = SCENE_MAP_TOOL_MODULE.tools.map((t) => t.name).filter((n) => !called.has(n));
  assert.deepEqual(missing, []);
});
