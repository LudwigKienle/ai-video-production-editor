/**
 * MCP test over the real renderer → MCP bridge (registerStudioTools): every setdesign_* tool is
 * published with a JSON schema and answers a call. Behaviour per tool: src/setdesign/agentTools.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import './setdesignTools.ts';
import { createMcpHarness, createTestContext } from '../mcpHarness.ts';
import { registerLiveCommands } from '../liveCommands.ts';
import { SETDESIGN_TOOLS } from './setdesignTools.ts';
import { setDesignBus } from '../../setdesign/bus.ts';
import type { SetDesignState } from '../../types.ts';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

test('setdesign tools are published over the MCP bridge and every one answers', async () => {
  let stored: SetDesignState | null = null;
  const detachHost = setDesignBus.attachHost({ getScene: () => stored, setScene: (next) => { stored = next; } });
  const shots: number[] = [];
  const detach = [
    setDesignBus.provideAction('renderFrame', async ({ request }) => ({ dataUrl: PNG, width: (request as any).width, height: (request as any).height })),
    setDesignBus.provideAction('applyToShot', async (payload) => { shots.push(Number(payload.shotNumber)); }),
    setDesignBus.provideAction('applyToReference', async (payload) => String(payload.reference)),
  ];
  // Stubs: storyboard shots, classic-page live commands, Sketchfab API, Sketchfab token.
  setDesignBus.provideServices({ getShots: () => [{ shot: 1, lensPresetId: '35mm', cameraYaw: 30, cameraPitch: -5 }] });
  const liveCalls: string[] = [];
  const disposeLive = registerLiveCommands(Object.fromEntries(['setdesign.classic.aiDirector', 'setdesign.classic.playback', 'setdesign.classic.record', 'setdesign.classic.renderPreset', 'setdesign.classic.renderSettings', 'setdesign.libraryModels']
    .map((name) => [name, (args: Record<string, unknown>) => { liveCalls.push(name); return name === 'setdesign.libraryModels' ? [] : { ok: true, args }; }])));
  const fetched: string[] = [];
  const g = globalThis as unknown as { fetch: typeof fetch; localStorage?: Storage };
  const realFetch = g.fetch;
  g.fetch = (async (input: string) => {
    fetched.push(String(input));
    const body = String(input).includes('/download')
      ? { glb: { url: 'https://example.com/stool.glb' } }
      : { results: [{ uid: 'abc123', name: 'Stool', user: { displayName: 'Jane', username: 'jane' }, license: { label: 'CC-BY' }, faceCount: 900, likeCount: 4, thumbnails: { images: [{ url: 'https://example.com/t.jpg', width: 256, height: 144 }] } }] };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  const storage = new Map<string, string>([['sketchfab_token', 'test-token']]);
  g.localStorage = { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, v); }, removeItem: (k: string) => { storage.delete(k); } } as unknown as Storage;
  const { BUILTIN_ASSET_PACKS, getAssetPackItemsByType } = await import('../../data/assetPacks.ts');
  const materialId = getAssetPackItemsByType(BUILTIN_ASSET_PACKS, 'material').filter((item) => item.metadata)[0].id;
  const { ctx, state } = createTestContext();
  const mcp = await createMcpHarness(ctx);
  try {
    const listed = mcp.list().filter((tool) => tool.name.startsWith('setdesign_'));
    assert.equal(listed.length, SETDESIGN_TOOLS.length);
    assert.ok(listed.length >= 45, `${listed.length} tools`);
    for (const tool of listed) assert.equal((tool.inputSchema as { type: string }).type, 'object', tool.name);
    assert.match(listed.find((tool) => tool.name === 'setdesign_add_primitive')!.description, /changes the project/);

    const calls: Array<[string, Record<string, unknown>]> = [
      ['setdesign_get_scene', {}],
      ['setdesign_list_commands', {}],
      ['setdesign_open_workspace', { tab: 'camera' }],
      ['setdesign_add_primitive', { primitive: 'wall', name: 'Rückwand', location: [0, 3, 1.3] }],
      ['setdesign_import_model', { url: 'https://example.com/tresen.glb' }],
      ['setdesign_add_camera', { name: 'Totale', location: [4, -5, 1.6], lookAt: 'Rückwand', lensMm: 28 }],
      ['setdesign_add_light', { lightType: 'area', location: [0, -2, 2.8], lookAt: 'Rückwand', power: 400, temperature: 4300 }],
      ['setdesign_transform_object', { object: 'Rückwand', rotation: [0, 0, 10] }],
      ['setdesign_update_object', { object: 'Rückwand', color: '#8a8378' }],
      ['setdesign_duplicate_objects', { objects: ['Rückwand'], offset: [4, 0, 0] }],
      ['setdesign_select_objects', { objects: ['Rückwand.001'] }],
      ['setdesign_hide_objects', {}],
      ['setdesign_delete_objects', { objects: ['Rückwand.001'] }],
      ['setdesign_aim_object', { object: 'Totale', lookAtPoint: [0, 3, 1.2] }],
      ['setdesign_set_active_camera', { object: 'Totale' }],
      ['setdesign_set_view', { camera: true }],
      ['setdesign_align_camera_to_view', {}],
      ['setdesign_set_shading', { mode: 'rendered' }],
      ['setdesign_set_overlays', { thirds: true }],
      ['setdesign_set_output', { width: 2048, height: 858 }],
      ['setdesign_set_world', { strength: 0.4 }],
      ['setdesign_run_command', { command: 'view.preset', args: { view: 'top' } }],
      ['setdesign_history', { action: 'undo' }],
      ['setdesign_history', { action: 'redo' }],
      ['setdesign_capture_frame', { pass: 'depth', shotNumber: 2 }],
      ['setdesign_hide_objects', { unhideAll: true }],
      ['setdesign_set_hdri', { url: 'https://example.com/studio.hdr' }],
      ['setdesign_add_camera_keyframe', {}],
      ['setdesign_add_camera_keyframe', { location: [2, -6, 1.6] }],
      ['setdesign_update_camera_keyframe', { id: '__FIRST_KEYFRAME__', time: 0.5 }],
      ['setdesign_get_camera_path', {}],
      ['setdesign_set_camera_path', { durationSeconds: 4 }],
      ['setdesign_seek_camera_path', { time: 1 }],
      ['setdesign_remove_camera_keyframes', { ids: ['__FIRST_KEYFRAME__'] }],
      ['setdesign_camera_from_shot', { shotNumber: 1 }],
      ['setdesign_apply_material_preset', { preset: '__FIRST_MATERIAL__', objects: ['Rückwand'] }],
      ['setdesign_list_presets', {}],
      ['setdesign_get_pack_manifest', {}],
      ['setdesign_export_blender_script', {}],
      ['setdesign_search_sketchfab', { query: 'stool' }],
      ['setdesign_import_sketchfab', { uid: 'abc123', author: 'Jane', license: 'CC-BY' }],
      ['setdesign_play_camera_path', { action: 'play' }],
      ['setdesign_record_camera_move', {}],
      ['setdesign_apply_render_preset', { preset: 'golden-hour' }],
      ['setdesign_set_classic_render', { exposure: 1.2 }],
      ['setdesign_list_library_assets', {}],
      ['setdesign_ai_director', { prompt: 'add a stool', confirm: true }],
      ['setdesign_generate_blockout', { imageUrl: 'https://example.com/ref.png' }],
      ['setdesign_generate_world', { prompt: 'rooftop bar at night' }],
    ];
    // Paid tools without confirm must refuse before calling any provider.
    const PAID_WITHOUT_CONFIRM = new Set(['setdesign_generate_blockout', 'setdesign_generate_world']);
    const called = new Set<string>();
    for (const [name, rawArgs] of calls) {
      const firstKeyframe = stored?.cameraPath?.keyframes?.[0]?.id;
      const args = JSON.parse(JSON.stringify(rawArgs).replace(/__FIRST_KEYFRAME__/g, firstKeyframe || '').replace(/__FIRST_MATERIAL__/g, materialId));
      const result = await mcp.call(name, args);
      if (PAID_WITHOUT_CONFIRM.has(name)) {
        assert.equal(result.ok, false, `${name} must refuse without confirm`);
        assert.match(String(result.message), /spends provider credits/);
      } else {
        assert.equal(result.ok, true, `${name}: ${String(result.message)}`);
      }
      called.add(name);
    }
    assert.deepEqual(liveCalls.sort(), ['setdesign.classic.aiDirector', 'setdesign.classic.playback', 'setdesign.classic.record', 'setdesign.classic.renderPreset', 'setdesign.classic.renderSettings', 'setdesign.libraryModels']);
    assert.equal(fetched.filter((url) => url.includes('sketchfab')).length, 2);
    assert.ok(stored!.assets.some((asset) => asset.attribution?.author === 'Jane'), 'Sketchfab credit kept');
    const paid = listed.filter((tool) => tool.description.startsWith('[KOSTET CREDITS]')).map((tool) => tool.name).sort();
    assert.deepEqual(paid, ['setdesign_ai_director', 'setdesign_generate_blockout', 'setdesign_generate_world']);
    assert.deepEqual([...called].sort(), listed.map((tool) => tool.name).sort());
    assert.equal(state.activeWorkspace, 'SET_DESIGN');
    assert.equal(state.mediaItems.length, 1);
    assert.deepEqual(shots, [2]);
    assert.equal(stored!.shading, 'rendered');
    const scene = await mcp.call('setdesign_get_scene');
    assert.equal((scene.activeCamera as { name: string }).name, 'Totale');
    const bad = await mcp.call('setdesign_add_primitive', { primitive: 'teapot' });
    assert.equal(bad.ok, false);
    assert.match(String(bad.message), /primitive must be one of/);
  } finally {
    mcp.dispose();
    detach.forEach((dispose) => dispose());
    detachHost();
    disposeLive();
    g.fetch = realFetch;
  }
});
