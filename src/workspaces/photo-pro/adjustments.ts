/**
 * Adjustment layers (Korrekturen). Pure pixel maths on unpremultiplied RGBA
 * bytes, so it runs in tests and on the compositor's canvases alike.
 * Tone curves are precomputed into 256-entry LUTs; only Hue/Saturation and
 * luminosity-preserving Colour Balance need per-pixel work.
 */

export type BrightnessContrast = { type: 'brightnessContrast'; brightness: number; contrast: number };
export type HueSaturation = { type: 'hueSaturation'; hue: number; saturation: number; lightness: number };
export type Exposure = { type: 'exposure'; exposure: number; offset: number; gamma: number };
export type Curves = { type: 'curves'; points: Array<[number, number]> };
export type Rgb3 = [number, number, number];
export type ColorBalance = {
  type: 'colorBalance';
  shadows: Rgb3;
  midtones: Rgb3;
  highlights: Rgb3;
  preserveLuminosity: boolean;
};
export type Invert = { type: 'invert' };
/** Result of the neural (AI) looks: CSS-filter style values, rendered with ctx.filter. */
export type Look = { type: 'look'; brightness: number; contrast: number; saturate: number; hue: number; blur: number };

export type Adjustment = BrightnessContrast | HueSaturation | Exposure | Curves | ColorBalance | Invert | Look;
export type AdjustmentType = Adjustment['type'];

export const ADJUSTMENT_LABELS: Record<AdjustmentType, string> = {
  brightnessContrast: 'Helligkeit/Kontrast',
  hueSaturation: 'Farbton/Sättigung',
  exposure: 'Belichtung',
  curves: 'Gradationskurven',
  colorBalance: 'Farbbalance',
  invert: 'Umkehren',
  look: 'Neural-Look',
};

export function defaultAdjustment(type: AdjustmentType): Adjustment {
  switch (type) {
    case 'brightnessContrast': return { type, brightness: 0, contrast: 0 };
    case 'hueSaturation': return { type, hue: 0, saturation: 0, lightness: 0 };
    case 'exposure': return { type, exposure: 0, offset: 0, gamma: 1 };
    case 'curves': return { type, points: [[0, 0], [255, 255]] };
    case 'colorBalance': return { type, shadows: [0, 0, 0], midtones: [0, 0, 0], highlights: [0, 0, 0], preserveLuminosity: true };
    case 'invert': return { type };
    case 'look': return { type, brightness: 100, contrast: 100, saturate: 100, hue: 0, blur: 0 };
    default: return { type: 'invert' };
  }
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const clampByte = (v: number) => (v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v));

export const identityLut = () => {
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i += 1) lut[i] = i;
  return lut;
};

/**
 * Brightness −150…150 bends the midtones (black and white points stay put),
 * contrast −50…100 is an S-free linear stretch around mid grey.
 */
export function brightnessContrastLut(brightness: number, contrast: number) {
  const lut = new Uint8ClampedArray(256);
  const b = clamp(brightness, -150, 150) / 150;
  const gamma = Math.pow(2, -b * 1.25);
  const c = clamp(contrast, -50, 100) / 100;
  const k = c >= 0 ? 1 / Math.max(0.0001, 1 - c * 0.85) : 1 + c;
  for (let i = 0; i < 256; i += 1) {
    let v = Math.pow(i / 255, gamma);
    v = (v - 0.5) * k + 0.5;
    lut[i] = clampByte(v * 255);
  }
  return lut;
}

export const srgbToLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
export const linearToSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

/** Exposure in stops, offset and gamma applied in linear light (like Photoshop). */
export function exposureLut(exposure: number, offset: number, gamma: number) {
  const lut = new Uint8ClampedArray(256);
  const gain = Math.pow(2, clamp(exposure, -20, 20));
  const g = clamp(gamma, 0.01, 9.99);
  for (let i = 0; i < 256; i += 1) {
    let lin = srgbToLinear(i / 255) * gain + offset;
    lin = lin <= 0 ? 0 : Math.pow(lin, 1 / g);
    lut[i] = clampByte(linearToSrgb(clamp(lin, 0, 1)) * 255);
  }
  return lut;
}

