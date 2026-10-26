/**
 * Buckswood Post Plugins Film Emulation v2.1 — parameter model.
 *
 * Port of `FilmEmulationCore::prepare()`, `stockForPreset()` and
 * `printForPreset()` from Buckswood_Film_Emulation (MIT, © Ludwig Kienle),
 * plus the OFX descriptor (`BuckswoodFilmEmulationOFX.cpp`): param ids,
 * defaults, ranges and choice lists. The WebGL shader and the CPU reference
 * both consume `PreparedFilm`.
 *
 * Float32 note: the C++ core works in `float`. Every control is rounded with
 * `Math.fround` exactly like the OFX glue (`static_cast<float>(double)`), and
 * the sin-based hash (`hash32`) is evaluated op by op in float32 because its
 * output is chaotic in the last bit of its argument.
 */

const F = Math.fround;

export const FILM_INPUT_SPACES = [
  'Rec.709 / Gamma 2.4',
  'AI Footage Rec.709',
  'Timeline / Scene Linear',
  'Sony S-Log3 / S-Gamut3.Cine',
  'ARRI LogC3',
  'ARRI LogC4',
  'Apple Log',
  'BMD Film Gen 5 / DWG',
] as const;

export const FILM_STOCKS = [
  'Neutral / Manual',
  '35mm Clean Negative',
  '500T Tungsten Inspired',
  '250D Daylight Inspired',
  'Soft Eterna Inspired',
  '16mm Documentary',
  'Bleach Bypass',
  'B/W Panchromatic',
  'AI Footage Deplastic Film',
  'AI Skin Recovery Negative',
  'AI Dream Grain',
  'AI Clean Commercial Film',
  'Large Format Clean',
  'Desert Epic Negative',
  'Green Cyber Print Negative',
  'Gritty Night 500T',
] as const;

export const FILM_PRINTS = [
  'No Print / Manual',
  '2383 Theater Print Inspired',
  '3513 Softer Print Inspired',
  'Clean Scan Print',
  'Warm Show Print',
  'Cool Silver Retention',
  'AI Soft Print',
  'Dense Theatrical',
  'B/W Silver Print',
] as const;

export const FILM_PROCESS_MODES = ['Full Process', 'Color Only', 'Texture Only'] as const;
export const FILM_GRAIN_PROFILES = ['Manual', '8mm 500', '16mm 500', '35mm 500', '35mm 250', '65mm 50'] as const;
export const FILM_HALATION_PROFILES = ['Manual', '8mm Emulsion', '16mm Emulsion', '35mm Emulsion', '65mm Subtle', 'No Remjet'] as const;
export const FILM_BLOOM_PROFILES = ['Manual', '8mm Diffusion', '16mm Diffusion', '35mm Diffusion', '65mm Clean'] as const;
export const FILM_GRAIN_MODES = ['Classic Negative Grain', 'Fine Scan Grain', 'Chunky 16mm Grain', 'Monochrome Tight Grain'] as const;
export const FILM_TEMPORAL_OFFSETS = ['1 Frame', '2 Frames', '3 Frames'] as const;
export const FILM_VIEW_MODES = [
  'Final Image',
  'Grain Matte',
  'Halation / Bloom Matte',
  'Density Map',
  'Temporal Reconstruction Map',
] as const;

/** Order matches the C++ `StockModel` struct. */
export const FILM_STOCK_FIELDS = [
  'contrast',
  'saturation',
  'density',
  'toe',
  'shoulder',
  'warmth',
  'greenBias',
  'blueBias',
  'subtractive',
  'halation',
  'grain',
  'silver',
  'monochrome',
  'pastel',
] as const;

/** Order matches the C++ `PrintModel` struct. */
export const FILM_PRINT_FIELDS = [
  'contrast',
  'saturation',
  'toe',
  'shoulder',
  'warmHighlights',
  'coolShadows',
  'blackDensity',
  'silver',
] as const;

export type FilmStockModel = Record<(typeof FILM_STOCK_FIELDS)[number], number>;
export type FilmPrintModel = Record<(typeof FILM_PRINT_FIELDS)[number], number>;

