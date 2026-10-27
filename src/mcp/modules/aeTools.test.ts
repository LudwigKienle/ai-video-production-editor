import test from 'node:test';
import assert from 'node:assert/strict';

import './aeTools.ts';
import { COMP_EXTRA_KEY } from './aeTools.ts';
import { createMcpHarness, createTestContext } from '../mcpHarness.ts';
import { registerLiveCommand } from '../liveCommands.ts';
import type { MediaItem } from '../../types.ts';
import type { CompStore } from '../../workspaces/fusion-shared/compPersist.ts';

const clip: MediaItem = { id: 'm1', name: 'Clip', type: 'video', url: 'blob:clip', source: 'upload', duration: 8 };

type LayerOut = { layerId: string; index: number; name: string; inPoint: number; outPoint: number; blend: string; solo: boolean; transform: Record<string, number | number[]>; keyframes: Record<string, Array<{ time: number; easing?: string }>>; effects: unknown[]; masks: unknown[] };

test('ae tools are published with schemas', async () => {
  const { ctx } = createTestContext();
  const mcp = await createMcpHarness(ctx);
  try {
    const names = mcp.list().map((tool) => tool.name);
    for (const name of [
      'ae_layers_list',
      'ae_layer_add',
      'ae_layer_reorder',
      'ae_layer_set_transform',
      'ae_layer_set_keyframe',
      'ae_layer_trim',
      'ae_layer_split',
      'ae_layer_duplicate',
      'ae_layer_delete',
      'ae_layer_add_effect',
      'ae_view_state',
      'ae_run_command',
    ]) {
      assert.ok(names.includes(name), `${name} missing`);
    }
    assert.match(mcp.list().find((t) => t.name === 'ae_layer_add')!.description, /changes the project/);
  } finally {
    mcp.dispose();
  }
});

test('build and edit a layer comp over MCP', async () => {
  const { ctx, state } = createTestContext({ mediaItems: [clip] });
  const mcp = await createMcpHarness(ctx);
  try {
    const empty = await mcp.call('ae_layers_list');
    assert.deepEqual(empty.layers, []);

    const media = await mcp.call('ae_layer_add', { kind: 'media', mediaId: 'm1' });
    assert.equal(media.ok, true);
    const store = state.extras[COMP_EXTRA_KEY] as CompStore;
    assert.equal(store.comps.length, 1);
    assert.ok(store.savedAt);
    const mediaId = (media.layer as LayerOut).layerId;
    assert.equal((media.layer as LayerOut).outPoint, 8);

    const solid = await mcp.call('ae_layer_add', { kind: 'solid', name: 'Hintergrund', color: '#203040' });
    const solidId = (solid.layer as LayerOut).layerId;
    const text = await mcp.call('ae_layer_add', { kind: 'text', text: 'Titel', position: [960, 200] });
    assert.deepEqual((text.layer as LayerOut).transform.position, [960, 200]);

    // Solid to the bottom; then move text to index 2.
    let order = await mcp.call('ae_layer_reorder', { layerId: solidId, mode: 'back' });
    assert.deepEqual((order.order as LayerOut[]).map((l) => l.name), ['Titel', 'Clip', 'Hintergrund']);
    order = await mcp.call('ae_layer_reorder', { layerId: '1', index: 2 });
    assert.deepEqual((order.order as LayerOut[]).map((l) => l.name), ['Clip', 'Titel', 'Hintergrund']);

    const tr = await mcp.call('ae_layer_set_transform', { layerId: mediaId, position: [1000, 540], scale: 50, opacity: 80, blend: 'screen', solo: true });
    const trLayer = tr.layer as LayerOut;
    assert.deepEqual(trLayer.transform.position, [1000, 540]);
    assert.equal(trLayer.transform.scale, 50);
    assert.ok(Math.abs((trLayer.transform.opacity as number) - 80) < 1e-9);
    assert.equal(trLayer.blend, 'screen');
    assert.equal(trLayer.solo, true);

    await mcp.call('ae_layer_set_keyframe', { layerId: mediaId, prop: 'rotation', time: 0, value: 0 });
    const kf = await mcp.call('ae_layer_set_keyframe', { layerId: mediaId, prop: 'rotation', time: 2, value: 90, easing: 'easy' });
    assert.deepEqual(kf.keyframes, [0, 2]);
    const kfs = (kf.layer as LayerOut).keyframes.rotation;
    assert.equal(kfs[0].easing, 'ease-out');
    assert.equal(kfs[1].easing, 'ease-in');
    const mid = await mcp.call('ae_layers_list', { time: 1 });
    const rot = ((mid.layers as LayerOut[]).find((l) => l.layerId === mediaId)!.transform.rotation as number);
    assert.ok(Math.abs(rot - 67.5) < 1e-9); // eased arrival: ease-out curve at the half

    const trim = await mcp.call('ae_layer_trim', { layerId: mediaId, inPoint: 1, outPoint: 20 });
    assert.equal((trim.layer as LayerOut).inPoint, 1);
    assert.equal((trim.layer as LayerOut).outPoint, 8);

    const split = await mcp.call('ae_layer_split', { layerId: mediaId, time: 4 });
    assert.equal(split.ok, true);
    assert.equal((split.layer as LayerOut).inPoint, 4);
    const bad = await mcp.call('ae_layer_split', { layerId: mediaId, time: 7 });
    assert.equal(bad.ok, false);

    const dup = await mcp.call('ae_layer_duplicate', { layerId: solidId });
    assert.equal((dup.layer as LayerOut).name, 'Hintergrund 2');

    const fx = await mcp.call('ae_layer_add_effect', { layerId: solidId, effectId: 'buckswood-post-plugins.film-emulation' });
    assert.equal(fx.ok, true);
    assert.equal((fx.layer as LayerOut).effects.length, 1);
    const mask = await mcp.call('ae_layer_add_effect', { layerId: solidId, kind: 'mask_ellipse', w: 0.3, h: 0.3 });
    assert.equal((mask.layer as LayerOut).masks.length, 1);
    const unknown = await mcp.call('ae_layer_add_effect', { layerId: solidId, effectId: 'nope' });
    assert.equal(unknown.ok, false);

    const del = await mcp.call('ae_layer_delete', { layerIds: [String((dup.layer as LayerOut).layerId)] });
    assert.equal(del.remaining, 4);

    const list = await mcp.call('ae_layers_list');
    assert.equal((list.layers as LayerOut[]).length, 4);
    assert.equal((list.compositions as unknown[]).length, 1);
    const missing = await mcp.call('ae_layer_set_transform', { layerId: 'nope', scale: 10 });
    assert.equal(missing.ok, false);
  } finally {
    mcp.dispose();
  }
});

test('view state and commands go through live commands', async () => {
  const { ctx } = createTestContext();
  const seen: Record<string, unknown>[] = [];
  const disposeGet = registerLiveCommand('ae.state.get', () => ({ tool: 'selection', time: 0 }));
  const disposeRun = registerLiveCommand('ae.command.run', (args) => {
    seen.push(args);
    return { tool: 'mask' };
  });
  const mcp = await createMcpHarness(ctx);
  try {
    const state = await mcp.call('ae_view_state');
    assert.equal((state.state as { tool: string }).tool, 'selection');
    const run = await mcp.call('ae_run_command', { command: 'tool.mask' });
    assert.equal((run.state as { tool: string }).tool, 'mask');
    assert.equal(seen[0].command, 'tool.mask');
  } finally {
    mcp.dispose();
    disposeGet();
    disposeRun();
  }
});
