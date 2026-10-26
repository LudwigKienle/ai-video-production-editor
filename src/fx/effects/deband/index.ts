import type { FxDefinition, FxParamDef, FxParamValues } from '../../types.ts';
import {
  DEBAND_DITHER_MODES,
  DEBAND_PRECISIONS,
  DEBAND_PRESET_NAMES,
  DEBAND_VIEW_MODES,
  DEBAND_WORKING_SPACES,
  controlsFromParams,
  prepareDeband,
} from './model.ts';
import { DEBAND_FRAGMENT, debandUniforms } from './shader.ts';

const f = (id: string, label: string, def: number, min: number, max: number, group: string, hint: string, extra: Partial<FxParamDef> = {}): FxParamDef =>
  ({ id, label, type: 'float', default: def, min, max, group, hint, ...extra }) as FxParamDef;
const choice = (id: string, label: string, def: number, options: readonly string[], group: string, hint: string): FxParamDef => ({
  id,
  label,
  type: 'choice',
  default: def,
  options: [...options],
  group,
  hint,
});

// Ids, labels, hints, defaults and ranges from BuckswoodDebandOFX.cpp (single
// "Buckswood Post Plugins Deband" page in OFX; grouped here for the Effect Controls panel).
const params: FxParamDef[] = [
  choice('preset', 'Preset', 0, DEBAND_PRESET_NAMES, 'profile', 'Selects a tuned starting profile. All repair controls remain active as trims.'),
  choice('workingSpace', 'Working Space', 0, DEBAND_WORKING_SPACES, 'profile', 'Choose the transfer behavior of the incoming pixels.'),
  choice('sourcePrecision', 'Source Precision', 0, DEBAND_PRECISIONS, 'profile', 'Sets the expected quantization step used for detection and dither.'),

  f('strength', 'Repair Strength', 0.7, 0, 1, 'repair', 'Amount of reconstructed gradient mixed into detected bands.'),
  f('detection', 'Band Detection', 0.55, 0, 1, 'repair', 'Raises sensitivity to weak false contours.'),
  f('radius', 'Repair Radius', 8, 2, 24, 'repair', 'Largest spatial scale sampled by the multi-scale reconstruction.', { unit: 'px' }),
  f('edgeProtection', 'Edge Protection', 0.85, 0, 1, 'repair', 'Protects silhouettes, text, and intentional graphic boundaries.'),
  f('textureProtection', 'Texture Protection', 0.8, 0, 1, 'repair', 'Protects grain, pores, fabric, and fine detail.'),
  f('chromaRepair', 'Chroma Repair', 0.35, 0, 1, 'repair', 'Extends repair from luminance into low-frequency color gradients.'),

  f('dither', 'Gradient Dither', 0.35, 0, 1, 'dither', 'Adds deterministic high-frequency dither only inside detected gradients.'),
  choice('ditherMotion', 'Dither Motion', 0, DEBAND_DITHER_MODES, 'dither', 'Static is identical in every frame. Frame-Indexed changes deterministically with time.'),
  f('seed', 'Dither Seed', 1, 1, 1000, 'dither', 'Changes the deterministic dither pattern.', { displayMax: 100, step: 1 }),

  choice('viewMode', 'View', 0, DEBAND_VIEW_MODES, 'output', 'Inspect the detector and protected image structure before rendering the result.'),
  f('outputMix', 'Output Mix', 1, 0, 1, 'output', 'Final dry/wet mix for the Result view.'),
];

const prepared = (values: FxParamValues, frame: { width: number; height: number; frameIndex: number }) =>
  prepareDeband(frame, controlsFromParams(values));

export const DEBAND: FxDefinition = {
  id: 'buckswood-post-plugins.deband',
  name: 'Deband',
  vendor: 'Buckswood Post Plugins',
  version: '1.0',
  category: 'repair',
  description:
    'Removes false contours from 8/10-bit gradients (skies, AI footage, compressed video): three-scale gradient reconstruction with edge, texture and flat-fill guards, optional chroma repair and targeted deterministic dither. Banding Map / Protected Detail / Difference views for inspection.',
  ofxIdentifier: 'com.buckswood.deband',
  groups: [
    { id: 'profile', label: 'Profile' },
    { id: 'repair', label: 'Repair' },
    { id: 'dither', label: 'Dither', collapsed: true },
    { id: 'output', label: 'View & Output' },
  ],
  params,
  presets: [
    { id: 'balanced', name: 'Balanced', description: 'Default profile for 10-bit sources.', values: { preset: 0 } },
    { id: 'subtle-10bit', name: 'Subtle 10-bit', description: 'Light touch for clean 10-bit masters.', values: { preset: 1 } },
    { id: 'sky-8bit', name: '8-bit Sky Rescue', description: 'Wide bands in skies and walls from 8-bit sources.', values: { preset: 2 } },
    { id: 'ai-footage', name: 'AI Footage Gradient Repair', description: 'Smooth AI-generated gradients with strong edge protection.', values: { preset: 3 } },
    { id: 'heavy-compression', name: 'Heavy Compression Rescue', description: 'Streaming/web encodes with blocky bands.', values: { preset: 4 } },
    { id: 'inspect-banding', name: 'Inspect: Banding Map', description: 'Heat map of the detected false contours.', values: { viewMode: 1 } },
  ],
  passes: [
    {
      id: 'deband',
      fragment: DEBAND_FRAGMENT,
      uniforms: (values, frame) => debandUniforms(prepared(values, frame)),
    },
  ],
};
