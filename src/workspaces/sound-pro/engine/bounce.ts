/**
 * Offline bounce: renders a range of the mix with the same engine that plays
 * it live. Used by the renderer (mixdown / stems / loudness analysis) and by
 * the Node export hook (electron/sound/mixdown.js).
 */

import { MIN_DB, normalizeSoundMix, trackMixOf, type SoundMix } from '../model.ts';
import { LoudnessMeter, normalizationGainDb, type LoudnessSummary } from './loudness.ts';
import { MixEngine, type EngineDocument, type EngineSource } from './mixEngine.ts';

export type BounceOptions = {
  sampleRate: number;
  start: number;
  end: number;
  /** Normalise the result to the master target (integrated LUFS, true-peak limited). */
  normalize?: boolean;
  /** Called with 0..1 between blocks; return false to abort. */
  onProgress?: (fraction: number) => boolean | void;
  blockSize?: number;
};

export type BounceResult = {
  channels: [Float32Array, Float32Array];
  sampleRate: number;
  loudness: LoudnessSummary;
  appliedGainDb: number;
  aborted: boolean;
};

const MAX_BOUNCE_SEC = 4 * 60 * 60;

export const bounceMix = (
  doc: EngineDocument,
  getSource: (mediaId: string) => EngineSource | null,
  options: BounceOptions,
): BounceResult => {
  const sampleRate = options.sampleRate > 0 ? Math.round(options.sampleRate) : 48000;
  const start = Math.max(0, Number.isFinite(options.start) ? options.start : 0);
  const end = Math.min(start + MAX_BOUNCE_SEC, Math.max(start, Number.isFinite(options.end) ? options.end : start));
  const startFrame = Math.round(start * sampleRate);
  const frames = Math.max(0, Math.round(end * sampleRate) - startFrame);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  const engine = new MixEngine({ sampleRate, getSource, maxBlock: options.blockSize ?? 4096 });
  engine.setDocument(doc);
  const meter = new LoudnessMeter(sampleRate);
  const block = options.blockSize ?? 4096;
  let aborted = false;
  for (let done = 0; done < frames; done += block) {
    const n = Math.min(block, frames - done);
    const l = left.subarray(done, done + n);
    const r = right.subarray(done, done + n);
    engine.render(startFrame + done, n, l, r);
    meter.push(l, r, n);
    if (options.onProgress && options.onProgress(frames ? (done + n) / frames : 1) === false) {
      aborted = true;
      break;
    }
  }
  let loudness = meter.summary();
  let appliedGainDb = 0;
  if (options.normalize && !aborted) {
    const mix = engine.document;
    const { gainDb } = normalizationGainDb(loudness, mix.master.targetLufs, mix.master.truePeakLimitDb);
    if (Math.abs(gainDb) > 0.01) {
      appliedGainDb = gainDb;
      const g = Math.pow(10, gainDb / 20);
      for (let i = 0; i < frames; i++) {
        left[i] *= g;
        right[i] *= g;
      }
      const after = new LoudnessMeter(sampleRate);
      after.push(left, right, frames);
      loudness = after.summary();
    }
  }
  return { channels: [left, right], sampleRate, loudness, appliedGainDb, aborted };
};

/**
 * Mix variant that only lets one sub/aux bus through (stem export).
 * Tracks routed straight to a main bus are silenced; master limiter stays off
 * so the stems sum back to the mix.
 */
export const stemMix = (raw: SoundMix | unknown, busId: string, trackIds: string[]): SoundMix => {
  const mix = normalizeSoundMix(raw);
  const mainIds = new Set(mix.buses.filter((b) => b.kind === 'main').map((b) => b.id));
  const tracks: SoundMix['tracks'] = {};
  for (const id of new Set([...trackIds, ...Object.keys(mix.tracks)])) {
    const t = trackMixOf(mix, id);
    tracks[id] = mainIds.has(t.outputBusId) ? { ...t, gainDb: MIN_DB, automationMode: 'off', sends: [] } : t;
  }
  return {
    ...mix,
    tracks,
    buses: mix.buses.map((b) => ({ ...b, solo: b.id === busId, mute: b.kind === 'main' ? false : b.mute })),
    master: { ...mix.master, limiter: { ...mix.master.limiter, enabled: false } },
  };
};
