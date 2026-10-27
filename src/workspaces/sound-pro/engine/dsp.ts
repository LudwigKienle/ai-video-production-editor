/**
 * Sample-accurate DSP building blocks for the sound mix engine.
 *
 * Pure TypeScript, no Web Audio and no DOM, so the very same code renders the
 * live preview (AudioWorklet), the offline mixdown in the renderer and the
 * export mixdown in Node. All processors work in place on stereo blocks and
 * keep their state between blocks; `update()` changes parameters without
 * resetting state, so automation and UI moves stay click-free.
 *
 * Filter formulas follow the public "Audio EQ Cookbook" (R. Bristow-Johnson).
 */

import {
  clamp,
  dbToGain,
  type CompressorParams,
  type DelayParams,
  type EqBand,
  type GateParams,
  type InsertSlot,
  type LimiterParams,
} from '../model.ts';

export interface StereoProcessor {
  process(left: Float32Array, right: Float32Array, frames: number): void;
  update(slot: InsertSlot): void;
  reset(): void;
}

/* ─── biquad ─── */

export type BiquadCoefficients = { b0: number; b1: number; b2: number; a1: number; a2: number };

export const IDENTITY_BIQUAD: BiquadCoefficients = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };

export const biquadCoefficients = (band: Pick<EqBand, 'type' | 'freq' | 'gainDb' | 'q'>, sampleRate: number): BiquadCoefficients => {
  const nyquist = sampleRate / 2;
  const freq = clamp(band.freq, 10, nyquist * 0.98);
  const q = Math.max(0.05, band.q);
  const w0 = (2 * Math.PI * freq) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * q);
  const A = Math.pow(10, band.gainDb / 40);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  switch (band.type) {
    case 'highpass':
      b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2;
      a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
      break;
    case 'lowpass':
      b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2;
      a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
      break;
    case 'peaking':
      b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A;
      a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A;
      break;
    case 'lowshelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) - (A - 1) * cos + s);
      b1 = 2 * A * ((A - 1) - (A + 1) * cos);
      b2 = A * ((A + 1) - (A - 1) * cos - s);
      a0 = (A + 1) + (A - 1) * cos + s;
      a1 = -2 * ((A - 1) + (A + 1) * cos);
      a2 = (A + 1) + (A - 1) * cos - s;
      break;
    }
    case 'highshelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) + (A - 1) * cos + s);
      b1 = -2 * A * ((A - 1) + (A + 1) * cos);
      b2 = A * ((A + 1) + (A - 1) * cos - s);
      a0 = (A + 1) - (A - 1) * cos + s;
      a1 = 2 * ((A - 1) - (A + 1) * cos);
      a2 = (A + 1) - (A - 1) * cos - s;
      break;
    }
    default:
      return IDENTITY_BIQUAD;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
};

/** Magnitude response in dB of a coefficient set at `freq` (used for the EQ curve display and tests). */
export const biquadMagnitudeDb = (c: BiquadCoefficients, freq: number, sampleRate: number): number => {
  const w = (2 * Math.PI * freq) / sampleRate;
  const cos1 = Math.cos(w), sin1 = Math.sin(w), cos2 = Math.cos(2 * w), sin2 = Math.sin(2 * w);
  const nr = c.b0 + c.b1 * cos1 + c.b2 * cos2;
  const ni = -(c.b1 * sin1 + c.b2 * sin2);
  const dr = 1 + c.a1 * cos1 + c.a2 * cos2;
  const di = -(c.a1 * sin1 + c.a2 * sin2);
  const mag = Math.sqrt((nr * nr + ni * ni) / Math.max(1e-30, dr * dr + di * di));
  return 20 * Math.log10(Math.max(1e-12, mag));
};

/** Transposed direct form II, one state pair per channel. */
export class Biquad {
  c: BiquadCoefficients = IDENTITY_BIQUAD;
  private z1 = [0, 0];
  private z2 = [0, 0];

