/**
 * Buckswood Post Plugins Optics Lab v1.3.1 — parameter model.
 *
 * Port of `OpticsLabCore::prepare()` / `modelForPreset()` from
 * Buckswood_Optics_Lab (MIT, © Ludwig Kienle), branch
 * codex/optics-lab-v1.3.1-edge-mix. Keep in sync with the C++ core: the
 * WebGL shader and the CPU reference both consume `PreparedOptics`.
 */

export const OPTICS_PRESET_NAMES = [
  'Neutral / Manual',
  'Modern Cinema',
  'Warm Classic',
  'Fast Vintage',
  'Anamorphic Character',
  'Petzval Portrait',
  'AI Deplastic',
  'Large Format Clean',
  'Dream Diffusion',
  'Clean Modern',
  'Classic Spherical',
  'Vintage Swirl',
  'Soft Focus Portrait',
  'Anamorphic Classic 2x',
  'Anamorphic Blue 1.8x',
  'Vintage Flare',
  'Clinical APO',
  'Rangefinder Tele',
  'Retrofocus Wide',
  'Modern Zoom',
  'AI Natural Lens',
] as const;

export const OPTICS_GLASS_ASSETS = [
  'Off / Legacy Selection',
  'Clean Circular',
  'Six-Blade Hexagon',
  'Eight-Blade Octagon',
  'Anamorphic Oval 1.5x',
  'Anamorphic Oval 2.0x',
  'Cat-Eye Oval',
  'Vintage Scalloped',
];

export const OPTICS_DIRT_ASSETS = [
  'Off / Legacy Selection',
  'Fine Dust',
  'Coarse Dust',
  'Clean-Room Flecks',
  'Edge Dust',
  'Organic Specks',
];

export const OPTICS_SMUDGE_ASSETS = [
  'Off',
  'Soft Fingerprint',
  'Dense Fingerprint',
  'Wipe Arc',
  'Streaked Glass',
];

/** Order matches the C++ `Model` struct. */
export const OPTICS_MODEL_FIELDS = [
  'distortion',
  'breathing',
  'lateralCA',
  'axialCA',
  'coma',
  'astigmatism',
  'fieldCurvature',
  'spherical',
  'swirl',
  'defocus',
  'catEye',
  'bloom',
  'diffusion',
  'halation',
  'flareGhosts',
  'flareStreak',
  'starburst',
  'vignette',
  'debayer',
  'chromaSmear',
  'grain',
  'warmth',
] as const;

export type OpticsModelField = (typeof OPTICS_MODEL_FIELDS)[number];

export type OpticsModel = Record<OpticsModelField, number> & {
  irisBlades: number;
  irisRoundness: number;
  irisRotation: number;
  starUnevenness: number;
  starGate: number;
};

