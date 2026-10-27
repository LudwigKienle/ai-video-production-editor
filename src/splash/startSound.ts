/**
 * Start sound, synthesised from scratch (no samples) and deterministic.
 *
 *   synthStartSound(sampleRate) -> Float32Array, stereo interleaved [L, R, L, R, …]
 *
 * Idea: the warm 60 Hz of a mains hum "switching on". The fundamental and its
 * harmonics 120/180/240 Hz (+ a little saturation, which adds 300/360/… so
 * the 60 Hz pitch is heard on laptop speakers, too) swell up to the arrow's
 * impact, a soft "thock" lands with it, Hermes' wings add an airy shimmer just
 * before, and with the smile everything opens into a just major chord built on
 * multiples of 60 Hz: 240 : 300 : 360 : 480 Hz = 4 : 5 : 6 : 8.
 *
 * Time marks follow SPLASH_TIMELINE (renderSplashFrame.ts). Total ≤ 3 s,
 * normalised to about −18 LUFS (BS.1770 K-weighted, gated) with the sample
 * peak held at or below −3 dBFS; raised-cosine fades at both ends (no clicks).
 */
import { SPLASH_TIMELINE } from './splashTimeline.ts';

export const START_SOUND = {
  duration: 2.95,
  targetLufs: -18,
  peakCeilingDb: -3.2,
  marks: {
    swell: [0, SPLASH_TIMELINE.flight[1]],
    wings: [0.58, 1.12],
    thock: SPLASH_TIMELINE.flight[1],
    chord: SPLASH_TIMELINE.smile[0] + 0.04,
    sparkle: SPLASH_TIMELINE.shimmer[0] + 0.02,
  },
} as const;

// ------------------------------------------------------------------ dsp helpers

