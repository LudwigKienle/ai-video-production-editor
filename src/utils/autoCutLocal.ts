/**
 * Local, offline cut detection for the Auto Cut panel.
 *
 * Borrows the ideas that make auto-editor and PySceneDetect reliable:
 * - Silence: loudness per window, an adaptive threshold from the clip's own
 *   noise floor, hysteresis so speech doesn't flicker, margins around speech,
 *   and minimum cut / minimum clip rules to keep the edit calm.
 * - Scenes: HSV-ish frame difference against a rolling average (adaptive
 *   detector) so camera moves don't register as cuts, plus a minimum scene length.
 * - Filler words: word-level timings from the transcript, removed with padding.
 */

export type SilenceOptions = {
  /** Window size in seconds for loudness analysis. */
  windowSeconds?: number;
  /** dB above the estimated noise floor that counts as speech. */
  thresholdAboveFloorDb?: number;
  /** Extra dB drop before speech is considered ended (hysteresis). */
  hysteresisDb?: number;
  /** Seconds kept before/after every loud region. */
  marginSeconds?: number;
  /** Silences shorter than this are kept (auto-editor's --minclip counterpart for gaps). */
  minCutSeconds?: number;
  /** Loud regions shorter than this are dropped. */
  minClipSeconds?: number;
};

export type SceneOptions = {
  /** Frames per second to sample. */
  sampleFps?: number;
  /** Minimum scene length in seconds. */
  minSceneSeconds?: number;
  /** Difference (0-100) above the rolling average that triggers a cut. */
  adaptiveThreshold?: number;
  /** Window (in samples) for the rolling average. */
  windowSize?: number;
  /** Optional hard threshold like PySceneDetect's ContentDetector. */
  contentThreshold?: number;
};

export type LocalSegment = {
  start: number;
  end: number;
  kind: 'speech' | 'scene' | 'clean';
  score: number;
  reason: string;
};

export type LocalAnalysis = {
  duration: number;
  segments: LocalSegment[];
  removedSeconds: number;
  notes: string[];
};

const DEFAULT_SILENCE: Required<SilenceOptions> = {
  windowSeconds: 0.02,
  thresholdAboveFloorDb: 12,
  hysteresisDb: 4,
  marginSeconds: 0.2,
  minCutSeconds: 0.35,
  minClipSeconds: 0.25,
};

const DEFAULT_SCENE: Required<SceneOptions> = {
  sampleFps: 4,
  minSceneSeconds: 1.0,
  adaptiveThreshold: 3,
  windowSize: 6,
  contentThreshold: 27,
};

export const DEFAULT_FILLER_WORDS = ['um', 'uh', 'uhm', 'erm', 'hmm', 'ah', 'like', 'you know', 'sort of', 'kind of', 'äh', 'ähm', 'öhm', 'also', 'halt', 'quasi'];

const toDb = (rms: number) => 20 * Math.log10(Math.max(rms, 1e-8));

const percentile = (values: number[], p: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[index];
};

const decodeAudio = async (source: string | Blob) => {
  const AudioContextCtor = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
  const context = new AudioContextCtor();
  try {
    const buffer = source instanceof Blob ? await source.arrayBuffer() : await (await fetch(source)).arrayBuffer();
    const decoded = await context.decodeAudioData(buffer.slice(0));
    return decoded;
  } finally {
    void context.close();
  }
};

/** Loudness envelope in dB per window. */
export const computeLoudnessEnvelope = (buffer: AudioBuffer, windowSeconds: number) => {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const windowSize = Math.max(64, Math.round(buffer.sampleRate * windowSeconds));
  const windows = Math.ceil(buffer.length / windowSize);
  const envelope = new Float32Array(windows);
  for (let w = 0; w < windows; w += 1) {
    const start = w * windowSize;
    const end = Math.min(buffer.length, start + windowSize);
    let sum = 0;
    let count = 0;
    for (const channel of channels) {
      for (let i = start; i < end; i += 1) {
        const v = channel[i];
        sum += v * v;
        count += 1;
      }
    }
    envelope[w] = toDb(Math.sqrt(sum / Math.max(1, count)));
  }
  return { envelope, windowSeconds: windowSize / buffer.sampleRate };
};

const mergeRegions = (regions: Array<[number, number]>, gap: number) => {
  const sorted = regions.slice().sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  sorted.forEach(([start, end]) => {
    const last = merged[merged.length - 1];
    if (last && start - last[1] <= gap) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  });
  return merged;
};

/**
 * Finds speech/loud regions and returns them as keep-segments.
 */
