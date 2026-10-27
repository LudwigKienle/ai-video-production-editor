/**
 * Plays the start sound in the renderer (Web Audio). The samples are
 * synthesised in a Web Worker so the splash is not blocked; without workers it
 * falls back to the main thread. Never throws: when audio is blocked it stays
 * silent and resolves with `played: false`.
 */
import { splitChannels, synthStartSound } from './startSound.ts';

type AudioCtxCtor = new (options?: { latencyHint?: string }) => AudioContext;

const pending = new Map<number, Promise<Float32Array>>();

/** Samples for a sample rate (worker first, main-thread fallback). Cached per rate. */
export function prepareStartSound(sampleRate: number): Promise<Float32Array> {
  const existing = pending.get(sampleRate);
  if (existing) return existing;
  const job = new Promise<Float32Array>((resolve) => {
    const fallback = () => resolve(synthStartSound(sampleRate));
    try {
      if (typeof Worker === 'undefined') { fallback(); return; }
      const worker = new Worker(new URL('./startSound.worker.ts', import.meta.url), { type: 'module' });
      const timer = setTimeout(() => { worker.terminate(); fallback(); }, 3000);
      worker.onmessage = (event: MessageEvent<{ samples: Float32Array }>) => { clearTimeout(timer); worker.terminate(); resolve(event.data.samples); };
      worker.onerror = () => { clearTimeout(timer); worker.terminate(); fallback(); };
      worker.postMessage({ sampleRate });
    } catch {
      fallback();
    }
  });
  pending.set(sampleRate, job);
  return job;
}

export type StartSoundHandle = { played: boolean; reason?: string; stop: () => void };

type WarmAudio = { ctx: AudioContext; samples: Promise<Float32Array> };
let warm: WarmAudio | null = null;

/**
 * Call as soon as it is clear the start sound will play (before the first
 * animation frame): opens the audio context and synthesises the samples, so
 * playback can start on the animation's first frame instead of joining late.
 */
export function warmStartSound(): void {
  if (warm) return;
  try {
    const g = globalThis as unknown as { AudioContext?: AudioCtxCtor; webkitAudioContext?: AudioCtxCtor };
    const Ctor = g.AudioContext ?? g.webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor({ latencyHint: 'interactive' });
    warm = { ctx, samples: prepareStartSound(ctx.sampleRate) };
  } catch {
    warm = null;
  }
}

const SILENT = (reason: string): StartSoundHandle => ({ played: false, reason, stop: () => undefined });

/**
 * Plays the sound once.
 * @param startedAt performance.now() of the animation start: if the samples are
 *   ready late, playback joins in at the right offset (in sync with the picture).
 */
export async function playStartSound(options: { volume?: number; startedAt?: number } = {}): Promise<StartSoundHandle> {
  try {
    const g = globalThis as unknown as { AudioContext?: AudioCtxCtor; webkitAudioContext?: AudioCtxCtor };
    const Ctor = g.AudioContext ?? g.webkitAudioContext;
    if (!Ctor) return SILENT('no Web Audio');
    const ctx = warm?.ctx ?? new Ctor({ latencyHint: 'interactive' });
    warm = null;
    if (ctx.state === 'suspended') {
      await Promise.race([ctx.resume().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 250))]);
    }
    if (ctx.state !== 'running') {
      void ctx.close().catch(() => undefined);
      return SILENT('audio blocked');
    }
    const samples = await prepareStartSound(ctx.sampleRate);
    const [l, r] = splitChannels(samples);
    const buffer = ctx.createBuffer(2, l.length, ctx.sampleRate);
    buffer.getChannelData(0).set(l);
    buffer.getChannelData(1).set(r);
    const offset = options.startedAt !== undefined ? Math.max(0, (performance.now() - options.startedAt) / 1000) : 0;
    if (offset > 1.0) { void ctx.close().catch(() => undefined); return SILENT('too late to sync'); }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    const volume = Math.max(0, Math.min(1, options.volume ?? 0.6));
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(offset > 0 ? 0 : volume, now);
    if (offset > 0) gain.gain.linearRampToValueAtTime(volume, now + 0.012);
    source.connect(gain).connect(ctx.destination);
    source.onended = () => { void ctx.close().catch(() => undefined); };
    source.start(now, offset);
    return {
      played: true,
      stop: () => {
        try {
          gain.gain.setTargetAtTime(0, ctx.currentTime, 0.04);
          source.stop(ctx.currentTime + 0.25);
        } catch { /* already stopped */ }
      },
    };
  } catch (error) {
    return SILENT(error instanceof Error ? error.message : String(error));
  }
}