/** Deterministic PRNG (mulberry32). */
const rng = (seed: number) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number };
const biquadRun = (x: Float64Array, c: Biquad): Float64Array => {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i += 1) {
    const v = c.b0 * x[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
};
const bandpass = (fs: number, f0: number, q: number): Biquad => {
  const w = (2 * Math.PI * f0) / fs, alpha = Math.sin(w) / (2 * q), a0 = 1 + alpha;
  return { b0: alpha / a0, b1: 0, b2: -alpha / a0, a1: (-2 * Math.cos(w)) / a0, a2: (1 - alpha) / a0 };
};
const lowpass = (fs: number, f0: number, q = 0.707): Biquad => {
  const w = (2 * Math.PI * f0) / fs, alpha = Math.sin(w) / (2 * q), cw = Math.cos(w), a0 = 1 + alpha;
  return { b0: (1 - cw) / 2 / a0, b1: (1 - cw) / a0, b2: (1 - cw) / 2 / a0, a1: (-2 * cw) / a0, a2: (1 - alpha) / a0 };
};
const highpass = (fs: number, f0: number, q = 0.707): Biquad => {
  const w = (2 * Math.PI * f0) / fs, alpha = Math.sin(w) / (2 * q), cw = Math.cos(w), a0 = 1 + alpha;
  return { b0: (1 + cw) / 2 / a0, b1: -(1 + cw) / a0, b2: (1 + cw) / 2 / a0, a1: (-2 * cw) / a0, a2: (1 - alpha) / a0 };
};

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const pan = (p: number): [number, number] => {
  const a = ((p + 1) * Math.PI) / 4;
  return [Math.cos(a), Math.sin(a)];
};

// ------------------------------------------------------------------ voices

function hum(fs: number, n: number, L: Float64Array, R: Float64Array): void {
  const tImpact = START_SOUND.marks.thock;
  const harmonics = [1, 0.62, 0.42, 0.3, 0.12, 0.08, 0.04];
  const H = harmonics.length;
  // Recurrence oscillators for the 60 Hz series (+ one slightly detuned partial for a slow beat).
  const freqs = [...harmonics.map((_, k) => 60 * (k + 1)), 60.35];
  const phases = [...harmonics.map((_, k) => (k + 1) * 0.7), 0];
  const c = new Float64Array(H + 1), y1 = new Float64Array(H + 1), y2 = new Float64Array(H + 1);
  freqs.forEach((f, k) => {
    const w = (2 * Math.PI * f) / fs;
    c[k] = 2 * Math.cos(w); y1[k] = Math.sin(phases[k] - w); y2[k] = Math.sin(phases[k] - 2 * w);
  });
  const iImpact = Math.floor(tImpact * fs);
  const kFall = Math.exp(-3.2 / fs), kOut = Math.exp(-3.4 / fs);
  let fallE = 1, outE = 1;
  for (let i = 0; i < n; i += 1) {
    const t = i / fs;
    let env: number;
    let bright: number;
    let drive: number;
    if (i < iImpact) {
      const u = t / tImpact;
      env = u * u * Math.sqrt(Math.sqrt(u)) * 0.95 + u * u * 0.05; // ≈ u^2.1
      bright = 0.35 + 0.65 * u * u * (3 - 2 * u);
      drive = 1 + 1.6 * u * u * (3 - 2 * u);
    } else {
      fallE *= kFall;
      env = 0.45 + 0.55 * fallE;
      bright = 1;
      drive = 2.6;
    }
    if (t > 2.0) { outE *= kOut; env *= outE; }
    let x = 0, w = 1;
    for (let k = 0; k <= H; k += 1) {
      const y = c[k] * y1[k] - y2[k];
      y2[k] = y1[k]; y1[k] = y;
      if (k < H) { x += harmonics[k] * w * y; w *= bright; } else x += 0.18 * y;
    }
    const v = (Math.tanh(drive * x * 0.55) / Math.tanh(drive * 0.55)) * env * 0.5;
    L[i] += v; R[i] += v;
  }
}

function wings(fs: number, n: number, L: Float64Array, R: Float64Array): void {
  const [t0, t1] = START_SOUND.marks.wings;
  const random = rng(60);
  const noise = new Float64Array(n);
  for (let i = 0; i < n; i += 1) noise[i] = random() * 2 - 1;
  const air = biquadRun(biquadRun(noise, bandpass(fs, 2400, 0.7)), lowpass(fs, 5200));
  const flapRate = 3.1; // same as the wing flaps in the picture
  for (let i = Math.floor(t0 * fs); i < Math.min(n, Math.ceil(t1 * fs)); i += 1) {
    const t = i / fs;
    const k = Math.max(0, Math.min(1, (t - t0) / (t1 - t0)));
    const bell = Math.max(0, Math.sin(Math.PI * k)) ** 1.5;
    const flap = 0.45 + 0.55 * Math.sin(Math.PI * flapRate * (t - t0) * 2) ** 2;
    const env = bell * flap;
    // a faint glint: 1440/1800/2160 Hz = 24/30/36 × 60 Hz (4 : 5 : 6)
    const glint = (Math.sin(2 * Math.PI * 1440 * t) + 0.7 * Math.sin(2 * Math.PI * 1800 * t) + 0.5 * Math.sin(2 * Math.PI * 2160 * t)) * smooth(k * 1.4) * (1 - k) * 0.03;
    const v = air[i] * env * 0.5 + glint;
    const [gl, gr] = pan(-0.65 + 0.65 * k); // follows the arrow from the left to the centre
    L[i] += v * gl; R[i] += v * gr;
  }
}

function thock(fs: number, n: number, L: Float64Array, R: Float64Array): void {
  const t0 = START_SOUND.marks.thock;
  const random = rng(120);
  const len = Math.floor(0.3 * fs);
  const noise = new Float64Array(len);
  for (let i = 0; i < len; i += 1) noise[i] = (random() * 2 - 1) * Math.exp(-i / (0.012 * fs));
  const soft = biquadRun(noise, lowpass(fs, 700));
  let phase = 0;
  const start = Math.floor(t0 * fs);
  for (let j = 0; j < len && start + j < n; j += 1) {
    const t = j / fs;
    const f = 60 + 120 * Math.exp(-t / 0.03); // 180 Hz -> 60 Hz
    phase += (2 * Math.PI * f) / fs;
    const env = (1 - Math.exp(-t / 0.002)) * Math.exp(-t / 0.075);
    const v = Math.sin(phase) * env * 0.85 + soft[j] * 0.5;
    L[start + j] += v; R[start + j] += v;
  }
}

function chord(fs: number, n: number, L: Float64Array, R: Float64Array): void {
  const t0 = START_SOUND.marks.chord;
  // [frequency, level, pan, onset offset]
  const notes: Array<[number, number, number, number]> = [
    [120, 0.5, 0, 0],
    [240, 0.55, -0.25, 0],
    [300, 0.45, 0.25, 0.018],
    [360, 0.42, -0.1, 0.036],
    [480, 0.3, 0.3, 0.054],
    [600, 0.12, -0.3, 0.07],
  ];
  for (const [f, level, p, off] of notes) {
    const [gl, gr] = pan(p);
    const start = Math.floor((t0 + off) * fs);
    const fr = [f, f + 0.45, 2 * f, 3 * f];
    const c = fr.map((x) => 2 * Math.cos((2 * Math.PI * x) / fs));
    const y1 = fr.map((x) => Math.sin((-2 * Math.PI * x) / fs)), y2 = fr.map((x) => Math.sin((-4 * Math.PI * x) / fs));
    let a1 = y1[0], b1 = y2[0], a2 = y1[1], b2 = y2[1], a3 = y1[2], b3 = y2[2], a4 = y1[3], b4 = y2[3];
    const c1 = c[0], c2 = c[1], c3 = c[2], c4 = c[3];
    const kA = Math.exp(-1 / (0.025 * fs)), kD = Math.exp(-1 / (0.62 * fs)), k2 = Math.exp(-1 / (0.3 * fs)), k3 = Math.exp(-1 / (0.15 * fs));
    let att = 1, dec = 1, e2 = 1, e3 = 1;
    for (let i = start; i < n; i += 1) {
      const s1 = c1 * a1 - b1; b1 = a1; a1 = s1;
      const s2 = c2 * a2 - b2; b2 = a2; a2 = s2;
      const s3 = c3 * a3 - b3; b3 = a3; a3 = s3;
      const s4 = c4 * a4 - b4; b4 = a4; a4 = s4;
      // warm tone: fundamental + soft 2nd/3rd partial, slight chorus
      const v = level * (1 - att) * dec * (s1 * 0.7 + s2 * 0.3 + 0.16 * s3 * e2 + 0.05 * s4 * e3);
      att *= kA; dec *= kD; e2 *= k2; e3 *= k3;
      L[i] += v * gl; R[i] += v * gr;
    }
  }
}

function sparkle(fs: number, n: number, L: Float64Array, R: Float64Array): void {
  const t0 = START_SOUND.marks.sparkle;
  const tones: Array<[number, number, number]> = [[1440, -0.35, 0], [1800, 0.1, 0.05], [2160, 0.4, 0.1]];
  for (const [f, p, off] of tones) {
    const [gl, gr] = pan(p);
    const start = Math.floor((t0 + off) * fs);
    const c = 2 * Math.cos((2 * Math.PI * f) / fs);
    let y1 = Math.sin((-2 * Math.PI * f) / fs), y2 = Math.sin((-4 * Math.PI * f) / fs);
    const kA = Math.exp(-1 / (0.006 * fs)), kD = Math.exp(-1 / (0.22 * fs));
    let att = 1, dec = 1;
    const end = Math.min(n, start + Math.round(1.6 * fs));
    for (let i = start; i < end; i += 1) {
      const y = c * y1 - y2; y2 = y1; y1 = y;
      const v = 0.035 * (1 - att) * dec * y;
      att *= kA; dec *= kD;
      L[i] += v * gl; R[i] += v * gr;
    }
  }
}

// ------------------------------------------------------------------ loudness (BS.1770-4)

const kWeighting = (fs: number): [Biquad, Biquad] => {
  // Coefficients for any sample rate (same design as the 48 kHz reference filters).
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / fs);
  const Vh = 10 ** (G / 20), Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const shelf: Biquad = { b0: (Vh + (Vb * K) / Q + K * K) / a0, b1: (2 * (K * K - Vh)) / a0, b2: (Vh - (Vb * K) / Q + K * K) / a0, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
  f0 = 38.13547087602444; Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / fs);
  a0 = 1 + K / Q + K * K;
  const hp: Biquad = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
  return [shelf, hp];
};

