import type { FxDefinition, FxParamDef, FxParamValues, FxTextureRequest } from '../../types.ts';
import { CURVE_LUT_SIZE, CURVE_ROWS, WINDOW_TYPES, buildCurveTexture, curveTextureKey, curvesFromParams, prepareGrade } from './model.ts';
import { PRIMARY_GRADE_FRAGMENTS, blurUniforms, composeUniforms, gradeUniforms, sizingUniforms } from './shader.ts';

export const PRIMARY_GRADE_ID = 'avpe.primary-grade';

const f = (id: string, label: string, def: number, min: number, max: number, group: string, extra: Partial<FxParamDef> = {}): FxParamDef =>
  ({ id, label, type: 'float', default: def, min, max, group, ...extra }) as FxParamDef;
const b = (id: string, label: string, def: boolean, group: string, extra: Partial<FxParamDef> = {}): FxParamDef =>
  ({ id, label, type: 'bool', default: def, group, ...extra }) as FxParamDef;

const channels = (prefix: string, label: string, def: number, min: number, max: number, group: string, withY = true, extra: Partial<FxParamDef> = {}) =>
  (withY ? ['R', 'G', 'B', 'Y'] : ['R', 'G', 'B']).map((c) => f(`${prefix}${c}`, `${label} ${c}`, def, min, max, group, extra));

const params: FxParamDef[] = [
  ...channels('lift', 'Lift', 0, -1, 1, 'primaries'),
  ...channels('gamma', 'Gamma', 0, -1, 1, 'primaries'),
  ...channels('gain', 'Gain', 1, 0, 4, 'primaries', true, { displayMin: 0, displayMax: 2 }),
  ...channels('offset', 'Offset', 0, -1, 1, 'primaries', false),
  f('temperature', 'Temperatur', 0, -100, 100, 'primaries'),
  f('tint', 'Tönung', 0, -100, 100, 'primaries'),
  f('contrast', 'Kontrast', 1, 0, 3, 'primaries', { displayMax: 2 }),
  f('pivot', 'Pivot', 0.435, 0, 1, 'primaries'),
  f('saturation', 'Sättigung', 1, 0, 4, 'primaries', { displayMax: 2 }),
  f('hue', 'Farbton', 0, -180, 180, 'primaries', { unit: '°' }),
  f('lumMix', 'Lum Mix', 1, 0, 1, 'primaries'),

  ...channels('logShadow', 'Log Schatten', 0, -1, 1, 'log', false),
  ...channels('logMid', 'Log Mitten', 0, -1, 1, 'log', false),
  ...channels('logHigh', 'Log Lichter', 0, -1, 1, 'log', false),
  f('logLowRange', 'Unterer Bereich', 0.333, 0, 1, 'log'),
  f('logHighRange', 'Oberer Bereich', 0.55, 0, 1, 'log'),

  b('qualEnabled', 'Qualifier aktiv', false, 'qualifier'),
  b('qualHueOn', 'Farbton verwenden', true, 'qualifier'),
  f('qualHue', 'Farbton Mitte', 0, 0, 360, 'qualifier', { unit: '°' }),
  f('qualHueWidth', 'Farbton Breite', 30, 0, 180, 'qualifier', { unit: '°' }),
  f('qualHueSoft', 'Farbton Weichheit', 10, 0, 90, 'qualifier', { unit: '°' }),
  b('qualSatOn', 'Sättigung verwenden', true, 'qualifier'),
  f('qualSatLow', 'Sättigung min', 0, 0, 1, 'qualifier'),
  f('qualSatHigh', 'Sättigung max', 1, 0, 1, 'qualifier'),
  f('qualSatSoft', 'Sättigung Weichheit', 0.05, 0, 0.5, 'qualifier'),
  b('qualLumOn', 'Luminanz verwenden', true, 'qualifier'),
  f('qualLumLow', 'Luminanz min', 0, 0, 1, 'qualifier'),
  f('qualLumHigh', 'Luminanz max', 1, 0, 1, 'qualifier'),
  f('qualLumSoft', 'Luminanz Weichheit', 0.05, 0, 0.5, 'qualifier'),
  b('qualInvert', 'Qualifier invertieren', false, 'qualifier'),

  { id: 'winType', label: 'Fenster', type: 'choice', default: 0, options: [...WINDOW_TYPES], group: 'window' },
  f('winX', 'Fenster X', 0.5, -1, 2, 'window', { displayMin: 0, displayMax: 1 }),
  f('winY', 'Fenster Y', 0.5, -1, 2, 'window', { displayMin: 0, displayMax: 1 }),
  f('winSizeX', 'Fenster Breite', 0.3, 0.001, 4, 'window', { displayMax: 1.5 }),
  f('winSizeY', 'Fenster Höhe', 0.3, 0.001, 4, 'window', { displayMax: 1.5 }),
  f('winRotation', 'Fenster Drehung', 0, -180, 180, 'window', { unit: '°' }),
  f('winSoftness', 'Weiche Kante', 0.15, 0, 2, 'window', { displayMax: 1 }),
  b('winInvert', 'Fenster invertieren', false, 'window'),

  f('blurRadius', 'Weichzeichnen', 0, 0, 64, 'blur', { unit: 'px', displayMax: 32 }),
  f('sharpen', 'Schärfen', 0, 0, 4, 'blur', { displayMax: 2 }),

  f('keyGain', 'Key-Verstärkung', 1, 0, 4, 'key', { displayMax: 2 }),
  f('keyOffset', 'Key-Offset', 0, -1, 1, 'key'),
  b('keyInvert', 'Key invertieren', false, 'key'),
  b('showMask', 'Maske anzeigen', false, 'key', { hidden: true }),

  f('sizePan', 'Pan', 0, -2, 2, 'sizing', { displayMin: -1, displayMax: 1 }),
  f('sizeTilt', 'Tilt', 0, -2, 2, 'sizing', { displayMin: -1, displayMax: 1 }),
  f('sizeZoom', 'Zoom', 1, 0.05, 20, 'sizing', { displayMin: 0.25, displayMax: 4 }),
  f('sizeRotate', 'Drehung', 0, -180, 180, 'sizing', { unit: '°' }),
  b('sizeFlipH', 'Horizontal spiegeln', false, 'sizing'),
  b('sizeFlipV', 'Vertikal spiegeln', false, 'sizing'),
];