/** Monotone cubic (Fritsch–Carlson) curve through the control points (0…255). */
export function curvesLut(points: Array<[number, number]>) {
  const pts = points
    .map(([x, y]) => [clamp(x, 0, 255), clamp(y, 0, 255)] as [number, number])
    .sort((a, b) => a[0] - b[0])
    .filter((p, i, arr) => i === 0 || p[0] > arr[i - 1][0]);
  const lut = new Uint8ClampedArray(256);
  if (pts.length === 0) return identityLut();
  if (pts.length === 1) { lut.fill(clampByte(pts[0][1])); return lut; }
  const n = pts.length;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    dx.push(pts[i + 1][0] - pts[i][0]);
    slope.push((pts[i + 1][1] - pts[i][1]) / dx[i]);
  }
  const m: number[] = new Array(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i += 1) m[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  for (let i = 0; i < n - 1; i += 1) {
    if (slope[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / slope[i];
    const b = m[i + 1] / slope[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * slope[i];
      m[i + 1] = t * b * slope[i];
    }
  }
  let seg = 0;
  for (let x = 0; x < 256; x += 1) {
    if (x <= pts[0][0]) { lut[x] = clampByte(pts[0][1]); continue; }
    if (x >= pts[n - 1][0]) { lut[x] = clampByte(pts[n - 1][1]); continue; }
    while (seg < n - 2 && x > pts[seg + 1][0]) seg += 1;
    const h = dx[seg];
    const t = (x - pts[seg][0]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    const y = (2 * t3 - 3 * t2 + 1) * pts[seg][1]
      + (t3 - 2 * t2 + t) * h * m[seg]
      + (-2 * t3 + 3 * t2) * pts[seg + 1][1]
      + (t3 - t2) * h * m[seg + 1];
    lut[x] = clampByte(y);
  }
  return lut;
}

/** Tonal-range weights used by Colour Balance (sum ≤ 1, peaks at 0, 128, 255). */
export function toneWeights(v: number): Rgb3 {
  const t = v / 255;
  const shadows = clamp(1 - t / 0.5, 0, 1);
  const highlights = clamp((t - 0.5) / 0.5, 0, 1);
  const midtones = 1 - shadows - highlights;
  return [shadows * shadows, midtones, highlights * highlights];
}

/** One LUT per channel: R (cyan–red), G (magenta–green), B (yellow–blue). */
export function colorBalanceLuts(cb: ColorBalance): [Uint8ClampedArray, Uint8ClampedArray, Uint8ClampedArray] {
  const luts: [Uint8ClampedArray, Uint8ClampedArray, Uint8ClampedArray] = [new Uint8ClampedArray(256), new Uint8ClampedArray(256), new Uint8ClampedArray(256)];
  for (let i = 0; i < 256; i += 1) {
    const [ws, wm, wh] = toneWeights(i);
    for (let c = 0; c < 3; c += 1) {
      const amount = (cb.shadows[c] * ws + cb.midtones[c] * wm + cb.highlights[c] * wh) / 100;
      luts[c][i] = clampByte(i + amount * 80);
    }
  }
  return luts;
}

export const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255; const gn = g / 255; const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [h * 60, s, l];
}

const hue2rgb = (p: number, q: number, t: number) => {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
};

export function hslToRgb(h: number, s: number, l: number): Rgb3 {
  if (s <= 0) { const v = clampByte(l * 255); return [v, v, v]; }
  const hh = (((h % 360) + 360) % 360) / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    clampByte(hue2rgb(p, q, hh + 1 / 3) * 255),
    clampByte(hue2rgb(p, q, hh) * 255),
    clampByte(hue2rgb(p, q, hh - 1 / 3) * 255),
  ];
}

/** CSS filter string for the neural "look" adjustment. */
export const lookFilter = (look: Look) => [
  `brightness(${look.brightness}%)`,
  `contrast(${look.contrast}%)`,
  `saturate(${look.saturate}%)`,
  `hue-rotate(${look.hue}deg)`,
  look.blur > 0 ? `blur(${look.blur}px)` : '',
].filter(Boolean).join(' ');

/** True when the adjustment cannot change pixels (skipped while compositing). */
export function isIdentityAdjustment(adj: Adjustment): boolean {
  switch (adj.type) {
    case 'brightnessContrast': return adj.brightness === 0 && adj.contrast === 0;
    case 'hueSaturation': return adj.hue === 0 && adj.saturation === 0 && adj.lightness === 0;
    case 'exposure': return adj.exposure === 0 && adj.offset === 0 && adj.gamma === 1;
    case 'curves': return adj.points.every(([x, y]) => x === y);
    case 'colorBalance': return [...adj.shadows, ...adj.midtones, ...adj.highlights].every((v) => v === 0);
    case 'invert': return false;
    case 'look': return adj.brightness === 100 && adj.contrast === 100 && adj.saturate === 100 && adj.hue === 0 && adj.blur === 0;
    default: return true;
  }
}

/** Applies a (non-"look") adjustment in place to RGBA bytes. */
export function applyAdjustment(data: Uint8ClampedArray, adj: Adjustment): void {
  if (adj.type === 'look' || isIdentityAdjustment(adj)) return;
  const len = data.length;
  if (adj.type === 'invert') {
    for (let i = 0; i < len; i += 4) {
      data[i] = 255 - data[i]; data[i + 1] = 255 - data[i + 1]; data[i + 2] = 255 - data[i + 2];
    }
    return;
  }
  if (adj.type === 'hueSaturation') {
    const sat = clamp(adj.saturation, -100, 100) / 100;
    const light = clamp(adj.lightness, -100, 100) / 100;
    for (let i = 0; i < len; i += 4) {
      if (data[i + 3] === 0) continue;
      let [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
      h += adj.hue;
      // Greys stay grey: saturation scales, it never invents a hue.
      s = Math.min(1, s * (1 + sat * (sat >= 0 ? 1.5 : 1)));
      l = light >= 0 ? l + (1 - l) * light : l * (1 + light);
      const [r, g, b] = hslToRgb(h, s, l);
      data[i] = r; data[i + 1] = g; data[i + 2] = b;
    }
    return;
  }
  if (adj.type === 'colorBalance') {
    const [lr, lg, lb] = colorBalanceLuts(adj);
    for (let i = 0; i < len; i += 4) {
      if (data[i + 3] === 0) continue;
      const r0 = data[i]; const g0 = data[i + 1]; const b0 = data[i + 2];
      let r = lr[r0]; let g = lg[g0]; let b = lb[b0];
      if (adj.preserveLuminosity) {
        const d = luma(r0, g0, b0) - luma(r, g, b);
        r = clampByte(r + d); g = clampByte(g + d); b = clampByte(b + d);
      }
      data[i] = r; data[i + 1] = g; data[i + 2] = b;
    }
    return;
  }
  const lut = adj.type === 'brightnessContrast'
    ? brightnessContrastLut(adj.brightness, adj.contrast)
    : adj.type === 'exposure'
      ? exposureLut(adj.exposure, adj.offset, adj.gamma)
      : curvesLut(adj.points);
  for (let i = 0; i < len; i += 4) {
    data[i] = lut[data[i]]; data[i + 1] = lut[data[i + 1]]; data[i + 2] = lut[data[i + 2]];
  }
}

/** Neural presets return CSS-filter values; normalise/clamp them like the old Adjust panel. */
export function lookFromAiFilters(filters: any): Look {
  const rawHue = Number(filters?.hueRotate ?? filters?.hue ?? 0);
  const normalizedHue = rawHue > 180 ? rawHue - 360 : rawHue;
  return {
    type: 'look',
    brightness: clamp(Math.round(Number(filters?.brightness ?? 100)), 50, 150),
    contrast: clamp(Math.round(Number(filters?.contrast ?? 100)), 50, 150),
    saturate: clamp(Math.round(Number(filters?.saturate ?? 100)), 50, 150),
    hue: clamp(Math.round(Number.isFinite(normalizedHue) ? normalizedHue : 0), -180, 180),
    blur: clamp(Math.round(Number(filters?.blur ?? 0)), 0, 20),
  };
}