/** Integrated loudness (LUFS) and sample peak (dBFS) of interleaved stereo. */
export function measureLoudness(interleaved: Float32Array, sampleRate: number): { lufs: number; peakDb: number } {
  const n = interleaved.length / 2;
  const chans = [new Float64Array(n), new Float64Array(n)];
  let peak = 0;
  for (let i = 0; i < n; i += 1) {
    chans[0][i] = interleaved[2 * i];
    chans[1][i] = interleaved[2 * i + 1];
    peak = Math.max(peak, Math.abs(interleaved[2 * i]), Math.abs(interleaved[2 * i + 1]));
  }
  const [shelf, hp] = kWeighting(sampleRate);
  const weighted = chans.map((c) => biquadRun(biquadRun(c, shelf), hp));
  const block = Math.round(0.4 * sampleRate), step = Math.round(0.1 * sampleRate);
  const energy = new Float64Array(n + 1);
  for (let i = 0; i < n; i += 1) energy[i + 1] = energy[i] + weighted[0][i] * weighted[0][i] + weighted[1][i] * weighted[1][i];
  const z: number[] = [];
  for (let s = 0; s + block <= n; s += step) z.push((energy[s + block] - energy[s]) / block);
  const lk = (v: number) => -0.691 + 10 * Math.log10(v);
  const abs = z.filter((v) => lk(v) > -70);
  const rel = abs.length ? lk(abs.reduce((a, b) => a + b, 0) / abs.length) - 10 : -70;
  const gated = abs.filter((v) => lk(v) > rel);
  const lufs = gated.length ? lk(gated.reduce((a, b) => a + b, 0) / gated.length) : -Infinity;
  return { lufs, peakDb: 20 * Math.log10(peak || 1e-12) };
}

