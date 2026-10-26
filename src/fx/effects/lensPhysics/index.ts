import type { FxDefinition, FxParamDef, FxParamValues } from '../../types.ts';
import { LENS_DEFAULT_CONTROLS, LENS_PRESET_NAMES, controlsFromParams, prepareLensPhysics } from './model.ts';
import { LENS_PHYSICS_FRAGMENT, lensPhysicsUniforms } from './shader.ts';

const f = (id: string, label: string, def: number, min: number, max: number, group: string, extra: Partial<FxParamDef> = {}): FxParamDef =>
  ({ id, label, type: 'float', default: def, min, max, group, ...extra }) as FxParamDef;

/*
 * Ids, labels, defaults, ranges and choice options are those of the OFX
 * descriptor (BuckswoodLensPhysicsOFX.cpp, describeInContext). The OFX plugin
 * has a single page without groups; the groups below only organise the
 * Effect Controls panel.
 */
const params: FxParamDef[] = [
  {
    id: 'lensPreset',
    label: 'Lens Preset',
    type: 'choice',
    default: 19,
    options: [...LENS_PRESET_NAMES],
    group: 'lens',
    hint: 'Lens character recipe. All sliders below are added on top as trims.',
  },
  f('effectStrength', 'Effect Strength', 0.45, 0, 1, 'lens'),
  f('overdrive', 'Overdrive', 0.85, 0, 3, 'lens', { hint: 'Optical drive multiplier (Strength × Mix × Overdrive).' }),
  f('outputMix', 'Output Mix', 0.55, 0, 1, 'lens'),

  f('distortion', 'Distortion Trim', 0, -1, 1, 'optics'),
  f('chromaticAberration', 'Chromatic Aberration', 0.015, 0, 1, 'optics'),
  f('fringing', 'High Contrast Fringing', 0.015, 0, 1, 'optics'),
  f('coma', 'Edge Coma', 0.035, 0, 1, 'optics'),
  f('swirl', 'Swirl', 0, 0, 1, 'optics'),

  f('bloom', 'Highlight Bloom', 0.075, 0, 1, 'light'),
  f('bloomThreshold', 'Bloom Threshold', 0.82, 0.35, 1, 'light'),
  f('vignette', 'Vignette', 0.045, 0, 1, 'light'),
  f('cornerColor', 'Corner Color Cast', 0.02, 0, 1, 'light'),

  f('fStopSharpener', 'F-Stop Sharpener', 0.06, -1, 1, 'detail'),
  f('edgeHaloGuard', 'Overdrive Edge Guard', 0.82, 0, 1, 'detail'),

  {
    id: 'adjustmentLayerGuard',
    label: 'Adjustment Layer Guard',
    type: 'bool',
    default: true,
    group: 'workflow',
    hint: 'Outputs transparent black when the input is an empty (black, opaque) frame, like an unused Resolve adjustment clip.',
  },
];

/** Full snapshot of the core controls so presets do not depend on current values. */
const snapshot = (values: FxParamValues): FxParamValues => {
  const { adjustmentLayerGuard: _guard, ...core } = LENS_DEFAULT_CONTROLS;
  void _guard;
  return { ...core, ...values };
};

export const LENS_PHYSICS: FxDefinition = {
  id: 'buckswood-post-plugins.lens-physics',
  name: 'Lens Physics',
  vendor: 'Buckswood Post Plugins',
  version: '0.5.0',
  category: 'lens',
  description:
    'Lens character for clean digital or AI footage: radial distortion, chromatic aberration, high-contrast fringing, bloom, edge coma, swirl, vignette and corner colour cast, with an overdrive edge-halo guard. 20 lens recipes including Lensfun-calibrated classics.',
  ofxIdentifier: 'com.buckswood.lens.physics',
  groups: [
    { id: 'lens', label: 'Lens & Strength' },
    { id: 'optics', label: 'Distortion & Aberrations', collapsed: true },
    { id: 'light', label: 'Bloom & Vignette', collapsed: true },
    { id: 'detail', label: 'Sharpness & Edge Guard', collapsed: true },
    { id: 'workflow', label: 'Workflow', collapsed: true },
  ],
  params,
  presets: [
    {
      id: 'realistic-match',
      name: 'Realistic Match (Default)',
      description: 'Subtle real-lens correction for AI footage — the OFX defaults.',
      values: snapshot({}),
    },
    {
      id: 'ai-deplastic-glass',
      name: 'AI Deplastic Glass',
      description: 'Breaks the clinical CGI look with mild CA, bloom and vignette.',
      values: snapshot({ lensPreset: 6, effectStrength: 0.6, outputMix: 0.7 }),
    },
    {
      id: 'clean-cinema',
      name: 'Clean Cinema Prime',
      values: snapshot({ lensPreset: 1, effectStrength: 0.6, outputMix: 0.8 }),
    },
    {
      id: 'imax-portrait',
      name: 'IMAX 80mm Portrait',
      values: snapshot({ lensPreset: 17, effectStrength: 0.7, outputMix: 0.8, fStopSharpener: 0.1 }),
    },
    {
      id: 'helios-vintage',
      name: 'Helios-44 Vintage',
      description: 'Moderate strength: full strength pushes the frame edge out of the image.',
      values: snapshot({ lensPreset: 7, effectStrength: 0.55, outputMix: 0.7, overdrive: 0.85 }),
    },
    {
      id: 'ultra-vista',
      name: 'Ultra Vista Anamorphic',
      values: snapshot({ lensPreset: 13, effectStrength: 0.6, outputMix: 0.75, bloomThreshold: 0.7 }),
    },
  ],
  passes: [
    {
      id: 'lens',
      fragment: LENS_PHYSICS_FRAGMENT,
      uniforms: (values, frame) => lensPhysicsUniforms(prepareLensPhysics(frame, controlsFromParams(values))),
    },
  ],
};
