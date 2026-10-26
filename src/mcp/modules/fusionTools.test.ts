import test from 'node:test';
import assert from 'node:assert/strict';

import './fusionTools.ts';
import { COMPOSITIONS_EXTRA, FUSION_LIVE } from './fusionTools.ts';
import { createMcpHarness, createTestContext } from '../mcpHarness.ts';
import { registerLiveCommands } from '../liveCommands.ts';
import type { MediaItem, TimelineClip } from '../../types.ts';
import type { CompStore } from '../../workspaces/fusion-shared/compPersist.ts';

const media: MediaItem = { id: 'm1', name: 'Plate', type: 'video', url: 'blob:plate', source: 'upload', duration: 4 };
const clip: TimelineClip = { id: 'c1', mediaId: 'm1', trackId: 'v1', start: 2, end: 5, duration: 3, speed: 1, effect: null };

const TOOLS = [
  'fusion_comp_list',
  'fusion_comp_create',
  'fusion_comp_get',
  'fusion_comp_update',
  'fusion_node_add',
  'fusion_node_remove',
  'fusion_node_connect',
  'fusion_node_set_params',
  'fusion_node_set_keyframe',
  'fusion_view_set',
  'fusion_viewer_set',
  'nuke_viewer_set',
  'fusion_render_frame',
  'fusion_render_to_media',
];

test('fusion tools are published with schemas', async () => {
  const { ctx } = createTestContext();
  const mcp = await createMcpHarness(ctx);
  try {
    const names = mcp.list().map((tool) => tool.name);
    for (const name of TOOLS) assert.ok(names.includes(name), `${name} missing`);
    assert.match(mcp.list().find((tool) => tool.name === 'fusion_node_add')!.description, /changes the project/);
  } finally {
    mcp.dispose();
  }
});

test('build a comp without the page open: create, add, connect, params, keyframes, view', async () => {
  const { ctx, state } = createTestContext({ mediaItems: [media], timelineClips: [clip] });
  const mcp = await createMcpHarness(ctx);
  try {
    const empty = await mcp.call('fusion_comp_list');
    assert.deepEqual(empty.comps, []);

    const created = await mcp.call('fusion_comp_create', { clipId: 'c1', name: 'Shot 010', fps: 25 });
    const compId = (created.comp as { id: string }).id;
    assert.equal((created.comp as { durationSeconds: number }).durationSeconds, 3);
    const store = state.extras[COMPOSITIONS_EXTRA] as CompStore;
    assert.equal(store.comps.length, 1);
    assert.equal(store.activeId, compId);

    // Text+ after MediaIn1 → Fusion auto-merge.
    const text = await mcp.call('fusion_node_add', { tool: 'TextPlus', afterNodeId: 'MediaIn1', params: { text: 'Hallo' } });
    assert.ok(text.mergeId);
    const blur = await mcp.call('fusion_node_add', { tool: 'Blur', afterNodeId: 'Merge1' });
    assert.equal((blur.node as { class: string }).class, 'blur');
    const grade = await mcp.call('fusion_node_add', { tool: 'Grade' });
    assert.equal((grade.node as { class: string }).class, 'grade');

    const got = await mcp.call('fusion_comp_get', {});
    const nodes = got.nodes as Array<{ name: string; inputs: Record<string, string | null>; params: Record<string, unknown> }>;
    const merge = nodes.find((node) => node.name === 'Merge1')!;
    const mediaIn = nodes.find((node) => node.name === 'MediaIn1') as unknown as { id: string };
    assert.equal(merge.inputs.bg, mediaIn.id);
    assert.equal(nodes.find((node) => node.name === 'Text1')!.params.text, 'Hallo');
    const output = nodes.find((node) => node.name === 'MediaOut1')!;
    assert.equal(output.inputs.input, (blur.node as { id: string }).id);

    // Nuke vocabulary: A = fg.
    const swapped = await mcp.call('fusion_node_connect', { from: 'MediaIn1', to: 'Merge1', port: 'A' });
    assert.equal(swapped.port, 'fg');
    const cycle = await mcp.call('fusion_node_connect', { from: 'MediaOut1', to: 'Merge1', port: 'bg' });
    assert.equal(cycle.ok, false);
    const bypass = await mcp.call('fusion_node_connect', { to: 'Blur1', bypass: true });
    assert.equal(bypass.enabled, false);

    const set = await mcp.call('fusion_node_set_params', { nodeId: 'Blur1', fxParams: { size: 20 } });
    assert.equal((set.node as { fx: Array<{ params: Record<string, number> }> }).fx[0].params.size, 20);

    await mcp.call('fusion_node_set_keyframe', { nodeId: 'Text1', param: 'opacity', time: 0, value: 0, easing: 'ease-out' });
    const key = await mcp.call('fusion_node_set_keyframe', { nodeId: 'Text1', param: 'opacity', time: 1, value: 1, easing: 'ease-out' });
    assert.equal((key.keyframes as unknown[]).length, 2);
    const at = await mcp.call('fusion_comp_get', { time: 0.5 });
    const opacity = (at.nodes as Array<{ name: string; params: Record<string, number> }>).find((node) => node.name === 'Text1')!.params.opacity;
    assert.ok(opacity > 0.5 && opacity < 1);
    // Editing an animated param keys it.
    await mcp.call('fusion_node_set_params', { nodeId: 'Text1', params: { opacity: 0.3 }, time: 2 });
    assert.equal(((await mcp.call('fusion_node_set_keyframe', { nodeId: 'Text1', param: 'opacity', time: 2, remove: true })).keyframes as unknown[]).length, 2);

    const range = await mcp.call('fusion_comp_update', { renderStart: 0.5, renderEnd: 2, arrange: 'nuke' });
    assert.deepEqual((range.comp as { renderRange: unknown }).renderRange, { start: 0.5, end: 2 });

    const removed = await mcp.call('fusion_node_remove', { nodeIds: ['Grade1', 'MediaOut1'] });
    assert.equal((removed.removed as string[]).length, 1);

    const view = await mcp.call('fusion_view_set', { view: 'nuke' });
    assert.equal(view.view, 'nuke');
    assert.equal(state.activeWorkspace, 'COMPOSITING');
    assert.equal((await mcp.call('fusion_comp_list')).view, 'nuke');

    const unknown = await mcp.call('fusion_node_add', { tool: 'Warp' });
    assert.equal(unknown.ok, false);
  } finally {
    mcp.dispose();
  }
});

