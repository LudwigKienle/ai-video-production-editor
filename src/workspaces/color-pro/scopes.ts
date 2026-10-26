/**
 * Scope binning for the Color page (Waveform, RGB Parade, Vectorscope,
 * Histogram). Runs on RGBA8 pixels of the graded viewer frame, read at a
 * reduced size (≈ 320 px wide), so it is cheap enough to run after each edit.
 */

export type ScopeData = {
  width: number;
  height: number;
  columns: number;
  levels: number;
  /** columns × levels luma density, index = column * levels + level (level 0 = black). */
  waveform: Uint32Array;
  /** Same layout per channel R, G, B. */
  parade: [Uint32Array, Uint32Array, Uint32Array];
  histogram: { r: Uint32Array; g: Uint32Array; b: Uint32Array; y: Uint32Array };
  vectorSize: number;
  /** vectorSize² density, row 0 = top (+Cr), column 0 = left (−Cb). */
  vectorscope: Uint32Array;
};

export type ScopeOptions = { columns?: number; levels?: number; vectorSize?: number };

const luma709 = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** BT.709 colour difference of an RGB triple (0..1) → Cb, Cr in −0.5..0.5. */
export function chroma709(r: number, g: number, b: number): [number, number] {
  const y = luma709(r, g, b);
  return [(b - y) / 1.8556, (r - y) / 1.5748];
}

/** Position of a colour on a vectorscope of the given size (x right = +Cb, y down = −Cr). */
export function vectorscopePosition(r: number, g: number, b: number, size: number): [number, number] {
  const [cb, cr] = chroma709(r, g, b);
  return [(cb + 0.5) * size, (0.5 - cr) * size];
}

const bin = (v: number, count: number) => Math.min(count - 1, Math.max(0, Math.floor((v / 256) * count)));

export function computeScopeData(data: ArrayLike<number>, width: number, height: number, options: ScopeOptions = {}): ScopeData {
  const columns = Math.max(1, Math.min(width, options.columns ?? Math.min(width, 256)));
  const levels = options.levels ?? 128;
  const vectorSize = options.vectorSize ?? 128;
  const waveform = new Uint32Array(columns * levels);
  const parade: [Uint32Array, Uint32Array, Uint32Array] = [new Uint32Array(columns * levels), new Uint32Array(columns * levels), new Uint32Array(columns * levels)];
  const histogram = { r: new Uint32Array(256), g: new Uint32Array(256), b: new Uint32Array(256), y: new Uint32Array(256) };
  const vectorscope = new Uint32Array(vectorSize * vectorSize);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const l = luma709(r, g, b);
      const column = Math.min(columns - 1, Math.floor((x * columns) / width));
      const base = column * levels;
      waveform[base + bin(l, levels)] += 1;
      parade[0][base + bin(r, levels)] += 1;
      parade[1][base + bin(g, levels)] += 1;
      parade[2][base + bin(b, levels)] += 1;
      histogram.r[r] += 1;
      histogram.g[g] += 1;
      histogram.b[b] += 1;
      histogram.y[Math.min(255, Math.round(l))] += 1;
      const [vx, vy] = vectorscopePosition(r / 255, g / 255, b / 255, vectorSize);
      const ix = Math.min(vectorSize - 1, Math.max(0, Math.floor(vx)));
      const iy = Math.min(vectorSize - 1, Math.max(0, Math.floor(vy)));
      vectorscope[iy * vectorSize + ix] += 1;
    }
  }
  return { width, height, columns, levels, waveform, parade, histogram, vectorSize, vectorscope };
}

/** 75 % colour bar targets for the vectorscope graticule. */
export const VECTOR_TARGETS: Array<{ label: string; rgb: [number, number, number] }> = [
  { label: 'R', rgb: [0.75, 0, 0] },
  { label: 'Mg', rgb: [0.75, 0, 0.75] },
  { label: 'B', rgb: [0, 0, 0.75] },
  { label: 'Cy', rgb: [0, 0.75, 0.75] },
  { label: 'G', rgb: [0, 0.75, 0] },
  { label: 'Yl', rgb: [0.75, 0.75, 0] },
];

/** Skin-tone indicator angle (≈ 123° on a 709 vectorscope), in radians from +Cb counter-clockwise. */
export const SKIN_TONE_ANGLE = (123 * Math.PI) / 180;

export type ChannelStats = { min: number; max: number; mean: number; p1: number; p50: number; p99: number; clippedLow: number; clippedHigh: number };
export type ScopeStats = {
  pixels: number;
  /** Values on a 0..1 scale; clipped* are fractions of pixels at 0 / 255. */
  r: ChannelStats;
  g: ChannelStats;
  b: ChannelStats;
  luma: ChannelStats;
  /** Mean colour difference (vectorscope centre of mass) and mean chroma, BT.709. */
  vector: { meanCb: number; meanCr: number; meanChroma: number; hueDegrees: number };
};

function channelStats(hist: Uint32Array, total: number): ChannelStats {
  let min = -1;
  let max = 0;
  let sum = 0;
  for (let i = 0; i < 256; i += 1) {
    if (!hist[i]) continue;
    if (min < 0) min = i;
    max = i;
    sum += i * hist[i];
  }
  const pct = (q: number) => {
    const target = q * total;
    let acc = 0;
    for (let i = 0; i < 256; i += 1) {
      acc += hist[i];
      if (acc >= target) return i;
    }
    return 255;
  };
  const r = (v: number) => Math.round((v / 255) * 10000) / 10000;
  const f = (v: number) => Math.round((v / Math.max(1, total)) * 10000) / 10000;
  return { min: r(Math.max(0, min)), max: r(max), mean: r(sum / Math.max(1, total)), p1: r(pct(0.01)), p50: r(pct(0.5)), p99: r(pct(0.99)), clippedLow: f(hist[0]), clippedHigh: f(hist[255]) };
}

/** Numbers an agent (or a test) can reason about instead of looking at the scopes. */
export function scopeStats(data: ScopeData): ScopeStats {
  const total = data.width * data.height;
  let sumCb = 0;
  let sumCr = 0;
  let sumChroma = 0;
  let count = 0;
  const n = data.vectorSize;
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const v = data.vectorscope[y * n + x];
      if (!v) continue;
      const cb = (x + 0.5) / n - 0.5;
      const cr = 0.5 - (y + 0.5) / n;
      sumCb += cb * v;
      sumCr += cr * v;
      sumChroma += Math.hypot(cb, cr) * v;
      count += v;
    }
  }
  const meanCb = sumCb / Math.max(1, count);
  const meanCr = sumCr / Math.max(1, count);
  const round = (v: number) => Math.round(v * 10000) / 10000;
  let hue = (Math.atan2(meanCr, meanCb) * 180) / Math.PI;
  if (hue < 0) hue += 360;
  return {
    pixels: total,
    r: channelStats(data.histogram.r, total),
    g: channelStats(data.histogram.g, total),
    b: channelStats(data.histogram.b, total),
    luma: channelStats(data.histogram.y, total),
    vector: { meanCb: round(meanCb), meanCr: round(meanCr), meanChroma: round(sumChroma / Math.max(1, count)), hueDegrees: Math.round(hue * 10) / 10 },
  };
}
