import test from 'node:test';
import assert from 'node:assert/strict';
import { biquadCoefficients, biquadMagnitudeDb, compressorGainDb, CompressorProcessor, LimiterProcessor, panGains } from './dsp.ts';
import { kWeightingCoefficients, LoudnessMeter, measureLoudness, normalizationGainDb } from './loudness.ts';
import { MixEngine, type EngineDocument } from './mixEngine.ts';
import { bounceMix, stemMix } from './bounce.ts';
import { decodeWav, encodeWav } from './wav.ts';
import { createInsert, createSoundMix, defaultTrackMix, normalizeSoundMix, STEM_BUS_IDS } from '../model.ts';

const SR = 48000;
const sine = (freq: number, seconds: number, amp = 1, sr = SR) => {
  const out = new Float32Array(Math.round(seconds * sr));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return out;
};
const close = (actual: number, expected: number, tol: number, msg?: string) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg ?? ''} expected ${expected} ± ${tol}, got ${actual}`);

test('K-weighting reproduces the BS.1770 coefficient table at 48 kHz', () => {
  const [shelf, hp] = kWeightingCoefficients(48000);
  close(shelf.b0, 1.53512485958697, 1e-9);
  close(shelf.b1, -2.69169618940638, 1e-9);
  close(shelf.b2, 1.19839281085285, 1e-9);
  close(shelf.a1, -1.69065929318241, 1e-9);
  close(shelf.a2, 0.73248077421585, 1e-9);
  close(hp.a1, -1.99004745483398, 1e-9);
  close(hp.a2, 0.99007225036621, 1e-9);
});

test('EBU Tech 3341: 1 kHz sine at −18 dBFS on both channels reads −18 LUFS (±0.1)', () => {
  const amp = Math.pow(10, -18 / 20);
  const s = sine(1000, 20, amp);
  const summary = measureLoudness(s, s, SR);
  close(summary.integratedLufs, -18, 0.1, 'integrated');
  close(summary.shortTermMaxLufs, -18, 0.1, 'short-term');
  close(summary.truePeakDb, -18, 0.2, 'true peak');
});

test('integrated loudness gates silence (−70 LUFS absolute gate)', () => {
  const amp = Math.pow(10, -23 / 20);
  const tone = sine(1000, 10, amp);
  const withSilence = new Float32Array(tone.length * 2);
  withSilence.set(tone, 0);
  const a = measureLoudness(tone, tone, SR).integratedLufs;
  const b = measureLoudness(withSilence, withSilence, SR).integratedLufs;
  close(b, a, 0.1); // only the gating blocks that straddle the cut differ
});

test('loudness range of a stepped −30/−20 LUFS signal is about 10 LU', () => {
  const lo = sine(1000, 20, Math.pow(10, -30 / 20));
  const hi = sine(1000, 20, Math.pow(10, -20 / 20));
  const both = new Float32Array(lo.length + hi.length);
  both.set(lo, 0);
  both.set(hi, lo.length);
  const meter = new LoudnessMeter(SR);
  meter.push(both, both, both.length);
  close(meter.rangeLu(), 10, 1);
});

test('true peak finds inter-sample peaks above the sample peak', () => {
  // fs/4 sine sampled at 45° phase: samples at 0.707, true peak 1.0
  const n = 4800;
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = Math.sin((Math.PI / 2) * i + Math.PI / 4);
  const summary = measureLoudness(s, s, SR);
  close(summary.samplePeakDb, -3.01, 0.05);
  assert.ok(summary.truePeakDb > -0.6, `true peak ${summary.truePeakDb}`);
});

test('normalization gain respects the true-peak limit', () => {
  const r = normalizationGainDb({ integratedLufs: -30, truePeakDb: -3, rangeLu: 0, momentaryMaxLufs: 0, shortTermMaxLufs: 0, samplePeakDb: -3, durationSec: 1 }, -14, -1);
  assert.deepEqual(r, { gainDb: 2, peakLimited: true });
  const s = normalizationGainDb({ integratedLufs: -30, truePeakDb: -20, rangeLu: 0, momentaryMaxLufs: 0, shortTermMaxLufs: 0, samplePeakDb: -20, durationSec: 1 }, -23, -1);
  assert.equal(s.gainDb, 7);
});

test('EQ biquads: peaking boost at centre, shelves and passes behave', () => {
  const peak = biquadCoefficients({ type: 'peaking', freq: 1000, gainDb: 6, q: 1 }, SR);
  close(biquadMagnitudeDb(peak, 1000, SR), 6, 0.01);
  close(biquadMagnitudeDb(peak, 50, SR), 0, 0.2);
  const hp = biquadCoefficients({ type: 'highpass', freq: 100, gainDb: 0, q: 0.707 }, SR);
  close(biquadMagnitudeDb(hp, 100, SR), -3, 0.1);
  assert.ok(biquadMagnitudeDb(hp, 25, SR) < -20);
  const shelf = biquadCoefficients({ type: 'highshelf', freq: 4000, gainDb: -6, q: 0.707 }, SR);
  close(biquadMagnitudeDb(shelf, 16000, SR), -6, 0.5);
});

test('compressor static curve and processing', () => {
  assert.equal(compressorGainDb(-30, { thresholdDb: -20, ratio: 4, kneeDb: 0 }), 0);
  close(compressorGainDb(-10, { thresholdDb: -20, ratio: 4, kneeDb: 0 }), -7.5, 1e-9);
  const slot = createInsert('compressor');
  if (slot.kind !== 'compressor') throw new Error();
  slot.params = { thresholdDb: -20, ratio: 4, attackMs: 1, releaseMs: 50, kneeDb: 0, makeupDb: 0 };
  const comp = new CompressorProcessor(SR, slot);
  const l = sine(1000, 1, Math.pow(10, -6 / 20));
  const r = l.slice();
  comp.process(l, r, l.length);
  const tail = l.subarray(l.length - 4800);
  const peak = Math.max(...Array.from(tail, Math.abs));
  // −6 dBFS input, 14 dB over threshold at 4:1 → about −10.5 dB reduction → ≈ −16.5 dBFS
  close(20 * Math.log10(peak), -16.5, 0.6);
});

test('limiter never exceeds its ceiling', () => {
  const lim = new LimiterProcessor(SR, { kind: 'limiter', params: { ceilingDb: -1, releaseMs: 50 } });
  const l = sine(440, 0.5, 2);
  const r = l.slice();
  lim.process(l, r, l.length);
  const ceiling = Math.pow(10, -1 / 20);
  for (const x of l) assert.ok(Math.abs(x) <= ceiling + 1e-6);
});

test('pan law: unity at centre, hard left silences right', () => {
  assert.deepEqual(panGains(0), [1, 1]);
  const [l, r] = panGains(-1);
  assert.equal(l, 1);
  assert.equal(r, 0);
  close(panGains(0.5)[0], Math.cos(Math.PI / 4), 1e-9);
});

const makeDoc = (mix: unknown, extra: Partial<EngineDocument> = {}): EngineDocument => ({
  tracks: [{ id: 'a1', type: 'audio', isMuted: false }, { id: 'a2', type: 'audio', isMuted: false }],
  clips: [
    { id: 'c1', mediaId: 'm1', trackId: 'a1', start: 1, end: 3, duration: 2, speed: 1, sourceIn: 0, volume: 1 },
    { id: 'c2', mediaId: 'm2', trackId: 'a2', start: 0, end: 4, duration: 4, speed: 1, sourceIn: 0, volume: 0.5 },
  ],
  media: [{ id: 'm1', type: 'audio' }, { id: 'm2', type: 'audio' }],
  mix,
  ...extra,
});
const dc = (value: number, seconds: number) => new Float32Array(Math.round(seconds * SR)).fill(value);
const sources = { m1: { sampleRate: SR, channels: [dc(0.25, 5)] }, m2: { sampleRate: SR, channels: [dc(0.5, 5), dc(-0.5, 5)] } };
const getSource = (id: string) => (sources as Record<string, { sampleRate: number; channels: Float32Array[] }>)[id] ?? null;
const at = (arr: Float32Array, sec: number) => arr[Math.round(sec * SR)];

test('mix engine places clips, applies clip volume, fader, pan, mute and solo', () => {
  const mix = createSoundMix();
  mix.master.limiter.enabled = false;
  const res = bounceMix(makeDoc(mix), getSource, { sampleRate: SR, start: 0, end: 4 });
  const [L, R] = res.channels;
  close(at(L, 0.5), 0.25, 1e-6, 'only c2 (0.5 × 0.5)');
  close(at(R, 0.5), -0.25, 1e-6);
  close(at(L, 2), 0.5, 1e-6, 'c1 + c2');
  close(at(R, 2), 0, 1e-6);

  mix.tracks.a1 = defaultTrackMix({ gainDb: -6.0206, pan: -1 });
  const r2 = bounceMix(makeDoc(mix), getSource, { sampleRate: SR, start: 0, end: 4 });
  close(at(r2.channels[0], 2), 0.25 + 0.125, 1e-4, 'fader −6 dB');
  close(at(r2.channels[1], 2), -0.25, 1e-4, 'hard left removes c1 from right');

  const muted = bounceMix(makeDoc(mix, { tracks: [{ id: 'a1', type: 'audio', isMuted: true }, { id: 'a2', type: 'audio', isMuted: false }] }), getSource, { sampleRate: SR, start: 0, end: 4 });
  close(at(muted.channels[0], 2), 0.25, 1e-6);
  const solo = bounceMix(makeDoc(mix, { tracks: [{ id: 'a1', type: 'audio', isMuted: false, isSolo: true }, { id: 'a2', type: 'audio', isMuted: false }] }), getSource, { sampleRate: SR, start: 0, end: 4 });
  close(at(solo.channels[0], 0.5), 0, 1e-6);
  close(at(solo.channels[0], 2), 0.125, 1e-4);
});

test('mix engine: fades, volume keyframes and volume automation', () => {
  const mix = createSoundMix();
  mix.master.limiter.enabled = false;
  mix.clips.c1 = { fadeIn: { duration: 1, curve: 'linear' }, fadeOut: { duration: 0.5, curve: 'linear' } };
  const doc = makeDoc(mix, { tracks: [{ id: 'a1', type: 'audio', isMuted: false }] });
  const res = bounceMix(doc, getSource, { sampleRate: SR, start: 0, end: 4 });
  close(at(res.channels[0], 1.5), 0.125, 1e-3, 'half-way through fade-in');
  close(at(res.channels[0], 2.2), 0.25, 1e-6, 'full level');
  close(at(res.channels[0], 2.75), 0.125, 1e-3, 'half-way through fade-out');

  const keyed = makeDoc(createSoundMix(), {
    tracks: [{ id: 'a1', type: 'audio', isMuted: false }],
    clips: [{ id: 'c1', mediaId: 'm1', trackId: 'a1', start: 1, end: 3, volume: 1, keyframes: [{ time: 0, value: 0, property: 'volume' }, { time: 2, value: 1, property: 'volume' }] }],
  });
  const k = bounceMix(keyed, getSource, { sampleRate: SR, start: 0, end: 4 });
  close(at(k.channels[0], 2), 0.125, 1e-3, 'keyframe ramp half-way');

  const auto = createSoundMix();
  auto.master.limiter.enabled = false;
  auto.tracks.a1 = defaultTrackMix({ automation: { volume: [{ time: 1, value: 0 }, { time: 3, value: -6.0206 }] } });
  const a = bounceMix(makeDoc(auto, { tracks: [{ id: 'a1', type: 'audio', isMuted: false }] }), getSource, { sampleRate: SR, start: 0, end: 4 });
  close(at(a.channels[0], 2.999), 0.125, 1e-3, 'automation reached −6 dB');
  auto.tracks.a1.automationMode = 'off';
  const off = bounceMix(makeDoc(auto, { tracks: [{ id: 'a1', type: 'audio', isMuted: false }] }), getSource, { sampleRate: SR, start: 0, end: 4 });
  close(at(off.channels[0], 2.999), 0.25, 1e-6, 'automation off plays the fader');
});

test('mix engine: bus routing, sends and stem bounce sum back to the mix', () => {
  const mix = createSoundMix();
  mix.master.limiter.enabled = false;
  mix.buses = mix.buses.filter((b) => b.kind !== 'aux');
  mix.tracks.a1 = defaultTrackMix({ outputBusId: STEM_BUS_IDS.dialog });
  mix.tracks.a2 = defaultTrackMix({ outputBusId: STEM_BUS_IDS.music });
  mix.buses = mix.buses.map((b) => (b.id === STEM_BUS_IDS.music ? { ...b, gainDb: -6.0206 } : b));
  const full = bounceMix(makeDoc(mix), getSource, { sampleRate: SR, start: 0, end: 4 });
  close(at(full.channels[0], 2), 0.25 + 0.125, 1e-4);
  const ids = ['a1', 'a2'];
  const d = bounceMix(makeDoc(stemMix(mix, STEM_BUS_IDS.dialog, ids)), getSource, { sampleRate: SR, start: 0, end: 4 });
  const m = bounceMix(makeDoc(stemMix(mix, STEM_BUS_IDS.music, ids)), getSource, { sampleRate: SR, start: 0, end: 4 });
  for (const t of [0.5, 1.5, 2.5, 3.5]) {
    close(at(d.channels[0], t) + at(m.channels[0], t), at(full.channels[0], t), 1e-5, `stems sum @${t}`);
  }

  // post-fader send to an aux bus with a plain gain
  const sendMix = createSoundMix();
  sendMix.master.limiter.enabled = false;
  sendMix.buses = sendMix.buses.map((b) => (b.kind === 'aux' ? { ...b, gainDb: 0, inserts: [] } : b));
  sendMix.tracks.a1 = defaultTrackMix({ sends: [{ busId: 'aux-reverb', levelDb: 0, preFader: false, enabled: true }] });
  const s = bounceMix(makeDoc(sendMix, { tracks: [{ id: 'a1', type: 'audio', isMuted: false }] }), getSource, { sampleRate: SR, start: 0, end: 4 });
  close(at(s.channels[0], 2), 0.5, 1e-5, 'direct + send');
});

test('mix engine survives garbage input and missing sources', () => {
  const engine = new MixEngine({ sampleRate: SR, getSource: () => null });
  engine.setDocument({ tracks: [null as never, { id: 'x', type: 'audio', isMuted: false }], clips: [{ id: 'c', mediaId: 'nope', trackId: 'x', start: NaN, end: 2 } as never], media: [], mix: { tracks: 'bad', buses: [{ id: 'b', outputBusId: 'b' }] } });
  const l = new Float32Array(512), r = new Float32Array(512);
  engine.render(0, 512, l, r);
  assert.ok(l.every((x) => x === 0));
  const norm = normalizeSoundMix({ buses: [{ id: 's1', kind: 'sub', outputBusId: 's2' }, { id: 's2', kind: 'sub', outputBusId: 's1' }] });
  assert.ok(norm.buses.some((b) => b.kind === 'main'));
  for (const b of norm.buses) if (b.kind !== 'main') assert.equal(b.outputBusId, norm.buses.find((x) => x.kind === 'main')!.id);
});

test('bounce normalises to the master target', () => {
  const mix = createSoundMix();
  mix.master.targetLufs = -23;
  mix.master.limiter.enabled = false;
  const tone = { sampleRate: SR, channels: [sine(1000, 6, 0.1)] };
  const res = bounceMix(
    { tracks: [{ id: 'a1', type: 'audio', isMuted: false }], clips: [{ id: 'c', mediaId: 't', trackId: 'a1', start: 0, end: 6 }], media: [{ id: 't', type: 'audio' }], mix },
    () => tone,
    { sampleRate: SR, start: 0, end: 6, normalize: true },
  );
  close(res.loudness.integratedLufs, -23, 0.1);
});

test('WAV round trip (24-bit and float)', () => {
  const l = sine(440, 0.1, 0.5);
  const r = sine(880, 0.1, -0.25);
  for (const format of ['pcm24', 'float32', 'pcm16'] as const) {
    const decoded = decodeWav(encodeWav([l, r], SR, format));
    assert.equal(decoded.sampleRate, SR);
    assert.equal(decoded.channels.length, 2);
    const tol = format === 'pcm16' ? 1e-4 : 1e-6;
    for (let i = 0; i < l.length; i += 97) {
      close(decoded.channels[0][i], l[i], tol);
      close(decoded.channels[1][i], r[i], tol);
    }
  }
});
