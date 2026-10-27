import test from 'node:test';
import assert from 'node:assert/strict';
import type { TimelineClip, TimelineTrack } from '../../types.ts';
import { describeSoundCommands, duckingAutomation, guessRole, runSoundCommand, SOUND_COMMANDS, type SoundState } from './commands.ts';
import { AutomationRecorder, evaluateAutomation, spliceAutomation } from './automation.ts';
import { crossfadeClips, deleteClips, deleteRange, moveClip, splitClipAt, trimClip } from './editOps.ts';
import { createSoundMix, normalizeSoundMix, STEM_BUS_IDS } from './model.ts';

const clip = (id: string, trackId: string, start: number, end: number, extra: Partial<TimelineClip> = {}): TimelineClip => ({
  id, mediaId: `m-${id}`, trackId, start, end, duration: end - start, speed: 1, sourceIn: 0, sourceOut: end - start, effect: null, ...extra,
});
const tracks: TimelineTrack[] = [
  { id: 'a1', name: 'Dialog', type: 'audio', isLocked: false, isMuted: false },
  { id: 'a2', name: 'Score', type: 'audio', isLocked: false, isMuted: false },
];
const baseState = (clips: TimelineClip[]): SoundState => ({
  mix: createSoundMix(),
  clips,
  tracks,
  media: clips.map((c) => ({ id: c.mediaId, type: 'audio' as const, name: c.trackId === 'a1' ? 'voice take' : 'music cue', duration: 30 })),
  playhead: 0,
});

test('every command has a unique id, German label and an object schema', () => {
  const ids = new Set<string>();
  for (const c of SOUND_COMMANDS) {
    assert.ok(!ids.has(c.id), c.id);
    ids.add(c.id);
    assert.equal(c.params.type, 'object');
    assert.ok(c.label.length > 2);
    for (const r of c.params.required ?? []) assert.ok(r in c.params.properties, `${c.id}: ${r}`);
  }
  assert.ok(describeSoundCommands().length === SOUND_COMMANDS.length);
});

test('commands reject bad input with a message instead of throwing', () => {
  const st = baseState([clip('c1', 'a1', 0, 2)]);
  assert.deepEqual(runSoundCommand(st, 'nope').ok, false);
  const r = runSoundCommand(st, 'mixer.setFader', { trackId: 'x', db: 0 });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /Spur/);
  const r2 = runSoundCommand(st, 'mixer.setFader', { trackId: 'a1', db: 'loud' });
  assert.equal(r2.ok, false);
  const r3 = runSoundCommand(st, 'mixer.setFader', { trackId: 'a1', db: 99 });
  assert.ok(r3.ok && r3.state.mix.tracks.a1.gainDb === 12, 'clamped to +12');
});

test('mute/solo write the shared timeline track fields', () => {
  const st = baseState([clip('c1', 'a1', 0, 2)]);
  const r = runSoundCommand(st, 'mixer.toggleMute', { trackId: 'a1' });
  assert.ok(r.ok);
  if (r.ok) {
    assert.deepEqual(r.patch.trackUpdates, [{ trackId: 'a1', updates: { isMuted: true } }]);
    assert.equal(r.state.tracks[0].isMuted, true);
  }
});

test('clip gain writes clip.volume; fades and crossfades go to the mix document', () => {
  const st = baseState([clip('c1', 'a1', 0, 4, { sourceOut: 4 }), clip('c2', 'a1', 4, 8, { sourceIn: 2, sourceOut: 6 })]);
  const g = runSoundCommand(st, 'clip.setGain', { clipIds: ['c1'], db: -6.0206 });
  assert.ok(g.ok);
  if (g.ok) assert.ok(Math.abs((g.state.clips[0].volume ?? 1) - 0.5) < 1e-4);
  const f = runSoundCommand(st, 'clip.setFade', { clipIds: 'c1', side: 'in', duration: 10, curve: 'linear' });
  assert.ok(f.ok);
  if (f.ok) assert.deepEqual(f.state.mix.clips.c1.fadeIn, { duration: 4, curve: 'linear' }, 'clamped to clip length');
  const x = runSoundCommand(st, 'clip.crossfade', { clipId: 'c1', duration: 1 });
  assert.ok(x.ok, !x.ok ? x.error : '');
  if (x.ok) {
    const [c1, c2] = x.state.clips;
    assert.equal(c1.end, 4.5);
    assert.equal(c2.start, 3.5);
    assert.equal(c2.sourceIn, 1.5);
    assert.equal(x.state.mix.clips.c1.fadeOut.duration, 1);
    assert.equal(x.state.mix.clips.c2.fadeIn.duration, 1);
  }
});

