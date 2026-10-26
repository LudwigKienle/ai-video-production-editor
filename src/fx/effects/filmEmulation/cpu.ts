/**
 * CPU reference of Film Emulation v2.1 (same math as shader.ts and
 * `FilmEmulationCore::processPixel`, single-frame path). Used by tests and as
 * a fallback where WebGL2 is unavailable.
 *
 * Images are RGBA float32, row 0 = bottom (OFX convention).
 */
import { hash32, type FilmControls, type PreparedFilm } from './model.ts';

export type FloatImage = { width: number; height: number; data: Float32Array };

type Px = [number, number, number, number];

const F = Math.fround;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v: number) => clamp(v, 0, 1);
/** Core smoothstep (epsilon 0.0001 — not the engine's bw_smoothstep). */
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / Math.max(0.0001, e1 - e0));
  return t * t * (3 - 2 * t);
};
const safePow = (v: number, e: number) => Math.pow(Math.max(0, v), e);
const safeLog2 = (v: number) => Math.log2(Math.max(0.000001, v));
const luma = (p: Px | number[]) => 0.2627 * p[0] + 0.678 * p[1] + 0.0593 * p[2];
const mix = (a: Px, b: Px, t: number): Px => {
  const u = 1 - t;
  return [a[0] * u + b[0] * t, a[1] * u + b[1] * t, a[2] * u + b[2] * t, a[3] * u + b[3] * t];
};
const saturate = (p: Px, amount: number): Px => {
  const y = luma(p);
  return [y + (p[0] - y) * amount, y + (p[1] - y) * amount, y + (p[2] - y) * amount, p[3]];
};
const clampPixel = (p: Px): Px => [clamp(p[0], 0, 64), clamp(p[1], 0, 64), clamp(p[2], 0, 64), clamp01(p[3])];

/**
 * Port of the OFX `FloatSampler` of BuckswoodFilmEmulationOFX.cpp: bilinear,
 * but transparent black for any position outside [0, w-1] x [0, h-1] (so gate
 * weave and halation taps see black beyond the frame edge, like the plugin).
 */
export function makeSampler(image: FloatImage) {
  const { width, height, data } = image;
  return (x: number, y: number): Px => {
    if (x < 0 || x > width - 1 || y < 0 || y > height - 1) return [0, 0, 0, 0];
    const x0 = Math.trunc(x);
    const y0 = Math.trunc(y);
    const x1 = Math.min(width - 1, x0 + 1);
    const y1 = Math.min(height - 1, y0 + 1);
    const tx = x - x0;
    const ty = y - y0;
    const i00 = (y0 * width + x0) * 4;
    const i10 = (y0 * width + x1) * 4;
    const i01 = (y1 * width + x0) * 4;
    const i11 = (y1 * width + x1) * 4;
    const u = 1 - tx;
    const v = 1 - ty;
    const out: Px = [0, 0, 0, 0];
    for (let c = 0; c < 4; c += 1) {
      out[c] = (data[i00 + c] * u + data[i10 + c] * tx) * v + (data[i01 + c] * u + data[i11 + c] * tx) * ty;
    }
    return out;
  };
}

function decodeTransfer(value: number, space: number): number {
  const v = clamp(value, 0, 64);
  switch (space) {
    case 2: return v;
    case 3: return Math.pow(2, (v - 0.410557) * 7.5) * 0.18;
    case 4: return Math.pow(2, (v - 0.391) * 6.65) * 0.18;
    case 5: return Math.pow(2, (v - 0.278) * 7.85) * 0.18;
    case 6: return Math.pow(2, (v - 0.405) * 7.05) * 0.18;
    case 7: return Math.pow(2, (v - 0.38) * 6.45) * 0.18;
    default: return safePow(v, 2.4);
  }
}

function encodeTransfer(value: number, space: number): number {
  const v = Math.max(0, value);
  switch (space) {
    case 2: return v;
    case 3: return safeLog2(v / 0.18) / 7.5 + 0.410557;
    case 4: return safeLog2(v / 0.18) / 6.65 + 0.391;
    case 5: return safeLog2(v / 0.18) / 7.85 + 0.278;
    case 6: return safeLog2(v / 0.18) / 7.05 + 0.405;
    case 7: return safeLog2(v / 0.18) / 6.45 + 0.38;
    default: return safePow(v, 1 / 2.4);
  }
}

