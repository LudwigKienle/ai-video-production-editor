import test from 'node:test';
import assert from 'node:assert/strict';

import './photoAiTools.ts';
import { createMcpHarness, createTestContext } from '../mcpHarness.ts';
import { registerLiveCommands } from '../liveCommands.ts';

test('photo_ai tools: markers, confirm rules, page actions', async () => {
  const { ctx } = createTestContext({ activeWorkspace: 'PHOTO' });
  const calls: Array<{ action: string; args: unknown }> = [];
  const dispose = registerLiveCommands({
    'photo_ai.get': () => ({ settings: {}, info: {} }),
    'photo_ai.set': () => ({ settings: {} }),
    'photo_ai.action': (input) => { calls.push({ action: String(input.action), args: input.args }); return { result: { ok: 1 }, info: {} }; },
  });
  const mcp = await createMcpHarness(ctx);
  try {
    const byName = new Map(mcp.list().map((tool) => [tool.name, tool]));
    for (const name of ['photo_ai_get_state', 'photo_ai_set', 'photo_ai_inpaint', 'photo_ai_expand_canvas', 'photo_ai_expand_and_fill', 'photo_ai_set_neural_reference', 'photo_ai_neural_look', 'photo_ai_resize_image', 'photo_ai_export_png']) {
      assert.ok(byName.has(name), `${name} missing`);
    }
    for (const paid of ['photo_ai_inpaint', 'photo_ai_expand_and_fill', 'photo_ai_neural_look']) {
      assert.match(byName.get(paid)!.description, /KOSTET CREDITS/);
      assert.ok((byName.get(paid)!.inputSchema as { properties: Record<string, unknown> }).properties.confirm, `${paid} confirm`);
    }

    const refused = await mcp.call('photo_ai_inpaint', { prompt: 'sky', model: 'flux-2-pro', resolution: '2 MP' });
    assert.equal(refused.ok, false);
    assert.equal(calls.length, 0, 'nothing ran without confirm');
    await mcp.call('photo_ai_inpaint', { prompt: 'sky', model: 'flux-2-pro', resolution: '2 MP', confirm: true });
    assert.deepEqual(calls[0], { action: 'inpaint', args: { prompt: 'sky', model: 'flux-2-pro', resolution: '2 MP' } });

    // Local looks are free, Gemini looks need confirm.
    assert.equal((await mcp.call('photo_ai_neural_look', { preset: 'dehaze' })).ok, true);
    assert.equal((await mcp.call('photo_ai_neural_look', { preset: 'cinematic_pop' })).ok, false);
    assert.equal((await mcp.call('photo_ai_neural_look', { preset: 'cinematic_pop', confirm: true })).ok, true);
    await mcp.call('photo_ai_expand_canvas', { padding: 200 });
    assert.deepEqual(calls.map((call) => call.action), ['inpaint', 'neural_look', 'neural_look', 'expand_canvas']);
  } finally {
    dispose();
    mcp.dispose();
  }
});
