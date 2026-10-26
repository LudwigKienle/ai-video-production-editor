/**
 * Buckswood Post Plugins Deband v1.0 — parameter model.
 *
 * Port of `DebandCore::prepare()` / `applyPreset()` from
 * Buckswood_Deband/src/DebandCore.cpp (MIT, © Ludwig Kienle). The WebGL
 * shader and the CPU reference both consume `PreparedDeband`.
 *
 * Arithmetic is rounded to float32 (`Math.fround`) where the C++ core works in
 * float, so derived radii and thresholds are bit-identical to the plugin.
 */

export const DEBAND_PRESET_NAMES = [
  'Balanced',
  'Subtle 10-bit',
  '8-bit Sky Rescue',
  'AI Footage Gradient Repair',
  'Heavy Compression Rescue',
  'Manual',
] as const;

export const DEBAND_WORKING_SPACES = ['Auto / Wide Gamut', 'Display-Referred', 'Log', 'Scene-Linear HDR'] as const;
export const DEBAND_PRECISIONS = ['Auto', '8-bit', '10-bit', '12-bit'] as const;
export const DEBAND_DITHER_MODES = ['Static / Baselight Safe', 'Frame-Indexed'] as const;
export const DEBAND_VIEW_MODES = ['Result', 'Banding Map', 'Protected Detail', 'Difference x12'] as const;

/** Enum values of DebandCore.h. */
export const DebandPreset = { Balanced: 0, Subtle10Bit: 1, Sky8Bit: 2, AIFootage: 3, HeavyCompression: 4, Manual: 5 } as const;
export const DebandWorkingSpace = { Auto: 0, DisplayReferred: 1, Log: 2, SceneLinear: 3 } as const;
export const DebandPrecision = { Auto: 0, Bit8: 1, Bit10: 2, Bit12: 3 } as const;
export const DebandView = { Result: 0, BandingMap: 1, ProtectedDetail: 2, Difference: 3 } as const;

export type DebandControls = {
  preset: number;
  workingSpace: number;
  sourcePrecision: number;
  strength: number;
  detection: number;
  radius: number;
  edgeProtection: number;
  textureProtection: number;
  chromaRepair: number;
  dither: number;
  ditherMotion: number;
  seed: number;
  viewMode: number;
  outputMix: number;
};

/** Defaults identical to the OFX descriptor (`BuckswoodDebandOFX.cpp`) and `Controls{}`. */
export const DEBAND_DEFAULT_CONTROLS: DebandControls = {
  preset: 0,
  workingSpace: 0,
  sourcePrecision: 0,
  strength: 0.7,
  detection: 0.55,
  radius: 8,
  edgeProtection: 0.85,
  textureProtection: 0.8,
  chromaRepair: 0.35,
  dither: 0.35,
  ditherMotion: 0,
  seed: 1,
  viewMode: 0,
  outputMix: 1,
};

export type PreparedDeband = {
  /** Controls after preset trims and clamping (float32 values). */
  controls: DebandControls;
  frameIndex: number;
  radiusSmall: number;
  radiusMedium: number;
  radiusLarge: number;
  threshold: number;
  noiseFloor: number;
  codeStep: number;
};

const f32 = Math.fround;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const num = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'boolean' ? (value ? 1 : 0) : fallback;
/** C++ choice params are ints: truncate like `int(...)`. */
const INT_CONTROLS = new Set(['preset', 'workingSpace', 'sourcePrecision', 'ditherMotion', 'viewMode']);
/** std::lround for the non-negative values used here. */
const lround = (value: number) => Math.sign(value) * Math.floor(Math.abs(value) + 0.5);

export function controlsFromParams(params: Record<string, unknown>): DebandControls {
  const out = { ...DEBAND_DEFAULT_CONTROLS } as Record<string, number>;
  for (const [key, fallback] of Object.entries(DEBAND_DEFAULT_CONTROLS)) {
    const value = num(params[key], fallback);
    // OFX doubles reach the core as float.
    out[key] = INT_CONTROLS.has(key) ? Math.trunc(value) : f32(value);
  }
  return out as DebandControls;
}

