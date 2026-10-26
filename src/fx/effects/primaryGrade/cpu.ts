/**
 * CPU reference of the primary grade (same math as shader.ts). Used by the
 * unit tests and the GPU parity check. Images are RGBA float32, row 0 =
 * bottom (OFX convention), like the other effect ports.
 */
import type { FxParamValues } from '../../types.ts';
import {
  CURVE_LUT_SIZE,
  blurTaps,
  buildCurveTexture,
  curvesFromParams,
  prepareGrade,
  type PreparedGrade,
} from './model.ts';

export type FloatImage = { width: number; height: number; data: Float32Array };
type V3 = [number, number, number];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smoothstep = (e0: number, e1: number, v: number) => {
  const t = clamp((v - e0) / Math.max(0.00001, e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const luma709 = (c: V3) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export function lgg(v: number, lift: number, gamma: number, gain: number): number {
  let o = lift * (1 - v) + gain * v;
  if (o > 0) o = Math.pow(o, Math.pow(2, -2 * gamma));
  return o;
}

function lut(tex: Float32Array, row: number, x: number): number {
  const c = clamp(x, 0, 1);
  const f = c * (CURVE_LUT_SIZE - 1);
  const i0 = Math.floor(f);
  const i1 = Math.min(i0 + 1, CURVE_LUT_SIZE - 1);
  const t = f - i0;
  const base = row * CURVE_LUT_SIZE;
  return mix(tex[base + i0], tex[base + i1], t) + (x - c);
}

function hueLut(tex: Float32Array, row: number, h: number): number {
  const f = (h - Math.floor(h)) * CURVE_LUT_SIZE;
  let i0 = Math.floor(f);
  const t = f - i0;
  i0 %= CURVE_LUT_SIZE;
  const i1 = i0 + 1 >= CURVE_LUT_SIZE ? 0 : i0 + 1;
  const base = row * CURVE_LUT_SIZE;
  return mix(tex[base + i0], tex[base + i1], t);
}

function rgb2hsv(c: V3): V3 {
  const mx = Math.max(c[0], c[1], c[2]);
  const mn = Math.min(c[0], c[1], c[2]);
  const d = mx - mn;
  let h = 0;
  if (d > 1e-6) {
    if (mx === c[0]) h = (c[1] - c[2]) / d;
    else if (mx === c[1]) h = 2 + (c[2] - c[0]) / d;
    else h = 4 + (c[0] - c[1]) / d;
    h /= 6;
    if (h < 0) h += 1;
  }
  return [h, mx > 1e-6 ? d / mx : 0, mx];
}

function hsv2rgb(c: V3): V3 {
  const h = (c[0] - Math.floor(c[0])) * 6;
  const [, s, v] = c;
  const r = clamp(Math.abs(h - 3) - 1, 0, 1);
  const g = clamp(2 - Math.abs(h - 2), 0, 1);
  const b = clamp(2 - Math.abs(h - 4), 0, 1);
  return [v * mix(1, r, s), v * mix(1, g, s), v * mix(1, b, s)];
}

function logWheel(s: PreparedGrade, v: number, sh: number, mi: number, hi: number) {
  const ws = 1 - smoothstep(s.logLow - 0.1, s.logLow + 0.1, v);
  const wh = smoothstep(s.logHighRange - 0.1, s.logHighRange + 0.1, v);
  const wm = Math.max(0, 1 - ws - wh);
  return v + 0.25 * (sh * ws + mi * wm + hi * wh);
}

/** The colour part of the node (grade pass) for one pixel. */
export function gradePixel(s: PreparedGrade, tex: Float32Array, input: V3): V3 {
  let v: V3 = [input[0] * s.wb[0] + s.offset[0], input[1] * s.wb[1] + s.offset[1], input[2] * s.wb[2] + s.offset[2]];
  if (s.logActive) v = [0, 1, 2].map((c) => logWheel(s, v[c], s.logShadow[c], s.logMid[c], s.logHigh[c])) as V3;
  const ganged = [0, 1, 2].map((c) => lgg(v[c], s.lift[c] + s.liftY, s.gamma[c] + s.gammaY, s.gain[c] * s.gainY)) as V3;
  const split = [0, 1, 2].map((c) => lgg(v[c], s.lift[c], s.gamma[c], s.gain[c])) as V3;
  const y = luma709(split);
  const dy = lgg(y, s.liftY, s.gammaY, s.gainY) - y;
  v = [0, 1, 2].map((c) => mix(ganged[c], split[c] + dy, s.lumMix)) as V3;
  v = v.map((x) => (x - s.pivot) * s.contrast + s.pivot) as V3;
  if (s.curvesActive) v = [lut(tex, 1, lut(tex, 0, v[0])), lut(tex, 2, lut(tex, 0, v[1])), lut(tex, 3, lut(tex, 0, v[2]))];
  const l = luma709(v);
  v = v.map((x) => l + (x - l) * s.saturation) as V3;
  const [r0, r1, r2] = s.hueRows;
  v = [
    r0[0] * v[0] + r0[1] * v[1] + r0[2] * v[2],
    r1[0] * v[0] + r1[1] * v[1] + r1[2] * v[2],
    r2[0] * v[0] + r2[1] * v[1] + r2[2] * v[2],
  ];
  if (s.hueCurvesActive) {
    const hsv = rgb2hsv(v);
    const shift = hueLut(tex, 4, hsv[0]) - 0.5;
    const satMul = hueLut(tex, 5, hsv[0]) * 2;
    const lumOff = hueLut(tex, 6, hsv[0]) - 0.5;
    const w = clamp(hsv[1], 0, 1);
    const shifted = hsv2rgb([hsv[0] + shift, Math.max(0, hsv[1] * satMul), hsv[2]]);
    v = [shifted[0] + lumOff * w, shifted[1] + lumOff * w, shifted[2] + lumOff * w];
  }
  return v.map((x, c) => (Number.isFinite(x) ? x : input[c])) as V3;
}

const range = (v: number, lo: number, hi: number, soft: number) => smoothstep(lo - soft, lo, v) * (1 - smoothstep(hi, hi + soft, v));

/** HSL qualifier key (0..1) of one input colour. */
export function qualifierMask(s: PreparedGrade, c: V3): number {
  const q = c.map((x) => clamp(x, 0, 1)) as V3;
  const mx = Math.max(q[0], q[1], q[2]);
  const mn = Math.min(q[0], q[1], q[2]);
  const l = 0.5 * (mx + mn);
  const d = mx - mn;
  let sat = d > 1e-6 ? d / Math.max(1e-6, 1 - Math.abs(2 * l - 1)) : 0;
  sat = clamp(sat, 0, 1);
  let h = 0;
  if (d > 1e-6) {
    if (mx === q[0]) h = (q[1] - q[2]) / d;
    else if (mx === q[1]) h = 2 + (q[2] - q[0]) / d;
    else h = 4 + (q[0] - q[1]) / d;
    h *= 60;
    if (h < 0) h += 360;
  }
  let dist = Math.abs(h - s.qualHue) % 360;
  dist = Math.min(dist, 360 - dist);
  const mh = 1 - smoothstep(s.qualHueWidth, s.qualHueWidth + s.qualHueSoft, dist);
  const ms = range(sat, s.qualSatLow, s.qualSatHigh, s.qualSatSoft);
  const ml = range(l, s.qualLumLow, s.qualLumHigh, s.qualLumSoft);
  const m = mix(1, mh, s.qualUse[0]) * mix(1, ms, s.qualUse[1]) * mix(1, ml, s.qualUse[2]);
  return s.qualInvert ? 1 - m : m;
}

/** Power window mask at pixel (x, y) — y counted from the bottom. */
export function windowMask(s: PreparedGrade, x: number, y: number, width: number, height: number): number {
  const u = (x + 0.5) / width;
  const vTop = 1 - (y + 0.5) / height;
  const dx = (u - s.winCenter[0]) * (width / height);
  const dy = vTop - s.winCenter[1];
  const cr = Math.cos(s.winRotation);
  const sr = Math.sin(s.winRotation);
  const rx = dx * cr + dy * sr;
  const ry = -dx * sr + dy * cr;
  let m: number;
  if (s.winType === 3) {
    const sw = Math.max(0.0005, s.winSoftness * 0.5);
    m = 1 - smoothstep(-sw, sw, ry);
  } else {
    const d = s.winType === 1 ? Math.hypot(rx / s.winSize[0], ry / s.winSize[1]) : Math.max(Math.abs(rx) / s.winSize[0], Math.abs(ry) / s.winSize[1]);
    const soft = s.winSoftness * 0.5;
    m = 1 - smoothstep(1 - soft, 1 + soft, d);
  }
  return s.winInvert ? 1 - m : m;
}

export function nodeMask(s: PreparedGrade, input: V3, x: number, y: number, width: number, height: number): number {
  let m = 1;
  if (s.qualEnabled) m *= qualifierMask(s, input);
  if (s.winType > 0) m *= windowMask(s, x, y, width, height);
  m = clamp(m * s.keyGain + s.keyOffset, 0, 1);
  return s.keyInvert ? 1 - m : m;
}

function blurAxis(img: Float32Array, width: number, height: number, sigma: number, taps: number, axis: 0 | 1): Float32Array {
  const out = new Float32Array(img.length);
  const inv = 1 / (2 * sigma * sigma);
  const weights = [1];
  for (let i = 1; i <= taps; i += 1) weights.push(Math.exp(-(i * i) * inv));
  const wsum = weights.reduce((a, w, i) => a + (i === 0 ? w : 2 * w), 0);
  const at = (x: number, y: number) => (clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1)) * 4;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        let acc = img[o + c];
        for (let i = 1; i <= taps; i += 1) {
          const a = axis === 0 ? at(x + i, y) : at(x, y + i);
          const b = axis === 0 ? at(x - i, y) : at(x, y - i);
          acc += weights[i] * (img[a + c] + img[b + c]);
        }
        out[o + c] = acc / wsum;
      }
      out[o + 3] = img[o + 3];
    }
  }
  return out;
}