test('edit modes: slip, grid, shuffle move and trim', () => {
  const clips = [clip('c1', 'a1', 0, 2), clip('c2', 'a1', 2, 5), clip('c3', 'a1', 5, 6)];
  assert.equal(moveClip(clips, 'c3', 7.3, 'slip', 1)[2].start, 7.3);
  assert.equal(moveClip(clips, 'c3', 7.3, 'grid', 1)[2].start, 7);
  // shuffle: c3 moved before c1 → order c3, c1, c2, butted from 0
  const shuffled = moveClip(clips, 'c3', 0, 'shuffle', 1);
  const pos = Object.fromEntries(shuffled.map((c) => [c.id, [c.start, c.end]]));
  assert.deepEqual(pos, { c3: [0, 1], c1: [1, 3], c2: [3, 6] });
  // shuffle trim end of c1 by −1 s ripples c2 and c3
  const trimmed = trimClip(clips, 'c1', 'end', 1, 'shuffle', 1, 30);
  assert.deepEqual(trimmed.map((c) => [c.start, c.end]), [[0, 1], [1, 4], [4, 5]]);
  // slip trim start reveals no media before 0
  const slipStart = trimClip(clips, 'c2', 'start', 1, 'slip', 1, 30);
  assert.equal(slipStart[1].start, 2, 'sourceIn 0 → cannot extend earlier');
});

test('split, delete and range delete with shuffle ripple', () => {
  const clips = [clip('c1', 'a1', 0, 4), clip('c2', 'a1', 4, 6), clip('d1', 'a2', 0, 6)];
  const split = splitClipAt(clips, 'c1', 1, 'c1b');
  assert.equal(split.length, 4);
  assert.deepEqual([split[0].end, split[1].start, split[1].sourceIn], [1, 1, 1]);
  const del = deleteClips(clips, ['c1'], 'shuffle');
  assert.deepEqual(del.find((c) => c.id === 'c2')!.start, 0);
  assert.equal(del.find((c) => c.id === 'd1')!.start, 0, 'other track untouched');
  let n = 0;
  const range = deleteRange(clips, ['a1'], 1, 2, 'shuffle', () => `r${n++}`);
  const a1 = range.filter((c) => c.trackId === 'a1').sort((a, b) => a.start - b.start).map((c) => [c.start, c.end]);
  assert.deepEqual(a1, [[0, 1], [1, 3], [3, 5]]);
});

test('crossfade needs an adjacent clip with media handles', () => {
  const clips = [clip('c1', 'a1', 0, 2, { sourceOut: 2 }), clip('c2', 'a1', 3, 5)];
  assert.equal(crossfadeClips(clips, 'c1', 1, () => 10).rightId, null);
});

test('automation evaluation, write range and recorder modes', () => {
  const lane = [{ time: 0, value: 0 }, { time: 10, value: -10 }];
  assert.equal(evaluateAutomation(lane, 5, 3), -5);
  assert.equal(evaluateAutomation([], 5, 3), 3);
  const written = spliceAutomation(lane, 2, 4, [{ time: 2, value: -20 }, { time: 4, value: -20 }]);
  assert.ok(Math.abs(evaluateAutomation(written, 3, 0) + 20) < 1e-9);
  assert.ok(Math.abs(evaluateAutomation(written, 8, 0) + 8) < 0.01, 'rest of the lane unchanged');

  const touch = new AutomationRecorder('touch', lane);
  touch.sample(1, -3, false);
  touch.sample(2, -6, true);
  touch.sample(3, -6, true);
  touch.sample(4, -1, false);
  const t = touch.finish(5);
  assert.equal(evaluateAutomation(t, 2.5, 0), -6);
  assert.ok(Math.abs(evaluateAutomation(t, 6, 0) + 6) < 0.01, 'after release the old lane returns');

  const latch = new AutomationRecorder('latch', lane);
  latch.sample(2, -6, true);
  latch.sample(3, -7, false);
  latch.sample(4, -7, false);
  const l = latch.finish(6);
  assert.equal(evaluateAutomation(l, 5.5, 0), -7, 'latch keeps writing until stop');

  const read = new AutomationRecorder('read', lane);
  read.sample(1, -50, true);
  assert.deepEqual(read.finish(2), lane);
});