const decode = (p: Px, space: number): Px => [decodeTransfer(p[0], space), decodeTransfer(p[1], space), decodeTransfer(p[2], space), p[3]];
const encode = (p: Px, space: number): Px => {
  const hi = space === 2 ? 64 : 1;
  return [clamp(encodeTransfer(p[0], space), 0, hi), clamp(encodeTransfer(p[1], space), 0, hi), clamp(encodeTransfer(p[2], space), 0, hi), p[3]];
};

function filmCurve(p: Px, contrast: number, toe: number, shoulder: number, pivot: number): Px {
  const logPivot = safeLog2(pivot);
  const curve = (value: number) => {
    let v = Math.max(0, value);
    let logValue = safeLog2(v + 0.00001);
    logValue = logPivot + (logValue - logPivot) * contrast;
    v = Math.pow(2, logValue);
    if (toe > 0.0001) {
      const t = toe * 0.2;
      v = (v * (1 + t)) / (1 + t / Math.max(v, 0.00001));
    }
    if (shoulder > 0.0001) v = v / (1 + v * shoulder * 0.34);
    return Math.max(0, v);
  };
  return [curve(p[0]), curve(p[1]), curve(p[2]), p[3]];
}

function skinMask(p: Px): number {
  const sum = Math.max(0.0001, p[0] + p[1] + p[2]);
  const nr = p[0] / sum;
  const ng = p[1] / sum;
  const nb = p[2] / sum;
  const y = luma(p);
  const hueZone =
    smoothstep(0.32, 0.46, nr) * (1 - smoothstep(0.54, 0.68, nr)) * smoothstep(0.24, 0.36, ng) * (1 - smoothstep(0.4, 0.52, nb));
  const brightness = smoothstep(0.035, 0.14, y) * (1 - smoothstep(1.25, 2.2, y));
  const skinOrder = smoothstep(-0.06, 0.08, p[0] - p[2]);
  return clamp01(hueZone * brightness * skinOrder);
}

function subtractiveColor(p: Px, amount: number, skin: number): Px {
  const a = clamp01(amount) * (1 - skin * 0.62);
  if (a <= 0.0001) return p;
  const y = Math.max(0.0001, luma(p));
  const cr = (p[0] - y) / y;
  const cg = (p[1] - y) / y;
  const cb = (p[2] - y) / y;
  const sat = Math.max(Math.abs(cr), Math.max(Math.abs(cg), Math.abs(cb)));
  const density = 1 - clamp01(sat * a * 0.24);
  return [
    p[0] * (density - a * Math.max(0, -cr) * 0.08) + y * a * 0.01,
    p[1] * (density - a * Math.max(0, -cg) * 0.06) + y * a * 0.002,
    p[2] * (density - a * Math.max(0, -cb) * 0.1) - y * a * 0.008,
    p[3],
  ];
}

function temperatureTint(p: Px, temperature: number, tint: number, skin: number): Px {
  const protect = 1 - skin * 0.54;
  const temp = clamp(temperature, -1, 1) * protect;
  const tn = clamp(tint, -1, 1) * protect;
  return [p[0] * (1 + temp * 0.055 - tn * 0.01), p[1] * (1 + tn * 0.04), p[2] * (1 - temp * 0.06 - tn * 0.016), p[3]];
}

function developer(input: Px, c: FilmControls, skin: number): Px {
  const contrast = 1 + clamp(c.developerContrast, -1, 1) * 0.42;
  const gamma = 1 / Math.max(0.12, 1 + clamp(c.developerGamma, -1, 1) * 0.55);
  let p = filmCurve(input, contrast, 0.08 * Math.max(0, c.developerContrast), 0.12, 0.18);
  p = [safePow(p[0], gamma), safePow(p[1], gamma), safePow(p[2], gamma), p[3]];
  const y = luma(p);
  const sep = clamp01(c.colorSeparation) * (1 - skin * 0.5);
  if (sep > 0.0001) {
    p[0] = y + (p[0] - y) * (1 + sep * 0.42);
    p[1] = y + (p[1] - y) * (1 + sep * 0.3);
    p[2] = y + (p[2] - y) * (1 + sep * 0.46);
    p[0] -= Math.max(0, p[1] - p[0]) * sep * 0.035;
    p[2] -= Math.max(0, p[1] - p[2]) * sep * 0.025;
  }
  const boost = clamp(c.colorBoost, -1, 1);
  if (Math.abs(boost) > 0.0001) p = saturate(p, 1 + boost * 0.36 * (1 - skin * 0.45));
  return p;
}