  set(c: BiquadCoefficients): void {
    this.c = c;
  }

  processChannel(data: Float32Array, frames: number, ch: 0 | 1): void {
    const { b0, b1, b2, a1, a2 } = this.c;
    let z1 = this.z1[ch];
    let z2 = this.z2[ch];
    for (let i = 0; i < frames; i++) {
      const x = data[i];
      const y = b0 * x + z1;
      z1 = b1 * x - a1 * y + z2;
      z2 = b2 * x - a2 * y;
      data[i] = y;
    }
    // flush denormals / runaway state after bad input
    this.z1[ch] = Number.isFinite(z1) && Math.abs(z1) > 1e-20 ? z1 : 0;
    this.z2[ch] = Number.isFinite(z2) && Math.abs(z2) > 1e-20 ? z2 : 0;
  }

  reset(): void {
    this.z1 = [0, 0];
    this.z2 = [0, 0];
  }
}

const isFlat = (band: EqBand) =>
  !band.enabled || ((band.type === 'peaking' || band.type === 'lowshelf' || band.type === 'highshelf') && Math.abs(band.gainDb) < 0.01);

export class EqProcessor implements StereoProcessor {
  private filters: Biquad[] = [];
  private active: boolean[] = [];
  private sampleRate: number;
  constructor(sampleRate: number, slot: InsertSlot) {
    this.sampleRate = sampleRate;
    this.update(slot);
  }
  update(slot: InsertSlot): void {
    if (slot.kind !== 'eq') return;
    const bands = slot.params.bands;
    while (this.filters.length < bands.length) this.filters.push(new Biquad());
    this.filters.length = bands.length;
    this.active = bands.map((band) => !isFlat(band));
    bands.forEach((band, i) => this.filters[i].set(biquadCoefficients(band, this.sampleRate)));
  }
  process(left: Float32Array, right: Float32Array, frames: number): void {
    for (let i = 0; i < this.filters.length; i++) {
      if (!this.active[i]) continue;
      this.filters[i].processChannel(left, frames, 0);
      this.filters[i].processChannel(right, frames, 1);
    }
  }
  reset(): void {
    this.filters.forEach((f) => f.reset());
  }
}

/* ─── dynamics ─── */

const timeCoefficient = (ms: number, sampleRate: number) => Math.exp(-1 / Math.max(1, (ms / 1000) * sampleRate));
const toDb = (x: number) => (x > 1e-9 ? 20 * Math.log10(x) : -180);

/** Static compressor curve (soft knee), returns gain reduction in dB (≤ 0). */
export const compressorGainDb = (inputDb: number, p: Pick<CompressorParams, 'thresholdDb' | 'ratio' | 'kneeDb'>): number => {
  const over = inputDb - p.thresholdDb;
  const knee = Math.max(0, p.kneeDb);
  const slope = 1 / Math.max(1, p.ratio) - 1;
  if (knee > 0 && Math.abs(over) <= knee / 2) {
    const x = over + knee / 2;
    return (slope * x * x) / (2 * knee);
  }
  return over > 0 ? slope * over : 0;
};

