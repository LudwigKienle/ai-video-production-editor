import test from 'node:test';
import assert from 'node:assert/strict';

import { editServices, AI_EFFECT_TOOLS } from './editPanelsTools.ts';
import { createMcpHarness, createTestContext } from '../mcpHarness.ts';
import { registerLiveCommands } from '../liveCommands.ts';

test('edit panel tools: page actions, paid confirm, service tools, AI effect map', async () => {
  const calls: string[] = [];
  editServices.override({
    generateMusicPromptForTimeline: async () => ({ prompt: 'tense strings', duration: 20, mood: 'tense' }),
    generateMusicWithLyria2: async (prompt, opts) => { calls.push(`lyria:${prompt}:${opts?.duration}`); return { id: 'mu1', name: 'music.wav', type: 'audio', url: 'blob:m', source: 'generated' }; },
    editImageWithQwen: async (prompt) => { calls.push(`qwen:${prompt}`); return { id: 'e1', name: 'edit.png', type: 'image', url: 'blob:e', source: 'generated' }; },
  });
  const { ctx, state } = createTestContext({
    timelineClips: [{ id: 'c1', mediaId: 'img', trackId: 'v1', start: 0, end: 3, duration: 3, speed: 1, effect: null } as never],
    selectedClipId: 'c1',
    mediaItems: [{ id: 'img', name: 'still.png', type: 'image', url: 'data:image/png;base64,AA==', source: 'upload' }],
  });
  const actions: Array<{ action: string; args: unknown }> = [];
  const dispose = registerLiveCommands({
    'edit_legacy.get': () => ({ settings: {}, info: {} }),
    'edit_legacy.set': () => ({ settings: {} }),
    'edit_legacy.action': (input) => { actions.push({ action: String(input.action), args: input.args }); return { result: {}, info: {} }; },
  });
  const mcp = await createMcpHarness(ctx);
  try {
    const byName = new Map(mcp.list().map((tool) => [tool.name, tool]));
    for (const name of ['edit_apply_css_effect', 'edit_apply_effect_stack', 'edit_apply_native_effect', 'edit_apply_transition', 'edit_title_add', 'edit_title_apply_preset', 'edit_title_treatment', 'edit_title_motion', 'edit_title_auto_contrast', 'edit_subtitles_generate', 'edit_subtitle_set_text', 'edit_subtitle_split', 'edit_subtitle_merge', 'edit_layout_apply', 'edit_layout_save', 'edit_layout_delete', 'edit_gap_match', 'edit_agent_plan', 'edit_agent_preview', 'edit_agent_apply', 'edit_agent_undo', 'edit_agent_review', 'edit_ai_effects', 'edit_ai_edit_clip_image', 'edit_ai_upscale_clip_image', 'edit_ai_tts', 'edit_music_brief', 'edit_music_generate', 'edit_music_voice']) {
      assert.ok(byName.has(name), `${name} missing`);
    }
    for (const paid of ['edit_subtitles_generate', 'edit_agent_plan', 'edit_agent_review', 'edit_ai_edit_clip_image', 'edit_music_generate', 'edit_music_brief']) {
      assert.match(byName.get(paid)!.description, /KOSTET CREDITS/, paid);
      assert.ok((byName.get(paid)!.inputSchema as { properties: Record<string, unknown> }).properties.confirm, `${paid} confirm`);
    }
    assert.match(byName.get('edit_subtitle_merge')!.description, /LÖSCHT/);

    await mcp.call('edit_apply_transition', { type: 'Cross Fade' });
    assert.equal((await mcp.call('edit_agent_plan', { objective: 'tighter' })).ok, false);
    await mcp.call('edit_agent_plan', { objective: 'tighter', confirm: true });
    assert.deepEqual(actions.map((entry) => entry.action), ['apply_transition', 'agent_plan']);

    assert.equal((await mcp.call('edit_music_generate', { prompt: 'drums' })).ok, false);
    await mcp.call('edit_music_generate', { prompt: 'drums', duration: 500, confirm: true });
    await mcp.call('edit_ai_edit_clip_image', { model: 'qwen', prompt: 'night sky', confirm: true });
    assert.deepEqual(calls, ['lyria:drums:120', 'qwen:night sky']);
    assert.deepEqual(state.mediaItems.map((item) => item.id), ['img', 'mu1', 'e1']);

    const map = await mcp.call('edit_ai_effects');
    assert.equal((map.effects as unknown[]).length, Object.keys(AI_EFFECT_TOOLS).length);
    for (const target of Object.values(AI_EFFECT_TOOLS)) assert.ok(target.tool.match(/^(image_gen|video_gen|avatar|edit)_/));
  } finally {
    dispose();
    editServices.override(null);
    mcp.dispose();
  }
});

test('autocut tools: analyze needs confirm, local silence is free, filler needs confirm', async () => {
  const { ctx } = createTestContext({ activeWorkspace: 'EDIT' });
  const actions: string[] = [];
  const dispose = registerLiveCommands({
    'edit_autocut.get': () => ({ settings: {}, info: {} }),
    'edit_autocut.set': () => ({ settings: {} }),
    'edit_autocut.action': (input) => { actions.push(`${input.action}:${(input.args as { mode?: string; scope?: string }).mode ?? (input.args as { scope?: string }).scope ?? ''}`); return { result: {}, info: {} }; },
  });
  const mcp = await createMcpHarness(ctx);
  try {
    assert.equal((await mcp.call('edit_autocut_analyze', { scope: 'pool' })).ok, false);
    await mcp.call('edit_autocut_analyze', { scope: 'pool', confirm: true });
    await mcp.call('edit_autocut_local_detect', { mode: 'silence' });
    assert.equal((await mcp.call('edit_autocut_local_detect', { mode: 'filler' })).ok, false);
    await mcp.call('edit_autocut_local_detect', { mode: 'filler', confirm: true });
    assert.deepEqual(actions, ['analyze:pool', 'local_detect:silence', 'local_detect:filler']);
  } finally {
    dispose();
    mcp.dispose();
  }
});