test('studio: auto routing by name and ducking automation', () => {
  const st = baseState([clip('c1', 'a1', 1, 3), clip('c2', 'a2', 0, 10)]);
  assert.equal(guessRole(tracks[0], st.clips, st.media), 'dialog');
  assert.equal(guessRole(tracks[1], st.clips, st.media), 'music');
  // regression: an SFX generator named after a music model must not become music
  const sfxTrack = { id: 'a9', name: 'A9', type: 'audio' as const, isLocked: false, isMuted: false };
  assert.equal(guessRole(sfxTrack, [clip('x', 'a9', 0, 1)], [{ id: 'm-x', type: 'audio', name: 'Impacts.wav', generatedBy: 'Lyria 2 SFX' }]), 'effects');
  assert.equal(guessRole({ ...sfxTrack, name: 'Effekte' }, [], []), 'effects');
  const routed = runSoundCommand(st, 'studio.autoRoute', {});
  assert.ok(routed.ok);
  if (!routed.ok) return;
  assert.equal(routed.state.mix.tracks.a1.outputBusId, STEM_BUS_IDS.dialog);
  assert.equal(routed.state.mix.tracks.a2.outputBusId, STEM_BUS_IDS.music);
  const ducked = runSoundCommand(routed.state, 'studio.duckMusic', { amountDb: -12, attack: 0.25, release: 0.5 });
  assert.ok(ducked.ok, !ducked.ok ? ducked.error : '');
  if (!ducked.ok) return;
  const vol = ducked.state.mix.tracks.a2.automation.volume!;
  assert.equal(evaluateAutomation(vol, 2, 0), -12);
  assert.equal(evaluateAutomation(vol, 8, 0), 0);
  assert.deepEqual(duckingAutomation([[1, 2], [2.2, 3]], 0, -10, 0.2, 0.5).length, 4, 'close dialog windows merge');
});

test('inserts, EQ bands, sends and busses through commands', () => {
  let st = baseState([clip('c1', 'a1', 0, 2)]);
  const eq = runSoundCommand(st, 'mixer.setEqBand', { target: 'a1', band: 2, gainDb: 4, freq: 2500 });
  assert.ok(eq.ok);
  if (!eq.ok) return;
  st = eq.state;
  const slot = st.mix.tracks.a1.inserts[0];
  assert.equal(slot.kind, 'eq');
  if (slot.kind === 'eq') assert.deepEqual([slot.params.bands[2].gainDb, slot.params.bands[2].freq], [4, 2500]);
  const comp = runSoundCommand(st, 'mixer.addInsert', { target: 'a1', kind: 'compressor' });
  assert.ok(comp.ok);
  if (!comp.ok) return;
  const insertId = (comp.patch.result as { insertId: string }).insertId;
  const set = runSoundCommand(comp.state, 'mixer.setInsertParams', { target: 'a1', insertId, params: { ratio: 100, thresholdDb: -30 } });
  assert.ok(set.ok);
  if (set.ok) {
    const c = set.state.mix.tracks.a1.inserts[1];
    if (c.kind === 'compressor') assert.deepEqual([c.params.ratio, c.params.thresholdDb], [40, -30]);
  }
  const send = runSoundCommand(st, 'mixer.setSend', { trackId: 'a1', busId: 'aux-reverb', levelDb: -12 });
  assert.ok(send.ok && send.state.mix.tracks.a1.sends[0].levelDb === -12);
  const toMain = runSoundCommand(st, 'mixer.setSend', { trackId: 'a1', busId: 'main-1' });
  assert.equal(toMain.ok, false);
  const bus = runSoundCommand(st, 'bus.add', { kind: 'aux', name: 'Slap' });
  assert.ok(bus.ok);
  if (!bus.ok) return;
  const busId = (bus.patch.result as { busId: string }).busId;
  const removed = runSoundCommand({ ...bus.state, mix: { ...bus.state.mix, tracks: { a1: { ...bus.state.mix.tracks.a1, outputBusId: busId } } } }, 'bus.remove', { busId });
  assert.ok(removed.ok && removed.state.mix.tracks.a1.outputBusId === 'main-1');
});

test('normalizeSoundMix keeps a valid document stable (idempotent JSON round trip)', () => {
  const st = baseState([clip('c1', 'a1', 0, 2)]);
  const r = runSoundCommand(st, 'mixer.setEqBand', { target: 'a1', band: 1, gainDb: 3 });
  assert.ok(r.ok);
  if (!r.ok) return;
  const once = normalizeSoundMix(JSON.parse(JSON.stringify(r.state.mix)));
  const twice = normalizeSoundMix(JSON.parse(JSON.stringify(once)));
  assert.deepEqual(twice, once);
});