function filmCompression(p: Px, c: FilmControls): Px {
  const impact = clamp01(c.filmCompression);
  if (impact <= 0.0001) return p;
  const whitePoint = clamp(c.compressionWhitePoint, 0.35, 4);
  const range = clamp(c.compressionRange, 0.05, 1);
  const density = clamp01(c.compressionColorDensity);
  const threshold = whitePoint * (1 - range * 0.42);
  const compress = (value: number) => {
    if (value <= threshold) return value;
    const over = value - threshold;
    const soft = threshold + over / (1 + over * impact * (1.8 / whitePoint));
    return value + (soft - value) * impact;
  };
  const out: Px = [compress(p[0]), compress(p[1]), compress(p[2]), p[3]];
  if (density > 0.0001) {
    const beforeY = Math.max(0.0001, luma(p));
    const afterY = Math.max(0.0001, luma(out));
    const lift = clamp(beforeY / afterY, 0.75, 1.35);
    const y = afterY;
    out[0] = y + (out[0] - y) * (1 + density * (lift - 1) * 0.72);
    out[1] = y + (out[1] - y) * (1 + density * (lift - 1) * 0.58);
    out[2] = y + (out[2] - y) * (1 + density * (lift - 1) * 0.66);
  }
  return out;
}

function expand(p: Px, c: FilmControls): Px {
  const black = clamp(c.expandBlackPoint, -1, 1) * 0.055;
  const white = clamp(c.expandWhitePoint, -1, 1) * 0.16;
  const scale = 1 + white - black;
  return [(p[0] - black) * scale, (p[1] - black) * scale, (p[2] - black) * scale, p[3]];
}

function printerLights(p: Px, c: FilmControls): Px {
  const cy = clamp(c.printerCyan, -1, 1);
  const mg = clamp(c.printerMagenta, -1, 1);
  const ye = clamp(c.printerYellow, -1, 1);
  return [
    p[0] * Math.pow(2, -cy * 0.115 + mg * 0.018 + ye * 0.012),
    p[1] * Math.pow(2, cy * 0.014 - mg * 0.11 + ye * 0.018),
    p[2] * Math.pow(2, cy * 0.02 + mg * 0.016 - ye * 0.118),
    p[3],
  ];
}

function applyStock(input: Px, s: PreparedFilm['stock'], c: FilmControls, skin: number): Px {
  const density = clamp(c.density + s.density, -1, 2);
  let p: Px = [input[0] * Math.pow(2, -density * 0.085), input[1] * Math.pow(2, -density * 0.07), input[2] * Math.pow(2, -density * 0.09), input[3]];
  p = temperatureTint(p, c.temperature + s.warmth * 8, c.tint + s.greenBias * 10, skin);
  p[2] *= 1 + s.blueBias;

  const neutral = clamp01(c.neutralizeCurves);
  const contrast = clamp(c.contrast * (s.contrast + (1 - s.contrast) * neutral), 0.25, 2.8);
  const toe = clamp((s.toe + Math.max(0, c.density) * 0.08) * (1 - neutral * 0.72), 0, 1.2);
  const shoulder = clamp((s.shoulder + c.highlightRolloff * 0.28) * (1 - neutral * 0.58), 0, 1.5);
  p = filmCurve(p, contrast, toe, shoulder, 0.18);
  p = saturate(p, clamp(c.saturation * s.saturation, 0, 2.2));

  const interlayer = clamp01(c.interlayer);
  if (interlayer > 0.0001) {
    const y = luma(p);
    const ri = Math.max(0, p[0] - y) * interlayer;
    const gi = Math.max(0, p[1] - y) * interlayer;
    const bi = Math.max(0, p[2] - y) * interlayer;
    const k = 1 - skin * 0.35;
    p[0] -= (gi * 0.025 + bi * 0.045) * k;
    p[1] -= (ri * 0.026 + bi * 0.02) * k;
    p[2] -= (ri * 0.048 + gi * 0.018) * k;
    p = saturate(p, 1 + interlayer * 0.08);
  }
  p = subtractiveColor(p, clamp01(c.subtractiveColor + s.subtractive), skin);

  if (s.pastel > 0.0001) {
    const q = clamp01(s.pastel);
    const y = luma(p);
    const pastel: Px = [
      y + (p[0] - y) * (1 - q * 0.32) + q * 0.01,
      y + (p[1] - y) * (1 - q * 0.26) + q * 0.008,
      y + (p[2] - y) * (1 - q * 0.28) + q * 0.006,
      p[3],
    ];
    p = mix(p, pastel, q);
  }
  if (s.monochrome > 0.0001) {
    const y = 0.3 * p[0] + 0.59 * p[1] + 0.11 * p[2];
    p = mix(p, [y, y, y, p[3]], clamp01(s.monochrome));
  }
  const bleach = clamp01(c.bleachBypass + s.silver);
  if (bleach > 0.0001) {
    const silver = clamp01(bleach);
    const gray = saturate(p, 0);
    const dense = filmCurve(p, 1 + silver * 0.22, silver * 0.12, silver * 0.12, 0.18);
    p = mix(dense, gray, silver * 0.42);
  }
  return p;
}