// FilmEmulationCore::stockForPreset — index = preset id (0 = neutral/default).
const STOCK_TABLE: number[][] = [
  [1.0, 1.0, 0.0, 0.0, 0.24, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
  [1.06, 0.98, 0.18, 0.18, 0.42, 0.01, -0.002, 0.0, 0.24, 0.12, 0.16, 0.0, 0.0, 0.05],
  [1.1, 1.03, 0.26, 0.23, 0.48, 0.03, 0.004, 0.02, 0.34, 0.24, 0.34, 0.0, 0.0, 0.02],
  [1.05, 1.02, 0.2, 0.16, 0.36, 0.01, -0.004, -0.01, 0.28, 0.14, 0.22, 0.0, 0.0, 0.04],
  [0.96, 0.88, 0.12, 0.24, 0.3, 0.004, 0.012, 0.01, 0.18, 0.1, 0.18, 0.0, 0.0, 0.24],
  [1.15, 0.96, 0.32, 0.3, 0.55, 0.02, 0.008, 0.012, 0.3, 0.2, 0.62, 0.04, 0.0, 0.0],
  [1.24, 0.72, 0.28, 0.18, 0.5, -0.004, 0.002, -0.006, 0.12, 0.08, 0.22, 0.72, 0.0, 0.0],
  [1.18, 0.0, 0.22, 0.24, 0.46, 0.0, 0.0, 0.0, 0.0, 0.06, 0.34, 0.42, 1.0, 0.0],
  [1.04, 0.92, 0.16, 0.2, 0.4, 0.012, -0.006, -0.004, 0.46, 0.12, 0.2, 0.0, 0.0, 0.16],
  [1.0, 0.9, 0.12, 0.18, 0.34, 0.018, -0.012, -0.006, 0.38, 0.1, 0.16, 0.0, 0.0, 0.2],
  [0.98, 0.96, 0.18, 0.28, 0.52, 0.025, 0.006, 0.018, 0.3, 0.22, 0.46, 0.0, 0.0, 0.18],
  [1.03, 0.94, 0.1, 0.12, 0.26, 0.006, -0.004, -0.004, 0.26, 0.06, 0.08, 0.0, 0.0, 0.1],
  [1.02, 0.99, 0.1, 0.1, 0.28, 0.006, -0.002, 0.0, 0.18, 0.06, 0.08, 0.0, 0.0, 0.02],
  [1.08, 0.9, 0.18, 0.2, 0.48, 0.038, -0.014, -0.026, 0.34, 0.18, 0.18, 0.0, 0.0, 0.08],
  [1.12, 0.88, 0.2, 0.22, 0.46, -0.02, 0.036, -0.02, 0.3, 0.08, 0.2, 0.2, 0.0, 0.02],
  [1.18, 0.9, 0.34, 0.34, 0.58, 0.016, 0.0, 0.024, 0.34, 0.28, 0.48, 0.18, 0.0, 0.0],
];

// FilmEmulationCore::printForPreset.
const PRINT_TABLE: number[][] = [
  [1.0, 1.0, 0.0, 0.18, 0.0, 0.0, 0.0, 0.0],
  [1.1, 0.96, 0.2, 0.44, 0.018, 0.018, 0.14, 0.0],
  [1.02, 0.92, 0.16, 0.34, 0.01, 0.01, 0.08, 0.0],
  [1.0, 0.98, 0.08, 0.24, 0.004, 0.006, 0.04, 0.0],
  [1.06, 0.94, 0.18, 0.38, 0.036, 0.012, 0.1, 0.0],
  [1.14, 0.76, 0.22, 0.48, -0.006, 0.04, 0.18, 0.6],
  [0.98, 0.88, 0.14, 0.3, 0.012, 0.014, 0.06, 0.0],
  [1.18, 0.9, 0.24, 0.54, 0.02, 0.02, 0.22, 0.12],
  [1.16, 0.0, 0.28, 0.42, 0.0, 0.0, 0.18, 0.84],
];

export function stockForPreset(preset: number): FilmStockModel {
  const row = STOCK_TABLE[preset] ?? STOCK_TABLE[0];
  const model = {} as FilmStockModel;
  FILM_STOCK_FIELDS.forEach((field, index) => {
    model[field] = F(row[index]);
  });
  return model;
}

export function printForPreset(preset: number): FilmPrintModel {
  const row = PRINT_TABLE[preset] ?? PRINT_TABLE[0];
  const model = {} as FilmPrintModel;
  FILM_PRINT_FIELDS.forEach((field, index) => {
    model[field] = F(row[index]);
  });
  return model;
}

export type FilmControls = {
  inputSpace: number;
  stockPreset: number;
  printPreset: number;
  processMode: number;
  exposure: number;
  pushPull: number;
  density: number;
  contrast: number;
  developerContrast: number;
  developerGamma: number;
  colorSeparation: number;
  colorBoost: number;
  saturation: number;
  subtractiveColor: number;
  interlayer: number;
  neutralizeCurves: number;
  bleachBypass: number;
  filmCompression: number;
  compressionWhitePoint: number;
  compressionRange: number;
  compressionColorDensity: number;
  expandBlackPoint: number;
  expandWhitePoint: number;
  printerCyan: number;
  printerMagenta: number;
  printerYellow: number;
  temperature: number;
  tint: number;
  highlightRolloff: number;
  blackLift: number;
  halationProfile: number;
  halation: number;
  halationLocal: number;
  halationGlobal: number;
  halationRedShift: number;
  bloomProfile: number;
  bloom: number;
  bloomThreshold: number;
  bloomSpread: number;
  grainProfile: number;
  grain: number;
  grainSize: number;
  grainMode: number;
  grainShadows: number;
  grainMidtones: number;
  grainHighlights: number;
  grainChroma: number;
  filmResolution: number;
  gateWeave: number;
  dust: number;
  scratches: number;
  flicker: number;
  filmBreath: number;
  temporalReconstruction: number;
  temporalStability: number;
  temporalMotionGuard: number;
  temporalOffset: number;
  skinProtect: number;
  outputMix: number;
  viewMode: number;
  adjustmentLayerGuard: boolean;
};

/** Defaults identical to the OFX descriptor, in descriptor order (61 params). */
export const FILM_DEFAULT_CONTROLS: FilmControls = {
  inputSpace: 1,
  stockPreset: 8,
  printPreset: 6,
  processMode: 0,
  exposure: 0,
  pushPull: 0,
  density: 0.18,
  contrast: 1,
  developerContrast: 0.1,
  developerGamma: 0,
  colorSeparation: 0.3,
  colorBoost: 0.04,
  saturation: 0.94,
  subtractiveColor: 0.34,
  interlayer: 0.34,
  neutralizeCurves: 0,
  bleachBypass: 0,
  filmCompression: 0.38,
  compressionWhitePoint: 1.08,
  compressionRange: 0.55,
  compressionColorDensity: 0.48,
  expandBlackPoint: 0,
  expandWhitePoint: 0,
  printerCyan: 0,
  printerMagenta: 0,
  printerYellow: 0,
  temperature: 0,
  tint: 0,
  highlightRolloff: 0.62,
  blackLift: 0,
  halationProfile: 2,
  halation: 0.12,
  halationLocal: 0.7,
  halationGlobal: 0.18,
  halationRedShift: 0.72,
  bloomProfile: 2,
  bloom: 0.05,
  bloomThreshold: 0.78,
  bloomSpread: 0.42,
  grainProfile: 3,
  grain: 0.18,
  grainSize: 0.85,
  grainMode: 1,
  grainShadows: 0.7,
  grainMidtones: 0.55,
  grainHighlights: 0.42,
  grainChroma: 0.26,
  filmResolution: 0.82,
  gateWeave: 0.04,
  dust: 0,
  scratches: 0,
  flicker: 0,
  filmBreath: 0.08,
  temporalReconstruction: 0,
  temporalStability: 0.62,
  temporalMotionGuard: 0.82,
  temporalOffset: 0,
  skinProtect: 0.72,
  outputMix: 0.75,
  viewMode: 0,
  adjustmentLayerGuard: true,
};

/** Choice / int controls (passed to the core as `int`, everything else is `float`). */
const INT_CONTROLS = new Set([
  'inputSpace',
  'stockPreset',
  'printPreset',
  'processMode',
  'halationProfile',
  'bloomProfile',
  'grainProfile',
  'grainMode',
  'temporalOffset',
  'viewMode',
]);

const num = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'boolean' ? (value ? 1 : 0) : fallback;
const bool = (value: unknown, fallback: boolean) =>
  typeof value === 'boolean' ? value : typeof value === 'number' ? value !== 0 : fallback;

export function controlsFromParams(params: Record<string, unknown>): FilmControls {
  const out = {} as Record<string, number | boolean>;
  for (const [key, fallback] of Object.entries(FILM_DEFAULT_CONTROLS)) {
    if (typeof fallback === 'boolean') out[key] = bool(params[key], fallback);
    else if (INT_CONTROLS.has(key)) out[key] = Math.trunc(num(params[key], fallback));
    else out[key] = F(num(params[key], fallback));
  }
  return out as FilmControls;
}

// ---------------------------------------------------------------------------
// float32 helpers shared by prepare() and the CPU reference.

const K_X = F(12.9898);
const K_Y = F(78.233);
const K_SEED = F(37.719);
const K_SCALE = F(43758.5453);

/**
 * `FilmEmulationCore::hash` evaluated exactly like the float32 C++ code:
 * fract(sinf(x * 12.9898f + y * 78.233f + seed * 37.719f) * 43758.5453f).
 * Arguments must already be float32 values. `fround(Math.sin())` is a
 * correctly rounded sinf (the probe uses the same; see README).
 */
export function hash32(x: number, y: number, seed: number): number {
  const arg = F(F(F(x * K_X) + F(y * K_Y)) + F(seed * K_SEED));
  const value = F(F(Math.sin(arg)) * K_SCALE);
  return F(value - Math.floor(value));
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const clamp01 = (value: number) => clamp(value, 0, 1);

export type PreparedFilm = {
  controls: FilmControls;
  stock: FilmStockModel;
  print: FilmPrintModel;
  frameIndex: number;
  frameSeed: number;
  weaveX: number;
  weaveY: number;
  exposureGain: number;
  grainAmount: number;
  colorStage: boolean;
  textureStage: boolean;
  // Derived constants of opticalPass() (depend only on controls).
  haloAmount: number;
  bloomAmount: number;
  opticalRadius: number;
  /** 0.62f + clamp(grainSize, 0, 4) * 2.35f — grain cell size (float32). */
  grainScale: number;
  grainProfileBias: number;
};

export function prepareFilm(frame: { width: number; height: number; frameIndex: number }, controls: FilmControls): PreparedFilm {
  const c = controls;
  const stock = stockForPreset(c.stockPreset);
  const print = printForPreset(c.printPreset);
  const frameIndex = Math.trunc(frame.frameIndex);
  const frameSeed = F(frameIndex);

  const weave = clamp01(c.gateWeave);
  const weaveX = Math.sin(frameSeed * 0.417 + 1.7) * 0.42 * weave + Math.sin(frameSeed * 0.113 + 5.3) * 0.28 * weave;
  const weaveY = Math.sin(frameSeed * 0.311 + 0.2) * 0.28 * weave + Math.sin(frameSeed * 0.071 + 4.1) * 0.18 * weave;

  const flickerNoise = hash32(17, frameSeed, F(9.13)) - 0.5;
  const breathSlow = Math.sin(frameSeed * 0.077 + 2.4);
  const breathFast = Math.sin(frameSeed * 0.193 + 4.0);
  const breath = (breathSlow * 0.65 + breathFast * 0.35) * clamp01(c.filmBreath);
  const flickerGain = 1 + flickerNoise * 0.055 * clamp01(c.flicker) + breath * 0.045;
  const exposureGain = Math.pow(2, clamp(c.exposure + c.pushPull * 0.72, -4, 4)) * flickerGain;
  const grainAmount = clamp01(c.grain + stock.grain * 0.55);

  // opticalPass() profile constants.
  let haloProfileScale = 1;
  let bloomProfileScale = 1;
  let haloSpread = 1;
  let bloomSpread = 1 + clamp01(c.bloomSpread) * 1.2;
  switch (c.halationProfile) {
    case 1: haloProfileScale = 1.28; haloSpread = 0.86; break;
    case 2: haloProfileScale = 1.12; haloSpread = 0.98; break;
    case 3: haloProfileScale = 0.92; haloSpread = 1.08; break;
    case 4: haloProfileScale = 0.58; haloSpread = 1.28; break;
    case 5: haloProfileScale = 1.86; haloSpread = 1.18; break;
    default: break;
  }
  switch (c.bloomProfile) {
    case 1: bloomProfileScale = 1.3; bloomSpread *= 0.9; break;
    case 2: bloomProfileScale = 1.1; break;
    case 3: bloomProfileScale = 0.92; bloomSpread *= 1.16; break;
    case 4: bloomProfileScale = 0.6; bloomSpread *= 1.36; break;
    default: break;
  }
  const haloAmount = clamp01(c.halation + stock.halation * clamp01(c.density)) * 0.42 * haloProfileScale;
  const bloomAmount = clamp01(c.bloom) * 0.34 * bloomProfileScale;
  const opticalRadius = (1.6 + 5.2 * clamp01(c.halation + c.bloom)) * Math.max(0.25, haloSpread * bloomSpread);

  let grainProfileBias = 1;
  switch (c.grainProfile) {
    case 1: grainProfileBias = 1.55; break;
    case 2: grainProfileBias = 1.28; break;
    case 3: grainProfileBias = 1.05; break;
    case 4: grainProfileBias = 0.82; break;
    case 5: grainProfileBias = 0.48; break;
    default: break;
  }

  return {
    controls: c,
    stock,
    print,
    frameIndex,
    frameSeed,
    weaveX,
    weaveY,
    exposureGain,
    grainAmount,
    colorStage: c.processMode !== 2,
    textureStage: c.processMode !== 1,
    haloAmount,
    bloomAmount,
    opticalRadius,
    grainScale: F(F(0.62) + F(clamp(c.grainSize, 0, 4) * F(2.35))),
    grainProfileBias,
  };
}
