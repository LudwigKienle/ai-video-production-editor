import test from 'node:test';
import assert from 'node:assert/strict';

import './colorTools.ts';
import { createMcpHarness, createTestContext } from '../mcpHarness.ts';
import { registerLiveCommands } from '../liveCommands.ts';
import { computeScopeData, scopeStats } from '../../workspaces/color-pro/scopes.ts';
import type { TimelineClip } from '../../types.ts';

const clip = (id: string): TimelineClip => ({ id, mediaId: `m-${id}`, trackId: 'v1', start: 0, end: 5, duration: 5, speed: 1, effect: null });
const media = (id: string) => ({ id: `m-${id}`, name: `${id}.mp4`, type: 'video' as const, url: 'blob:x', source: 'upload' as const });

const COLOR_TOOLS = [
  'color_nodes_list', 'color_node_add', 'color_node_remove', 'color_node_reorder', 'color_node_enable',
  'color_primaries_set', 'color_curves_set', 'color_qualifier_set', 'color_window_set', 'color_node_params_set',
  'color_copy_grade', 'color_grade_reset', 'color_stills_list', 'color_still_grab', 'color_still_apply', 'color_still_remove',
  'color_scopes_read', 'color_viewer_set',
];

test('color tools are published with schemas and write markers', async () => {
  const { ctx } = createTestContext();
  const mcp = await createMcpHarness(ctx);
  try {
    const listed = mcp.list();
    for (const name of COLOR_TOOLS) assert.ok(listed.some((tool) => tool.name === name), `${name} missing`);
    assert.match(listed.find((tool) => tool.name === 'color_primaries_set')!.description, /changes the project/);
    assert.doesNotMatch(listed.find((tool) => tool.name === 'color_nodes_list')!.description, /changes the project/);
  } finally {
    mcp.dispose();
  }
});

test('nodes: primaries create node 01, add/reorder/enable/remove', async () => {
  const { ctx, state } = createTestContext({ timelineClips: [clip('c1')], mediaItems: [media('c1')], selectedClipId: 'c1' });
  const mcp = await createMcpHarness(ctx);
  try {
    const prim = await mcp.call('color_primaries_set', { lift: { y: 0.05, b: 0.02 }, gain: { r: 1.1 }, saturation: 1.2, temperature: 10 });
    assert.equal(prim.ok, true);
    const node = state.timelineClips[0].fxStack![0];
    assert.equal(node.effectId, 'avpe.primary-grade');
    assert.equal(node.params.liftY, 0.05);
    assert.equal(node.params.gainR, 1.1);
    assert.equal(node.params.saturation, 1.2);

    const added = await mcp.call('color_node_add', { label: 'Haut', params: { hue: 5 } });
    assert.equal(added.index, 1);
    const fx = await mcp.call('color_node_add', { effectId: 'buckswood-post-plugins.optics-lab', afterIndex: -1 });
    assert.equal(fx.index, 0);
    let list = await mcp.call('color_nodes_list');
    const nodes = list.nodes as Array<{ kind: string; label: string; changedParams?: Record<string, unknown> }>;
    assert.deepEqual(nodes.map((n) => n.kind), ['effect', 'color', 'color']);
    assert.equal(nodes[2].label, '03 Haut');
    assert.equal(nodes[1].changedParams?.temperature, 10);

    await mcp.call('color_node_reorder', { nodeIndex: 0, to: 2 });
    assert.equal(state.timelineClips[0].fxStack![2].effectId, 'buckswood-post-plugins.optics-lab');
    await mcp.call('color_node_enable', { nodeIndex: 2 });
    assert.equal(state.timelineClips[0].fxStack![2].enabled, false);
    await mcp.call('color_node_enable', { nodeIndex: 0, enabled: true, mix: 0.5 });
    assert.equal(state.timelineClips[0].fxStack![0].mix, 0.5);
    await mcp.call('color_node_remove', { nodeIndex: 2 });
    list = await mcp.call('color_nodes_list');
    assert.equal((list.nodes as unknown[]).length, 2);
    const bad = await mcp.call('color_node_remove', {});
    assert.equal(bad.ok, false);
  } finally {
    mcp.dispose();
  }
});

