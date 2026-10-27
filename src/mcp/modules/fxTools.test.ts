import test from 'node:test';
import assert from 'node:assert/strict';

import './fxTools.ts';
import { createMcpHarness, createTestContext } from '../mcpHarness.ts';
import type { TimelineClip } from '../../types.ts';

const clip = (id: string): TimelineClip => ({ id, mediaId: 'm1', trackId: 'v1', start: 0, end: 5, duration: 5, speed: 1, effect: null });

test('fx tools are published over the MCP bridge with JSON schemas', async () => {
  const { ctx } = createTestContext();
  const mcp = await createMcpHarness(ctx);
  try {
    const names = mcp.list().map((tool) => tool.name);
    for (const name of ['fx_list_effects', 'fx_get_clip_stack', 'fx_add_effect', 'fx_update_effect', 'fx_remove_effect', 'fx_move_effect', 'ofx_scan_plugins', 'burst_frame_build_prompt']) {
      assert.ok(names.includes(name), `${name} missing`);
    }
    const add = mcp.list().find((tool) => tool.name === 'fx_add_effect')!;
    assert.equal((add.inputSchema as { type: string }).type, 'object');
    assert.match(add.description, /changes the project/);
  } finally {
    mcp.dispose();
  }
});

test('add, update, move and remove effects through MCP calls', async () => {
  const { ctx, state } = createTestContext({ timelineClips: [clip('c1')], selectedClipId: 'c1' });
  const mcp = await createMcpHarness(ctx);
  try {
    const list = await mcp.call('fx_list_effects');
    assert.ok((list.effects as Array<{ id: string }>).some((effect) => effect.id === 'buckswood-post-plugins.optics-lab'));
    const detail = await mcp.call('fx_list_effects', { effectId: 'buckswood-post-plugins.optics-lab' });
    assert.ok(((detail.effect as { params: unknown[] }).params).length > 40);

    const added = await mcp.call('fx_add_effect', { effectId: 'buckswood-post-plugins.optics-lab', preset: 'ai-natural', params: { grain: 0.5 } });
    assert.equal(added.ok, true);
    const second = await mcp.call('fx_add_effect', { effectId: 'buckswood-post-plugins.film-emulation' });
    assert.equal(state.timelineClips[0].fxStack?.length, 2);
    assert.equal(state.timelineClips[0].fxStack?.[0].params.grain, 0.5);
    assert.equal(state.timelineClips[0].fxStack?.[0].params.preset, 20);

    await mcp.call('fx_update_effect', { instanceId: added.instanceId, params: { effectStrength: 0.4 }, mix: 0.5, enabled: false });
    const updated = state.timelineClips[0].fxStack![0];
    assert.equal(updated.params.effectStrength, 0.4);
    assert.equal(updated.mix, 0.5);
    assert.equal(updated.enabled, false);

    const moved = await mcp.call('fx_move_effect', { instanceId: second.instanceId, index: 0 });
    assert.deepEqual(moved.order, [second.instanceId, added.instanceId]);

    const stack = await mcp.call('fx_get_clip_stack', { clipId: 'c1' });
    assert.equal((stack.stack as unknown[]).length, 2);

    await mcp.call('fx_remove_effect', { instanceId: added.instanceId });
    assert.equal(state.timelineClips[0].fxStack?.length, 1);

    const bad = await mcp.call('fx_add_effect', { effectId: 'nope' });
    assert.equal(bad.ok, false);
    assert.match(String(bad.message), /Unknown effect/);
  } finally {
    mcp.dispose();
  }
});

test('burst frame prompt via MCP', async () => {
  const { ctx } = createTestContext();
  const mcp = await createMcpHarness(ctx);
  try {
    const result = await mcp.call('burst_frame_build_prompt', { continuity: 'a red vintage camera on a wooden desk', style: 'Soft daylight from the left.', subjectKind: 'object' });
    assert.equal((result.check as { ok: boolean }).ok, true);
    assert.match(String(result.prompt), /\[20\]/);
  } finally {
    mcp.dispose();
  }
});