/** Feed-forward stereo-linked compressor with a peak detector in the dB domain. */
export class CompressorProcessor implements StereoProcessor {
  private p!: CompressorParams;
  private att = 0;
  private rel = 0;
  private envDb = 0;
  /** Last gain reduction in dB, for the GR meter. */
  reductionDb = 0;
  private sampleRate: number;
  constructor(sampleRate: number, slot: InsertSlot) {
    this.sampleRate = sampleRate;
    this.update(slot);
  }
  update(slot: InsertSlot): void {
    if (slot.kind !== 'compressor') return;
    this.p = slot.params;
    this.att = timeCoefficient(this.p.attackMs, this.sampleRate);
    this.rel = timeCoefficient(this.p.releaseMs, this.sampleRate);
  }
  process(left: Float32Array, right: Float32Array, frames: number): void {
    const makeup = dbToGain(this.p.makeupDb);
    let env = this.envDb;
    let maxReduction = 0;
    for (let i = 0; i < frames; i++) {
      const level = Math.max(Math.abs(left[i]), Math.abs(right[i]));
      const target = -compressorGainDb(toDb(level), this.p); // positive amount of reduction
      const coeff = target > env ? this.att : this.rel;
      env = target + coeff * (env - target);
      const gain = Math.pow(10, -env / 20) * makeup;
      left[i] *= gain;
      right[i] *= gain;
      if (env > maxReduction) maxReduction = env;
    }
    this.envDb = Number.isFinite(env) ? env : 0;
    this.reductionDb = -maxReduction;
  }
  reset(): void {
    this.envDb = 0;
    this.reductionDb = 0;
  }
}

export class GateProcessor implements StereoProcessor {
  private p!: GateParams;
  private att = 0;
  private rel = 0;
  private gain = 1;
  private sampleRate: number;
  constructor(sampleRate: number, slot: InsertSlot) {
    this.sampleRate = sampleRate;
    this.update(slot);
  }
  update(slot: InsertSlot): void {
    if (slot.kind !== 'gate') return;
    this.p = slot.params;
    this.att = timeCoefficient(this.p.attackMs, this.sampleRate);
    this.rel = timeCoefficient(this.p.releaseMs, this.sampleRate);
  }
  process(left: Float32Array, right: Float32Array, frames: number): void {
    const threshold = dbToGain(this.p.thresholdDb);
    const floor = dbToGain(this.p.rangeDb);
    let g = this.gain;
    for (let i = 0; i < frames; i++) {
      const level = Math.max(Math.abs(left[i]), Math.abs(right[i]));
      const target = level >= threshold ? 1 : floor;
      const coeff = target > g ? this.att : this.rel;
      g = target + coeff * (g - target);
      left[i] *= g;
      right[i] *= g;
    }
    this.gain = Number.isFinite(g) ? g : 1;
  }
  reset(): void {
    this.gain = 1;
  }
}

/** Sample-peak limiter: instant attack (never exceeds the ceiling), exponential release. */
export class LimiterProcessor implements StereoProcessor {
  private ceiling = 1;
  private rel = 0;
  private gain = 1;
  reductionDb = 0;
  private sampleRate: number;
  constructor(sampleRate: number, slot: InsertSlot | { kind: 'limiter'; params: LimiterParams }) {
    this.sampleRate = sampleRate;
    this.update(slot as InsertSlot);
  }
  update(slot: InsertSlot): void {
    if (slot.kind !== 'limiter') return;
    this.ceiling = dbToGain(slot.params.ceilingDb);
    this.rel = timeCoefficient(slot.params.releaseMs, this.sampleRate);
  }
  process(left: Float32Array, right: Float32Array, frames: number): void {
    let g = this.gain;
    let minGain = 1;
    for (let i = 0; i < frames; i++) {
      const level = Math.max(Math.abs(left[i]), Math.abs(right[i]));
      const needed = level > this.ceiling ? this.ceiling / level : 1;
      g = needed < g ? needed : needed + this.rel * (g - needed);
      if (g > needed) g = needed;
      left[i] *= g;
      right[i] *= g;
      if (g < minGain) minGain = g;
    }
    this.gain = Number.isFinite(g) ? g : 1;
    this.reductionDb = toDb(minGain);
  }
  reset(): void {
    this.gain = 1;
    this.reductionDb = 0;
  }
}

