/**
 * Block-based mix engine: timeline clips → tracks → busses → master.
 *
 * One engine for every path: the AudioWorklet renders 128-frame blocks live,
 * the renderer bounces offline, and Node renders the export mixdown. Sources
 * must already be decoded at the engine sample rate.
 *
 * Signal flow per track (Fairlight/console order):
 *   clips (clip gain = clip.volume / volume keyframes, fades) → sum
 *   → phase → inserts → [pre-fader sends] → fader (+ volume automation)
 *   → mute → pan → [post-fader sends] → output bus
 * Busses are processed after all tracks in dependency order (sub/aux before
 * main), main feeds the master: gain → limiter → output.
 */

import { evaluateAutomation, isAutomationPlaying } from '../automation.ts';
import {
  clamp,
  dbToGain,
  fadeShape,
  MIN_DB,
  normalizeSoundMix,
  type BusMix,
  type SoundMix,
  type TrackMix,
  defaultClipMix,
  defaultTrackMix,
} from '../model.ts';
import { InsertChain, LimiterProcessor, panGains } from './dsp.ts';

export type EngineTrack = { id: string; type: 'video' | 'audio'; isMuted: boolean; isSolo?: boolean };
export type EngineKeyframe = { time: number; value: number; property: string; easing?: string };
export type EngineClip = {
  id: string;
  mediaId: string;
  trackId: string;
  start: number;
  end: number;
  duration?: number;
  speed?: number;
  sourceIn?: number;
  sourceOut?: number;
  volume?: number;
  keyframes?: EngineKeyframe[];
};
export type EngineMedia = { id: string; type: string };
/** Decoded audio at the engine rate. `offsetSec` = source time of the first sample (partial decodes). */
export type EngineSource = { channels: Float32Array[]; sampleRate: number; offsetSec?: number };

export type EngineDocument = {
  tracks: EngineTrack[];
  clips: EngineClip[];
  media: EngineMedia[];
  mix: SoundMix | unknown;
};

export type ChannelMeter = { peakL: number; peakR: number; sumSqL: number; sumSqR: number; frames: number; reductionDb: number };
export type MeterSnapshot = { tracks: Record<string, ChannelMeter>; buses: Record<string, ChannelMeter>; master: ChannelMeter };

const emptyMeter = (): ChannelMeter => ({ peakL: 0, peakR: 0, sumSqL: 0, sumSqR: 0, frames: 0, reductionDb: 0 });

const meterBlock = (m: ChannelMeter, l: Float32Array, r: Float32Array, frames: number): void => {
  let pl = m.peakL, pr = m.peakR, sl = 0, sr = 0;
  for (let i = 0; i < frames; i++) {
    const a = l[i], b = r[i];
    const aa = a < 0 ? -a : a;
    const bb = b < 0 ? -b : b;
    if (aa > pl) pl = aa;
    if (bb > pr) pr = bb;
    sl += a * a;
    sr += b * b;
  }
  m.peakL = pl;
  m.peakR = pr;
  m.sumSqL += sl;
  m.sumSqR += sr;
  m.frames += frames;
};

/* ─── keyframes (same semantics as the editor preview) ─── */

const ease = (easing: string | undefined, t: number): number => {
  if (easing === 'ease-in') return t * t;
  if (easing === 'ease-out') return t * (2 - t);
  if (easing === 'ease-in-out') return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  return t;
};

/** Mirrors the preview: when volume keyframes exist they define the clip gain, otherwise `clip.volume`. */
export const clipGainAt = (keys: EngineKeyframe[], fallback: number, keyTime: number): number => {
  if (keys.length === 0) return fallback;
  if (keyTime <= keys[0].time) return keys[0].value;
  const last = keys[keys.length - 1];
  if (keyTime >= last.time) return last.value;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (keyTime >= a.time && keyTime < b.time) {
      const span = b.time - a.time;
      return span > 0 ? a.value + (b.value - a.value) * ease(b.easing, (keyTime - a.time) / span) : b.value;
    }
  }
  return fallback;
};