test('with the page mounted the live store is used; render and viewer tools call the page', async () => {
  const { ctx } = createTestContext({ mediaItems: [media] });
  let live: unknown = { version: 1, comps: [], activeId: null, view: 'fusion' };
  const calls: string[] = [];
  const dispose = registerLiveCommands({
    [FUSION_LIVE.storeGet]: () => live,
    [FUSION_LIVE.storeSet]: (args) => { live = args.store; calls.push('set'); return { ok: true }; },
    [FUSION_LIVE.renderFrame]: (args) => { calls.push(`frame:${args.time}`); return { mediaId: 'png1', type: 'image' }; },
    [FUSION_LIVE.renderMedia]: () => { calls.push('media'); return { mediaId: 'mov1', type: 'video' }; },
    [FUSION_LIVE.viewerSet]: (args) => { calls.push(`viewer:${args.viewer}`); return { ok: true }; },
    [FUSION_LIVE.nukeViewerSet]: (args) => { calls.push(`nuke:${args.channel}`); return { ok: true }; },
  });
  const mcp = await createMcpHarness(ctx);
  try {
    await mcp.call('fusion_comp_create', { mediaId: 'm1' });
    assert.equal((live as CompStore).comps.length, 1);
    assert.equal((await mcp.call('fusion_render_frame', { time: 1 })).mediaId, 'png1');
    assert.equal((await mcp.call('fusion_render_to_media', {})).mediaId, 'mov1');
    await mcp.call('fusion_viewer_set', { nodeId: 'MediaIn1', viewer: 2 });
    await mcp.call('nuke_viewer_set', { channel: 'a' });
    assert.deepEqual(calls, ['set', 'frame:1', 'media', 'viewer:2', 'set', 'nuke:a']);
  } finally {
    mcp.dispose();
    dispose();
  }
});
