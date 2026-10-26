import type { FxDefinition, FxParamDef, FxParamValues } from '../../types.ts';
import { opticsAsset } from './assets.ts';
import {
  OPTICS_DIRT_ASSETS,
  OPTICS_GLASS_ASSETS,
  OPTICS_PRESET_NAMES,
  OPTICS_SMUDGE_ASSETS,
  controlsFromParams,
  prepareOptics,
} from './model.ts';
import { OPTICS_LAB_FRAGMENT, opticsLabUniforms } from './shader.ts';

const f = (id: string, label: string, def: number, min: number, max: number, group: string, extra: Partial<FxParamDef> = {}): FxParamDef =>
  ({ id, label, type: 'float', default: def, min, max, group, ...extra }) as FxParamDef;
const b = (id: string, label: string, def: boolean, group: string, hint?: string): FxParamDef => ({ id, label, type: 'bool', default: def, group, hint });
const choice = (id: string, label: string, def: number, options: readonly string[], group: string, hint?: string): FxParamDef => ({
  id,
  label,
  type: 'choice',
  default: def,
  options: [...options],
  group,
  hint,
});

const params: FxParamDef[] = [
  choice('preset', 'Lens', 6, OPTICS_PRESET_NAMES, 'lens', 'Coherent optical recipe. The controls below remain available as trims.'),
  f('effectStrength', 'Lens Strength', 0.65, 0, 1, 'lens'),
  f('focalLength', 'Focal Length', 50, 8, 300, 'lens', { unit: 'mm' }),
  f('fStop', 'F-Stop', 2.8, 0.7, 32, 'lens', { step: 0.1 }),
  f('focusDistance', 'Focus Distance', 3, 0.0002, 1000, 'lens', { displayMax: 30 }),
  f('breathing', 'Focus Breathing', 0, -1, 1, 'lens'),
  f('sensorWidth', 'Sensor Width', 36, 8, 70, 'lens', { unit: 'mm' }),
  f('anamorphicSqueeze', 'Anamorphic Squeeze', 1, 1, 2, 'lens'),
  f('anamorphicAngle', 'Anamorphic Axis', 0, -180, 180, 'lens', { unit: '°' }),
  choice('sceneUnits', 'Scene Units', 0, ['Meters', 'Centimeters', 'Millimeters', 'Feet', 'Inches'], 'lens'),
  f('sceneScale', 'Scene Scale', 1, 0.001, 1000, 'lens', { displayMax: 10 }),

  f('distortion', 'Distortion Trim', 0, -1, 1, 'distortion'),
  f('fieldCurvature', 'Field Curvature', 0, 0, 1, 'distortion'),
  f('swirl', 'Swirl', 0, 0, 1, 'distortion'),

  f('lateralCA', 'Lateral CA', 0, 0, 1, 'chromatic'),
  f('axialCA', 'Axial CA', 0, 0, 1, 'chromatic'),

  choice('glassAsset', 'Glass', 0, OPTICS_GLASS_ASSETS, 'glass', 'Built-in aperture character.'),
  f('apertureInfluence', 'Glass Influence', 0.85, 0, 1, 'glass'),
  choice('depthSource', 'Depth Source', 0, ['Uniform Focus Offset', 'Source Alpha as Depth'], 'glass'),
  b('depthInvert', 'Invert Alpha Depth', false, 'glass'),
  f('depthNear', 'Alpha Depth Near', 0, 0, 1, 'glass'),
  f('depthFar', 'Alpha Depth Far', 1, 0, 1, 'glass'),
  f('depthGamma', 'Alpha Depth Gamma', 1, 0.1, 4, 'glass'),
  f('focusPlane', 'Alpha Focus Plane', 0.5, 0, 1, 'glass'),
  f('focusOffset', 'Uniform Focus Offset', 0, -1, 1, 'glass'),
  f('defocus', 'Defocus', 0, 0, 1, 'glass'),
  f('catEye', 'Cat-Eye Bokeh', 0, 0, 1, 'glass'),
  f('coma', 'Coma', 0, 0, 1, 'glass'),
  f('astigmatism', 'Astigmatism', 0, 0, 1, 'glass'),
  f('spherical', 'Spherical Aberration', 0, 0, 1, 'glass'),
  { id: 'irisBlades', label: 'Iris Blades (0 = Lens)', type: 'int', default: 0, min: 0, max: 16, group: 'glass' },
  f('irisRoundnessTrim', 'Iris Roundness Trim', 0, -1, 1, 'glass'),
  f('irisRotation', 'Iris Rotation', 0, -180, 180, 'glass', { unit: '°' }),

  f('bloom', 'Bloom', 0, 0, 1, 'light'),
  f('bloomThreshold', 'Highlight Threshold', 0.82, 0, 4, 'light'),
  f('diffusion', 'Diffusion', 0, 0, 1, 'light'),
  f('halation', 'Halation', 0, 0, 1, 'light'),
  f('flareGhosts', 'Flare Ghosts', 0, 0, 1, 'light'),
  f('flareStreak', 'Anamorphic Streak', 0, 0, 1, 'light'),
  f('starburst', 'Starburst', 0, 0, 1, 'light'),
  f('starUnevennessTrim', 'Star Spoke Unevenness', 0, -1, 1, 'light'),
  f('starFStopResponse', 'Physical F-Stop Response', 1, 0, 1, 'light'),

  f('vignette', 'Vignette', 0, 0, 1, 'vignette'),

  choice('dirtAsset', 'Dirt', 0, OPTICS_DIRT_ASSETS, 'surface'),
  f('dirtAmount', 'Dirt Amount', 0, 0, 1, 'surface'),
  f('dirtScale', 'Dirt Scale', 1, 0.25, 8, 'surface'),
  choice('smudgeAsset', 'Smudge', 0, OPTICS_SMUDGE_ASSETS, 'surface'),
  f('smudgeAmount', 'Smudge Amount', 0, 0, 1, 'surface'),
  f('smudgeScale', 'Smudge Scale', 1, 0.25, 8, 'surface'),

  f('debayer', 'Sensor Debayer Character', 0, 0, 1, 'sensor'),
  f('chromaSmear', 'Chroma Detail Smear', 0, 0, 1, 'sensor'),
  f('grain', 'Sensor Grain', 0, 0, 1, 'sensor'),
  f('grainSize', 'Grain Size', 1, 0.5, 4, 'sensor'),
  f('grainSeed', 'Grain Seed', 1, 0, 1000, 'sensor', { displayMax: 100, step: 1 }),
  f('sensorISO', 'Sensor ISO', 400, 50, 12800, 'sensor', { displayMax: 6400, step: 50 }),
  f('edgeGuard', 'Edge Halo Guard', 0.8, 0, 1, 'sensor'),
  f('outputMix', 'Output Mix', 0.65, 0, 1, 'sensor'),

  choice('quality', 'Render Quality', 1, ['Preview', 'Full'], 'workflow', 'Preview reduces optical samples while keeping the same stage model.'),
  b('geometryEnabled', 'Enable Geometry', true, 'workflow'),
  b('aberrationsEnabled', 'Enable Aberrations', true, 'workflow'),
  b('defocusEnabled', 'Enable Defocus / Iris', true, 'workflow'),
  b('lightEnabled', 'Enable Light Effects', true, 'workflow'),
  b('vignetteEnabled', 'Enable Vignette', true, 'workflow'),
  b('surfaceEnabled', 'Enable Dirt / Smudge', true, 'workflow'),
  b('sensorEnabled', 'Enable Sensor', true, 'workflow'),
];