// 22 model values, then optional iris blades, roundness, rotation (deg), star unevenness, star gate.
const PRESET_TABLE: Record<number, number[]> = {
  1: [0.010, 0.04, 0.035, 0.020, 0.015, 0.010, 0.015, 0.010, 0.000, 0.00, 0.02, 0.045, 0.020, 0.010, 0.005, 0.000, 0.005, 0.035, 0.050, 0.035, 0.025, 0.004],
  2: [-0.030, 0.10, 0.080, 0.070, 0.070, 0.055, 0.075, 0.050, 0.025, 0.02, 0.10, 0.120, 0.090, 0.100, 0.040, 0.010, 0.015, 0.100, 0.080, 0.080, 0.060, 0.035],
  3: [-0.055, 0.18, 0.140, 0.160, 0.180, 0.120, 0.150, 0.120, 0.060, 0.08, 0.28, 0.180, 0.140, 0.160, 0.080, 0.015, 0.030, 0.160, 0.120, 0.110, 0.085, 0.045],
  4: [0.025, 0.16, 0.160, 0.120, 0.100, 0.110, 0.085, 0.070, 0.025, 0.05, 0.22, 0.155, 0.100, 0.125, 0.060, 0.180, 0.025, 0.090, 0.090, 0.090, 0.055, 0.012],
  5: [-0.070, 0.20, 0.100, 0.145, 0.200, 0.170, 0.230, 0.110, 0.250, 0.10, 0.45, 0.140, 0.115, 0.120, 0.045, 0.000, 0.015, 0.220, 0.070, 0.080, 0.060, 0.025],
  6: [-0.012, 0.05, 0.040, 0.025, 0.030, 0.025, 0.025, 0.025, 0.004, 0.00, 0.03, 0.080, 0.075, 0.055, 0.015, 0.000, 0.006, 0.050, 0.160, 0.120, 0.075, 0.006],
  7: [-0.004, 0.025, 0.018, 0.012, 0.008, 0.006, 0.010, 0.008, 0.000, 0.00, 0.01, 0.030, 0.018, 0.006, 0.003, 0.000, 0.003, 0.018, 0.035, 0.020, 0.018, 0.002],
  8: [-0.018, 0.08, 0.055, 0.080, 0.040, 0.045, 0.050, 0.080, 0.020, 0.03, 0.12, 0.220, 0.240, 0.210, 0.030, 0.020, 0.020, 0.110, 0.060, 0.070, 0.055, 0.018],
  9: [0.003, 0.02, 0.012, 0.008, 0.005, 0.005, 0.006, 0.006, 0.000, 0.015, 0.00, 0.025, 0.012, 0.004, 0.002, 0.000, 0.010, 0.015, 0.025, 0.014, 0.012, 0.001, 9, 0.86, 0.0, 0.04, 1.0],
  10: [-0.018, 0.07, 0.052, 0.045, 0.040, 0.035, 0.040, 0.045, 0.010, 0.045, 0.06, 0.095, 0.065, 0.070, 0.025, 0.006, 0.024, 0.075, 0.055, 0.050, 0.040, 0.022, 8, 0.62, 11.0, 0.14, 1.0],
  11: [-0.055, 0.15, 0.095, 0.120, 0.145, 0.130, 0.180, 0.095, 0.190, 0.090, 0.32, 0.145, 0.125, 0.110, 0.040, 0.000, 0.022, 0.190, 0.080, 0.075, 0.065, 0.030, 10, 0.32, 7.0, 0.24, 1.0],
  12: [-0.010, 0.06, 0.035, 0.060, 0.025, 0.030, 0.045, 0.125, 0.012, 0.080, 0.14, 0.190, 0.255, 0.180, 0.020, 0.000, 0.014, 0.090, 0.040, 0.040, 0.035, 0.026, 12, 0.94, 0.0, 0.08, 1.0],
  13: [0.032, 0.14, 0.120, 0.095, 0.085, 0.105, 0.080, 0.060, 0.020, 0.070, 0.18, 0.130, 0.085, 0.105, 0.055, 0.220, 0.030, 0.085, 0.075, 0.075, 0.048, 0.010, 6, 0.48, 0.0, 0.20, 1.0],
  14: [0.020, 0.11, 0.105, 0.075, 0.060, 0.075, 0.060, 0.045, 0.012, 0.055, 0.12, 0.105, 0.065, 0.075, 0.040, 0.280, 0.026, 0.065, 0.060, 0.065, 0.038, -0.008, 6, 0.70, 30.0, 0.12, 1.0],
  15: [-0.028, 0.10, 0.075, 0.090, 0.080, 0.055, 0.070, 0.080, 0.018, 0.040, 0.10, 0.180, 0.130, 0.150, 0.120, 0.055, 0.034, 0.120, 0.075, 0.070, 0.050, 0.040, 7, 0.42, 4.0, 0.30, 1.0],
  16: [0.001, 0.01, 0.004, 0.003, 0.002, 0.002, 0.003, 0.003, 0.000, 0.010, 0.00, 0.012, 0.006, 0.002, 0.001, 0.000, 0.008, 0.010, 0.012, 0.008, 0.009, 0.000, 11, 0.95, 0.0, 0.02, 1.0],
  17: [-0.014, 0.09, 0.038, 0.050, 0.045, 0.038, 0.055, 0.048, 0.010, 0.065, 0.18, 0.085, 0.070, 0.065, 0.022, 0.000, 0.018, 0.095, 0.045, 0.045, 0.038, 0.016, 10, 0.68, 18.0, 0.13, 1.0],
  18: [0.048, 0.08, 0.085, 0.055, 0.075, 0.070, 0.090, 0.050, 0.030, 0.040, 0.11, 0.075, 0.050, 0.045, 0.018, 0.000, 0.022, 0.130, 0.060, 0.060, 0.042, 0.008, 8, 0.58, 22.5, 0.17, 1.0],
  19: [0.009, 0.06, 0.022, 0.018, 0.015, 0.014, 0.022, 0.015, 0.003, 0.025, 0.04, 0.045, 0.025, 0.012, 0.008, 0.000, 0.012, 0.040, 0.045, 0.035, 0.025, 0.003, 9, 0.80, 0.0, 0.07, 1.0],
  20: [-0.008, 0.04, 0.028, 0.018, 0.020, 0.018, 0.020, 0.020, 0.003, 0.025, 0.025, 0.065, 0.060, 0.045, 0.012, 0.000, 0.012, 0.042, 0.125, 0.095, 0.060, 0.005, 9, 0.84, 0.0, 0.05, 1.0],
};

