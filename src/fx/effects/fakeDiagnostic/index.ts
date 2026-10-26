import type { FxDefinition, FxParamDef, FxParamValues } from '../../types.ts';
import { FAKE_TEMPORAL_OFFSETS, FAKE_VIEW_MODES, controlsFromParams, prepareFake } from './model.ts';
import { FAKE_DIAGNOSTIC_FRAGMENT, FAKE_GUARD_FRAGMENT, fakeDiagnosticUniforms, fakeGuardUniforms } from './shader.ts';

const f = (id: string, label: string, def: number, min: number, max: number, group: string, extra: Partial<FxParamDef> = {}): FxParamDef =>
  ({ id, label, type: 'float', default: def, min, max, group, ...extra }) as FxParamDef;

// Ids, labels, defaults and ranges from BuckswoodFakeDiagnosticOFX.cpp
// (single "Fake Diagnostic" page in OFX; grouped here for the Effect Controls panel).
const params: FxParamDef[] = [
  {
    id: 'viewMode',
    label: 'View Mode',
    type: 'choice',
    default: 0,
    options: [...FAKE_VIEW_MODES],
    group: 'diagnostic',
    hint: 'Overlay: category colours over the image. Matte: suspicion map. Assist: subtle corrective processing. The two temporal views need neighbouring frames and show no temporal signal in the WebGL engine.',
  },
  f('sensitivity', 'Sensitivity', 1, 0.1, 3, 'diagnostic'),
  f('overlayStrength', 'Overlay Strength', 0.65, 0, 1, 'diagnostic'),
  f('correctionStrength', 'Correction Strength', 0.35, 0, 1, 'diagnostic'),
  {
    id: 'temporalAnalysis',
    label: 'Temporal Analysis',
    type: 'bool',
    default: false,
    group: 'temporal',
    hidden: true,
    hint: 'Kept for OFX project compatibility; ignored by the WebGL engine (single-frame analysis).',
  },
  {
    id: 'temporalOffset',
    label: 'Temporal Frame Offset',
    type: 'choice',
    default: 0,
    options: [...FAKE_TEMPORAL_OFFSETS],
    group: 'temporal',
    hidden: true,
    hint: 'Kept for OFX project compatibility; ignored by the WebGL engine.',
  },
  f('plasticWeight', 'Plastic/Smooth Weight', 1, 0, 2, 'weights'),
  f('highlightWeight', 'Highlight/Clip Weight', 1, 0, 2, 'weights'),
  f('edgeWeight', 'Edge/Matte Weight', 0.85, 0, 2, 'weights'),
  f('gradeWeight', 'Grade/Gamut Weight', 0.9, 0, 2, 'weights'),
  f('textureWeight', 'Texture Weight', 0.85, 0, 2, 'weights'),
  f('temporalWeight', 'Temporal Weight', 0.8, 0, 2, 'weights', {
    hint: 'No temporal signal in the WebGL engine, but still part of the score normalisation (as in the plugin).',
  }),
  f('microContrast', 'Micro Contrast Assist', 0.35, -1, 1, 'assist'),
  f('edgeSoften', 'Edge Soften Assist', 0.15, 0, 1, 'assist'),
  f('highlightRolloff', 'Highlight Rolloff Assist', 0.55, 0, 1, 'assist'),
  f('gamutGuard', 'Gamut Guard Assist', 0.45, 0, 1, 'assist'),
  f('sensorTexture', 'Sensor Texture Assist', 0.25, 0, 1, 'assist'),
  f('temporalAssist', 'Temporal Smooth Assist', 0.25, 0, 1, 'temporal', {
    hidden: true,
    hint: 'Blends towards the neighbour-frame average; ignored by the WebGL engine.',
  }),
  f('seed', 'Texture Seed', 17, 1, 1000, 'assist', { displayMax: 100, step: 1 }),
  {
    id: 'adjustmentLayerGuard',
    label: 'Adjustment Layer Guard',
    type: 'bool',
    default: true,
    group: 'diagnostic',
    hint: 'Outputs transparent black when the input looks like an empty adjustment layer (near-black and opaque).',
  },
];

const prepared = (values: FxParamValues, frame: { width: number; height: number; frameIndex: number }) =>
  prepareFake(frame, controlsFromParams(values));

export const FAKE_DIAGNOSTIC: FxDefinition = {
  id: 'buckswood-post-plugins.fake-diagnostic',
  name: 'Fake Diagnostic',
  vendor: 'Buckswood Post Plugins',
  version: '2.2',
  category: 'diagnostic',
  description:
    'Supervisor tool for spotting "feels fake" signals in AI, CG and comped images: plastic smoothness (magenta), clipped highlights (yellow), hard edges (cyan), gamut/grade pressure (red) and missing sensor texture (blue) as overlay, matte or category map, plus a subtle Reality Match Assist correction. Single-frame analysis.',
  ofxIdentifier: 'com.buckswood.fake.diagnostic',
  groups: [
    { id: 'diagnostic', label: 'Diagnostic' },
    { id: 'weights', label: 'Category Weights', collapsed: true },
    { id: 'assist', label: 'Reality Match Assist', collapsed: true },
    { id: 'temporal', label: 'Temporal (OFX only)', collapsed: true },
  ],
  params,
  presets: [
    { id: 'overlay', name: 'Diagnostic Overlay', description: 'Category colours over the image.', values: { viewMode: 0, sensitivity: 1, overlayStrength: 0.65 } },
    { id: 'problem-matte', name: 'Problem Matte', description: 'Grayscale suspicion map, e.g. as a qualifier.', values: { viewMode: 1 } },
    { id: 'category-map', name: 'Category Map', description: 'False-colour map of what drives the fake feeling.', values: { viewMode: 4 } },
    { id: 'reality-assist', name: 'Reality Match Assist', description: 'Gentle correction of the detected problems.', values: { viewMode: 2, correctionStrength: 0.5 } },
    { id: 'strict-review', name: 'Strict Review', description: 'Higher sensitivity, full overlay.', values: { viewMode: 0, sensitivity: 1.8, overlayStrength: 0.85 } },
    {
      id: 'ai-skin-plastic',
      name: 'AI Skin / Plastic Focus',
      description: 'Weights smoothness and missing texture over edges and grade.',
      values: { viewMode: 1, plasticWeight: 2, textureWeight: 1.6, edgeWeight: 0.4, gradeWeight: 0.4 },
    },
  ],
  passes: [
    {
      id: 'guard',
      fragment: FAKE_GUARD_FRAGMENT,
      uniforms: (values, frame) => fakeGuardUniforms(prepared(values, frame)),
    },
    {
      id: 'diagnostic',
      fragment: FAKE_DIAGNOSTIC_FRAGMENT,
      inputs: ['guard'],
      uniforms: (values, frame) => fakeDiagnosticUniforms(prepared(values, frame)),
    },
  ],
};
