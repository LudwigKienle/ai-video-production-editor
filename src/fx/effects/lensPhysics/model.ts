/**
 * Buckswood Post Plugins Lens Physics v0.5 — parameter model.
 *
 * Port of `LensPhysicsCore::prepare()` / `modelForPreset()` from
 * Buckswood_Lens_Physics/src/LensPhysicsCore.cpp (MIT, © Ludwig Kienle),
 * buckswood-post-plugins@2b898e7. Keep in sync with the C++ core: the WebGL
 * shader and the CPU reference both consume `PreparedLensPhysics`.
 */

/** Choice labels of the OFX "lensPreset" param, in index order. */
export const LENS_PRESET_NAMES = [
  'Neutral / Manual',
  'Clean Cinema Prime',
  'Vintage Spherical',
  'Petzval Swirl',
  'Anamorphic Soft',
  'Soviet Glow',
  'AI Deplastic Glass',
  'Lensfun Helios-44 58/2',
  'Lensfun MC Helios-44M-4 58/2',
  'Lensfun Zeiss Batis 25/2',
  'Lensfun Voigtlander Nokton 58/1.4',
  'Lensfun Voigtlander Nokton 28/1.5',
  'Desert Epic P1 H-Series IMAX 1.43',
  'Desert Epic P1 Ultra Vista 1.6x',
  'Desert Epic P2 Moviecam Spherical',
  'Desert Epic P2 Soviet Glass',
  'IMAX 15/70 50mm Sweet Spot',
  'IMAX 15/70 80mm Portrait',
  'Desert Epic P3 Atlas Golden IMAX',
  'Buckswood Post Plugins Realistic Match',
] as const;

/** Order matches the C++ `LensModel` struct. */
export const LENS_MODEL_FIELDS = [
  'distortion',
  'chromaticAberration',
  'fringing',
  'coma',
  'bloom',
  'vignette',
  'cornerColor',
  'swirl',
  'sharpener',
  'warmBias',
  'blueBias',
] as const;

export type LensModelField = (typeof LENS_MODEL_FIELDS)[number];
export type LensModel = Record<LensModelField, number>;

// One row per `case` of `LensPhysicsCore::modelForPreset()`, LensModel field order.
const PRESET_TABLE: Record<number, readonly number[]> = {
  1: [0.015, 0.16, 0.08, 0.04, 0.18, 0.18, 0.06, 0.0, 0.16, 0.01, 0.0], // Clean Cinema Prime
  2: [-0.075, 0.36, 0.25, 0.28, 0.42, 0.35, 0.22, 0.04, 0.04, 0.03, -0.01], // Vintage Spherical
  3: [-0.12, 0.3, 0.18, 0.34, 0.32, 0.42, 0.2, 0.42, -0.02, 0.02, 0.02], // Petzval Swirl
  4: [0.03, 0.46, 0.35, 0.18, 0.52, 0.26, 0.14, 0.02, 0.02, 0.01, 0.04], // Anamorphic Soft
  5: [-0.105, 0.42, 0.3, 0.38, 0.6, 0.48, 0.3, 0.16, -0.04, 0.05, -0.02], // Soviet Glow
  6: [-0.035, 0.22, 0.14, 0.12, 0.28, 0.24, 0.1, 0.03, 0.08, 0.02, 0.01], // AI Deplastic Glass
  // Rows 7–11 are Buckswood Post Plugins's character models of lenses calibrated in the
  // Lensfun database (https://github.com/lensfun/lensfun). Lensfun data is
  // licensed CC BY-SA 3.0; attribution: "Lens profile data derived from the
  // Lensfun project (lensfun.github.io), CC BY-SA 3.0". The values are copied
  // unchanged from LensPhysicsCore.cpp (no raw Lensfun coefficients here).
  7: [0.035, 0.1, 0.18, 0.3, 0.42, 0.46, 0.28, 0.24, -0.03, 0.035, -0.01], // KMZ Helios-44 58mm f/2, M42, FF
  8: [0.026, 0.07, 0.14, 0.26, 0.36, 0.48, 0.3, 0.18, -0.02, 0.03, -0.01], // KMZ MC Helios-44M-4 58mm f/2, M42, FF
  9: [-0.055, 0.04, 0.06, 0.06, 0.2, 0.39, 0.12, 0.0, 0.12, 0.005, 0.01], // Zeiss Batis 25mm f/2, Sony E
  10: [-0.03, 0.06, 0.12, 0.18, 0.3, 0.34, 0.18, 0.08, 0.02, 0.02, 0.0], // Voigtlander Nokton 58mm f/1.4 SLII
  11: [0.006, 0.22, 0.2, 0.14, 0.34, 0.58, 0.24, 0.04, 0.04, 0.01, 0.01], // Voigtlander Nokton 28mm f/1.5 Asph.
  12: [-0.012, 0.1, 0.09, 0.08, 0.24, 0.2, 0.07, 0.0, 0.02, 0.018, 0.004], // Desert Epic P1: Panavision H Series inspiration
  13: [0.02, 0.34, 0.3, 0.1, 0.45, 0.24, 0.11, 0.02, -0.02, 0.012, 0.02], // Desert Epic P1: Ultra Vista 1.6x inspiration
  14: [-0.018, 0.12, 0.1, 0.16, 0.28, 0.22, 0.1, 0.03, 0.0, 0.02, 0.005], // Desert Epic P2: Moviecam spherical inspiration
  15: [-0.07, 0.28, 0.26, 0.34, 0.48, 0.42, 0.24, 0.18, -0.06, 0.035, -0.01], // Desert Epic P2: IronGlass Soviet-era inspiration
  16: [-0.006, 0.08, 0.06, 0.04, 0.18, 0.08, 0.03, 0.0, 0.08, 0.006, 0.004], // IMAX 15/70 50mm sweet spot
  17: [-0.004, 0.06, 0.05, 0.03, 0.16, 0.06, 0.025, 0.0, 0.1, 0.004, 0.003], // IMAX 15/70 80mm portrait
  18: [-0.004, 0.12, 0.18, 0.1, 0.3, 0.02, 0.14, 0.0, 0.06, 0.045, 0.0], // Desert Epic P3: Atlas golden IMAX inspiration
  19: [-0.006, 0.03, 0.02, 0.02, 0.055, 0.04, 0.014, 0.0, 0.055, 0.003, 0.001], // Buckswood Post Plugins Realistic Match
};