export class DelayProcessor implements StereoProcessor {
  private p!: DelayParams;
  private bufL: Float32Array;
  private bufR: Float32Array;
  private pos = 0;
  private sampleRate: number;
  constructor(sampleRate: number, slot: InsertSlot) {
    this.sampleRate = sampleRate;
    const size = Math.ceil(sampleRate * 2.1);
    this.bufL = new Float32Array(size);
    this.bufR = new Float32Array(size);
    this.update(slot);
  }
  update(slot: InsertSlot): void {
    if (slot.kind !== 'delay') return;
    this.p = slot.params;
  }
  process(left: Float32Array, right: Float32Array, frames: number): void {
    const size = this.bufL.length;
    const delay = clamp(Math.round((this.p.timeMs / 1000) * this.sampleRate), 1, size - 1);
    const fb = this.p.feedback;
    const wet = this.p.mix;
    const dry = 1 - wet;
    let pos = this.pos;
    for (let i = 0; i < frames; i++) {
      const read = (pos - delay + size) % size;
      const dl = this.bufL[read];
      const dr = this.bufR[read];
      this.bufL[pos] = left[i] + dl * fb;
      this.bufR[pos] = right[i] + dr * fb;
      left[i] = left[i] * dry + dl * wet;
      right[i] = right[i] * dry + dr * wet;
      pos = (pos + 1) % size;
    }
    this.pos = pos;
  }
  reset(): void {
    this.bufL.fill(0);
    this.bufR.fill(0);
    this.pos = 0;
  }
}

export const createProcessor = (slot: InsertSlot, sampleRate: number): StereoProcessor => {
  switch (slot.kind) {
    case 'eq':
      return new EqProcessor(sampleRate, slot);
    case 'compressor':
      return new CompressorProcessor(sampleRate, slot);
    case 'gate':
      return new GateProcessor(sampleRate, slot);
    case 'limiter':
      return new LimiterProcessor(sampleRate, slot);
    case 'delay':
      return new DelayProcessor(sampleRate, slot);
    default:
      throw new Error('unknown insert');
  }
};

/** Keeps processor instances (and their state) across document updates, keyed by insert id. */
export class InsertChain {
  private procs = new Map<string, { kind: InsertSlot['kind']; proc: StereoProcessor }>();
  private order: InsertSlot[] = [];
  private sampleRate: number;
  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
  }

  update(slots: InsertSlot[]): void {
    const keep = new Set<string>();
    for (const slot of slots) {
      keep.add(slot.id);
      const existing = this.procs.get(slot.id);
      if (existing && existing.kind === slot.kind) existing.proc.update(slot);
      else this.procs.set(slot.id, { kind: slot.kind, proc: createProcessor(slot, this.sampleRate) });
    }
    for (const id of [...this.procs.keys()]) if (!keep.has(id)) this.procs.delete(id);
    this.order = slots;
  }

  process(left: Float32Array, right: Float32Array, frames: number): void {
    for (const slot of this.order) {
      if (slot.bypass) continue;
      this.procs.get(slot.id)?.proc.process(left, right, frames);
    }
  }

  /** Largest gain reduction (dB, ≤ 0) of the dynamics inserts in the last block. */
  reductionDb(): number {
    let r = 0;
    for (const { proc } of this.procs.values()) {
      if (proc instanceof CompressorProcessor || proc instanceof LimiterProcessor) r = Math.min(r, proc.reductionDb);
    }
    return r;
  }

  reset(): void {
    for (const { proc } of this.procs.values()) proc.reset();
  }
}

/* ─── pan ─── */

/**
 * Balance pan law with unity at centre: the centre position keeps both
 * channels at 0 dB (same level as the editor preview), turning towards one
 * side attenuates the other channel along a quarter cosine.
 */
export const panGains = (pan: number): [number, number] => {
  const p = clamp(Number.isFinite(pan) ? pan : 0, -1, 1);
  const left = p <= 0 ? 1 : Math.cos((p * Math.PI) / 2);
  const right = p >= 0 ? 1 : Math.cos((-p * Math.PI) / 2);
  return [left < 1e-7 ? 0 : left, right < 1e-7 ? 0 : right];
};