const f32 = Math.fround;

export function modelForPreset(preset: number): OpticsModel {
  const row = PRESET_TABLE[preset] ?? [];
  const model = {} as OpticsModel;
  OPTICS_MODEL_FIELDS.forEach((field, index) => {
    model[field] = f32(row[index] ?? 0);
  });
  model.irisBlades = row.length > 22 ? row[22] : 0;
  model.irisRoundness = f32(row.length > 23 ? row[23] : 1);
  model.irisRotation = f32(row.length > 24 ? row[24] : 0);
  model.starUnevenness = f32(row.length > 25 ? row[25] : 0);
  model.starGate = f32(row.length > 26 ? row[26] : 0);
  return model;
}

export type OpticsControls = {
  preset: number;
  effectStrength: number;
  focalLength: number;
  fStop: number;
  focusDistance: number;
  sensorWidth: number;
  anamorphicSqueeze: number;
  anamorphicAngle: number;
  distortion: number;
  breathing: number;
  lateralCA: number;
  axialCA: number;
  coma: number;
  astigmatism: number;
  fieldCurvature: number;
  spherical: number;
  swirl: number;
  depthSource: number;
  depthInvert: boolean;
  depthNear: number;
  depthFar: number;
  depthGamma: number;
  focusPlane: number;
  focusOffset: number;
  defocus: number;
  catEye: number;
  bloom: number;
  bloomThreshold: number;
  diffusion: number;
  halation: number;
  flareGhosts: number;
  flareStreak: number;
  starburst: number;
  vignette: number;
  debayer: number;
  chromaSmear: number;
  grain: number;
  grainSize: number;
  grainSeed: number;
  sensorISO: number;
  glassAsset: number;
  apertureInfluence: number;
  dirtAsset: number;
  dirtAmount: number;
  dirtScale: number;
  smudgeAsset: number;
  smudgeAmount: number;
  smudgeScale: number;
  edgeGuard: number;
  outputMix: number;
  geometryEnabled: boolean;
  aberrationsEnabled: boolean;
  defocusEnabled: boolean;
  lightEnabled: boolean;
  vignetteEnabled: boolean;
  surfaceEnabled: boolean;
  sensorEnabled: boolean;
  quality: number;
  sceneUnits: number;
  sceneScale: number;
  irisBlades: number;
  irisRoundnessTrim: number;
  irisRotation: number;
  starUnevennessTrim: number;
  starFStopResponse: number;
};