const f32 = Math.fround;

export function modelForPreset(preset: number): LensModel {
  const row = PRESET_TABLE[preset] ?? [];
  const model = {} as LensModel;
  LENS_MODEL_FIELDS.forEach((field, index) => {
    model[field] = f32(row[index] ?? 0);
  });
  return model;
}

export type LensControls = {
  lensPreset: number;
  effectStrength: number;
  distortion: number;
  chromaticAberration: number;
  fringing: number;
  coma: number;
  bloom: number;
  bloomThreshold: number;
  vignette: number;
  cornerColor: number;
  swirl: number;
  fStopSharpener: number;
  overdrive: number;
  outputMix: number;
  edgeHaloGuard: number;
  /** OFX glue: empty adjustment clip → transparent output. */
  adjustmentLayerGuard: boolean;
};

/** Defaults identical to the OFX descriptor (`BuckswoodLensPhysicsOFX.cpp`). */
export const LENS_DEFAULT_CONTROLS: LensControls = {
  lensPreset: 19,
  effectStrength: 0.45,
  distortion: 0,
  chromaticAberration: 0.015,
  fringing: 0.015,
  coma: 0.035,
  bloom: 0.075,
  bloomThreshold: 0.82,
  vignette: 0.045,
  cornerColor: 0.02,
  swirl: 0,
  fStopSharpener: 0.06,
  overdrive: 0.85,
  outputMix: 0.55,
  edgeHaloGuard: 0.82,
  adjustmentLayerGuard: true,
};

export type PreparedLensPhysics = {
  model: LensModel;
  controls: LensControls;
  rawOverdrive: number;
  baseOverdrive: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  aspect: number;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const num = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'boolean' ? (value ? 1 : 0) : fallback;
const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : typeof value === 'number' ? value !== 0 : fallback);
const safeDiv = (a: number, b: number) => (b === 0 ? 0 : a / b);

export function controlsFromParams(params: Record<string, unknown>): LensControls {
  const out = { ...LENS_DEFAULT_CONTROLS } as Record<string, number | boolean>;
  for (const [key, fallback] of Object.entries(LENS_DEFAULT_CONTROLS)) {
    out[key] = typeof fallback === 'boolean' ? bool(params[key], fallback) : f32(num(params[key], fallback));
  }
  // OFX choice → C++ int.
  out.lensPreset = Math.trunc(out.lensPreset as number);
  return out as LensControls;
}

export function prepareLensPhysics(frame: { width: number; height: number }, controls: LensControls): PreparedLensPhysics {
  const model = modelForPreset(controls.lensPreset);
  model.distortion += controls.distortion * 0.18;
  model.chromaticAberration += controls.chromaticAberration;
  model.fringing += controls.fringing;
  model.coma += controls.coma;
  model.bloom += controls.bloom;
  model.vignette += controls.vignette;
  model.cornerColor += controls.cornerColor;
  model.swirl += controls.swirl;
  model.sharpener += controls.fStopSharpener;
  for (const field of LENS_MODEL_FIELDS) model[field] = f32(model[field]);

  const lensAmount = clamp01(controls.effectStrength) * clamp01(controls.outputMix);
  const rawOverdrive = Math.max(0, controls.overdrive);
  const width = Math.max(1, Math.round(frame.width));
  const height = Math.max(1, Math.round(frame.height));
  return {
    model,
    controls: { ...controls },
    rawOverdrive,
    baseOverdrive: f32(rawOverdrive * lensAmount),
    width,
    height,
    centerX: (width - 1) * 0.5,
    centerY: (height - 1) * 0.5,
    aspect: safeDiv(width, height),
  };
}
