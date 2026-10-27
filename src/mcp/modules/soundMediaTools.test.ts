import test from 'node:test';
import assert from 'node:assert/strict';

import './soundTools.ts';
import './soundMediaTools.ts';
import { SOUND_MEDIA_TOOLS } from './soundMediaTools.ts';
import { createMcpHarness, createTestContext } from '../mcpHarness.ts';
import { registerLiveCommand } from '../liveCommands.ts';
import { setSoundAudioServices } from '../../workspaces/sound-pro/audioServices.ts';
import { setSoundRuntime } from '../../workspaces/sound-pro/engine/runtime.ts';
import type { SoundMix } from '../../workspaces/sound-pro/model.ts';
import type { MediaItem, TimelineClip, TimelineTrack } from '../../types.ts';

/* fake providers: record every call, spend nothing */
const calls: Array<{ service: string; args: unknown[] }> = [];
let masteringReady = true;
const fakeItem = (id: string, name: string, duration = 4): MediaItem => ({ id, name, type: 'audio', url: `blob:${id}`, source: 'generated', duration });
setSoundAudioServices({
  elevenLabsSpeech: async (...args) => { calls.push({ service: 'elevenlabs', args }); return fakeItem(`v-${calls.length}`, 'voice.mp3', 3); },
  minimaxSpeech: async (...args) => { calls.push({ service: 'minimax', args }); return fakeItem(`mm-${calls.length}`, 'minimax.mp3', 3); },
  lyriaMusic: async (...args) => { calls.push({ service: 'lyria', args }); return fakeItem(`ly-${calls.length}`, 'lyria.wav', 6); },
  sonautoMusic: async (...args) => { calls.push({ service: 'sonauto', args }); return fakeItem(`so-${calls.length}`, 'song.mp3', 30); },
  sonautoAvailable: async () => true,
  demucs: async (...args) => { calls.push({ service: 'demucs', args }); return ['vocals', 'drums', 'bass', 'other'].map((n, i) => fakeItem(`st-${i}-${calls.length}`, `${n}.wav`, 8)); },
  urlToPayload: async (url) => { calls.push({ service: 'payload', args: [url] }); return { base64: 'AAAA', mimeType: 'audio/wav' }; },
  masteringStatus: async () => ({ ready: masteringReady, available: true, error: masteringReady ? null : 'Python fehlt' }),
  masteringSetup: async () => { calls.push({ service: 'setup', args: [] }); masteringReady = true; return { ready: true, available: true }; },
  masteringRun: async (request) => {
    calls.push({ service: 'master', args: [request] });
    return { ok: true, outputPath: '/p/master.wav', outputName: 'master.wav', url: 'file:///p/master.wav', beforeLufs: -20, afterLufs: request.targetLufs, beforeTruePeakDbtp: -3, afterTruePeakDbtp: -1, warnings: [] };
  },
});
setSoundRuntime({ decode: async () => null });

const LIBRARY = [
  { id: 'lib-1', name: 'Regen auf Dach.wav', kind: 'audio', url: 'file:///lib/regen.wav', duration: 12, projectName: 'Altprojekt', origin: 'recent' },
  { id: 'lib-2', name: 'Bild.png', kind: 'image', url: 'file:///lib/bild.png', projectName: 'Altprojekt', origin: 'recent' },
];
registerLiveCommand('sound.library.list', () => ({ assets: LIBRARY.filter((a) => a.kind === 'audio') }));

const tracks = (): TimelineTrack[] => [
  { id: 'a1', name: 'Dialog', type: 'audio', isLocked: false, isMuted: false },
  { id: 'a2', name: 'Musik', type: 'audio', isLocked: true, isMuted: false },
];
const setup = async () => {
  const { ctx, state } = createTestContext({
    timelineTracks: tracks(),
    mediaItems: [{ id: 'm1', name: 'take.wav', type: 'audio', url: 'blob:m1', source: 'upload', duration: 10 }],
    timelineClips: [{ id: 'c1', mediaId: 'm1', trackId: 'a1', start: 0, end: 4, duration: 4, speed: 1, sourceIn: 0, sourceOut: 4, effect: null } as TimelineClip],
    playheadPosition: 2,
    projectPath: '/projekt',
  });
  const mcp = await createMcpHarness(ctx);
  return { ctx, state, mcp, mix: () => state.extras.soundMix as SoundMix | undefined };
};
type Env = Awaited<ReturnType<typeof setup>>;