export const detectSpeechSegments = async (source: string | Blob, options: SilenceOptions = {}): Promise<LocalAnalysis> => {
  const opts = { ...DEFAULT_SILENCE, ...options };
  const buffer = await decodeAudio(source);
  const { envelope, windowSeconds } = computeLoudnessEnvelope(buffer, opts.windowSeconds);
  const values = Array.from(envelope).filter((v) => Number.isFinite(v));
  const floor = percentile(values, 0.1);
  const peak = percentile(values, 0.98);
  const dynamicRange = peak - floor;
  // If the clip is very flat (music bed, room tone), be more conservative.
  const above = dynamicRange < 12 ? Math.max(4, dynamicRange * 0.5) : opts.thresholdAboveFloorDb;
  const onThreshold = floor + above;
  const offThreshold = onThreshold - opts.hysteresisDb;

  const regions: Array<[number, number]> = [];
  let inSpeech = false;
  let regionStart = 0;
  for (let i = 0; i < envelope.length; i += 1) {
    const t = i * windowSeconds;
    const level = envelope[i];
    if (!inSpeech && level >= onThreshold) {
      inSpeech = true;
      regionStart = t;
    } else if (inSpeech && level < offThreshold) {
      inSpeech = false;
      regions.push([regionStart, t]);
    }
  }
  if (inSpeech) regions.push([regionStart, buffer.duration]);

  // Margin, then merge regions whose gap is shorter than the minimum cut.
  const padded = regions.map(([s, e]) => [Math.max(0, s - opts.marginSeconds), Math.min(buffer.duration, e + opts.marginSeconds)] as [number, number]);
  const merged = mergeRegions(padded, opts.minCutSeconds).filter(([s, e]) => e - s >= opts.minClipSeconds);

  const segments: LocalSegment[] = merged.map(([start, end], index) => {
    const startWindow = Math.floor(start / windowSeconds);
    const endWindow = Math.min(envelope.length, Math.ceil(end / windowSeconds));
    let loud = 0;
    for (let i = startWindow; i < endWindow; i += 1) if (envelope[i] >= onThreshold) loud += 1;
    const density = endWindow > startWindow ? loud / (endWindow - startWindow) : 0;
    return {
      start,
      end,
      kind: 'speech',
      score: Math.round(55 + density * 45),
      reason: `Speech ${index + 1}: ${(end - start).toFixed(1)}s, ${Math.round(density * 100)}% above threshold`,
    };
  });
  const kept = segments.reduce((sum, s) => sum + (s.end - s.start), 0);
  return {
    duration: buffer.duration,
    segments,
    removedSeconds: Math.max(0, buffer.duration - kept),
    notes: [
      `Noise floor ${floor.toFixed(1)} dB, speech threshold ${onThreshold.toFixed(1)} dB (hysteresis ${opts.hysteresisDb} dB).`,
      `${regions.length} raw regions → ${segments.length} keep segments after ${opts.marginSeconds}s margins, ${opts.minCutSeconds}s min cut, ${opts.minClipSeconds}s min clip.`,
    ],
  };
};

const frameSignature = (ctx: CanvasRenderingContext2D, video: HTMLVideoElement, width: number, height: number) => {
  ctx.drawImage(video, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  // Downsampled HSV-like channels: hue proxy (r-g, g-b), saturation, value.
  const out = new Float32Array(data.length / 4 * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    out[j] = max;
    out[j + 1] = max > 0 ? (max - min) / max : 0;
    out[j + 2] = (r - g + 1) / 2;
  }
  return out;
};

const frameDelta = (a: Float32Array, b: Float32Array) => {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
  return (sum / a.length) * 100;
};

/**
 * Adaptive scene detection: like PySceneDetect's AdaptiveDetector, a cut is
 * declared when a frame's difference exceeds the rolling average of its
 * neighbours by `adaptiveThreshold`, or the hard content threshold outright.
 */
export const detectSceneSegments = async (
  source: string,
  options: SceneOptions = {},
  onProgress?: (fraction: number) => void,
): Promise<LocalAnalysis> => {
  const opts = { ...DEFAULT_SCENE, ...options };
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.preload = 'auto';
  video.src = source;
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('Could not load video for scene detection.'));
  });
  const duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Video has no duration.');
  const width = 64;
  const height = 36;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas unavailable.');

  const step = 1 / opts.sampleFps;
  const times: number[] = [];
  for (let t = 0; t < duration; t += step) times.push(t);
  const deltas: number[] = [];
  let previous: Float32Array | null = null;
  for (let i = 0; i < times.length; i += 1) {
    const t = times[i];
    await new Promise<void>((resolve) => {
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        resolve();
      };
      video.addEventListener('seeked', onSeeked);
      video.currentTime = Math.min(duration - 0.01, t);
    });
    const signature = frameSignature(ctx, video, width, height);
    deltas.push(previous ? frameDelta(previous, signature) : 0);
    previous = signature;
    onProgress?.((i + 1) / times.length);
  }

  const cuts: number[] = [];
  const half = Math.max(1, Math.floor(opts.windowSize / 2));
  let lastCut = 0;
  for (let i = 1; i < deltas.length; i += 1) {
    const neighbours: number[] = [];
    for (let k = i - half; k <= i + half; k += 1) {
      if (k === i || k < 1 || k >= deltas.length) continue;
      neighbours.push(deltas[k]);
    }
    const average = neighbours.length ? neighbours.reduce((s, v) => s + v, 0) / neighbours.length : 0;
    const ratio = average > 0.01 ? deltas[i] / average : deltas[i] > 0 ? Infinity : 0;
    const isCut = (ratio >= opts.adaptiveThreshold && deltas[i] >= 3) || deltas[i] >= opts.contentThreshold;
    const t = times[i];
    if (isCut && t - lastCut >= opts.minSceneSeconds) {
      cuts.push(t);
      lastCut = t;
    }
  }

  const bounds = [0, ...cuts, duration];
  const segments: LocalSegment[] = [];
  for (let i = 0; i < bounds.length - 1; i += 1) {
    const start = bounds[i];
    const end = bounds[i + 1];
    if (end - start < 0.2) continue;
    segments.push({
      start,
      end,
      kind: 'scene',
      score: Math.round(60 + Math.min(40, ((end - start) / duration) * 120)),
      reason: `Scene ${segments.length + 1}: ${(end - start).toFixed(1)}s`,
    });
  }
  return {
    duration,
    segments,
    removedSeconds: 0,
    notes: [`${cuts.length} cuts found sampling ${opts.sampleFps} fps (adaptive ×${opts.adaptiveThreshold}, content ≥ ${opts.contentThreshold}).`],
  };
};

