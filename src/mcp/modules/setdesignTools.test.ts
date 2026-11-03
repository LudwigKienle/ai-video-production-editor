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
    if (String(input).endsWith('.glb')) return new Response(new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 12, 0, 0, 0]), { status: 200, headers: { 'Content-Type': 'model/gltf-binary' } });
    if (/\/models\/abc123$/.test(String(input))) {
      return new Response(JSON.stringify({ uid: 'abc123', name: 'Stool', isDownloadable: true, user: { displayName: 'Jane', username: 'jane' }, license: { label: 'CC-BY', slug: 'by' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
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
  // Sketchfab import goes through the 3D library importer: files are written into a fake project folder.
  const written: string[] = [];
  const { overrideLibraryToolDeps } = await import('./setdesignLibraryTools.ts');
  overrideLibraryToolDeps({ projectPath: '/tmp/fake-project', writeFile: async (_folder, rel) => { written.push(rel); return true; }, statFile: async () => null });
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
      // Agentic 3D builder.
      ['setdesign_builder_guide', {}],
      ['setdesign_build_room', { name: 'Bar', width: 5, depth: 4, openings: [{ wall: 'south', type: 'door' }, { wall: 'north', type: 'window', offset: 1 }] }],
      ['setdesign_build_furniture', { type: 'table', name: 'Bartisch', parent: 'Bar' }],
      ['setdesign_build_furniture', { type: 'chair', name: 'Hocker', location: [1.2, -1, 0] }],
      ['setdesign_build_array', { object: 'Hocker', count: 3, offset: [0.6, 0, 0] }],
      ['setdesign_build_scatter', { primitive: 'box', dimensions: [0.1, 0.1, 0.2], area: { onObject: 'Bartisch' }, count: 4, seed: 2, minDistance: 0.2 }],
      ['setdesign_build_stairs', { steps: 4, location: [-4, 0, 0] }],
      ['setdesign_set_material', { objects: ['Bar'], color: '#d0c8b8', maps: { baseColor: 'https://example.com/plaster.jpg' }, repeat: [2, 2], name: 'Plaster' }],
      ['setdesign_group_objects', { objects: ['Bartisch'], name: 'Tischgruppe' }],
      ['setdesign_ungroup', { objects: ['Tischgruppe'] }],
      ['setdesign_parent_objects', { objects: ['Hocker Array'], parent: 'Bar' }],
      ['setdesign_batch', { label: 'Kiste', commands: [
        { command: 'object.add_primitive', args: { primitive: 'box', name: 'Kiste', dimensions: [0.4, 0.4, 0.4], location: [0, 0, 2] }, as: 'kiste' },
        { command: 'material.set', args: { objects: ['$kiste'], color: '#8a6f55' } },
      ] }],
      ['setdesign_drop_to_floor', { objects: ['Kiste'] }],
      ['setdesign_place_on', { object: 'Kiste', target: 'Bartisch' }],
      ['setdesign_align_objects', { objects: ['Kiste'], to: 'Bartisch', axis: 'x', side: 'min' }],
      ['setdesign_query', { objects: ['Kiste', 'Bartisch'] }],
      ['setdesign_describe_scene', {}],
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
    assert.ok(fetched.filter((url) => url.includes('sketchfab')).length >= 3, 'search, model details and download link');
    assert.ok(written.some((rel) => rel.endsWith('abc123.glb')), 'GLB stored in the project, not the expiring link');
    assert.ok(stored!.assets.some((asset) => asset.attribution?.author === 'Jane'), 'Sketchfab credit kept');
    const paid = listed.filter((tool) => tool.description.startsWith('[KOSTET CREDITS]')).map((tool) => tool.name).sort();
    assert.deepEqual(paid, ['setdesign_ai_director', 'setdesign_generate_blockout', 'setdesign_generate_world']);
    assert.deepEqual([...called].sort(), listed.map((tool) => tool.name).sort());
    assert.equal(state.activeWorkspace, 'SET_DESIGN');
    assert.equal(state.mediaItems.length, 1);
    assert.deepEqual(shots, [2]);
    assert.equal(stored!.shading, 'rendered');
    // Builder results through MCP.
    const query = await mcp.call('setdesign_query', { objects: ['Kiste'], camera: 'none' });
    const kiste = (query.objects as Array<{ name: string; zMin: number; floor: { status: string; supportedBy?: string } }>)[0];
    assert.equal(kiste.zMin, 0.75);
    assert.equal(kiste.floor.status, 'supported');
    assert.equal(kiste.floor.supportedBy, 'Bartisch/Top');
    const described = await mcp.call('setdesign_describe_scene');
    assert.match(String(described.summary), /The set has \d+ objects/);
    assert.ok((described.hierarchy as Array<{ name: string }>).some((node) => node.name === 'Bar'));
    const guide = await mcp.call('setdesign_builder_guide');
    assert.match(String(guide.guide), /Z is up/);
    for (const name of ['setdesign_query', 'setdesign_describe_scene', 'setdesign_builder_guide']) assert.doesNotMatch(listed.find((tool) => tool.name === name)!.description, /changes the project/, name);
    const batchSchema = listed.find((tool) => tool.name === 'setdesign_batch')!.inputSchema as { properties: { commands: { items: { properties: Record<string, unknown> } } } };
    assert.deepEqual(Object.keys(batchSchema.properties.commands.items.properties).sort(), ['args', 'as', 'command']);
    const failed = await mcp.call('setdesign_batch', { commands: [{ command: 'object.add_primitive', args: { primitive: 'box', name: 'Nie' } }, { command: 'object.delete', args: { objects: ['Gibtsnicht'] } }] });
    assert.equal(failed.ok, false);
    assert.match(String(failed.message), /Step 2 \(object\.delete\) failed/);
    assert.equal(stored!.assets.some((asset) => asset.name === 'Nie'), false);
    assert.ok(stored!.assets.find((asset) => asset.name === 'Bar/Floor')!.material!.maps!.baseColor);
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
    overrideLibraryToolDeps(null);
  }
});
