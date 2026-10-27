import test from 'node:test';
import assert from 'node:assert/strict';

import './soundTools.ts';
import { SOUND_TOOLS, soundToolName } from './soundTools.ts';
import { createMcpHarness, createTestContext } from '../mcpHarness.ts';
import { registerLiveCommand } from '../liveCommands.ts';
import { setSoundRuntime } from '../../workspaces/sound-pro/engine/runtime.ts';
import { decodeWav } from '../../workspaces/sound-pro/engine/wav.ts';
import { SOUND_COMMANDS } from '../../workspaces/sound-pro/commands.ts';
import type { SoundMix } from '../../workspaces/sound-pro/model.ts';
import type { MediaItem, TimelineClip, TimelineTrack } from '../../types.ts';

const SR = 48000;
const written = new Map<string, Uint8Array>();
setSoundRuntime({
  // dialog: constant 0.25 (mono), music: 0.5 / −0.5 (stereo)
  decode: async (media) => {
    if (media.id === 'm1') return { sampleRate: SR, channels: [new Float32Array(10 * SR).fill(0.25)] };
    if (media.id === 'm2') return { sampleRate: SR, channels: [new Float32Array(10 * SR).fill(0.5), new Float32Array(10 * SR).fill(-0.5)] };
    return null;
  },
  writeProjectFile: async (projectPath, relativePath, bytes) => {
    written.set(relativePath, bytes);
    return { path: `${projectPath}/${relativePath}`, url: `file://${projectPath}/${relativePath}` };
  },
  createObjectUrl: () => 'blob:test',
});

const clip = (id: string, mediaId: string, trackId: string, start: number, end: number, extra: Partial<TimelineClip> = {}): TimelineClip => ({
  id, mediaId, trackId, start, end, duration: end - start, speed: 1, sourceIn: 0, sourceOut: end - start, effect: null, ...extra,
});
const tracks = (): TimelineTrack[] => [
  { id: 'a1', name: 'Dialog', type: 'audio', isLocked: false, isMuted: false },
  { id: 'a2', name: 'Score', type: 'audio', isLocked: false, isMuted: false },
];
const media = (): MediaItem[] => [
  { id: 'm1', name: 'voice take.wav', type: 'audio', url: 'blob:m1', source: 'generated', generatedBy: 'ElevenLabs', duration: 10 },
  { id: 'm2', name: 'music cue.wav', type: 'audio', url: 'blob:m2', source: 'generated', generatedBy: 'Lyria 2', duration: 10 },
];
const setup = async (projectPath: string | null = null) => {
  const { ctx, state } = createTestContext({
    timelineTracks: tracks(),
    mediaItems: media(),
    timelineClips: [
      clip('c1', 'm1', 'a1', 1, 3, { sourceIn: 1, sourceOut: 3 }),
      clip('c1b', 'm1', 'a1', 3, 5, { sourceIn: 5, sourceOut: 7 }),
      clip('c2', 'm2', 'a2', 0, 6),
    ],
    projectPath,
  });
  const mcp = await createMcpHarness(ctx);
  const mix = () => state.extras.soundMix as SoundMix;
  return { ctx, state, mcp, mix };
};
type Env = Awaited<ReturnType<typeof setup>>;

