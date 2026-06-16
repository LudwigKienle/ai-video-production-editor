import { CubeLut } from '../types';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const parseTuple = (parts: string[]) => parts.slice(0, 3).map((value) => Number.parseFloat(value)) as [number, number, number];

export const parseCubeLut = (text: string): CubeLut => {
  const lines = text.split(/\r?\n/);
  let title: string | undefined;
  let size = 0;
  let is3d = true;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  const data: number[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const keyword = parts[0].toUpperCase();

    if (keyword === 'TITLE') {
      const match = rawLine.match(/\"(.*)\"/);
      title = match ? match[1] : parts.slice(1).join(' ');
      continue;
    }
    if (keyword === 'LUT_3D_SIZE') {
      size = Number.parseInt(parts[1], 10);
      is3d = true;
      continue;
    }
    if (keyword === 'LUT_1D_SIZE') {
      size = Number.parseInt(parts[1], 10);
      is3d = false;
      continue;
    }
    if (keyword === 'DOMAIN_MIN') {
      domainMin = parseTuple(parts.slice(1));
      continue;
    }
    if (keyword === 'DOMAIN_MAX') {
      domainMax = parseTuple(parts.slice(1));
      continue;
    }

    if (parts.length >= 3) {
      const values = parseTuple(parts);
      if (!values.some((value) => Number.isNaN(value))) {
        data.push(values[0], values[1], values[2]);
      }
    }
  }

  if (!size || Number.isNaN(size)) {
    throw new Error('Missing LUT size in .cube file.');
  }

  const expectedLength = size * (is3d ? size * size : 1) * 3;
  if (data.length < expectedLength) {
    throw new Error(`Incomplete LUT data: expected ${expectedLength} values, found ${data.length}.`);
  }
  if (data.length > expectedLength) {
    data.length = expectedLength;
  }

  return {
    title,
    size,
    domainMin,
    domainMax,
    data: new Float32Array(data),
    is3d,
  };
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const normalizeChannel = (value: number, min: number, max: number) => {
  const range = max - min;
  if (!Number.isFinite(range) || range <= 0) return clamp(value, 0, 1);
  return clamp((value - min) / range, 0, 1);
};

const sample1d = (lut: CubeLut, r: number, g: number, b: number) => {
  const size = lut.size;
  const scale = size - 1;
  const data = lut.data;

  const sampleChannel = (value: number) => {
    const scaled = clamp(value, 0, 1) * scale;
    const i0 = Math.floor(scaled);
    const i1 = Math.min(i0 + 1, size - 1);
    const t = scaled - i0;
    const base0 = i0 * 3;
    const base1 = i1 * 3;
    return [
      lerp(data[base0], data[base1], t),
      lerp(data[base0 + 1], data[base1 + 1], t),
      lerp(data[base0 + 2], data[base1 + 2], t),
    ] as [number, number, number];
  };

  const [rOut] = sampleChannel(r);
  const [, gOut] = sampleChannel(g);
  const [, , bOut] = sampleChannel(b);
  return [rOut, gOut, bOut] as [number, number, number];
};

const sample3d = (lut: CubeLut, r: number, g: number, b: number) => {
  const size = lut.size;
  const scale = size - 1;
  const data = lut.data;

  const rScaled = clamp(r, 0, 1) * scale;
  const gScaled = clamp(g, 0, 1) * scale;
  const bScaled = clamp(b, 0, 1) * scale;

  const r0 = Math.floor(rScaled);
  const g0 = Math.floor(gScaled);
  const b0 = Math.floor(bScaled);
  const r1 = Math.min(r0 + 1, size - 1);
  const g1 = Math.min(g0 + 1, size - 1);
  const b1 = Math.min(b0 + 1, size - 1);

  const fr = rScaled - r0;
  const fg = gScaled - g0;
  const fb = bScaled - b0;

  const idx = (ri: number, gi: number, bi: number) => (ri * size * size + gi * size + bi) * 3;

  const c000 = idx(r0, g0, b0);
  const c001 = idx(r0, g0, b1);
  const c010 = idx(r0, g1, b0);
  const c011 = idx(r0, g1, b1);
  const c100 = idx(r1, g0, b0);
  const c101 = idx(r1, g0, b1);
  const c110 = idx(r1, g1, b0);
  const c111 = idx(r1, g1, b1);

  const r00 = lerp(data[c000], data[c001], fb);
  const r01 = lerp(data[c010], data[c011], fb);
  const r10 = lerp(data[c100], data[c101], fb);
  const r11 = lerp(data[c110], data[c111], fb);

  const g00 = lerp(data[c000 + 1], data[c001 + 1], fb);
  const g01 = lerp(data[c010 + 1], data[c011 + 1], fb);
  const g10 = lerp(data[c100 + 1], data[c101 + 1], fb);
  const g11 = lerp(data[c110 + 1], data[c111 + 1], fb);

  const b00 = lerp(data[c000 + 2], data[c001 + 2], fb);
  const b01 = lerp(data[c010 + 2], data[c011 + 2], fb);
  const b10 = lerp(data[c100 + 2], data[c101 + 2], fb);
  const b11 = lerp(data[c110 + 2], data[c111 + 2], fb);

  const r0v = lerp(r00, r01, fg);
  const r1v = lerp(r10, r11, fg);
  const g0v = lerp(g00, g01, fg);
  const g1v = lerp(g10, g11, fg);
  const b0v = lerp(b00, b01, fg);
  const b1v = lerp(b10, b11, fg);

  return [lerp(r0v, r1v, fr), lerp(g0v, g1v, fr), lerp(b0v, b1v, fr)] as [number, number, number];
};

export const applyCubeLutToImageData = (imageData: ImageData, lut: CubeLut, strength = 1) => {
  const data = imageData.data;
  const intensity = clamp(strength, 0, 1);
  if (intensity <= 0) return;

  const min = lut.domainMin;
  const max = lut.domainMax;
  const use3d = lut.is3d;

  for (let i = 0; i < data.length; i += 4) {
    const r = normalizeChannel(data[i] / 255, min[0], max[0]);
    const g = normalizeChannel(data[i + 1] / 255, min[1], max[1]);
    const b = normalizeChannel(data[i + 2] / 255, min[2], max[2]);

    const [lr, lg, lb] = use3d ? sample3d(lut, r, g, b) : sample1d(lut, r, g, b);

    const outR = lerp(data[i] / 255, lr, intensity);
    const outG = lerp(data[i + 1] / 255, lg, intensity);
    const outB = lerp(data[i + 2] / 255, lb, intensity);

    data[i] = Math.round(clamp(outR, 0, 1) * 255);
    data[i + 1] = Math.round(clamp(outG, 0, 1) * 255);
    data[i + 2] = Math.round(clamp(outB, 0, 1) * 255);
  }
};
