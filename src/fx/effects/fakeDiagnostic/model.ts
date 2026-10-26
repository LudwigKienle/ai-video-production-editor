/**
 * Buckswood Post Plugins Fake Diagnostic v2.2 — parameter model.
 *
 * Port of `FakeDiagnosticCore::defaultControls()` / `prepare()`
 * (Buckswood_Fake_Diagnostic/src/FakeDiagnosticCore.cpp, MIT, © Ludwig
 * Kienle) plus the OFX wrapper settings (view mode, temporal analysis,
 * adjustment-layer guard) from BuckswoodFakeDiagnosticOFX.cpp.
 *
 * Only the single-frame path is ported: `temporalAnalysis` and
 * `temporalOffset` are kept for project compatibility but ignored (the
 * temporal score is 0, exactly as in the plugin when the host provides no
 * neighbouring frames).
 */

export const FAKE_VIEW_MODES = [
  'Diagnostic Overlay',
  'Problem Matte',
  'Reality Match Assist',
  'Assist + Overlay',
  'Category Colors',
  'Temporal Stability Matte',
  'Temporal Difference Overlay',
] as const;

export const FAKE_TEMPORAL_OFFSETS = ['1 Frame', '2 Frames', '3 Frames'] as const;

/** `ViewMode` enum of FakeDiagnosticCore.h. */
export const FakeView = {
  DiagnosticOverlay: 0,
  ProblemMatte: 1,
  RealityMatchAssist: 2,
  AssistWithOverlay: 3,
  CategoryColors: 4,
  TemporalStabilityMatte: 5,
  TemporalDifferenceOverlay: 6,
} as const;

export type FakeControls = {
  viewMode: number;
  sensitivity: number;
  overlayStrength: number;
  correctionStrength: number;
  /** Ignored by the WebGL port (single-frame only). */
  temporalAnalysis: boolean;
  /** Ignored by the WebGL port (single-frame only). */
  temporalOffset: number;
  plasticWeight: number;
  highlightWeight: number;
  edgeWeight: number;
  gradeWeight: number;
  textureWeight: number;
  /** Still part of the score normalisation (`weightSum`), although the temporal score is 0. */
  temporalWeight: number;
  microContrast: number;
  edgeSoften: number;
  highlightRolloff: number;
  gamutGuard: number;
  sensorTexture: number;
  /** Only acts on the temporal average: no effect in the single-frame path. */
  temporalAssist: number;
  seed: number;
  adjustmentLayerGuard: boolean;
};

/** Defaults identical to the OFX descriptor and `defaultControls()`, in descriptor order. */
export const FAKE_DEFAULT_CONTROLS: FakeControls = {
  viewMode: 0,
  sensitivity: 1,
  overlayStrength: 0.65,
  correctionStrength: 0.35,
  temporalAnalysis: false,
  temporalOffset: 0,
  plasticWeight: 1,
  highlightWeight: 1,
  edgeWeight: 0.85,
  gradeWeight: 0.9,
  textureWeight: 0.85,
  temporalWeight: 0.8,
  microContrast: 0.35,
  edgeSoften: 0.15,
  highlightRolloff: 0.55,
  gamutGuard: 0.45,
  sensorTexture: 0.25,
  temporalAssist: 0.25,
  seed: 17,
  adjustmentLayerGuard: true,
};

export type PreparedFake = {
  controls: FakeControls;
  width: number;
  height: number;
  frameIndex: number;
  weightSum: number;
  noiseSeedBase: number;
  noiseSeedAlt: number;
};

const f32 = Math.fround;
const num = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'boolean' ? (value ? 1 : 0) : fallback;
const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : typeof value === 'number' ? value !== 0 : fallback);
const INT_CONTROLS = new Set(['viewMode', 'temporalOffset']);

export function controlsFromParams(params: Record<string, unknown>): FakeControls {
  const out = { ...FAKE_DEFAULT_CONTROLS } as Record<string, number | boolean>;
  for (const [key, fallback] of Object.entries(FAKE_DEFAULT_CONTROLS)) {
    if (typeof fallback === 'boolean') out[key] = bool(params[key], fallback);
    else {
      const value = num(params[key], fallback);
      // OFX doubles reach the core as float; choices as int.
      out[key] = INT_CONTROLS.has(key) ? Math.trunc(value) : f32(value);
    }
  }
  return out as FakeControls;
}

/** `FakeDiagnosticCore::prepare()`. The OFX frame index is `int(time)`. */
export function prepareFake(frame: { width: number; height: number; frameIndex: number }, controls: FakeControls): PreparedFake {
  const c = controls;
  // Left-to-right float32 sum like the C++ expression.
  let sum = f32(c.plasticWeight + c.highlightWeight);
  sum = f32(sum + c.edgeWeight);
  sum = f32(sum + c.gradeWeight);
  sum = f32(sum + c.textureWeight);
  sum = f32(sum + c.temporalWeight);
  const frameIndex = Math.trunc(frame.frameIndex);
  return {
    controls: { ...controls },
    width: frame.width,
    height: frame.height,
    frameIndex,
    weightSum: Math.max(f32(0.001), sum),
    noiseSeedBase: (frameIndex + Math.trunc(f32(c.seed * 13))) | 0,
    noiseSeedAlt: (frameIndex + Math.trunc(f32(c.seed * 29))) | 0,
  };
}