/** Fade multiplier for a clip at local timeline time `local` (0 = clip start). */
export const clipFadeAt = (local: number, length: number, fadeIn: { duration: number; curve: Parameters<typeof fadeShape>[0] }, fadeOut: { duration: number; curve: Parameters<typeof fadeShape>[0] }): number => {
  let g = 1;
  if (fadeIn.duration > 0 && local < fadeIn.duration) g *= fadeShape(fadeIn.curve, local / fadeIn.duration);
  const remain = length - local;
  if (fadeOut.duration > 0 && remain < fadeOut.duration) g *= fadeShape(fadeOut.curve, remain / fadeOut.duration);
  return g;
};

/* ─── compiled document ─── */

type CompiledClip = {
  id: string;
  source: EngineSource | null;
  mediaId: string;
  start: number;
  end: number;
  speed: number;
  sourceIn: number;
  sourceOut: number;
  volume: number;
  volumeKeys: EngineKeyframe[];
  fadeIn: { duration: number; curve: Parameters<typeof fadeShape>[0] };
  fadeOut: { duration: number; curve: Parameters<typeof fadeShape>[0] };
};

type CompiledTrack = {
  id: string;
  mix: TrackMix;
  audible: boolean;
  clips: CompiledClip[];
  chain: InsertChain;
  bufL: Float32Array;
  bufR: Float32Array;
  outBus: string;
};

type CompiledBus = {
  bus: BusMix;
  chain: InsertChain;
  bufL: Float32Array;
  bufR: Float32Array;
  outBus: string | null;
  audible: boolean;
};

export type MixEngineOptions = {
  sampleRate: number;
  /** Returns the decoded source for a media id, or null when it is not (yet) available. */
  getSource: (mediaId: string) => EngineSource | null;
  maxBlock?: number;
};

export class MixEngine {
  readonly sampleRate: number;
  private getSource: MixEngineOptions['getSource'];
  private maxBlock: number;
  private tracks: CompiledTrack[] = [];
  private buses: CompiledBus[] = [];
  private busById = new Map<string, CompiledBus>();
  private trackChains = new Map<string, InsertChain>();
  private busChains = new Map<string, InsertChain>();
  private mix: SoundMix = normalizeSoundMix(null);
  private masterLimiter: LimiterProcessor;
  private scratchL: Float32Array;
  private scratchR: Float32Array;
  private gainBuf: Float32Array;
  meters: MeterSnapshot = { tracks: {}, buses: {}, master: emptyMeter() };

  constructor(options: MixEngineOptions) {
    this.sampleRate = options.sampleRate > 0 ? options.sampleRate : 48000;
    this.getSource = options.getSource;
    this.maxBlock = Math.max(128, options.maxBlock ?? 4096);
    this.scratchL = new Float32Array(this.maxBlock);
    this.scratchR = new Float32Array(this.maxBlock);
    this.gainBuf = new Float32Array(this.maxBlock);
    this.masterLimiter = new LimiterProcessor(this.sampleRate, { kind: 'limiter', params: { ceilingDb: -1, releaseMs: 50 } });
  }