/** Defaults identical to the OFX descriptor (`BuckswoodOpticsLabOFX.cpp`). */
export const OPTICS_DEFAULT_CONTROLS: OpticsControls = {
  preset: 6,
  effectStrength: 0.65,
  focalLength: 50,
  fStop: 2.8,
  focusDistance: 3,
  sensorWidth: 36,
  anamorphicSqueeze: 1,
  anamorphicAngle: 0,
  distortion: 0,
  breathing: 0,
  lateralCA: 0,
  axialCA: 0,
  coma: 0,
  astigmatism: 0,
  fieldCurvature: 0,
  spherical: 0,
  swirl: 0,
  depthSource: 0,
  depthInvert: false,
  depthNear: 0,
  depthFar: 1,
  depthGamma: 1,
  focusPlane: 0.5,
  focusOffset: 0,
  defocus: 0,
  catEye: 0,
  bloom: 0,
  bloomThreshold: 0.82,
  diffusion: 0,
  halation: 0,
  flareGhosts: 0,
  flareStreak: 0,
  starburst: 0,
  vignette: 0,
  debayer: 0,
  chromaSmear: 0,
  grain: 0,
  grainSize: 1,
  grainSeed: 1,
  sensorISO: 400,
  glassAsset: 0,
  apertureInfluence: 0.85,
  dirtAsset: 0,
  dirtAmount: 0,
  dirtScale: 1,
  smudgeAsset: 0,
  smudgeAmount: 0,
  smudgeScale: 1,
  edgeGuard: 0.8,
  outputMix: 0.65,
  geometryEnabled: true,
  aberrationsEnabled: true,
  defocusEnabled: true,
  lightEnabled: true,
  vignetteEnabled: true,
  surfaceEnabled: true,
  sensorEnabled: true,
  quality: 1,
  sceneUnits: 0,
  sceneScale: 1,
  irisBlades: 0,
  irisRoundnessTrim: 0,
  irisRotation: 0,
  starUnevennessTrim: 0,
  starFStopResponse: 1,
};

export type PreparedOptics = {
  model: OpticsModel;
  controls: OpticsControls;
  width: number;
  height: number;
  frameIndex: number;
  centerX: number;
  centerY: number;
  aspect: number;
  amount: number;
  apertureScale: number;
  focalScale: number;
  breathingScale: number;
  anamorphicCos: number;
  anamorphicSin: number;
  isoGrainScale: number;
  focusDistanceMeters: number;
  defocusSamples: number;
  glowSamples: number;
  comaSamples: number;
  irisBlades: number;
  maxStarSpokes: number;
  irisRoundness: number;
  irisRotation: number;
  starUnevenness: number;
  starGate: number;
  needsEdgeGuard: boolean;
  identityMapping: boolean;
  identityOutput: boolean;
  /** Built-in textures actually in use (0 = none). */
  glassAsset: number;
  dirtAsset: number;
  smudgeAsset: number;
};

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const clamp01 = (value: number) => clamp(value, 0, 1);
const num = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'boolean' ? (value ? 1 : 0) : fallback);
const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : typeof value === 'number' ? value !== 0 : fallback);

export function controlsFromParams(params: Record<string, unknown>): OpticsControls {
  const out = { ...OPTICS_DEFAULT_CONTROLS } as Record<string, number | boolean>;
  for (const [key, fallback] of Object.entries(OPTICS_DEFAULT_CONTROLS)) {
    out[key] = typeof fallback === 'boolean' ? bool(params[key], fallback) : num(params[key], fallback);
  }
  return out as OpticsControls;
}

const UNIT_TO_METERS = [1, 0.01, 0.001, 0.3048, 0.0254];