/** One case per tool: optional preparation, the call, and what must have changed. */
const CASES: Record<string, { prepare?: (env: Env) => Promise<Record<string, unknown> | void>; args: (prep: Record<string, unknown>) => Record<string, unknown>; check: (env: Env, result: Record<string, unknown>) => void }> = {
  sound_get_mix: { args: () => ({}), check: (_e, r) => assert.equal((r.tracks as unknown[]).length, 2) },
  sound_list_commands: { args: () => ({ group: 'Mixer' }), check: (_e, r) => assert.ok((r.commands as Array<{ tool: string }>).some((c) => c.tool === 'sound_mixer_set_fader')) },
  sound_get_meters: {
    args: () => ({ time: 2, window: 0.2 }),
    check: (_e, r) => {
      const master = r.master as { peakDb: number[] };
      assert.ok(Math.abs(master.peakDb[0] - 20 * Math.log10(0.75)) < 0.1, `master peak ${master.peakDb[0]}`);
      assert.ok((r.tracks as Record<string, unknown>).a1);
    },
  },
  sound_measure_loudness: {
    args: () => ({ start: 0, end: 6 }),
    check: (_e, r) => {
      assert.equal(typeof r.integratedLufs, 'number');
      assert.equal(r.targetLufs, -23);
    },
  },
  sound_mixdown: {
    args: () => ({ start: 0, end: 6, stems: true, name: 'Test' }),
    check: (e, r) => {
      const files = r.files as Array<{ name: string; mediaId: string }>;
      assert.equal(files.length, 5, 'mix + 4 stems');
      const bytes = [...written.entries()].find(([k]) => k.startsWith('exports/audio/Test-2'))?.[1];
      assert.ok(bytes, 'written into the project folder');
      const wav = decodeWav(bytes!);
      assert.equal(wav.channels[0].length, 6 * SR);
      assert.equal(e.state.mediaItems.filter((m) => m.generatedBy === 'Sound-Mixdown').length, 5);
    },
  },
  sound_mixer_set_fader: { args: () => ({ trackId: 'a1', db: -6 }), check: (e) => assert.equal(e.mix().tracks.a1.gainDb, -6) },
  sound_mixer_nudge_fader: { args: () => ({ trackId: 'a1', deltaDb: 1.5 }), check: (e) => assert.equal(e.mix().tracks.a1.gainDb, 1.5) },
  sound_mixer_set_pan: { args: () => ({ trackId: 'a2', pan: -0.5 }), check: (e) => assert.equal(e.mix().tracks.a2.pan, -0.5) },
  sound_mixer_toggle_mute: { args: () => ({ trackId: 'a1' }), check: (e) => assert.equal(e.state.timelineTracks[0].isMuted, true) },
  sound_mixer_toggle_solo: { args: () => ({ trackId: 'a2' }), check: (e) => assert.equal(e.state.timelineTracks[1].isSolo, true) },
  sound_mixer_clear_solo: {
    prepare: async (e) => { await e.mcp.call('sound_mixer_toggle_solo', { trackId: 'a1' }); },
    args: () => ({}), check: (e) => assert.ok(e.state.timelineTracks.every((t) => !t.isSolo)),
  },
  sound_mixer_toggle_phase: { args: () => ({ trackId: 'a1' }), check: (e) => assert.equal(e.mix().tracks.a1.phaseInvert, true) },
  sound_mixer_toggle_record_arm: { args: () => ({ trackId: 'a1' }), check: (e) => assert.equal(e.mix().tracks.a1.recordArm, true) },
  sound_mixer_set_output_bus: { args: () => ({ trackId: 'a1', busId: 'sub-dialog' }), check: (e) => assert.equal(e.mix().tracks.a1.outputBusId, 'sub-dialog') },
  sound_mixer_set_role: { args: () => ({ trackId: 'a2', role: 'music' }), check: (e) => assert.deepEqual([e.mix().tracks.a2.role, e.mix().tracks.a2.outputBusId], ['music', 'sub-music']) },
  sound_mixer_add_insert: { args: () => ({ target: 'a1', kind: 'compressor' }), check: (e, r) => assert.equal(e.mix().tracks.a1.inserts[0].id, r.insertId) },
  sound_mixer_remove_insert: {
    prepare: async (e) => (await e.mcp.call('sound_mixer_add_insert', { target: 'a1', kind: 'gate' })) as Record<string, unknown>,
    args: (p) => ({ target: 'a1', insertId: p.insertId }), check: (e) => assert.equal(e.mix().tracks.a1.inserts.length, 0),
  },
  sound_mixer_bypass_insert: {
    prepare: async (e) => (await e.mcp.call('sound_mixer_add_insert', { target: 'main-1', kind: 'limiter' })) as Record<string, unknown>,
    args: (p) => ({ target: 'main-1', insertId: p.insertId }), check: (e) => assert.equal(e.mix().buses.find((b) => b.id === 'main-1')!.inserts[0].bypass, true),
  },
  sound_mixer_set_insert_params: {
    prepare: async (e) => (await e.mcp.call('sound_mixer_add_insert', { target: 'a1', kind: 'compressor' })) as Record<string, unknown>,
    args: (p) => ({ target: 'a1', insertId: p.insertId, params: { thresholdDb: -24, ratio: 6 } }),
    check: (e) => {
      const slot = e.mix().tracks.a1.inserts[0];
      assert.ok(slot.kind === 'compressor' && slot.params.ratio === 6 && slot.params.thresholdDb === -24);
    },
  },
  sound_mixer_set_eq_band: {
    args: () => ({ target: 'a1', band: 0, enabled: true, freq: 100 }),
    check: (e) => {
      const slot = e.mix().tracks.a1.inserts[0];
      assert.ok(slot.kind === 'eq' && slot.params.bands[0].enabled && slot.params.bands[0].freq === 100);
    },
  },
  sound_mixer_set_send: { args: () => ({ trackId: 'a1', busId: 'aux-reverb', levelDb: -8, preFader: true }), check: (e) => assert.deepEqual(e.mix().tracks.a1.sends[0], { busId: 'aux-reverb', levelDb: -8, preFader: true, enabled: true }) },
  sound_mixer_remove_send: {
    prepare: async (e) => { await e.mcp.call('sound_mixer_set_send', { trackId: 'a1', busId: 'aux-reverb' }); },
    args: () => ({ trackId: 'a1', busId: 'aux-reverb' }), check: (e) => assert.equal(e.mix().tracks.a1.sends.length, 0),
  },
  sound_mixer_reset_track: {
    prepare: async (e) => { await e.mcp.call('sound_mixer_set_fader', { trackId: 'a1', db: -20 }); },
    args: () => ({ trackId: 'a1' }), check: (e) => assert.equal(e.mix().tracks.a1.gainDb, 0),
  },
  sound_track_add: { args: () => ({}), check: (e) => assert.equal(e.state.timelineTracks.length, 3) },
  sound_bus_add: { args: () => ({ kind: 'aux', name: 'Slap' }), check: (e, r) => assert.ok(e.mix().buses.some((b) => b.id === r.busId && b.name === 'Slap')) },
  sound_bus_remove: { args: () => ({ busId: 'sub-effects' }), check: (e) => assert.ok(!e.mix().buses.some((b) => b.id === 'sub-effects')) },
  sound_bus_set: { args: () => ({ busId: 'sub-music', gainDb: -3, mute: true }), check: (e) => assert.ok(e.mix().buses.some((b) => b.id === 'sub-music' && b.gainDb === -3 && b.mute)) },
  sound_master_set: { args: () => ({ targetLufs: -14, ceilingDb: -2 }), check: (e) => assert.deepEqual([e.mix().master.targetLufs, e.mix().master.limiter.ceilingDb], [-14, -2]) },
  sound_clip_set_gain: { args: () => ({ clipIds: ['c1'], db: -6.0206 }), check: (e) => assert.ok(Math.abs((e.state.timelineClips[0].volume ?? 1) - 0.5) < 1e-4) },
  sound_clip_nudge_gain: { args: () => ({ clipIds: 'c2', deltaDb: 6.0206 }), check: (e) => assert.ok(Math.abs((e.state.timelineClips[2].volume ?? 1) - 2) < 1e-3) },
  sound_clip_set_fade: { args: () => ({ clipIds: ['c2'], side: 'out', duration: 1.5, curve: 's-curve' }), check: (e) => assert.deepEqual(e.mix().clips.c2.fadeOut, { duration: 1.5, curve: 's-curve' }) },
  sound_clip_remove_fades: {
    prepare: async (e) => { await e.mcp.call('sound_clip_set_fade', { clipIds: ['c2'], side: 'in', duration: 1 }); },
    args: () => ({ clipIds: ['c2'] }), check: (e) => assert.equal(e.mix().clips.c2, undefined),
  },
  sound_clip_crossfade: { args: () => ({ clipId: 'c1', duration: 0.5 }), check: (e) => assert.equal(e.mix().clips.c1.fadeOut.duration, 0.5) },
  sound_clip_move: { args: () => ({ clipId: 'c2', start: 2.4, mode: 'grid' }), check: (e) => assert.equal(e.state.timelineClips[2].start, 2) },
  sound_clip_trim: { args: () => ({ clipId: 'c2', edge: 'end', time: 4, mode: 'slip' }), check: (e) => assert.equal(e.state.timelineClips[2].end, 4) },
  sound_clip_split: { args: () => ({ clipIds: ['c2'], time: 2 }), check: (e) => assert.equal(e.state.timelineClips.length, 4) },
  sound_clip_delete: { args: () => ({ clipIds: ['c1'], mode: 'shuffle' }), check: (e) => assert.equal(e.state.timelineClips.find((c) => c.id === 'c1b')!.start, 1) },
  sound_edit_delete_selection: { args: () => ({ trackIds: ['a2'], start: 1, end: 2 }), check: (e) => assert.equal(e.state.timelineClips.filter((c) => c.trackId === 'a2').length, 2) },
  sound_clip_nudge: { args: () => ({ clipIds: ['c2'], deltaSec: 0.5 }), check: (e) => assert.equal(e.state.timelineClips[2].start, 0.5) },
  sound_automation_set_mode: { args: () => ({ trackId: 'a2', mode: 'latch' }), check: (e) => assert.equal(e.mix().tracks.a2.automationMode, 'latch') },
  sound_automation_add_point: { args: () => ({ trackId: 'a2', param: 'volume', time: 1, value: -12 }), check: (e) => assert.deepEqual(e.mix().tracks.a2.automation.volume, [{ time: 1, value: -12 }]) },
  sound_automation_remove_points: {
    prepare: async (e) => { await e.mcp.call('sound_automation_add_point', { trackId: 'a2', param: 'pan', time: 1, value: 0.5 }); },
    args: () => ({ trackId: 'a2', param: 'pan' }), check: (e) => assert.equal(e.mix().tracks.a2.automation.pan, undefined),
  },
  sound_automation_write_range: { args: () => ({ trackId: 'a2', param: 'volume', start: 1, end: 2, value: -10 }), check: (e) => assert.ok((e.mix().tracks.a2.automation.volume ?? []).some((p) => p.value === -10)) },
  sound_automation_commit_pass: {
    prepare: async (e) => { await e.mcp.call('sound_automation_set_mode', { trackId: 'a2', mode: 'write' }); },
    args: () => ({ trackId: 'a2', param: 'volume', samples: [{ time: 0, value: -3 }, { time: 1, value: -9 }], stopTime: 2 }),
    check: (e) => assert.equal(e.mix().tracks.a2.automation.volume?.at(-1)?.value, -9),
  },
  sound_view_set: { args: () => ({ view: 'protools' }), check: (e) => assert.deepEqual([e.mix().ui.view, e.state.activeWorkspace], ['protools', 'SOUND']) },
  sound_view_toggle_mix_window: { args: () => ({}), check: (e) => assert.equal(e.mix().ui.proToolsWindow, 'mix') },
  sound_view_toggle_automation: { args: () => ({}), check: (e) => assert.equal(e.mix().ui.showAutomation, true) },
  sound_view_zoom: { args: () => ({ zoom: 4 }), check: (e) => assert.equal(e.mix().ui.zoom, 4) },
  sound_edit_set_mode: { args: () => ({ mode: 'shuffle' }), check: (e) => assert.equal(e.mix().ui.editMode, 'shuffle') },
  sound_edit_set_tool: { args: () => ({ tool: 'selector' }), check: (e) => assert.equal(e.mix().ui.tool, 'selector') },
  sound_edit_set_grid: { args: () => ({ gridSec: 0.5 }), check: (e) => assert.equal(e.mix().ui.gridSec, 0.5) },
  sound_edit_set_selection: { args: () => ({ start: 1, end: 2 }), check: (e) => assert.deepEqual(e.mix().ui.selection, { start: 1, end: 2 }) },
  sound_select_track: { args: () => ({ trackId: 'a2' }), check: (e) => assert.equal(e.mix().ui.selectedTrackId, 'a2') },
  sound_select_clips: { args: () => ({ clipIds: ['c1', 'nope'] }), check: (e) => assert.deepEqual(e.mix().ui.selectedClipIds, ['c1']) },
  sound_transport_toggle: { args: () => ({}), check: () => assert.equal(transportCalls.at(-1), 'toggle') },
  sound_transport_locate: { args: () => ({ time: 4.5 }), check: (e) => assert.equal(e.state.playheadPosition, 4.5) },
  sound_adr_add_cue: { args: () => ({ character: 'Mara', line: 'Wo warst du?', start: 1, end: 2.5 }), check: (e) => assert.equal(e.mix().adrCues[0].character, 'Mara') },
  sound_adr_update_cue: {
    prepare: async (e) => (await e.mcp.call('sound_adr_add_cue', { character: 'Mara', line: 'x' })) as Record<string, unknown>,
    args: (p) => ({ cueId: p.cueId, done: true, note: 'Take 3' }), check: (e) => assert.deepEqual([e.mix().adrCues[0].done, e.mix().adrCues[0].note], [true, 'Take 3']),
  },
  sound_adr_remove_cue: {
    prepare: async (e) => (await e.mcp.call('sound_adr_add_cue', { character: 'Mara', line: 'x' })) as Record<string, unknown>,
    args: (p) => ({ cueId: p.cueId }), check: (e) => assert.equal(e.mix().adrCues.length, 0),
  },
  sound_studio_auto_route: { args: () => ({}), check: (e, r) => assert.deepEqual(r.assigned, { a1: 'dialog', a2: 'music' }) },
  sound_studio_duck_music: {
    prepare: async (e) => { await e.mcp.call('sound_studio_auto_route', {}); },
    args: () => ({ amountDb: -12 }), check: (e) => assert.ok((e.mix().tracks.a2.automation.volume ?? []).some((p) => p.value === -12)),
  },
  sound_mix_reset: {
    prepare: async (e) => { await e.mcp.call('sound_mixer_set_fader', { trackId: 'a1', db: -20 }); },
    args: () => ({}), check: (e) => assert.deepEqual(e.mix().tracks, {}),
  },
};

