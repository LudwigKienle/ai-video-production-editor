import test from 'node:test';
import assert from 'node:assert/strict';

import './compositingAiTools.ts';
import { createMcpHarness, createTestContext } from '../mcpHarness.ts';
import { registerLiveCommands } from '../liveCommands.ts';

test('compositing tools: publish, paid confirm, media result, sub-tool opening', async () => {
  const { ctx, state } = createTestContext({ activeWorkspace: 'COMPOSITING' });
  const actions: string[] = [];
  const dispose = registerLiveCommands({
    'compositing_ai.get': () => ({ settings: {}, info: {} }),
    'compositing_ai.set': () => ({ settings: {} }),
    'compositing_ai.action': (input) => {
      actions.push(String(input.action));
      if (input.action === 'reframe') state.mediaItems = [...state.mediaItems, { id: 'r1', name: 'reframe.mp4', type: 'video', url: 'blob:r', source: 'generated' }];
      if (input.action === 'open_tool') {
        // Opening the relight tool mounts the relight panel, which registers its commands.
        registerLiveCommands({ 'compositing_relight.action': (i) => { actions.push(`relight:${i.action}`); return { result: {}, info: {} }; } });
      }
      return { result: {}, info: { status: { reframe: 'ok' } } };
    },
  });
  const mcp = await createMcpHarness(ctx);
  try {
    const byName = new Map(mcp.list().map((tool) => [tool.name, tool]));
    for (const name of ['compositing_ai_open_tool', 'compositing_ai_set_input', 'compositing_ai_composite', 'compositing_ai_corridorkey_prepare', 'compositing_ai_corridorkey_run', 'compositing_ai_openpose', 'compositing_ai_animate_replace', 'compositing_ai_reframe', 'compositing_ai_kling_bridge', 'compositing_ai_add_result_to_timeline', 'compositing_relight_export', 'compositing_relight_generate_depth_guide', 'compositing_nodes_add_effect', 'compositing_nodes_render_still']) {
      assert.ok(byName.has(name), `${name} missing`);
    }
    for (const paid of ['compositing_ai_openpose', 'compositing_ai_animate_replace', 'compositing_ai_reframe', 'compositing_ai_kling_bridge']) assert.match(byName.get(paid)!.description, /KOSTET CREDITS/);
    assert.doesNotMatch(byName.get('compositing_ai_corridorkey_run')!.description, /KOSTET/);

    assert.equal((await mcp.call('compositing_ai_reframe', {})).ok, false);
    const reframed = await mcp.call('compositing_ai_reframe', { confirm: true, settings: { reframeAspect: '9:16' } });
    assert.equal((reframed.mediaItems as Array<{ id: string }>)[0].id, 'r1');

    await mcp.call('compositing_relight_apply_preset', { presetId: 'rim' });
    assert.deepEqual(actions, ['reframe', 'open_tool', 'relight:apply_preset']);
  } finally {
    dispose();
    mcp.dispose();
  }
});