// The user-facing "Render Quality" param decides sample counts (WYSIWYG between
// preview and export); the renderer only lowers resolution while scrubbing.
const prepared = (values: FxParamValues, frame: { width: number; height: number; frameIndex: number }) =>
  prepareOptics(frame, controlsFromParams(values));

export const OPTICS_LAB: FxDefinition = {
  id: 'buckswood-post-plugins.optics-lab',
  name: 'Optics Lab',
  vendor: 'Buckswood Post Plugins',
  version: '1.3.1',
  category: 'lens',
  description:
    'Physically motivated lens character: distortion, aberrations, bokeh, bloom, flares, vignette, dirt and sensor grain. 21 lens recipes, including "AI Deplastic" and "AI Natural Lens" for photographic AI images.',
  ofxIdentifier: 'com.buckswood.optics.lab',
  groups: [
    { id: 'lens', label: 'Lens State & Focus' },
    { id: 'distortion', label: 'Distortion & Field', collapsed: true },
    { id: 'chromatic', label: 'Chromatic Aberration', collapsed: true },
    { id: 'glass', label: 'Defocus & Bokeh / Glass', collapsed: true },
    { id: 'light', label: 'Flaring & Bloom', collapsed: true },
    { id: 'vignette', label: 'Vignetting', collapsed: true },
    { id: 'surface', label: 'Dirt & Smudge', collapsed: true },
    { id: 'sensor', label: 'Sensor & Output' },
    { id: 'workflow', label: 'Workflow & Performance', collapsed: true },
  ],
  params,
  presets: [
    { id: 'ai-deplastic', name: 'AI Deplastic (Standard)', description: 'Removes the CGI sheen from generated images.', values: { preset: 6, effectStrength: 0.65, outputMix: 0.65 } },
    { id: 'ai-natural', name: 'AI Natural Lens + Grain', description: 'Subtle real-lens imperfections plus ISO 800 sensor grain.', values: { preset: 20, effectStrength: 0.7, grain: 0.35, sensorISO: 800, outputMix: 0.75 } },
    { id: 'documentary', name: 'Documentary Zoom', values: { preset: 19, effectStrength: 0.6, grain: 0.25, sensorISO: 1600, vignette: 0.1 } },
    { id: 'anamorphic-night', name: 'Anamorphic Night', values: { preset: 14, effectStrength: 0.75, anamorphicSqueeze: 1.8, flareStreak: 0.2, bloom: 0.15, grain: 0.3, sensorISO: 3200 } },
    { id: 'vintage-70s', name: 'Vintage 70s', values: { preset: 15, effectStrength: 0.8, halation: 0.2, grain: 0.45, sensorISO: 800, dirtAsset: 1, dirtAmount: 0.25 } },
    { id: 'soft-portrait', name: 'Soft Portrait', values: { preset: 12, effectStrength: 0.7, diffusion: 0.1 } },
  ],
  passes: [
    {
      id: 'optics',
      fragment: OPTICS_LAB_FRAGMENT,
      uniforms: (values, frame) => opticsLabUniforms(prepared(values, frame)),
      textures: (values, frame) => {
        const state = prepared(values, frame);
        const requests = [] as ReturnType<NonNullable<FxDefinition['passes'][number]['textures']>>;
        const add = (uniform: string, kind: 'glass' | 'dirt' | 'smudge', index: number) => {
          const texture = opticsAsset(kind, index) ?? opticsAsset('glass', 1)!;
          requests.push({ uniform, key: `optics:${kind}:${index > 0 ? index : 'none'}`, width: texture.width, height: texture.height, build: () => texture.data });
        };
        add('t_glass', 'glass', state.glassAsset);
        add('t_dirt', 'dirt', state.dirtAsset);
        add('t_smudge', 'smudge', state.smudgeAsset);
        return requests;
      },
    },
  ],
};
