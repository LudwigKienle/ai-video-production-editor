/**
 * Buckswood Post Plugins AI Photorealizer v0.3 — parameter model.
 *
 * Mirrors `buckswood::Controls` / `Masks` of Buckswood_AI_Photorealizer
 * (include/PhotorealizerCore.h, MIT, © Ludwig Kienle),
 * buckswood-post-plugins@2b898e7. The core has no prepare step; the only
 * derived value is the integer texture seed, computed here once per frame so
 * the shader and the CPU reference use the identical integer.
 *
 * The OFX plugin always renders with `PhotorealizerCore::defaultMasks()`
 * (the CoreML mask provider is a stub), so the masks are constants here.
 */

export type PhotorealizerControls = {
  plasticReduction: number;
  skinRealism: number;
  highlightRealism: number;
  colorNaturalize: number;
  textureAmount: number;
  microContrast: number;
  gamutGuard: number;
  shadowDepth: number;
  smoothnessBreakup: number;
  outputMix: number;
  seed: number;
  /** OFX glue: empty adjustment clip → transparent output. */
  adjustmentLayerGuard: boolean;
};

/** Defaults identical to the OFX descriptor (`BuckswoodAIPhotorealizerOFX.cpp`). */
export const PHOTOREALIZER_DEFAULT_CONTROLS: PhotorealizerControls = {
  plasticReduction: 0.65,
  skinRealism: 0.55,
  highlightRealism: 0.7,
  colorNaturalize: 0.55,
  textureAmount: 0.3,
  microContrast: 0.35,
  gamutGuard: 0.75,
  shadowDepth: 0.35,
  smoothnessBreakup: 0.45,
  outputMix: 1,
  seed: 1,
  adjustmentLayerGuard: true,
};

/** `PhotorealizerCore::defaultMasks()`: skin, plastic, highlight, edge, detail. */
export const PHOTOREALIZER_DEFAULT_MASKS = { skin: 0, plastic: 1, highlight: 1, edge: 0, detail: 1 } as const;

export type PreparedPhotorealizer = {
  controls: PhotorealizerControls;
  frameIndex: number;
  /** `static_cast<int>(controls.seed * 997.0f) + frame.frameIndex * 17` */
  textureSeed: number;
};

const f32 = Math.fround;
const num = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'boolean' ? (value ? 1 : 0) : fallback;
const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : typeof value === 'number' ? value !== 0 : fallback);

export function controlsFromParams(params: Record<string, unknown>): PhotorealizerControls {
  const out = { ...PHOTOREALIZER_DEFAULT_CONTROLS } as Record<string, number | boolean>;
  for (const [key, fallback] of Object.entries(PHOTOREALIZER_DEFAULT_CONTROLS)) {
    // OFX doubles are narrowed to float by the plugin (static_cast<float>).
    out[key] = typeof fallback === 'boolean' ? bool(params[key], fallback) : f32(num(params[key], fallback));
  }
  return out as PhotorealizerControls;
}

export function preparePhotorealizer(frame: { frameIndex: number }, controls: PhotorealizerControls): PreparedPhotorealizer {
  const frameIndex = Math.trunc(frame.frameIndex);
  return {
    controls: { ...controls },
    frameIndex,
    textureSeed: (Math.trunc(f32(f32(controls.seed) * 997)) + frameIndex * 17) | 0,
  };
}