export function prepareOptics(
  frame: { width: number; height: number; frameIndex: number },
  input: OpticsControls,
): PreparedOptics {
  const controls: OpticsControls = { ...input };
  controls.edgeGuard = clamp01(input.edgeGuard);
  controls.outputMix = clamp01(input.outputMix);
  controls.depthNear = clamp01(input.depthNear);
  controls.depthFar = Math.max(controls.depthNear + 0.0001, clamp01(input.depthFar));
  controls.depthGamma = clamp(input.depthGamma, 0.1, 4);
  controls.focusPlane = clamp01(input.focusPlane);
  controls.anamorphicSqueeze = clamp(input.anamorphicSqueeze, 1, 2);
  controls.apertureInfluence = clamp01(input.apertureInfluence);
  controls.dirtAmount = clamp01(input.dirtAmount);
  controls.dirtScale = clamp(input.dirtScale, 0.25, 8);
  controls.smudgeAmount = clamp01(input.smudgeAmount);
  controls.smudgeScale = clamp(input.smudgeScale, 0.25, 8);
  controls.grainSize = clamp(input.grainSize, 0.5, 4);
  controls.quality = input.quality === 0 ? 0 : 1;
  controls.sceneUnits = Math.min(4, Math.max(0, Math.round(input.sceneUnits)));
  controls.sceneScale = clamp(input.sceneScale, 0.001, 1000);
  controls.irisBlades = input.irisBlades >= 3 ? Math.min(16, Math.round(input.irisBlades)) : 0;
  controls.irisRoundnessTrim = clamp(input.irisRoundnessTrim, -1, 1);
  controls.irisRotation = clamp(input.irisRotation, -180, 180);
  controls.starUnevennessTrim = clamp(input.starUnevennessTrim, -1, 1);
  controls.starFStopResponse = clamp01(input.starFStopResponse);

  const model = modelForPreset(Math.round(input.preset));
  model.distortion += input.distortion * 0.16;
  model.breathing += input.breathing;
  model.lateralCA += input.lateralCA;
  model.axialCA += input.axialCA;
  model.coma += input.coma;
  model.astigmatism += input.astigmatism;
  model.fieldCurvature += input.fieldCurvature;
  model.spherical += input.spherical;
  model.swirl += input.swirl;
  model.defocus += input.defocus;
  model.catEye += input.catEye;
  model.bloom += input.bloom;
  model.diffusion += input.diffusion;
  model.halation += input.halation;
  model.flareGhosts += input.flareGhosts;
  model.flareStreak += input.flareStreak;
  model.starburst += input.starburst;
  model.vignette += input.vignette;
  model.debayer += input.debayer;
  model.chromaSmear += input.chromaSmear;
  model.grain += input.grain;

  if (!input.geometryEnabled) {
    model.distortion = 0;
    model.breathing = 0;
    model.swirl = 0;
  }
  if (!input.aberrationsEnabled) {
    model.lateralCA = 0;
    model.axialCA = 0;
    model.coma = 0;
    model.astigmatism = 0;
    model.fieldCurvature = 0;
    model.spherical = 0;
  }
  if (!input.defocusEnabled) {
    model.defocus = 0;
    model.catEye = 0;
  }
  if (!input.lightEnabled) {
    model.bloom = 0;
    model.diffusion = 0;
    model.halation = 0;
    model.flareGhosts = 0;
    model.flareStreak = 0;
    model.starburst = 0;
  }
  if (!input.vignetteEnabled) model.vignette = 0;
  if (!input.surfaceEnabled) {
    controls.dirtAmount = 0;
    controls.smudgeAmount = 0;
  }
  if (!input.sensorEnabled) {
    model.debayer = 0;
    model.chromaSmear = 0;
    model.grain = 0;
  }

  const width = Math.max(1, frame.width);
  const height = Math.max(1, frame.height);
  const focalLength = clamp(input.focalLength, 8, 300);
  const sensorWidth = clamp(input.sensorWidth, 8, 70);
  const fStop = clamp(input.fStop, 0.7, 32);
  const focusDistance = clamp(
    input.focusDistance * UNIT_TO_METERS[controls.sceneUnits] * controls.sceneScale,
    0.0002,
    1000,
  );
  controls.fStop = fStop;
  controls.focalLength = focalLength;
  controls.sensorWidth = sensorWidth;
  const focalScale = clamp((50 / focalLength) * (sensorWidth / 36), 0.35, 3.5);
  const apertureScale = clamp(2.8 / fStop, 0.12, 3.5);
  const breathingScale = 1 + model.breathing * clamp(1 / focusDistance, 0, 2) * 0.045;
  const anamorphicRadians = input.anamorphicAngle * 0.017453292519943295;
  const amount = clamp01(input.effectStrength);
  const irisBlades = controls.irisBlades >= 3 ? controls.irisBlades : model.irisBlades;
  const irisRoundness = clamp01(model.irisRoundness + controls.irisRoundnessTrim);
  const irisRotation = (model.irisRotation + controls.irisRotation) * 0.017453292519943295;
  const starUnevenness = clamp01(model.starUnevenness + controls.starUnevennessTrim);
  const starGate = clamp01(model.starGate * controls.starFStopResponse);
  const needsEdgeGuard =
    input.edgeGuard > 0.0001 &&
    amount > 0.0001 &&
    (model.lateralCA > 0.0001 ||
      model.axialCA > 0.0001 ||
      model.coma > 0.0001 ||
      model.astigmatism > 0.0001 ||
      model.fieldCurvature > 0.0001 ||
      model.spherical > 0.0001 ||
      model.defocus > 0.0001);
  const identityMapping =
    Math.abs(model.distortion * amount) <= 0.000001 &&
    Math.abs(model.swirl * amount) <= 0.000001 &&
    Math.abs(breathingScale - 1) <= 0.000001;

  const glassAsset = Math.min(7, Math.max(0, Math.round(input.glassAsset)));
  const dirtAsset = Math.min(5, Math.max(0, Math.round(input.dirtAsset)));
  const smudgeAsset = Math.min(4, Math.max(0, Math.round(input.smudgeAsset)));
  // Mirrors the C++ core: amounts alone decide, independent of asset choice.
  const surfaceActive = controls.dirtAmount > 0.0001 || controls.smudgeAmount > 0.0001;

  const identityOutput =
    identityMapping &&
    model.lateralCA === 0 &&
    model.axialCA === 0 &&
    model.coma === 0 &&
    model.astigmatism === 0 &&
    model.fieldCurvature === 0 &&
    model.spherical === 0 &&
    model.defocus === 0 &&
    model.bloom === 0 &&
    model.diffusion === 0 &&
    model.halation === 0 &&
    model.flareGhosts === 0 &&
    model.flareStreak === 0 &&
    model.starburst === 0 &&
    model.vignette === 0 &&
    model.debayer === 0 &&
    model.chromaSmear === 0 &&
    model.grain === 0 &&
    !surfaceActive;

  return {
    model,
    controls,
    width,
    height,
    frameIndex: Math.floor(frame.frameIndex),
    centerX: (width - 1) * 0.5,
    centerY: (height - 1) * 0.5,
    aspect: width / height,
    amount,
    apertureScale,
    focalScale,
    breathingScale,
    anamorphicCos: Math.cos(anamorphicRadians),
    anamorphicSin: Math.sin(anamorphicRadians),
    isoGrainScale: Math.sqrt(clamp(input.sensorISO, 50, 12800) / 400),
    focusDistanceMeters: focusDistance,
    defocusSamples: controls.quality === 0 ? 8 : 12,
    glowSamples: controls.quality === 0 ? 4 : 8,
    comaSamples: controls.quality === 0 ? 2 : 4,
    irisBlades,
    maxStarSpokes: controls.quality === 0 ? 8 : 18,
    irisRoundness,
    irisRotation,
    starUnevenness,
    starGate,
    needsEdgeGuard,
    identityMapping,
    identityOutput,
    glassAsset,
    dirtAsset,
    smudgeAsset,
  };
}