const curveTexture = (values: FxParamValues): FxTextureRequest[] => [
  {
    uniform: 't_curves',
    key: curveTextureKey(values),
    width: CURVE_LUT_SIZE,
    height: CURVE_ROWS,
    build: () => buildCurveTexture(curvesFromParams(values)),
  },
];

export const PRIMARY_GRADE: FxDefinition = {
  id: PRIMARY_GRADE_ID,
  name: 'Farbkorrektur-Node',
  vendor: 'AI Video Production Editor',
  version: '1.0.0',
  category: 'color',
  description:
    'Primäre Farbkorrektur wie ein Color-Page-Node: Lift/Gamma/Gain/Offset, Log-Räder, Kurven, HSL-Qualifier, Power Window, Weichzeichnen/Schärfen, Key und Sizing.',
  groups: [
    { id: 'primaries', label: 'Primaries' },
    { id: 'log', label: 'Log-Räder', collapsed: true },
    { id: 'qualifier', label: 'Qualifier', collapsed: true },
    { id: 'window', label: 'Power Window', collapsed: true },
    { id: 'blur', label: 'Weichzeichnen / Schärfen', collapsed: true },
    { id: 'key', label: 'Key', collapsed: true },
    { id: 'sizing', label: 'Sizing', collapsed: true },
  ],
  params,
  passes: [
    {
      id: 'grade',
      fragment: PRIMARY_GRADE_FRAGMENTS.grade,
      uniforms: (values, frame) => gradeUniforms(prepareGrade(values, frame)),
      textures: (values) => curveTexture(values),
    },
    { id: 'blurH', fragment: PRIMARY_GRADE_FRAGMENTS.blurH, uniforms: (values, frame) => blurUniforms(prepareGrade(values, frame)) },
    { id: 'blurV', fragment: PRIMARY_GRADE_FRAGMENTS.blurV, uniforms: (values, frame) => blurUniforms(prepareGrade(values, frame)) },
    {
      id: 'compose',
      fragment: PRIMARY_GRADE_FRAGMENTS.compose,
      inputs: ['grade'],
      uniforms: (values, frame) => composeUniforms(prepareGrade(values, frame)),
    },
    { id: 'sizing', fragment: PRIMARY_GRADE_FRAGMENTS.sizing, uniforms: (values, frame) => sizingUniforms(prepareGrade(values, frame)) },
  ],
};
