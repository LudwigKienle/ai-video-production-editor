/**
 * Loudness metering after ITU-R BS.1770-4 / EBU R128 (Tech 3341, 3342).
 *
 *  - K-weighting: high-shelf + high-pass pre-filter, designed for any sample rate
 *    from the analog parameters of the recommendation (48 kHz reproduces the
 *    published coefficient table exactly).
 *  - Momentary (400 ms), short-term (3 s), integrated (gated: −70 LUFS absolute,
 *    −10 LU relative), loudness range (short-term, −20 LU relative, P10–P95).
 *  - True peak via 4× oversampling (windowed-sinc interpolator), sample peak.
 *
 * Streaming: feed blocks with `push`, read values at any time. Energy is kept
 * per 100 ms sub-block, so gating needs only ~10 numbers per second.
 */

import type { BiquadCoefficients } from './dsp.ts';

export const LUFS_FLOOR = -70;
const ABS_GATE = -70;

export const kWeightingCoefficients = (sampleRate: number): [BiquadCoefficients, BiquadCoefficients] => {
  // stage 1: high shelf
  const f0 = 1681.974450955533;
  const G = 3.999843853973347;
  const Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf: BiquadCoefficients = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  // stage 2: high pass (RLB)
  const f1 = 38.13547087602444;
  const Q1 = 0.5003270373238773;
  K = Math.tan((Math.PI * f1) / sampleRate);
  a0 = 1 + K / Q1 + K * K;
  const highpass: BiquadCoefficients = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q1 + K * K) / a0,
  };
  return [shelf, highpass];
};

const energyToLufs = (meanSquare: number): number => (meanSquare > 0 ? -0.691 + 10 * Math.log10(meanSquare) : -Infinity);

/** 4× oversampling interpolator for true-peak detection (Hann-windowed sinc, 12 taps per phase). */
const TP_FACTOR = 4;
const TP_TAPS = 12;
const TP_PHASES: Float64Array[] = (() => {
  const phases: Float64Array[] = [];
  const half = TP_TAPS / 2;
  for (let p = 0; p < TP_FACTOR; p++) {
    const frac = p / TP_FACTOR;
    const taps = new Float64Array(TP_TAPS);
    let sum = 0;
    for (let k = 0; k < TP_TAPS; k++) {
      const x = k - half + 1 - frac; // distance to the interpolated point
      const sinc = Math.abs(x) < 1e-12 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const w = 0.5 + 0.5 * Math.cos((Math.PI * x) / (half + 0.5));
      taps[k] = sinc * w;
      sum += taps[k];
    }
    for (let k = 0; k < TP_TAPS; k++) taps[k] /= sum;
    phases.push(taps);
  }
  return phases;
})();

export type LoudnessSummary = {
  integratedLufs: number;
  rangeLu: number;
  momentaryMaxLufs: number;
  shortTermMaxLufs: number;
  truePeakDb: number;
  samplePeakDb: number;
  durationSec: number;
};