  /** (Re)compiles routing; processor state survives for inserts that keep their id. */
  setDocument(doc: EngineDocument): void {
    const mix = normalizeSoundMix(doc.mix);
    this.mix = mix;
    const mediaType = new Map((doc.media || []).map((m) => [m.id, m.type]));
    const tracks = (doc.tracks || []).filter((t) => t && typeof t.id === 'string');
    const hasSoloAudio = tracks.some((t) => t.type === 'audio' && t.isSolo);
    const hasSoloVideo = tracks.some((t) => t.type === 'video' && t.isSolo);
    const mainId = mix.buses.find((b) => b.kind === 'main')!.id;

    const keepTrackChains = new Map<string, InsertChain>();
    this.tracks = tracks.map((track) => {
      const tm = mix.tracks[track.id] ?? defaultTrackMix();
      const chain = this.trackChains.get(track.id) ?? new InsertChain(this.sampleRate);
      chain.update(tm.inserts);
      keepTrackChains.set(track.id, chain);
      const soloOk = track.type === 'audio' ? (hasSoloAudio ? Boolean(track.isSolo) : true) : hasSoloVideo ? Boolean(track.isSolo) : true;
      const clips = (doc.clips || [])
        .filter((c) => c && c.trackId === track.id && (mediaType.get(c.mediaId) === 'audio' || mediaType.get(c.mediaId) === 'video'))
        .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start)
        .map<CompiledClip>((c) => {
          const speed = Math.max(0.05, Number.isFinite(c.speed) && (c.speed as number) > 0 ? (c.speed as number) : 1);
          const sourceIn = Math.max(0, Number.isFinite(c.sourceIn) ? (c.sourceIn as number) : 0);
          const dur = Number.isFinite(c.duration) && (c.duration as number) > 0 ? (c.duration as number) : (c.end - c.start) * speed;
          const sourceOut = Number.isFinite(c.sourceOut) && (c.sourceOut as number) > sourceIn ? (c.sourceOut as number) : sourceIn + dur;
          const cm = mix.clips[c.id] ?? defaultClipMix();
          const length = c.end - c.start;
          // fades never overlap each other inside one clip
          const fin = Math.min(cm.fadeIn.duration, length);
          const fout = Math.min(cm.fadeOut.duration, Math.max(0, length - fin));
          return {
            id: c.id,
            mediaId: c.mediaId,
            source: null,
            start: c.start,
            end: c.end,
            speed,
            sourceIn,
            sourceOut,
            volume: Number.isFinite(c.volume) ? Math.max(0, c.volume as number) : 1,
            volumeKeys: (c.keyframes || [])
              .filter((k) => k && k.property === 'volume' && Number.isFinite(k.time) && Number.isFinite(k.value))
              .sort((a, b) => a.time - b.time),
            fadeIn: { duration: fin, curve: cm.fadeIn.curve },
            fadeOut: { duration: fout, curve: cm.fadeOut.curve },
          };
        })
        .sort((a, b) => a.start - b.start);
      return {
        id: track.id,
        mix: tm,
        audible: !track.isMuted && soloOk,
        clips,
        chain,
        bufL: new Float32Array(this.maxBlock),
        bufR: new Float32Array(this.maxBlock),
        outBus: mix.buses.some((b) => b.id === tm.outputBusId) ? tm.outputBusId : mainId,
      };
    });
    this.trackChains = keepTrackChains;