function applyPrint(input: Px, pr: PreparedFilm['print'], c: FilmControls): Px {
  let p = filmCurve(input, clamp(pr.contrast, 0.25, 2.8), pr.toe, pr.shoulder, 0.18);
  const y = luma(p);
  const shadow = 1 - smoothstep(0.03, 0.28, y);
  const highlight = smoothstep(0.3, 1.2, y);
  p[0] += highlight * pr.warmHighlights * 0.55 - shadow * pr.coolShadows * 0.014;
  p[1] += highlight * pr.warmHighlights * 0.12 + shadow * pr.coolShadows * 0.004;
  p[2] -= highlight * pr.warmHighlights * 0.18 - shadow * pr.coolShadows * 0.036;
  const blackDensity = clamp01(pr.blackDensity + Math.max(0, c.density) * 0.05);
  const k = 1 - shadow * blackDensity * 0.1;
  p = [p[0] * k, p[1] * k, p[2] * k, p[3]];
  p = saturate(p, pr.saturation);
  if (pr.silver > 0.0001) p = mix(p, saturate(p, 0), pr.silver * 0.34);
  return p;
}

/** `FilmEmulationCore::grainValue`, float32-exact up to the final pow. */
export function grainValue(x: number, y: number, state: PreparedFilm, channel: number, mode: number): number {
  const scale = state.grainScale;
  const fx = Math.floor(F(x / scale));
  const fy = Math.floor(F(y / scale));
  const frame = state.frameSeed;
  let n = hash32(F(fx + channel * 19), F(fy + F(frame * F(1.73))), F(11 + F(channel * F(3.1))));
  n = F(n + F(hash32(F(F(fx * F(2.1)) + F(frame * F(0.37))), F(F(fy * F(2.1)) + channel * 5), 23) * 0.5));
  n = F(n / 1.5);
  let centered = F(F(n * 2) - 1);
  if (mode === 1) {
    const fine = hash32(F(x + F(frame * 5)), y, 91 + channel);
    centered = F(F(centered * F(0.55)) + F(F(F(fine * 2) - 1) * F(0.45)));
  } else if (mode === 2) {
    centered = centered > 0 ? safePow(centered, 0.72) : -safePow(-centered, 0.72);
  } else if (mode === 3) {
    const mono = hash32(F(fx + F(frame * F(1.21))), fy, 55);
    centered = F(F(mono * 2) - 1);
  }
  return clamp(centered, -1, 1);
}