// ------------------------------------------------------------------ synth

const cache = new Map<number, Float32Array>();

/** The start sound as interleaved stereo Float32 samples. Pure and deterministic. */
export function synthStartSound(sampleRate: number): Float32Array {
  const cached = cache.get(sampleRate);
  if (cached) return cached.slice();
  const fs = sampleRate;
  const n = Math.round(START_SOUND.duration * fs);
  const L = new Float64Array(n), R = new Float64Array(n);
  hum(fs, n, L, R);
  wings(fs, n, L, R);
  thock(fs, n, L, R);
  chord(fs, n, L, R);
  sparkle(fs, n, L, R);

  // Remove sub-audio rumble below the hum, keep 60 Hz.
  const dc = highpass(fs, 30, 0.6);
  const l2 = biquadRun(L, dc), r2 = biquadRun(R, dc);

  // Click-free fades (raised cosine): 12 ms in, 120 ms out.
  const fadeIn = Math.round(0.012 * fs), fadeOut = Math.round(0.12 * fs);
  for (let i = 0; i < n; i += 1) {
    let g = 1;
    if (i < fadeIn) g = 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeIn);
    if (i >= n - fadeOut) g *= 0.5 - 0.5 * Math.cos((Math.PI * (n - 1 - i)) / fadeOut);
    l2[i] *= g; r2[i] *= g;
  }

  // Loudness normalisation: exact gain from the linear mix, then the soft
  // ceiling, then one correction pass for what the ceiling took away.
  const ceiling = 10 ** (START_SOUND.peakCeilingDb / 20);
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i += 1) { out[2 * i] = l2[i]; out[2 * i + 1] = r2[i]; }
  let gain = 10 ** ((START_SOUND.targetLufs - measureLoudness(out, fs).lufs) / 20);
  for (let pass = 0; pass < 2; pass += 1) {
    for (let i = 0; i < n; i += 1) {
      out[2 * i] = softLimit(l2[i] * gain, ceiling);
      out[2 * i + 1] = softLimit(r2[i] * gain, ceiling);
    }
    if (pass === 0) gain *= 10 ** ((START_SOUND.targetLufs - measureLoudness(out, fs).lufs) / 20);
  }
  cache.set(sampleRate, out);
  return out.slice();
}

/** Transparent below 70 % of the ceiling, smooth knee above, never exceeds it. */
function softLimit(x: number, ceiling: number): number {
  const knee = ceiling * 0.7;
  const a = Math.abs(x);
  if (a <= knee) return x;
  const over = (a - knee) / (ceiling - knee);
  return Math.sign(x) * (knee + (ceiling - knee) * Math.tanh(over));
}

/** De-interleave into two channels (Web Audio buffers). */
export function splitChannels(interleaved: Float32Array): [Float32Array, Float32Array] {
  const n = interleaved.length / 2;
  const l = new Float32Array(n), r = new Float32Array(n);
  for (let i = 0; i < n; i += 1) { l[i] = interleaved[2 * i]; r[i] = interleaved[2 * i + 1]; }
  return [l, r];
}

/** PCM WAV (stereo, 16 or 24 bit) for the preview file. */
export function encodeWav(interleaved: Float32Array, sampleRate: number, bits: 16 | 24 = 24): Uint8Array {
  const bytes = bits / 8;
  const dataLen = interleaved.length * bytes;
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i += 1) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2 * bytes, true); v.setUint16(32, 2 * bytes, true); v.setUint16(34, bits, true);
  str(36, 'data'); v.setUint32(40, dataLen, true);
  let o = 44;
  const max = bits === 16 ? 32767 : 8388607;
  for (let i = 0; i < interleaved.length; i += 1) {
    const s = Math.round(Math.max(-1, Math.min(1, interleaved[i])) * max);
    if (bits === 16) { v.setInt16(o, s, true); o += 2; } else { v.setUint8(o, s & 255); v.setUint8(o + 1, (s >> 8) & 255); v.setUint8(o + 2, (s >> 16) & 255); o += 3; }
  }
  return new Uint8Array(buf);
}