/** `applyPreset()` — multiplicative trims and guard floors per preset. */
function applyPreset(c: DebandControls): void {
  const scale = (key: keyof DebandControls, factor: number) => {
    c[key] = f32(c[key] * f32(factor));
  };
  const floor = (key: keyof DebandControls, minimum: number) => {
    c[key] = Math.max(c[key], f32(minimum));
  };
  switch (c.preset) {
    case DebandPreset.Subtle10Bit:
      scale('strength', 0.68);
      scale('detection', 0.78);
      scale('radius', 0.68);
      floor('edgeProtection', 0.92);
      floor('textureProtection', 0.92);
      scale('chromaRepair', 0.58);
      scale('dither', 0.55);
      if (c.sourcePrecision === DebandPrecision.Auto) c.sourcePrecision = DebandPrecision.Bit10;
      break;
    case DebandPreset.Sky8Bit:
      scale('strength', 1.18);
      scale('detection', 1.28);
      scale('radius', 1.35);
      floor('edgeProtection', 0.86);
      floor('textureProtection', 0.84);
      scale('chromaRepair', 1.28);
      scale('dither', 1.55);
      if (c.sourcePrecision === DebandPrecision.Auto) c.sourcePrecision = DebandPrecision.Bit8;
      break;
    case DebandPreset.AIFootage:
      scale('strength', 1.04);
      scale('detection', 1.16);
      scale('radius', 1.15);
      floor('edgeProtection', 0.9);
      floor('textureProtection', 0.88);
      scale('chromaRepair', 0.88);
      scale('dither', 0.98);
      break;
    case DebandPreset.HeavyCompression:
      scale('strength', 1.32);
      scale('detection', 1.48);
      scale('radius', 1.75);
      scale('edgeProtection', 0.9);
      scale('textureProtection', 0.9);
      scale('chromaRepair', 1.7);
      scale('dither', 1.82);
      if (c.sourcePrecision === DebandPrecision.Auto) c.sourcePrecision = DebandPrecision.Bit8;
      break;
    default:
      // Balanced and Manual leave the controls untouched.
      break;
  }
}

export function prepareDeband(frame: { width: number; height: number; frameIndex: number }, input: DebandControls): PreparedDeband {
  const controls: DebandControls = { ...input };
  if (controls.preset !== DebandPreset.Manual) applyPreset(controls);

  controls.strength = clamp(controls.strength, 0, 1);
  controls.detection = clamp(controls.detection, 0, 1);
  controls.radius = clamp(controls.radius, 2, 24);
  controls.edgeProtection = clamp(controls.edgeProtection, 0, 1);
  controls.textureProtection = clamp(controls.textureProtection, 0, 1);
  controls.chromaRepair = clamp(controls.chromaRepair, 0, 1);
  controls.dither = clamp(controls.dither, 0, 1);
  controls.outputMix = clamp(controls.outputMix, 0, 1);
  controls.seed = clamp(controls.seed, 1, 1000);

  const radiusLarge = Math.max(2, lround(controls.radius));
  const radiusMedium = Math.max(2, lround(f32(controls.radius * f32(0.55))));
  const radiusSmall = Math.max(1, lround(f32(controls.radius * f32(0.25))));

  const precision = controls.sourcePrecision === DebandPrecision.Auto ? DebandPrecision.Bit10 : controls.sourcePrecision;
  const levels = precision === DebandPrecision.Bit8 ? 255 : precision === DebandPrecision.Bit12 ? 4095 : 1023;
  const codeStep = f32(1 / levels);
  const detectionScale = f32(f32(0.65) + f32(controls.detection * f32(1.5)));
  const threshold = clamp(f32(f32(codeStep * f32(5.5)) * detectionScale), f32(0.003), f32(0.055));
  const noiseFloor = Math.max(f32(0.00008), f32(codeStep * f32(f32(0.22) + f32(f32(0.25) * controls.detection))));

  return {
    controls,
    frameIndex: frame.frameIndex,
    radiusSmall,
    radiusMedium,
    radiusLarge,
    threshold,
    noiseFloor,
    codeStep,
  };
}