function opticalPass(sample: (x: number, y: number) => Px, x: number, y: number, center: Px, state: PreparedFilm): Px {
  const c = state.controls;
  if (state.haloAmount <= 0.0001 && state.bloomAmount <= 0.0001) return [0, 0, 0, center[3]];
  const centerY = luma(center);
  const radius = state.opticalRadius;
  const glow = [0, 0, 0];
  let haloSum = 0;
  let bloomSum = 0;
  const red = 0.72 + c.halationRedShift * 0.78;
  const blue = 0.3 - c.halationRedShift * 0.18;
  for (const [ox, oy] of OPTICAL_OFFSETS) {
    const s = decode(sample(x + ox * radius, y + oy * radius), c.inputSpace);
    const sy = luma(s);
    const highlight = smoothstep(0.54, 2.4, sy);
    const edgeEnergy = smoothstep(0.04, 0.48, sy - centerY) * clamp01(c.halationLocal) + smoothstep(0.82, 3.2, sy) * clamp01(c.halationGlobal);
    const halo = highlight * edgeEnergy;
    const bloom = smoothstep(Math.max(0.05, c.bloomThreshold), 3, sy);
    glow[0] += s[0] * (halo * red + bloom * 0.64);
    glow[1] += s[1] * (halo * 0.42 + bloom * 0.58);
    glow[2] += s[2] * (halo * blue + bloom * 0.52);
    haloSum += halo;
    bloomSum += bloom;
  }
  const inv = 1 / 8;
  const haloScale = state.haloAmount * clamp01(haloSum * inv * 1.6);
  const bloomScale = state.bloomAmount * clamp01(bloomSum * inv * 1.3);
  return [
    glow[0] * inv * (haloScale + bloomScale),
    glow[1] * inv * (haloScale * 0.7 + bloomScale),
    glow[2] * inv * (haloScale * 0.4 + bloomScale),
    center[3],
  ];
}

const OPTICAL_OFFSETS = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
  [-0.707, -0.707], [0.707, -0.707], [-0.707, 0.707], [0.707, 0.707],
];

function toneGrainMask(value: number, state: PreparedFilm): number {
  const c = state.controls;
  const shadowMask = 1 - smoothstep(0.08, 0.34, value);
  const highMask = smoothstep(0.48, 1.45, value);
  const midMask = clamp01(1 - shadowMask * 0.85 - highMask * 0.65);
  return state.grainProfileBias * (shadowMask * clamp01(c.grainShadows) + midMask * clamp01(c.grainMidtones) + highMask * clamp01(c.grainHighlights));
}