function bilinear(img: Float32Array, width: number, height: number, px: number, py: number): number[] {
  const sx = clamp(px, 0, width - 1);
  const sy = clamp(py, 0, height - 1);
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = sx - x0;
  const ty = sy - y0;
  const out = [0, 0, 0, 0];
  for (let c = 0; c < 4; c += 1) {
    const a = img[(y0 * width + x0) * 4 + c] * (1 - tx) + img[(y0 * width + x1) * 4 + c] * tx;
    const b = img[(y1 * width + x0) * 4 + c] * (1 - tx) + img[(y1 * width + x1) * 4 + c] * tx;
    out[c] = a * (1 - ty) + b * ty;
  }
  return out;
}

/** Full node render on the CPU (all five passes). */
export function renderPrimaryGradeCpu(input: FloatImage, values: FxParamValues): FloatImage {
  const { width, height, data } = input;
  const s = prepareGrade(values, { width, height });
  const tex = buildCurveTexture(curvesFromParams(values));
  const graded = new Float32Array(data.length);
  for (let i = 0; i < width * height; i += 1) {
    const o = i * 4;
    const g = gradePixel(s, tex, [data[o], data[o + 1], data[o + 2]]);
    graded[o] = g[0];
    graded[o + 1] = g[1];
    graded[o + 2] = g[2];
    graded[o + 3] = data[o + 3];
  }
  let blurred: Float32Array = graded;
  if (s.blurMode !== 0) {
    const taps = blurTaps(s.blurSigma);
    blurred = blurAxis(blurAxis(graded, width, height, s.blurSigma, taps, 0), width, height, s.blurSigma, taps, 1);
  }
  const composed = new Float32Array(data.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      const orig: V3 = [data[o], data[o + 1], data[o + 2]];
      const m = nodeMask(s, orig, x, y, width, height);
      for (let c = 0; c < 3; c += 1) {
        const g = graded[o + c];
        const b = blurred[o + c];
        const corrected = s.blurMode === 1 ? b : s.blurMode === 2 ? g + (g - b) * s.sharpen : g;
        composed[o + c] = s.showMask ? m : mix(orig[c], corrected, m);
      }
      composed[o + 3] = data[o + 3];
    }
  }
  if (!s.sizingActive) return { width, height, data: composed };
  const out = new Float32Array(data.length);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const cr = Math.cos(s.sizeRotate);
  const sr = Math.sin(s.sizeRotate);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - cx - s.sizePan[0] * width;
      const dy = y - cy - s.sizePan[1] * height;
      let qx = (dx * cr + dy * sr) / s.sizeZoom;
      let qy = (-dx * sr + dy * cr) / s.sizeZoom;
      if (s.sizeFlip[0] > 0.5) qx = -qx;
      if (s.sizeFlip[1] > 0.5) qy = -qy;
      qx += cx;
      qy += cy;
      const o = (y * width + x) * 4;
      if (qx < -0.5 || qy < -0.5 || qx > width - 0.5 || qy > height - 0.5) continue;
      out.set(bilinear(composed, width, height, qx, qy), o);
    }
  }
  return { width, height, data: out };
}
