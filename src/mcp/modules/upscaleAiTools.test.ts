import test from 'node:test';
import assert from 'node:assert/strict';

import './upscaleAiTools.ts';
import { createMcpHarness, createTestContext } from '../mcpHarness.ts';
import { registerLiveCommands } from '../liveCommands.ts';
import { kindFromUrl } from '../../workspaces/upscale-pro/inputKind.ts';

test('upscale_ai tools publish, mark deletes and pass arguments to the page', async () => {
  const { ctx } = createTestContext({ activeWorkspace: 'UPSCALE' });
  const calls: Array<{ action: string; args: unknown }> = [];
  const dispose = registerLiveCommands({
    'upscale_ai.get': () => ({ settings: {}, info: { rubyFormats: [] } }),
    'upscale_ai.set': () => ({ settings: {} }),
    'upscale_ai.action': (input) => { calls.push({ action: String(input.action), args: input.args }); return { result: {}, info: {} }; },
  });
  const mcp = await createMcpHarness(ctx);
  try {
    const byName = new Map(mcp.list().map((tool) => [tool.name, tool]));
    for (const name of ['upscale_ai_get_state', 'upscale_ai_set_color_science', 'upscale_ai_set_output_folder', 'upscale_ai_add_input_url', 'upscale_ai_add_library_asset', 'upscale_ai_remove_input', 'upscale_ai_set_input_fps', 'upscale_ai_job_show', 'upscale_ai_job_add_to_bin', 'upscale_ai_job_open_folder', 'upscale_ai_job_remove', 'upscale_ai_clear_finished_jobs']) {
      assert.ok(byName.has(name), `${name} missing`);
    }
    for (const name of ['upscale_ai_remove_input', 'upscale_ai_job_remove', 'upscale_ai_clear_finished_jobs']) assert.match(byName.get(name)!.description, /LÖSCHT/);
    assert.doesNotMatch(byName.get('upscale_ai_set_color_science')!.description, /KOSTET/);
    await mcp.call('upscale_ai_set_color_science', { enabled: true, engine: 'runway-ruby', rubyFormat: 'hdr_exr_acescg_sequence_1_3', keepEnhance: false });
    assert.deepEqual(calls[0], { action: 'set_color_science', args: { enabled: true, engine: 'runway-ruby', rubyFormat: 'hdr_exr_acescg_sequence_1_3', keepEnhance: false } });
  } finally {
    dispose();
    mcp.dispose();
  }
});

test('kindFromUrl recognises images and videos', () => {
  assert.equal(kindFromUrl('file:///x/clip.MOV'), 'video');
  assert.equal(kindFromUrl('https://x/a.jpg?w=1'), 'image');
  assert.equal(kindFromUrl('data:video/mp4;base64,AA'), 'video');
  assert.equal(kindFromUrl('https://x/unknown'), null);
});