export class LoudnessMeter {
  readonly sampleRate: number;
  private stages: [BiquadCoefficients, BiquadCoefficients];
  private z = new Float64Array(8); // 2 channels × 2 stages × 2 states
  private subLen: number;
  private subFill = 0;
  private subSum = 0;
  /** Mean-square energy of every finished 100 ms sub-block (channel-weighted sum). */
  private subBlocks: number[] = [];
  private momentaryMax = -Infinity;
  private shortTermMax = -Infinity;
  private tpHistory: [Float64Array, Float64Array] = [new Float64Array(TP_TAPS), new Float64Array(TP_TAPS)];
  private tpPos = 0;
  private truePeak = 0;
  private samplePeak = 0;
  private frames = 0;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate > 0 ? sampleRate : 48000;
    this.stages = kWeightingCoefficients(this.sampleRate);
    this.subLen = Math.max(1, Math.round(this.sampleRate * 0.1));
  }

  reset(): void {
    this.z.fill(0);
    this.subFill = 0;
    this.subSum = 0;
    this.subBlocks = [];
    this.momentaryMax = -Infinity;
    this.shortTermMax = -Infinity;
    this.tpHistory[0].fill(0);
    this.tpHistory[1].fill(0);
    this.tpPos = 0;
    this.truePeak = 0;
    this.samplePeak = 0;
    this.frames = 0;
  }

  private kfilter(x: number, ch: number): number {
    const z = this.z;
    const o = ch * 4;
    const [s, h] = this.stages;
    let y = s.b0 * x + z[o];
    z[o] = s.b1 * x - s.a1 * y + z[o + 1];
    z[o + 1] = s.b2 * x - s.a2 * y;
    const y2 = h.b0 * y + z[o + 2];
    z[o + 2] = h.b1 * y - h.a1 * y2 + z[o + 3];
    z[o + 3] = h.b2 * y - h.a2 * y2;
    return y2;
  }

  push(left: Float32Array, right: Float32Array | null, frames: number): void {
    const r = right ?? left;
    const hl = this.tpHistory[0];
    const hr = this.tpHistory[1];
    for (let i = 0; i < frames; i++) {
      let a = left[i];
      let b = r[i];
      if (!Number.isFinite(a)) a = 0;
      if (!Number.isFinite(b)) b = 0;
      const fa = this.kfilter(a, 0);
      const fb = right ? this.kfilter(b, 1) : 0;
      this.subSum += fa * fa + fb * fb;
      if (++this.subFill >= this.subLen) this.closeSubBlock();

      const aa = Math.abs(a), bb = Math.abs(b);
      if (aa > this.samplePeak) this.samplePeak = aa;
      if (bb > this.samplePeak) this.samplePeak = bb;
      // true peak: push into ring buffer and evaluate the 4 interpolation phases
      hl[this.tpPos] = a;
      hr[this.tpPos] = b;
      this.tpPos = (this.tpPos + 1) % TP_TAPS;
      for (let p = 1; p < TP_FACTOR; p++) {
        const taps = TP_PHASES[p];
        let sl = 0, sr = 0;
        for (let k = 0; k < TP_TAPS; k++) {
          const idx = (this.tpPos + k) % TP_TAPS;
          sl += hl[idx] * taps[k];
          sr += hr[idx] * taps[k];
        }
        const m = Math.max(Math.abs(sl), Math.abs(sr));
        if (m > this.truePeak) this.truePeak = m;
      }
    }
    this.frames += frames;
    if (this.samplePeak > this.truePeak) this.truePeak = this.samplePeak;
  }

  private closeSubBlock(): void {
    this.subBlocks.push(this.subSum / this.subFill);
    this.subSum = 0;
    this.subFill = 0;
    const m = this.windowLufs(4);
    if (m > this.momentaryMax) this.momentaryMax = m;
    const s = this.windowLufs(30);
    if (s > this.shortTermMax) this.shortTermMax = s;
  }

  /** Loudness of the last `count` 100 ms sub-blocks (4 = momentary, 30 = short-term). */
  private windowLufs(count: number, endIndex = this.subBlocks.length): number {
    if (endIndex < count) return -Infinity;
    let sum = 0;
    for (let i = endIndex - count; i < endIndex; i++) sum += this.subBlocks[i];
    return energyToLufs(sum / count);
  }

  momentaryLufs(): number {
    return this.windowLufs(4);
  }

  shortTermLufs(): number {
    return this.windowLufs(30);
  }

  integratedLufs(): number {
    // 400 ms gating blocks with 75 % overlap = every window of 4 sub-blocks
    const blocks: number[] = [];
    for (let end = 4; end <= this.subBlocks.length; end++) {
      let sum = 0;
      for (let i = end - 4; i < end; i++) sum += this.subBlocks[i];
      blocks.push(sum / 4);
    }
    const absGated = blocks.filter((e) => energyToLufs(e) > ABS_GATE);
    if (!absGated.length) return -Infinity;
    const relGate = energyToLufs(absGated.reduce((a, b) => a + b, 0) / absGated.length) - 10;
    const gated = absGated.filter((e) => energyToLufs(e) > relGate);
    if (!gated.length) return -Infinity;
    return energyToLufs(gated.reduce((a, b) => a + b, 0) / gated.length);
  }

  /** Loudness range (EBU Tech 3342) in LU. */
  rangeLu(): number {
    const st: number[] = [];
    for (let end = 30; end <= this.subBlocks.length; end++) {
      let sum = 0;
      for (let i = end - 30; i < end; i++) sum += this.subBlocks[i];
      st.push(sum / 30);
    }
    const absGated = st.filter((e) => energyToLufs(e) > ABS_GATE);
    if (absGated.length < 2) return 0;
    const relGate = energyToLufs(absGated.reduce((a, b) => a + b, 0) / absGated.length) - 20;
    const values = absGated.map(energyToLufs).filter((l) => l > relGate).sort((a, b) => a - b);
    if (values.length < 2) return 0;
    const pct = (p: number) => values[Math.min(values.length - 1, Math.max(0, Math.round((p / 100) * (values.length - 1))))];
    return Math.max(0, pct(95) - pct(10));
  }

  truePeakDb(): number {
    return this.truePeak > 0 ? 20 * Math.log10(this.truePeak) : -Infinity;
  }

  samplePeakDb(): number {
    return this.samplePeak > 0 ? 20 * Math.log10(this.samplePeak) : -Infinity;
  }

  summary(): LoudnessSummary {
    return {
      integratedLufs: this.integratedLufs(),
      rangeLu: this.rangeLu(),
      momentaryMaxLufs: this.momentaryMax,
      shortTermMaxLufs: this.shortTermMax,
      truePeakDb: this.truePeakDb(),
      samplePeakDb: this.samplePeakDb(),
      durationSec: this.frames / this.sampleRate,
    };
  }
}

export const measureLoudness = (left: Float32Array, right: Float32Array | null, sampleRate: number): LoudnessSummary => {
  const meter = new LoudnessMeter(sampleRate);
  meter.push(left, right, left.length);
  return meter.summary();
};

/** Gain (dB) that brings `summary` to `targetLufs` without letting the true peak exceed `truePeakLimitDb`. */
export const normalizationGainDb = (summary: LoudnessSummary, targetLufs: number, truePeakLimitDb: number): { gainDb: number; peakLimited: boolean } => {
  if (!Number.isFinite(summary.integratedLufs)) return { gainDb: 0, peakLimited: false };
  const wanted = targetLufs - summary.integratedLufs;
  const headroom = Number.isFinite(summary.truePeakDb) ? truePeakLimitDb - summary.truePeakDb : Infinity;
  if (wanted > headroom) return { gainDb: headroom, peakLimited: true };
  return { gainDb: wanted, peakLimited: false };
};

/** Formats a LUFS/LU value for display. */
export const formatLufs = (value: number): string => (Number.isFinite(value) && value > -99 ? value.toFixed(1) : '−∞');