test('curves, qualifier, window and generic params', async () => {
  const { ctx, state } = createTestContext({ timelineClips: [clip('c1')], mediaItems: [media('c1')], selectedClipId: 'c1' });
  const mcp = await createMcpHarness(ctx);
  try {
    await mcp.call('color_curves_set', { curve: 'y', points: [[0, 0], [0.25, 0.2], [0.75, 0.8], [1, 1]] });
    await mcp.call('color_curves_set', { curve: 'hue_sat', points: [[0.33, 0.8]] });
    await mcp.call('color_qualifier_set', { pickRgb: [0.2, 0.7, 0.2], invert: true });
    await mcp.call('color_window_set', { type: 'circle', x: 0.4, y: 0.5, width: 0.2, softness: 0.3 });
    await mcp.call('color_node_params_set', { params: { blurRadius: 4, sizeZoom: 1.2 } });
    const p = state.timelineClips[0].fxStack![0].params;
    assert.equal(p.curveY, '0:0,0.25:0.2,0.75:0.8,1:1');
    assert.equal(p.hueSat, '0.33:0.8');
    assert.equal(p.qualEnabled, true);
    assert.ok(Math.abs(Number(p.qualHue) - 120) < 0.5);
    assert.equal(p.qualInvert, true);
    assert.equal(p.winType, 1);
    assert.equal(p.winSizeX, 0.2);
    assert.equal(p.blurRadius, 4);
    assert.equal(state.timelineClips[0].fxStack!.length, 1, 'all edits on node 01');
    await mcp.call('color_curves_set', { curve: 'y', points: [] });
    assert.equal(state.timelineClips[0].fxStack![0].params.curveY, '');
    const unknown = await mcp.call('color_node_params_set', { params: { nope: 1 } });
    assert.equal(unknown.ok, false);
    const wrongType = await mcp.call('color_window_set', { type: 'star' });
    assert.equal(wrongType.ok, false);
  } finally {
    mcp.dispose();
  }
});

test('copy grade, stills grab/apply/remove, grade reset', async () => {
  const { ctx, state } = createTestContext({ timelineClips: [clip('c1'), clip('c2'), clip('c3')], mediaItems: [media('c1'), media('c2'), media('c3')], selectedClipId: 'c1' });
  const mcp = await createMcpHarness(ctx);
  try {
    await mcp.call('color_primaries_set', { gain: { y: 1.3 } });
    const copy = await mcp.call('color_copy_grade', { toClipIds: ['c2'] });
    assert.deepEqual(copy.applied, ['c2']);
    assert.equal(state.timelineClips[1].fxStack![0].params.gainY, 1.3);
    assert.notEqual(state.timelineClips[1].fxStack![0].id, state.timelineClips[0].fxStack![0].id);

    const unmount = registerLiveCommands({ 'color.viewer.thumbnail': () => 'data:image/jpeg;base64,AAA' });
    const grab = await mcp.call('color_still_grab', { name: 'Abend' });
    unmount();
    assert.equal(grab.thumbnail, true);
    const stills = await mcp.call('color_stills_list');
    const entry = (stills.stills as Array<{ id: string; name: string }>).find((s) => s.id === grab.stillId);
    assert.equal(entry?.name, 'Abend');
    await mcp.call('color_still_apply', { stillId: grab.stillId, all: true });
    assert.equal(state.timelineClips[2].fxStack![0].params.gainY, 1.3);

    await mcp.call('color_grade_reset', { clipId: 'c3' });
    assert.equal(state.timelineClips[2].fxStack!.length, 0);
    const all = await mcp.call('color_copy_grade', { fromClipId: 'c1', all: true });
    assert.deepEqual(all.applied, ['c2', 'c3']);
    await mcp.call('color_still_remove', { stillId: grab.stillId });
    const after = await mcp.call('color_stills_list');
    assert.ok(!(after.stills as Array<{ id: string }>).some((s) => s.id === grab.stillId));
  } finally {
    mcp.dispose();
  }
});

test('scopes and viewer state via live commands of the Color page', async () => {
  const { ctx, state } = createTestContext({ timelineClips: [clip('c1')], mediaItems: [media('c1')], selectedClipId: 'c1' });
  const mcp = await createMcpHarness(ctx);
  const px = new Uint8ClampedArray(4 * 4);
  px.set([255, 0, 0, 255, 0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255]);
  let viewer = { bypass: false, wipe: false };
  const unmount = registerLiveCommands({
    'color.scopes.read': () => ({ clipId: 'c1', stats: scopeStats(computeScopeData(px, 4, 1)) }),
    'color.viewer.set': (args) => { viewer = { ...viewer, ...(args as typeof viewer) }; return viewer; },
  });
  try {
    const scopes = await mcp.call('color_scopes_read');
    const stats = scopes.stats as { r: { max: number; mean: number }; luma: { min: number; clippedLow: number } };
    assert.equal(stats.r.max, 1);
    assert.equal(stats.luma.min, 0);
    assert.equal(stats.luma.clippedLow, 0.25);
    const v = await mcp.call('color_viewer_set', { bypass: true, wipe: true });
    assert.equal(v.bypass, true);
    assert.equal(v.wipe, true);
    assert.equal(state.activeWorkspace, 'EDIT', 'page already open → no navigation');
  } finally {
    unmount();
    mcp.dispose();
  }
});