export type FillerWordOptions = {
  fillerWords?: string[];
  /** Seconds of padding removed around each filler. */
  paddingSeconds?: number;
  /** Also remove pauses longer than this (seconds) between words; 0 disables. */
  maxPauseSeconds?: number;
};

/**
 * Turns word timings into keep-segments with filler words (and optionally long
 * pauses) removed.
 */
export const buildCleanSpeechSegments = (
  words: Array<{ text: string; start: number; end: number }>,
  duration: number,
  options: FillerWordOptions = {},
): LocalAnalysis => {
  const fillers = new Set((options.fillerWords || DEFAULT_FILLER_WORDS).map((w) => w.toLowerCase()));
  const padding = options.paddingSeconds ?? 0.04;
  const maxPause = options.maxPauseSeconds ?? 0;
  const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}' ]/gu, '').trim();
  const sorted = words.filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end)).sort((a, b) => a.start - b.start);
  const removals: Array<[number, number]> = [];
  let removedFillers = 0;
  let removedPauses = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    const word = sorted[i];
    const text = normalize(word.text);
    const next = sorted[i + 1];
    const pair = next ? `${text} ${normalize(next.text)}` : '';
    if (fillers.has(pair) && next) {
      removals.push([Math.max(0, word.start - padding), Math.min(duration, next.end + padding)]);
      removedFillers += 1;
      i += 1;
      continue;
    }
    if (fillers.has(text)) {
      removals.push([Math.max(0, word.start - padding), Math.min(duration, word.end + padding)]);
      removedFillers += 1;
    }
    if (maxPause > 0 && next && next.start - word.end > maxPause) {
      removals.push([word.end + 0.15, next.start - 0.15]);
      removedPauses += 1;
    }
  }
  const merged = mergeRegions(removals, 0.02);
  const segments: LocalSegment[] = [];
  let cursor = 0;
  merged.forEach(([start, end]) => {
    if (start - cursor > 0.15) {
      segments.push({ start: cursor, end: start, kind: 'clean', score: 80, reason: 'Clean speech' });
    }
    cursor = Math.max(cursor, end);
  });
  if (duration - cursor > 0.15) segments.push({ start: cursor, end: duration, kind: 'clean', score: 80, reason: 'Clean speech' });
  const removed = merged.reduce((sum, [s, e]) => sum + (e - s), 0);
  return {
    duration,
    segments,
    removedSeconds: removed,
    notes: [`Removed ${removedFillers} filler${removedFillers === 1 ? '' : 's'}${maxPause > 0 ? ` and ${removedPauses} long pause${removedPauses === 1 ? '' : 's'}` : ''} (${removed.toFixed(1)}s).`],
  };
};

/** Extracts the audio track of a video URL as a WAV blob for transcription. */
export const extractAudioAsWav = async (source: string | Blob, maxSeconds = 600): Promise<Blob> => {
  const buffer = await decodeAudio(source);
  const sampleRate = 16000;
  const length = Math.min(buffer.duration, maxSeconds) * sampleRate;
  const offline = new OfflineAudioContext(1, Math.ceil(length), sampleRate);
  const node = offline.createBufferSource();
  node.buffer = buffer;
  node.connect(offline.destination);
  node.start();
  const rendered = await offline.startRendering();
  const samples = rendered.getChannelData(0);
  const wav = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(wav);
  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([wav], { type: 'audio/wav' });
};
