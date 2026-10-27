/**
 * Live playback for the Sound workspace: runs the mix engine on the audio
 * thread callback and follows the app transport (isPlaying + playhead).
 *
 * The app advances the playhead by wall clock; the engine renders from its
 * own sample counter and re-locates when the playhead jumps (seek, locate).
 * Meters and live loudness are published ~20× per second.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MediaItem } from '../../types';
import { MixEngine, type EngineDocument } from './engine/mixEngine.ts';
import { LoudnessMeter } from './engine/loudness.ts';
import { ENGINE_SAMPLE_RATE, sourceCache } from './engine/runtime.ts';
import { MIN_DB } from './model.ts';

export type MeterReading = { peakDb: [number, number]; rmsDb: [number, number]; reductionDb: number };
export type LiveMeters = {
  tracks: Record<string, MeterReading>;
  buses: Record<string, MeterReading>;
  master: MeterReading;
  momentaryLufs: number;
  shortTermLufs: number;
  integratedLufs: number;
  rangeLu: number;
  truePeakDb: number;
};

const SILENT: MeterReading = { peakDb: [MIN_DB, MIN_DB], rmsDb: [MIN_DB, MIN_DB], reductionDb: 0 };
export const SILENT_METERS: LiveMeters = {
  tracks: {}, buses: {}, master: SILENT,
  momentaryLufs: -Infinity, shortTermLufs: -Infinity, integratedLufs: -Infinity, rangeLu: 0, truePeakDb: -Infinity,
};

const BLOCK = 2048;

type Args = {
  doc: EngineDocument;
  media: MediaItem[];
  isPlaying: boolean;
  playhead: number;
  /** Master monitor level (does not change the mix). */
  monitorDb?: number;
};

export function useSoundPlayback({ doc, media, isPlaying, playhead, monitorDb = 0 }: Args) {
  const engineRef = useRef<MixEngine | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<ScriptProcessorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const loudRef = useRef<LoudnessMeter | null>(null);
  const posRef = useRef(0);
  const playingRef = useRef(false);
  const stoppedRef = useRef(true);
  const [meters, setMeters] = useState<LiveMeters>(SILENT_METERS);
  const [loading, setLoading] = useState<{ pending: boolean; missing: string[] }>({ pending: false, missing: [] });
  const [audioError, setAudioError] = useState<string | null>(null);

  if (!engineRef.current) engineRef.current = new MixEngine({ sampleRate: ENGINE_SAMPLE_RATE, getSource: (id) => sourceCache.get(id), maxBlock: BLOCK });
  if (!loudRef.current) loudRef.current = new LoudnessMeter(ENGINE_SAMPLE_RATE);

  // document → engine (cheap; processor state survives)
  useEffect(() => {
    engineRef.current?.setDocument(doc);
  }, [doc]);

  // decode the media the timeline uses
  const usedMedia = useMemo(() => {
    const used = new Set(doc.clips.map((c) => c.mediaId));
    return media.filter((m) => used.has(m.id) && (m.type === 'audio' || m.type === 'video'));
  }, [doc.clips, media]);
  useEffect(() => {
    let alive = true;
    setLoading((prev) => ({ ...prev, pending: true }));
    sourceCache.ensure(usedMedia).then(({ missing }) => {
      if (!alive) return;
      setLoading({ pending: false, missing });
      engineRef.current?.setDocument(doc); // retry clips whose source was not decoded yet
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usedMedia]);

  const ensureContext = () => {
    if (ctxRef.current) return ctxRef.current;
    const Ctx = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) {
      setAudioError('Web Audio ist in dieser Umgebung nicht verfügbar.');
      return null;
    }
    const ctx = new Ctx({ sampleRate: ENGINE_SAMPLE_RATE, latencyHint: 'playback' });
    const node = ctx.createScriptProcessor(BLOCK, 0, 2);
    const gain = ctx.createGain();
    node.onaudioprocess = (event) => {
      const out = event.outputBuffer;
      const L = out.getChannelData(0);
      const R = out.getChannelData(1);
      if (!playingRef.current || !engineRef.current) {
        L.fill(0);
        R.fill(0);
        return;
      }
      try {
        engineRef.current.render(posRef.current, L.length, L, R);
        loudRef.current?.push(L, R, L.length);
      } catch {
        L.fill(0);
        R.fill(0);
      }
      posRef.current += L.length;
    };
    node.connect(gain);
    gain.connect(ctx.destination);
    ctxRef.current = ctx;
    nodeRef.current = node;
    gainRef.current = gain;
    return ctx;
  };

  // transport follow
  useEffect(() => {
    if (isPlaying) {
      const ctx = ensureContext();
      if (!ctx) return;
      void ctx.resume();
      posRef.current = Math.round(playhead * ENGINE_SAMPLE_RATE);
      engineRef.current?.resetState();
      loudRef.current?.reset();
      playingRef.current = true;
    } else {
      playingRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  // locate when the playhead jumps away from the engine position
  useEffect(() => {
    if (!playingRef.current) return;
    const enginePos = posRef.current / ENGINE_SAMPLE_RATE;
    if (Math.abs(enginePos - playhead) > 0.25) {
      posRef.current = Math.round(playhead * ENGINE_SAMPLE_RATE);
      engineRef.current?.resetState();
    }
  }, [playhead]);

  useEffect(() => {
    if (gainRef.current) gainRef.current.gain.value = Math.pow(10, monitorDb / 20);
  }, [monitorDb]);

  // meter publishing
  useEffect(() => {
    const id = window.setInterval(() => {
      const engine = engineRef.current;
      if (!engine) return;
      if (!playingRef.current) {
        // publish the stopped state once, then stay idle (no re-render while stopped)
        if (!stoppedRef.current) {
          stoppedRef.current = true;
          setMeters((prev) => ({ ...SILENT_METERS, integratedLufs: prev.integratedLufs, rangeLu: prev.rangeLu, truePeakDb: prev.truePeakDb }));
        }
        return;
      }
      stoppedRef.current = false;
      const read = (m: Parameters<typeof MixEngine.readMeter>[0]) => MixEngine.readMeter(m);
      const loud = loudRef.current!;
      setMeters({
        tracks: Object.fromEntries(Object.entries(engine.meters.tracks).map(([k, m]) => [k, read(m)])),
        buses: Object.fromEntries(Object.entries(engine.meters.buses).map(([k, m]) => [k, read(m)])),
        master: read(engine.meters.master),
        momentaryLufs: loud.momentaryLufs(),
        shortTermLufs: loud.shortTermLufs(),
        integratedLufs: loud.integratedLufs(),
        rangeLu: loud.rangeLu(),
        truePeakDb: loud.truePeakDb(),
      });
    }, 50);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => () => {
    playingRef.current = false;
    nodeRef.current?.disconnect();
    gainRef.current?.disconnect();
    void ctxRef.current?.close();
  }, []);

  return { meters, loading, audioError };
}