const transportCalls: string[] = [];
registerLiveCommand('sound.transport', (args) => { transportCalls.push(String(args.action)); return { ok: true }; });

test('every sound command is published as an MCP tool with a schema and a test case', async () => {
  const { mcp } = await setup();
  try {
    const listed = new Map(mcp.list().map((t) => [t.name, t]));
    for (const command of SOUND_COMMANDS) {
      const name = soundToolName(command.id);
      assert.ok(listed.has(name), `${name} not published`);
      assert.equal((listed.get(name)!.inputSchema as { type: string }).type, 'object');
    }
    for (const tool of SOUND_TOOLS) {
      assert.ok(CASES[tool.name], `missing MCP test case for ${tool.name}`);
      assert.ok(tool.description.length > 20, `${tool.name} needs a description`);
    }
    assert.match(listed.get('sound_clip_delete')!.description, /LÖSCHT/);
  } finally {
    mcp.dispose();
  }
});

for (const tool of SOUND_TOOLS) {
  test(`MCP ${tool.name}`, async () => {
    const env = await setup('/projekt');
    try {
      const prep = (await CASES[tool.name]?.prepare?.(env)) ?? {};
      const result = await env.mcp.call(tool.name, CASES[tool.name].args(prep as Record<string, unknown>));
      assert.equal(result.ok, true, `${tool.name}: ${String(result.message)}`);
      CASES[tool.name].check(env, result);
    } finally {
      env.mcp.dispose();
    }
  });
}

