import test from 'node:test';
import assert from 'node:assert/strict';

import { avatarServices } from './avatarTools.ts';
import { createMcpHarness, createTestContext } from '../mcpHarness.ts';
import type { AvatarProfile } from '../../types.ts';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

test('avatar CRUD, voiceover and video generation (fake providers)', async () => {
  const calls: Array<{ fn: string; arg: unknown }> = [];
  avatarServices.override({
    fetchElevenLabsVoices: async () => [{ voice_id: 'v1', name: 'Anna' }],
    generateSpeechWithElevenLabs: async (text) => { calls.push({ fn: 'tts', arg: text }); return { id: 'a1', name: 'vo.mp3', type: 'audio', url: 'data:audio/mpeg;base64,AA==', duration: 2 } as never; },
    generateAvatarVideo: async (input) => { calls.push({ fn: 'video', arg: { mode: input.mode, hasAudio: Boolean(input.audio), settings: input.settings } }); return { id: 'vid1', name: 'avatar.mp4', type: 'video', url: 'blob:x', duration: 5 } as never; },
  });
  const { ctx, state } = createTestContext({ extras: { avatars: [] } });
  const mcp = await createMcpHarness(ctx);
  try {
    const names = mcp.list().map((tool) => tool.name);
    for (const name of ['avatar_list', 'avatar_create', 'avatar_rename', 'avatar_delete', 'avatar_list_voices', 'avatar_generate_voiceover', 'avatar_generate_video']) assert.ok(names.includes(name), name);
    assert.match(mcp.list().find((tool) => tool.name === 'avatar_generate_video')!.description, /KOSTET CREDITS/);
    assert.match(mcp.list().find((tool) => tool.name === 'avatar_delete')!.description, /LÖSCHT/);

    const created = await mcp.call('avatar_create', { name: 'Host', imageUrl: PNG });
    const id = (created.avatar as { id: string }).id;
    assert.equal((state.extras.avatars as AvatarProfile[])[0].imageUrl, PNG);
    await mcp.call('avatar_rename', { avatarId: id, name: 'Moderatorin' });
    assert.equal((await mcp.call('avatar_list')).avatars instanceof Array, true);
    assert.equal(((await mcp.call('avatar_list_voices')).voices as Array<{ voiceId: string }>)[0].voiceId, 'v1');

    const missing = await mcp.call('avatar_generate_video', { confirm: true,  avatarId: id, mode: 'omni-human' });
    assert.equal(missing.ok, false);
    assert.equal(calls.length, 0, 'nothing spent when inputs are missing');

    const talking = await mcp.call('avatar_generate_video', { confirm: true,  avatarId: 'Moderatorin', mode: 'omni-human', voiceText: 'Willkommen', settings: { klingDuration: 10 } });
    assert.equal((talking.mediaItem as { id: string }).id, 'vid1');
    assert.equal((talking.voiceover as { id: string }).id, 'a1');
    assert.deepEqual(calls.map((call) => call.fn), ['tts', 'video']);
    assert.deepEqual(state.mediaItems.map((item) => item.id), ['a1', 'vid1']);

    const vo = await mcp.call('avatar_generate_voiceover', { confirm: true,  text: 'Hallo' });
    assert.equal((vo.mediaItem as { type: string }).type, 'audio');

    await mcp.call('avatar_delete', { avatarId: id });
    assert.equal((state.extras.avatars as AvatarProfile[]).length, 0);
  } finally {
    avatarServices.override(null);
    mcp.dispose();
  }
});

test('paid avatar tools refuse without confirm and spend nothing', async () => {
  let called = 0;
  avatarServices.override({ generateSpeechWithElevenLabs: async () => { called += 1; return {} as never; } });
  const { ctx } = createTestContext({ extras: { avatars: [] } });
  const mcp = await createMcpHarness(ctx);
  try {
    const tool = mcp.list().find((entry) => entry.name === 'avatar_generate_voiceover')!;
    assert.ok((tool.inputSchema as { properties: Record<string, unknown> }).properties.confirm);
    const refused = await mcp.call('avatar_generate_voiceover', { text: 'Hallo' });
    assert.equal(refused.ok, false);
    assert.match(String(refused.message), /confirm: true/);
    assert.equal(called, 0);
  } finally {
    avatarServices.override(null);
    mcp.dispose();
  }
});