const CASES: Record<string, { args: Record<string, unknown>; check: (env: Env, r: Record<string, unknown>) => void; before?: () => void }> = {
  sound_generate_voice: {
    args: { text: 'Hallo Welt', provider: 'minimax', speed: 1.2, confirm: true },
    check: (e, r) => {
      assert.equal(calls.at(-1)?.service, 'minimax');
      const placed = (r.placed as Array<{ trackId: string; start: number }>)[0];
      assert.equal(placed.start, 2, 'at the playhead');
      assert.notEqual(placed.trackId, 'a1', 'a1 is busy at 2 s, a2 is locked → new track');
      assert.equal(e.mix()?.tracks[placed.trackId]?.role, 'dialog');
      assert.ok(e.state.mediaItems.some((m) => m.generatedBy === 'Minimax Speech 02 HD'));
    },
  },
  sound_generate_music: {
    args: { prompt: 'ruhiges Klavier', provider: 'sonauto-v3', instrumental: true, start: 10, trackId: 'a1', confirm: true },
    check: (e, r) => {
      assert.equal(calls.at(-1)?.service, 'sonauto');
      assert.deepEqual((r.placed as Array<{ trackId: string; start: number }>).map((p) => [p.trackId, p.start]), [['a1', 10]]);
      assert.equal(e.mix()?.tracks.a1?.role, 'music');
    },
  },
  sound_generate_sfx: {
    args: { prompt: 'Tür knallt', duration: 3, placeOnTimeline: false, confirm: true },
    check: (e, r) => {
      assert.deepEqual(calls.at(-1)?.args[1], { duration: 3 });
      assert.equal(e.state.timelineClips.length, 1, 'not placed');
      assert.equal((r.media as unknown[]).length, 1);
    },
  },
  sound_stems_separate: {
    args: { clipId: 'c1', confirm: true },
    check: (e, r) => {
      assert.equal(calls.at(-1)?.service, 'demucs');
      const placed = r.placed as Array<{ trackId: string; start: number }>;
      assert.equal(placed.length, 4);
      assert.equal(new Set(placed.map((p) => p.trackId)).size, 4, 'each stem on its own track');
      assert.ok(placed.every((p) => p.start === 0), 'aligned to the clip start');
    },
  },
  sound_mastering_status: { args: {}, check: (_e, r) => assert.equal((r.status as { ready: boolean }).ready, true) },
  sound_mastering_setup: { args: {}, check: () => assert.equal(calls.at(-1)?.service, 'setup') },
  sound_mastering_run: {
    args: { mode: 'spotify_auto', mediaId: 'm1', assetId: undefined, targetLufs: -16, referenceUrl: 'https://example.org/ref.wav' },
    check: (e, r) => {
      const req = calls.at(-1)?.args[0] as { mode: string; targetLufs: number; reference: unknown; projectPath: string };
      assert.deepEqual([req.mode, req.targetLufs, Boolean(req.reference), req.projectPath], ['spotify_auto', -16, true, '/projekt']);
      assert.equal(r.afterLufs, -16);
      assert.ok(e.state.mediaItems.some((m) => m.name === 'master.wav'));
      assert.equal(e.state.timelineClips.length, 1, 'not placed by default');
    },
  },
  sound_library_list: {
    args: { query: 'regen' },
    check: (_e, r) => {
      assert.deepEqual((r.library as Array<{ assetId: string }>).map((a) => a.assetId), ['lib-1']);
      assert.deepEqual(r.project, []);
    },
  },
  sound_library_add_to_timeline: {
    args: { assetId: 'lib-1', role: 'ambience', start: 5 },
    check: (e, r) => {
      const item = e.state.mediaItems.find((m) => m.url === 'file:///lib/regen.wav');
      assert.ok(item, 'asset imported into the media pool');
      const clip = e.state.timelineClips.find((c) => c.mediaId === item!.id)!;
      assert.deepEqual([clip.start, clip.end], [5, 17]);
      assert.equal(e.mix()?.tracks[String(r.trackId)]?.role, 'ambience');
    },
  },
};

test('every sound media tool has a test case, paid ones are marked and need confirm', async () => {
  const { mcp } = await setup();
  try {
    const listed = new Map(mcp.list().map((t) => [t.name, t]));
    for (const tool of SOUND_MEDIA_TOOLS) {
      assert.ok(listed.has(tool.name), `${tool.name} not published`);
      assert.ok(CASES[tool.name], `missing test case for ${tool.name}`);
    }
    for (const name of ['sound_generate_voice', 'sound_generate_music', 'sound_generate_sfx', 'sound_stems_separate']) {
      assert.match(listed.get(name)!.description, /KOSTET CREDITS/);
      assert.ok(((listed.get(name)!.inputSchema as { required?: string[] }).required ?? []).includes('confirm'), `${name} requires confirm`);
    }
  } finally {
    mcp.dispose();
  }
});

for (const tool of SOUND_MEDIA_TOOLS) {
  test(`MCP ${tool.name}`, async () => {
    const env = await setup();
    try {
      const result = await env.mcp.call(tool.name, CASES[tool.name].args);
      assert.equal(result.ok, true, `${tool.name}: ${String(result.message)}`);
      CASES[tool.name].check(env, result);
    } finally {
      env.mcp.dispose();
    }
  });
}

test('paid tools refuse to run without confirm and call no provider', async () => {
  const { mcp, state } = await setup();
  try {
    const before = calls.filter((c) => c.service !== 'payload').length;
    for (const [name, args] of [
      ['sound_generate_voice', { text: 'x' }],
      ['sound_generate_music', { prompt: 'x' }],
      ['sound_generate_sfx', { prompt: 'x', confirm: 'yes' }],
      ['sound_stems_separate', { mediaId: 'm1' }],
    ] as const) {
      const r = await mcp.call(name, args as Record<string, unknown>);
      assert.equal(r.ok, false, name);
      assert.match(String(r.message), /confirm: true/, name);
    }
    assert.equal(calls.filter((c) => c.service !== 'payload').length, before, 'no provider call');
    assert.equal(state.mediaItems.length, 1);
  } finally {
    mcp.dispose();
  }
});

test('mastering refuses when the environment is not ready; bad sources are reported', async () => {
  const { mcp } = await setup();
  try {
    masteringReady = false;
    const r = await mcp.call('sound_mastering_run', { mediaId: 'm1' });
    assert.equal(r.ok, false);
    assert.match(String(r.message), /sound_mastering_setup/);
    masteringReady = true;
    const bad = await mcp.call('sound_stems_separate', { clipId: 'nope', confirm: true });
    assert.equal(bad.ok, false);
    const none = await mcp.call('sound_stems_separate', { confirm: true });
    assert.match(String(none.message), /Quelle fehlt/);
    const locked = await mcp.call('sound_library_add_to_timeline', { mediaId: 'm1', trackId: 'a2' });
    assert.match(String(locked.message), /gesperrt/);
  } finally {
    mcp.dispose();
  }
});