export function filmEmulationPixel(sample: (x: number, y: number) => Px, x: number, y: number, state: PreparedFilm): Px {
  const c = state.controls;
  const space = c.inputSpace;
  const sx = F(x + state.weaveX);
  const sy = F(y + state.weaveY);
  const dry = sample(x, y);
  // Temporal reconstruction needs neighbouring frames: identity here.
  const scene = clampPixel(decode(sample(sx, sy), space));
  const preTemporal: Px = [scene[0], scene[1], scene[2], scene[3]];
  const skin = skinMask(scene) * clamp01(c.skinProtect);
  scene[0] *= state.exposureGain;
  scene[1] *= state.exposureGain;
  scene[2] *= state.exposureGain;

  let worked: Px = [scene[0], scene[1], scene[2], scene[3]];
  if (state.colorStage) {
    worked = developer(worked, c, skin);
    worked = applyStock(worked, state.stock, c, skin);
    worked = filmCompression(worked, c);
  }
  const optics: Px = state.textureStage ? opticalPass(sample, sx, sy, scene, state) : [0, 0, 0, scene[3]];
  if (state.textureStage) worked = [worked[0] + optics[0], worked[1] + optics[1], worked[2] + optics[2], worked[3]];
  if (state.colorStage) {
    worked = printerLights(worked, c);
    worked = applyPrint(worked, state.print, c);
    worked = expand(worked, c);
    const roll = clamp01(c.highlightRolloff) * 1.35;
    if (roll > 0.0001) {
      for (let k = 0; k < 3; k += 1) worked[k] = worked[k] / (1 + worked[k] * roll * 0.22);
    }
    const lift = c.blackLift * 0.035;
    if (Math.abs(lift) > 0.0001) {
      const shadowMask = 1 - smoothstep(0.03, 0.24, luma(worked));
      for (let k = 0; k < 3; k += 1) worked[k] += lift * shadowMask;
    }
  }

  const yScene = luma(worked);
  const grainMask = toneGrainMask(yScene, state) * (0.55 + 0.45 * smoothstep(0.01, 0.12, yScene));
  if (state.textureStage && state.grainAmount > 0.0001) {
    const resolutionBlur = 1 + (1 - clamp01(c.filmResolution)) * 0.32;
    const base = state.grainAmount * grainMask * 0.042 * resolutionBlur;
    const mono = grainValue(x, y, state, 0, c.grainMode);
    const r = grainValue(x, y, state, 1, c.grainMode);
    const g = grainValue(x, y, state, 2, c.grainMode);
    const b = grainValue(x, y, state, 3, c.grainMode);
    const chroma = clamp01(c.grainChroma);
    worked[0] += base * (mono * (1 - chroma * 0.52) + r * chroma * 0.52);
    worked[1] += base * (mono * (1 - chroma * 0.38) + g * chroma * 0.38);
    worked[2] += base * (mono * (1 - chroma * 0.58) + b * chroma * 0.58);
  }

  const dust = clamp01(c.dust);
  if (state.textureStage && dust > 0.0001) {
    const staticDust = hash32(Math.floor(x / 3), Math.floor(y / 3), 37);
    const movingDust = hash32(Math.floor(x / 6), F(state.frameSeed + Math.floor(y / 19)), 81);
    const white = smoothstep(0.9975 - dust * 0.006, 1, staticDust) * 0.16 * dust;
    const black = smoothstep(0.997 - dust * 0.006, 1, movingDust) * 0.11 * dust;
    for (let k = 0; k < 3; k += 1) worked[k] = worked[k] * (1 - black) + white;
  }

  const scratches = clamp01(c.scratches);
  if (state.textureStage && scratches > 0.0001) {
    const column = hash32(Math.floor(x / 2), Math.floor(F(state.frameSeed / 3)), 301);
    const streak = smoothstep(0.998 - scratches * 0.006, 1, column);
    const broken = hash32(Math.floor(y / 11), state.frameSeed, 307);
    const line = streak * smoothstep(0.18, 0.92, broken) * scratches * 0.18;
    worked[0] += line;
    worked[1] += line * 0.92;
    worked[2] += line * 0.76;
  }

  if (c.viewMode === 1) {
    const gv = 0.5 + grainValue(x, y, state, 0, c.grainMode) * 0.5;
    return [gv, gv, gv, dry[3]];
  }
  if (c.viewMode === 2) {
    const oy = clamp01(luma(optics) * 5);
    return [oy, oy * 0.35, oy * 0.12, dry[3]];
  }
  if (c.viewMode === 3) {
    const dy = clamp01(luma(worked) / Math.max(0.0001, luma(scene) + 0.02));
    return [dy, dy, dy, dry[3]];
  }
  if (c.viewMode === 4) {
    const ty = clamp01((Math.abs(scene[0] - preTemporal[0]) + Math.abs(scene[1] - preTemporal[1]) + Math.abs(scene[2] - preTemporal[2])) * 2.4);
    return [ty, ty * 0.72, 1 - ty, dry[3]];
  }

  const encoded = encode(clampPixel(worked), space);
  encoded[3] = dry[3];
  return mix(dry, encoded, clamp01(c.outputMix));
}

/**
 * Port of `sourceLooksLikeBlankAdjustment()` (OFX glue): a 7×7 grid of the
 * source that is near-black and mostly opaque is treated as an empty
 * adjustment layer and rendered transparent.
 */
export function looksLikeBlankAdjustment(image: FloatImage): boolean {
  const { width, height, data } = image;
  if (width <= 0 || height <= 0) return false;
  let maxRgb = 0;
  let alphaSum = 0;
  let samples = 0;
  for (let gy = 0; gy < 7; gy += 1) {
    const y = Math.trunc(((height - 1) * gy) / 6);
    for (let gx = 0; gx < 7; gx += 1) {
      const x = Math.trunc(((width - 1) * gx) / 6);
      const i = (y * width + x) * 4;
      maxRgb = Math.max(maxRgb, data[i], data[i + 1], data[i + 2]);
      alphaSum += data[i + 3];
      samples += 1;
      if (maxRgb > F(0.015)) return false;
    }
  }
  return samples > 0 && alphaSum / samples > 0.75 && maxRgb < F(0.015);
}

export function renderFilmEmulationCpu(image: FloatImage, state: PreparedFilm): FloatImage {
  const out = new Float32Array(image.width * image.height * 4);
  if (state.controls.adjustmentLayerGuard && looksLikeBlankAdjustment(image)) {
    return { width: image.width, height: image.height, data: out };
  }
  const sample = makeSampler(image);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const p = filmEmulationPixel(sample, x, y, state);
      const i = (y * image.width + x) * 4;
      out[i] = p[0];
      out[i + 1] = p[1];
      out[i + 2] = p[2];
      out[i + 3] = p[3];
    }
  }
  return { width: image.width, height: image.height, data: out };
}