    const anyBusSolo = mix.buses.some((b) => b.kind !== 'main' && b.solo);
    const keepBusChains = new Map<string, InsertChain>();
    const compiled = mix.buses.map<CompiledBus>((bus) => {
      const chain = this.busChains.get(bus.id) ?? new InsertChain(this.sampleRate);
      chain.update(bus.inserts);
      keepBusChains.set(bus.id, chain);
      return {
        bus,
        chain,
        bufL: new Float32Array(this.maxBlock),
        bufR: new Float32Array(this.maxBlock),
        outBus: bus.kind === 'main' ? null : bus.outputBusId ?? mainId,
        audible: !bus.mute && (bus.kind === 'main' || !anyBusSolo || bus.solo),
      };
    });
    this.busChains = keepBusChains;
    // dependency order: deepest feeders first, main busses last
    const depth = (bus: CompiledBus): number => {
      let d = 0;
      let cur: CompiledBus | undefined = bus;
      const seen = new Set<string>();
      while (cur && cur.outBus && !seen.has(cur.bus.id) && d < 64) {
        seen.add(cur.bus.id);
        cur = compiled.find((b) => b.bus.id === cur!.outBus);
        d++;
      }
      return d;
    };
    this.buses = compiled.sort((a, b) => depth(b) - depth(a));
    this.busById = new Map(this.buses.map((b) => [b.bus.id, b]));
    this.masterLimiter.update({ id: 'master-limiter', kind: 'limiter', bypass: false, params: { ceilingDb: mix.master.limiter.ceilingDb, releaseMs: 50 } });
    this.resetMeters();
  }

  get document(): SoundMix {
    return this.mix;
  }

  /** Clears filter / dynamics / delay memory (after a seek). */
  resetState(): void {
    for (const t of this.tracks) t.chain.reset();
    for (const b of this.buses) b.chain.reset();
    this.masterLimiter.reset();
  }

  resetMeters(): void {
    this.meters = { tracks: {}, buses: {}, master: emptyMeter() };
    for (const t of this.tracks) this.meters.tracks[t.id] = emptyMeter();
    for (const b of this.buses) this.meters.buses[b.bus.id] = emptyMeter();
  }

  /** Total timeline length covered by audible clips, seconds. */
  contentEnd(): number {
    let end = 0;
    for (const t of this.tracks) for (const c of t.clips) end = Math.max(end, c.end);
    return end;
  }

  /**
   * Renders `frames` frames starting at timeline frame `startFrame` into
   * `outL`/`outR` (overwritten). Frames beyond `maxBlock` are rendered in chunks.
   */
  render(startFrame: number, frames: number, outL: Float32Array, outR: Float32Array): void {
    let done = 0;
    while (done < frames) {
      const n = Math.min(this.maxBlock, frames - done);
      this.renderBlock(startFrame + done, n, outL.subarray(done, done + n), outR.subarray(done, done + n));
      done += n;
    }
  }

  private renderBlock(startFrame: number, n: number, outL: Float32Array, outR: Float32Array): void {
    const sr = this.sampleRate;
    const t0 = startFrame / sr;
    const t1 = (startFrame + n) / sr;
    const tMid = (t0 + t1) / 2;
    for (const b of this.buses) {
      b.bufL.fill(0, 0, n);
      b.bufR.fill(0, 0, n);
    }

    for (const track of this.tracks) {
      const L = track.bufL, R = track.bufR;
      L.fill(0, 0, n);
      R.fill(0, 0, n);
      let hasSignal = false;
      for (const clip of track.clips) {
        if (clip.end <= t0 || clip.start >= t1) continue;
        if (this.mixClip(clip, startFrame, n, L, R)) hasSignal = true;
      }
      const meter = (this.meters.tracks[track.id] ??= emptyMeter());
      if (!hasSignal && track.mix.inserts.length === 0) {
        meterBlock(meter, L, R, n);
        continue;
      }
      const tm = track.mix;
      if (tm.phaseInvert) for (let i = 0; i < n; i++) { L[i] = -L[i]; R[i] = -R[i]; }
      track.chain.process(L, R, n);
      meter.reductionDb = track.chain.reductionDb();

      const auto = isAutomationPlaying(tm.automationMode) ? tm.automation : {};
      const mutedByAuto = evaluateAutomation(auto.mute, tMid, 0) >= 0.5;
      const audible = track.audible && !mutedByAuto;

      // pre-fader sends
      for (const send of tm.sends) {
        if (!send.enabled || !send.preFader || !audible) continue;
        const bus = this.busById.get(send.busId);
        if (!bus) continue;
        const g = dbToGain(evaluateAutomation(auto[`send:${send.busId}`], tMid, send.levelDb));
        for (let i = 0; i < n; i++) { bus.bufL[i] += L[i] * g; bus.bufR[i] += R[i] * g; }
      }

      // fader with per-sample volume automation (dB, linearly interpolated)
      const volPts = auto.volume;
      const gains = this.gainBuf;
      if (volPts && volPts.length) {
        for (let i = 0; i < n; i++) gains[i] = dbToGain(evaluateAutomation(volPts, (startFrame + i) / sr, tm.gainDb));
      } else {
        gains.fill(dbToGain(tm.gainDb), 0, n);
      }
      const [pl, pr] = panGains(evaluateAutomation(auto.pan, tMid, tm.pan));
      if (!audible) {
        L.fill(0, 0, n);
        R.fill(0, 0, n);
      } else {
        for (let i = 0; i < n; i++) { L[i] *= gains[i] * pl; R[i] *= gains[i] * pr; }
      }
      meterBlock(meter, L, R, n);
      if (!audible) continue;

      const out = this.busById.get(track.outBus);
      if (out) for (let i = 0; i < n; i++) { out.bufL[i] += L[i]; out.bufR[i] += R[i]; }
      for (const send of tm.sends) {
        if (!send.enabled || send.preFader) continue;
        const bus = this.busById.get(send.busId);
        if (!bus) continue;
        const g = dbToGain(evaluateAutomation(auto[`send:${send.busId}`], tMid, send.levelDb));
        for (let i = 0; i < n; i++) { bus.bufL[i] += L[i] * g; bus.bufR[i] += R[i] * g; }
      }
    }

    outL.fill(0, 0, n);
    outR.fill(0, 0, n);
    for (const b of this.buses) {
      const L = b.bufL, R = b.bufR;
      b.chain.process(L, R, n);
      const g = b.audible ? dbToGain(b.bus.gainDb) : 0;
      const [pl, pr] = panGains(b.bus.pan);
      for (let i = 0; i < n; i++) { L[i] *= g * pl; R[i] *= g * pr; }
      const meter = (this.meters.buses[b.bus.id] ??= emptyMeter());
      meterBlock(meter, L, R, n);
      meter.reductionDb = b.chain.reductionDb();
      const target = b.outBus ? this.busById.get(b.outBus) : null;
      const dstL = target ? target.bufL : outL;
      const dstR = target ? target.bufR : outR;
      for (let i = 0; i < n; i++) { dstL[i] += L[i]; dstR[i] += R[i]; }
    }

    const master = dbToGain(this.mix.master.gainDb);
    for (let i = 0; i < n; i++) {
      const l = outL[i] * master, r = outR[i] * master;
      outL[i] = Number.isFinite(l) ? l : 0;
      outR[i] = Number.isFinite(r) ? r : 0;
    }
    if (this.mix.master.limiter.enabled) {
      this.masterLimiter.process(outL, outR, n);
      this.meters.master.reductionDb = this.masterLimiter.reductionDb;
    }
    meterBlock(this.meters.master, outL, outR, n);
  }

  /** Adds one clip's contribution to the track buffers; returns false when its source is not available. */
  private mixClip(clip: CompiledClip, startFrame: number, n: number, L: Float32Array, R: Float32Array): boolean {
    const source = (clip.source ??= this.getSource(clip.mediaId));
    if (!source || !source.channels.length) {
      clip.source = null; // retry on the next block (decode may still be running)
      return false;
    }
    const sr = this.sampleRate;
    const chL = source.channels[0];
    const chR = source.channels.length > 1 ? source.channels[1] : chL;
    const len = chL.length;
    const length = clip.end - clip.start;
    const outEnd = clip.sourceOut;
    const offset = source.offsetSec ?? 0;
    for (let i = 0; i < n; i++) {
      const t = (startFrame + i) / sr;
      if (t < clip.start || t >= clip.end) continue;
      const local = t - clip.start;
      const srcTime = clip.sourceIn + local * clip.speed;
      if (srcTime >= outEnd) continue;
      const pos = (srcTime - offset) * sr;
      const idx = Math.floor(pos);
      if (idx < 0 || idx >= len) continue;
      const frac = pos - idx;
      const nxt = idx + 1 < len ? idx + 1 : idx;
      const xl = chL[idx] + (chL[nxt] - chL[idx]) * frac;
      const xr = chR[idx] + (chR[nxt] - chR[idx]) * frac;
      const vol = clip.volumeKeys.length ? clipGainAt(clip.volumeKeys, clip.volume, local * clip.speed) : clip.volume;
      const g = vol * clipFadeAt(local, length, clip.fadeIn, clip.fadeOut);
      L[i] += xl * g;
      R[i] += xr * g;
    }
    return true;
  }

  /** Converts a meter to dBFS peak / RMS per side and clears it for the next read. */
  static readMeter(m: ChannelMeter | undefined): { peakDb: [number, number]; rmsDb: [number, number]; reductionDb: number } {
    if (!m || m.frames === 0) return { peakDb: [MIN_DB, MIN_DB], rmsDb: [MIN_DB, MIN_DB], reductionDb: 0 };
    const toDb = (x: number) => (x > 1e-9 ? clamp(20 * Math.log10(x), MIN_DB, 24) : MIN_DB);
    const out = {
      peakDb: [toDb(m.peakL), toDb(m.peakR)] as [number, number],
      rmsDb: [toDb(Math.sqrt(m.sumSqL / m.frames)), toDb(Math.sqrt(m.sumSqR / m.frames))] as [number, number],
      reductionDb: m.reductionDb,
    };
    m.peakL = m.peakR = m.sumSqL = m.sumSqR = 0;
    m.frames = 0;
    return out;
  }
}