test('MCP sound tools report bad input as ok:false with a German message', async () => {
  const { mcp } = await setup();
  try {
    const bad = await mcp.call('sound_mixer_set_fader', { trackId: 'zzz', db: 0 });
    assert.equal(bad.ok, false);
    assert.match(String(bad.message), /Spur/);
    const badView = await mcp.call('sound_view_set', { view: 'logic' });
    assert.equal(badView.ok, false);
    const empty = await mcp.call('sound_measure_loudness', { start: 3, end: 3 });
    assert.equal(empty.ok, false);
  } finally {
    mcp.dispose();
  }
});

test('MCP mix changes are audible in the mixdown (fader + mute)', async () => {
  const { mcp, state } = await setup('/projekt');
  try {
    await mcp.call('sound_master_set', { limiterEnabled: false });
    await mcp.call('sound_mixer_set_fader', { trackId: 'a2', db: -6.0206 });
    await mcp.call('sound_mixer_toggle_mute', { trackId: 'a1' });
    const res = await mcp.call('sound_mixdown', { start: 0, end: 4, name: 'Check' });
    const name = (res.files as Array<{ name: string }>)[0].name;
    const wav = decodeWav(written.get(`exports/audio/${name}`)!);
    assert.ok(Math.abs(wav.channels[0][2 * SR] - 0.25) < 1e-3, 'music at −6 dB, dialog muted');
    assert.ok(state.mediaItems.some((m) => m.name === name));
  } finally {
    mcp.dispose();
  }
});
