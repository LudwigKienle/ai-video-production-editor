import type { CubeLut } from '../types';

/**
 * Primary colour wheels in the DaVinci Resolve sense: Lift (shadows), Gamma
 * (midtones), Gain (highlights) and Offset (everything), each with an RGB tint
 * and a master (luma) trim, plus global temperature / tint / contrast /
 * saturation. The grade is baked into a 3D LUT so the existing preview and
 * render pipeline (which already understands .cube LUTs) can apply it.
 */

export type ColorWheelValue = {
  /** Horizontal / vertical position on the wheel, each in -1..1. */
  x: number;
  y: number;
  /** Master (Y) trim in -1..1. */
  y_master: number;
};

export type ColorWheelGrade = {
  lift: ColorWheelValue;
  gamma: ColorWheelValue;
  gain: ColorWheelValue;
  offset: ColorWheelValue;
  /** -1..1, negative is cooler (blue), positive warmer (amber). */
  temperature: number;
  /** -1..1, negative is greener, positive more magenta. */
  tint: number;
  /** 0..2, 1 = unchanged. */
  contrast: number;
  /** 0..1 pivot for contrast. */
  pivot: number;
  /** 0..2, 1 = unchanged. */
  saturation: number;
  /** Degrees, -180..180. */
  hue: number;
};

const neutralWheel = (): ColorWheelValue => ({ x: 0, y: 0, y_master: 0 });

export const DEFAULT_COLOR_WHEEL_GRADE: ColorWheelGrade = {
  lift: neutralWheel(),
  gamma: neutralWheel(),
  gain: neutralWheel(),
  offset: neutralWheel(),
  temperature: 0,
  tint: 0,
  contrast: 1,
  pivot: 0.435,
  saturation: 1,
  hue: 0,
};

export const isNeutralColorWheelGrade = (grade?: ColorWheelGrade | null) => {
  if (!grade) return true;
  const wheels = [grade.lift, grade.gamma, grade.gain, grade.offset];
  const wheelsNeutral = wheels.every((wheel) => Math.abs(wheel.x) < 1e-4 && Math.abs(wheel.y) < 1e-4 && Math.abs(wheel.y_master) < 1e-4);
  return wheelsNeutral
    && Math.abs(grade.temperature) < 1e-4
    && Math.abs(grade.tint) < 1e-4
    && Math.abs(grade.contrast - 1) < 1e-4
    && Math.abs(grade.saturation - 1) < 1e-4
    && Math.abs(grade.hue) < 1e-4;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Converts a wheel position into per-channel RGB offsets. The wheel is laid out
 * like Resolve's: red at 0°, green at 120°, blue at 240°, so pushing toward a
 * colour raises that channel and lowers the opposite two.
 */
export const wheelToRgb = (wheel: ColorWheelValue, strength = 1): [number, number, number] => {
  const radius = Math.min(1, Math.hypot(wheel.x, wheel.y));
  if (radius < 1e-6) return [0, 0, 0];
  const angle = Math.atan2(-wheel.y, wheel.x); // screen y is down
  const r = Math.cos(angle);
  const g = Math.cos(angle - (2 * Math.PI) / 3);
  const b = Math.cos(angle + (2 * Math.PI) / 3);
  const scale = radius * strength;
  return [r * scale, g * scale, b * scale];
};

const rotateHue = (rgb: [number, number, number], degrees: number): [number, number, number] => {
  if (Math.abs(degrees) < 1e-6) return rgb;
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Rodrigues rotation around the grey axis (1,1,1)/sqrt(3).
  const k = 1 / 3;
  const s = Math.sqrt(1 / 3);
  const m = [
    cos + (1 - cos) * k, (1 - cos) * k - s * sin, (1 - cos) * k + s * sin,
    (1 - cos) * k + s * sin, cos + (1 - cos) * k, (1 - cos) * k - s * sin,
    (1 - cos) * k - s * sin, (1 - cos) * k + s * sin, cos + (1 - cos) * k,
  ];
  const [r, g, b] = rgb;
  return [
    m[0] * r + m[1] * g + m[2] * b,
    m[3] * r + m[4] * g + m[5] * b,
    m[6] * r + m[7] * g + m[8] * b,
  ];
};

/** Applies the grade to one RGB triple in 0..1 (sRGB-ish, no gamma linearisation for speed). */
export const gradeColor = (input: [number, number, number], grade: ColorWheelGrade): [number, number, number] => {
  const lift = wheelToRgb(grade.lift, 0.35);
  const gamma = wheelToRgb(grade.gamma, 0.5);
  const gain = wheelToRgb(grade.gain, 0.5);
  const offset = wheelToRgb(grade.offset, 0.35);
  const liftMaster = grade.lift.y_master * 0.35;
  const gammaMaster = grade.gamma.y_master * 0.6;
  const gainMaster = grade.gain.y_master * 0.5;
  const offsetMaster = grade.offset.y_master * 0.35;
  // Temperature shifts red against blue, tint shifts green against magenta.
  const temp = grade.temperature * 0.18;
  const tint = grade.tint * 0.14;
  const balance: [number, number, number] = [temp - tint * 0.5, tint, -temp - tint * 0.5];

  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c += 1) {
    let v = input[c];
    // Offset: uniform shift.
    v += offset[c] + offsetMaster + balance[c] * 0.5;
    // Lift: affects shadows most, fades out toward white.
    v += (lift[c] + liftMaster) * (1 - clamp01(v));
    // Gain: multiplies, affects highlights most.
    v *= 1 + gain[c] + gainMaster;
    // Gamma: power curve around midtones.
    const gammaAmount = clamp(1 - (gamma[c] + gammaMaster) * 0.8, 0.2, 5);
    v = v > 0 ? Math.pow(clamp01(v), gammaAmount) : 0;
    // Contrast around pivot.
    v = grade.pivot + (v - grade.pivot) * grade.contrast;
    out[c] = v;
  }

  // Saturation and hue in a simple luma-preserving space.
  const luma = 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2];
  let result: [number, number, number] = [
    luma + (out[0] - luma) * grade.saturation,
    luma + (out[1] - luma) * grade.saturation,
    luma + (out[2] - luma) * grade.saturation,
  ];
  result = rotateHue(result, grade.hue);
  return [clamp01(result[0]), clamp01(result[1]), clamp01(result[2])];
};

