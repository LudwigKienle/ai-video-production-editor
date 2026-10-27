import test from 'node:test';
import assert from 'node:assert/strict';

import './fxTools.ts';
import './effectControlsTools.ts';
import { createMcpHarness, createTestContext } from '../mcpHarness.ts';
import { registerLiveCommand } from '../liveCommands.ts';
import { resolveParamsAtTime, resolveMixAtTime } from '../../fx/registry.ts';
import type { TimelineClip } from '../../types.ts';

const clip = (id: string): TimelineClip => ({ id, mediaId: 'm1', trackId: 'v1', start: 10, end: 14, duration: 4, speed: 1, effect: null });

const TOOLS = ['effect_controls_get', 'effect_controls_transform_set', 'keyframe_list', 'keyframe_set', 'keyframe_remove', 'keyframe_set_interpolation', 'keyframe_move', 'effect_controls_ui'];

test('effect controls tools are published', async () => {
  const { ctx } = createTestContext();
  const mcp = await createMcpHarness(ctx);
  try {
    const names = mcp.list().map((tool) => tool.name);
    TOOLS.forEach((name) => assert.ok(names.includes(name), `${name} missing`));
    assert.match(mcp.list().find((tool) => tool.name === 'keyframe_set')!.description, /changes the project/);
  } finally {
    mcp.dispose();
  }
});

test('transform, rotation and clip-property keyframes over MCP', async () => {
  const { ctx, state } = createTestContext({ timelineClips: [clip('c1')], selectedClipId: 'c1', playheadPosition: 10 });
  const mcp = await createMcpHarness(ctx);
  try {
    const set = await mcp.call('effect_controls_transform_set', { x: 40, rotation: 15, opacity: 0.8, blendMode: 'screen' });
    assert.equal(set.ok, true);
    assert.equal(state.timelineClips[0].transform?.rotation, 15);
    assert.equal(state.timelineClips[0].blendMode, 'screen');

    await mcp.call('keyframe_set', { property: 'rotation', time: 0 });
    await mcp.call('keyframe_set', { property: 'rotation', timelineTime: 12, value: 90, easing: 'ease-out' });
    const list = await mcp.call('keyframe_list', { property: 'rotation' });
    const track = (list.tracks as Array<{ keyframes: Array<{ id: string; time: number; value: number; easing: string; timelineTime: number }> }>)[0];
    assert.deepEqual(track.keyframes.map((k) => [k.time, k.value, k.easing, k.timelineTime]), [[0, 15, 'linear', 10], [2, 90, 'ease-out', 12]]);

    // Animated property: transform_set writes a keyframe at the playhead.
    state.playheadPosition = 11;
    const keyed = await mcp.call('effect_controls_transform_set', { rotation: 45 });
    assert.deepEqual(keyed.keyframed, ['rotation']);
    const afterKey = (await mcp.call('keyframe_list', { property: 'rotation' })).tracks as Array<{ keyframes: Array<{ time: number; value: number }> }>;
    assert.deepEqual(afterKey[0].keyframes.map((k) => [k.time, k.value]), [[0, 15], [1, 45], [2, 90]]);

    await mcp.call('keyframe_set_interpolation', { property: 'rotation', all: true, easing: 'hold' });
    const moved = await mcp.call('keyframe_move', { property: 'rotation', keyframeId: track.keyframes[1].id, delta: 5 });
    assert.equal((moved.keyframes as Array<{ time: number }>)[0].time, 4);

    const get = await mcp.call('effect_controls_get', { animatedOnly: true });
    assert.equal(get.playheadLocalTime, 1);
    assert.equal((get.tracks as unknown[]).length, 1);
    assert.ok((get.exportWarnings as string[]).some((w) => /Drehung/.test(w)));

    const removedOne = await mcp.call('keyframe_remove', { property: 'rotation', time: 1 });
    assert.equal(removedOne.removed, 1);
    const off = await mcp.call('keyframe_remove', { property: 'rotation', all: true });
    assert.equal(off.removed, 2);
    assert.equal(state.timelineClips[0].keyframes?.filter((k) => k.property === 'rotation').length, 0);

    const outside = await mcp.call('keyframe_set', { property: 'x', time: 9 });
    assert.equal(outside.ok, false);
    assert.match(String(outside.message), /outside the clip/);
  } finally {
    mcp.dispose();
  }
});

test('FX param and mix keyframes over MCP', async () => {
  const { ctx, state } = createTestContext({ timelineClips: [clip('c1')], selectedClipId: 'c1', playheadPosition: 10 });
  const mcp = await createMcpHarness(ctx);
  try {
    const added = await mcp.call('fx_add_effect', { effectId: 'buckswood-post-plugins.optics-lab' });
    const instanceId = String(added.instanceId);
    await mcp.call('keyframe_set', { instanceId, param: 'effectStrength', time: 0, value: 0.1 });
    await mcp.call('keyframe_set', { instanceId, param: 'effectStrength', time: 4, value: 0.9 });
    await mcp.call('keyframe_set', { instanceId, param: 'mix', time: 0, value: 0, easing: 'hold' });
    await mcp.call('keyframe_set', { instanceId, param: 'mix', time: 2, value: 1 });
    const instance = state.timelineClips[0].fxStack![0];
    assert.ok(Math.abs(Number(resolveParamsAtTime(instance, 2).effectStrength) - 0.5) < 1e-9);
    assert.equal(resolveMixAtTime(instance, 1.5), 0);
    const bad = await mcp.call('keyframe_set', { instanceId, param: 'depthInvert', time: 0 });
    assert.equal(bad.ok, false);
    const get = await mcp.call('effect_controls_get', { animatedOnly: true });
    assert.equal((get.tracks as unknown[]).length, 2);
  } finally {
    mcp.dispose();
  }
});

test('effect_controls_ui talks to the mounted panel', async () => {
  const { ctx } = createTestContext();
  const mcp = await createMcpHarness(ctx);
  const dispose = registerLiveCommand('effectControls.ui', (args) => ({ laneVisible: args.laneVisible ?? true, sections: { motion: args.open ?? true } }));
  try {
    const result = await mcp.call('effect_controls_ui', { laneVisible: false, section: 'motion', open: false });
    assert.equal(result.laneVisible, false);
    assert.deepEqual(result.sections, { motion: false });
  } finally {
    dispose();
    mcp.dispose();
  }
});
