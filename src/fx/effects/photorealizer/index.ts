import type { FxDefinition, FxParamDef } from '../../types.ts';
import { controlsFromParams, preparePhotorealizer } from './model.ts';
import { PHOTOREALIZER_FRAGMENT, photorealizerUniforms } from './shader.ts';

const f = (id: string, label: string, def: number, min: number, max: number, group: string, extra: Partial<FxParamDef> = {}): FxParamDef =>
  ({ id, label, type: 'float', default: def, min, max, group, ...extra }) as FxParamDef;

/*
 * Ids, labels, defaults and ranges are those of the OFX descriptor
 * (BuckswoodAIPhotorealizerOFX.cpp, describeInContext). The OFX plugin has a
 * single page without groups; the groups below only organise the Effect
 * Controls panel.
 */
const params: FxParamDef[] = [
  f('plasticReduction', 'Plastic Reduction', 0.65, 0, 1, 'surface', { hint: 'Raises the sensor texture on smooth, waxy AI surfaces.' }),
  f('skinRealism', 'Skin Realism', 0.55, 0, 1, 'surface', { hint: 'Pulls skin tones from pink/magenta towards a camera-like peach.' }),
  f('smoothnessBreakup', 'Smoothness Breakup', 0.45, 0, 1, 'surface'),
  f('textureAmount', 'Sensor Texture', 0.3, 0, 1, 'surface'),
  f('seed', 'Texture Seed', 1, 1, 1000, 'surface', { displayMax: 100, step: 1 }),

  f('highlightRealism', 'Highlight Realism', 0.7, 0, 1, 'tone', { hint: 'Camera-like highlight roll-off above 0.74 instead of glossy clipping.' }),
  f('microContrast', 'Micro Contrast', 0.35, 0, 1, 'tone'),
  f('shadowDepth', 'Shadow Depth', 0.35, 0, 1, 'tone'),

  f('colorNaturalize', 'Color Naturalize', 0.55, 0, 1, 'color'),
  f('gamutGuard', 'Gamut Guard', 0.75, 0, 1, 'color', { hint: 'Compresses only extreme, neon-like chroma.' }),

  f('outputMix', 'Output Mix', 1, 0, 1, 'output'),
  {
    id: 'adjustmentLayerGuard',
    label: 'Adjustment Layer Guard',
    type: 'bool',
    default: true,
    group: 'output',
    hint: 'Outputs transparent black when the input is an empty (black, opaque) frame, like an unused Resolve adjustment clip.',
  },
];

const SLIDERS = ['plasticReduction', 'skinRealism', 'highlightRealism', 'colorNaturalize', 'textureAmount', 'microContrast', 'gamutGuard', 'shadowDepth', 'smoothnessBreakup', 'outputMix'] as const;
const preset = (values: readonly number[]) => Object.fromEntries(SLIDERS.map((id, i) => [id, values[i]]));

export const AI_PHOTOREALIZER: FxDefinition = {
  id: 'buckswood-post-plugins.ai-photorealizer',
  name: 'AI Photorealizer',
  vendor: 'Buckswood Post Plugins',
  version: '0.3.0',
  category: 'film',
  description:
    'Makes AI-generated images read like camera footage: gamut guard for neon chroma, skin-tone bias, highlight roll-off, shadow depth, micro contrast and a fine deterministic sensor texture that breaks up plastic surfaces.',
  ofxIdentifier: 'com.buckswood.ai.photorealizer',
  groups: [
    { id: 'surface', label: 'Surface & Texture' },
    { id: 'tone', label: 'Tone' },
    { id: 'color', label: 'Color', collapsed: true },
    { id: 'output', label: 'Output', collapsed: true },
  ],
  params,
  presets: [
    //                                   plastic skin  hilite natur texture micro gamut shadow breakup mix
    { id: 'default', name: 'Standard (Default)', description: 'The OFX defaults.', values: preset([0.65, 0.55, 0.7, 0.55, 0.3, 0.35, 0.75, 0.35, 0.45, 1]) },
    { id: 'deplastic-subtle', name: 'Deplastic Subtle', description: 'Gentle clean-up for images that are almost there.', values: preset([0.45, 0.35, 0.5, 0.35, 0.18, 0.2, 0.6, 0.2, 0.3, 0.7]) },
    { id: 'skin-texture', name: 'Skin & Texture', description: 'Portraits: stronger skin correction and visible sensor texture.', values: preset([0.8, 0.9, 0.65, 0.45, 0.55, 0.3, 0.7, 0.3, 0.75, 1]) },
    { id: 'strong', name: 'Strong', description: 'Heavily stylised or over-saturated AI renders.', values: preset([1, 0.8, 1, 0.85, 0.8, 0.7, 1, 0.7, 0.9, 1]) },
  ],
  passes: [
    {
      id: 'photorealizer',
      fragment: PHOTOREALIZER_FRAGMENT,
      uniforms: (values, frame) => photorealizerUniforms(preparePhotorealizer(frame, controlsFromParams(values))),
    },
  ],
};