/** Bakes the grade into a 3D LUT compatible with the app's .cube pipeline. */
export const buildCubeLutFromGrade = (grade: ColorWheelGrade, size = 17, title = 'Color Wheels'): CubeLut => {
  const data: number[] = [];
  for (let b = 0; b < size; b += 1) {
    for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size; r += 1) {
        const graded = gradeColor([r / (size - 1), g / (size - 1), b / (size - 1)], grade);
        data.push(graded[0], graded[1], graded[2]);
      }
    }
  }
  return {
    title,
    size,
    is3d: true,
    domainMin: [0, 0, 0],
    domainMax: [1, 1, 1],
    data: Float32Array.from(data),
  };
};

export const serializeGradeAsCube = (grade: ColorWheelGrade, size = 33, title = 'Color Wheels') => {
  const lines: string[] = [`TITLE "${title}"`, `LUT_3D_SIZE ${size}`, 'DOMAIN_MIN 0.0 0.0 0.0', 'DOMAIN_MAX 1.0 1.0 1.0'];
  for (let b = 0; b < size; b += 1) {
    for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size; r += 1) {
        const graded = gradeColor([r / (size - 1), g / (size - 1), b / (size - 1)], grade);
        lines.push(`${graded[0].toFixed(6)} ${graded[1].toFixed(6)} ${graded[2].toFixed(6)}`);
      }
    }
  }
  return lines.join('\n');
};

export type ColorWheelPreset = { id: string; label: string; grade: Partial<ColorWheelGrade> };

export const COLOR_WHEEL_PRESETS: ColorWheelPreset[] = [
  { id: 'teal-orange', label: 'Teal & Orange', grade: { lift: { x: -0.35, y: 0.25, y_master: -0.05 }, gain: { x: 0.35, y: -0.15, y_master: 0.05 }, saturation: 1.1 } },
  { id: 'bleach', label: 'Bleach Bypass', grade: { contrast: 1.25, saturation: 0.55, gamma: { x: 0, y: 0, y_master: 0.05 } } },
  { id: 'warm-film', label: 'Warm Film', grade: { temperature: 0.35, lift: { x: 0.15, y: 0.1, y_master: 0.03 }, gamma: { x: 0.1, y: -0.05, y_master: 0 }, contrast: 1.08 } },
  { id: 'cool-night', label: 'Cool Night', grade: { temperature: -0.45, lift: { x: -0.2, y: 0.2, y_master: -0.08 }, saturation: 0.9, contrast: 1.12 } },
  { id: 'lifted-matte', label: 'Lifted Matte', grade: { lift: { x: 0, y: 0, y_master: 0.14 }, contrast: 0.88, saturation: 0.9 } },
  { id: 'punchy', label: 'Punchy', grade: { contrast: 1.2, saturation: 1.2, gain: { x: 0, y: 0, y_master: 0.06 } } },
];

export const applyColorWheelPreset = (base: ColorWheelGrade, preset: ColorWheelPreset): ColorWheelGrade => ({
  ...DEFAULT_COLOR_WHEEL_GRADE,
  ...base,
  ...preset.grade,
  lift: { ...neutralWheel(), ...(preset.grade.lift || base.lift) },
  gamma: { ...neutralWheel(), ...(preset.grade.gamma || base.gamma) },
  gain: { ...neutralWheel(), ...(preset.grade.gain || base.gain) },
  offset: { ...neutralWheel(), ...(preset.grade.offset || base.offset) },
});

/** Simple RGB histogram + luma waveform sampling from an image, for on-page scopes. */
export const computeScopes = (image: HTMLImageElement | HTMLCanvasElement, columns = 128) => {
  const canvas = document.createElement('canvas');
  const width = 256;
  const height = 144;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  const histogram = { r: new Uint32Array(256), g: new Uint32Array(256), b: new Uint32Array(256), l: new Uint32Array(256) };
  const waveform: Float32Array[] = Array.from({ length: columns }, () => new Float32Array(64));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const l = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
      histogram.r[r] += 1;
      histogram.g[g] += 1;
      histogram.b[b] += 1;
      histogram.l[l] += 1;
      const column = Math.min(columns - 1, Math.floor((x / width) * columns));
      waveform[column][Math.min(63, Math.floor((l / 255) * 63))] += 1;
    }
  }
  return { histogram, waveform, width, height };
};
