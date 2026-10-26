/**
 * Buckswood Post Plugins FX engine — shared types.
 *
 * An effect (FxDefinition) is a declarative parameter schema plus one or more
 * WebGL2 fragment passes. Photo editor, timeline preview and export all render
 * through the same definitions, so what you see is what gets exported.
 */

export type FxParamValue = number | boolean | string;
export type FxParamValues = Record<string, FxParamValue>;

type FxParamBase = {
  id: string;
  label: string;
  /** Group id (see FxDefinition.groups). */
  group?: string;
  hint?: string;
  /** Hidden params keep their value but are not shown in the UI. */
  hidden?: boolean;
};

export type FxFloatParam = FxParamBase & {
  type: 'float';
  default: number;
  min: number;
  max: number;
  /** Slider range when smaller than the hard range. */
  displayMin?: number;
  displayMax?: number;
  step?: number;
  unit?: string;
};

export type FxIntParam = FxParamBase & {
  type: 'int';
  default: number;
  min: number;
  max: number;
};

export type FxBoolParam = FxParamBase & {
  type: 'bool';
  default: boolean;
};

export type FxChoiceParam = FxParamBase & {
  type: 'choice';
  default: number;
  options: string[];
};

export type FxParamDef = FxFloatParam | FxIntParam | FxBoolParam | FxChoiceParam;

export type FxGroup = {
  id: string;
  label: string;
  /** Collapsed by default in the Effect Controls panel. */
  collapsed?: boolean;
};

export type FxFrameContext = {
  width: number;
  height: number;
  /** Integer frame index (drives animated grain). */
  frameIndex: number;
  /** Seconds since clip start. */
  time: number;
  /** Render quality hint: preview may reduce sample counts. */
  quality: 'preview' | 'full';
};

export type FxUniformValue = number | boolean | number[] | Float32Array | Int32Array;
export type FxUniforms = Record<string, FxUniformValue>;

export type FxTextureRequest = {
  /** Sampler uniform name in the shader. */
  uniform: string;
  /** Stable cache key — regenerated only when the key changes. */
  key: string;
  width: number;
  height: number;
  /** Single channel (luminance) data, 0..1. */
  build: () => Float32Array;
};

export type FxPass = {
  id: string;
  /**
   * GLSL ES 3.00 fragment body. The engine prepends the common header
   * (precision, `u_src`, `u_orig`, `u_size`, `bw_sample()` helpers …).
   */
  fragment: string;
  /** Output scale relative to the frame (e.g. 0.5 for a half-res blur pass). */
  scale?: number;
  /** Uniforms for this pass, derived from params + frame. */
  uniforms?: (params: FxParamValues, frame: FxFrameContext) => FxUniforms;
  /** Extra textures (procedural assets, LUTs). */
  textures?: (params: FxParamValues, frame: FxFrameContext) => FxTextureRequest[];
  /** Ids of earlier passes made available as `u_pass_<id>` samplers. */
  inputs?: string[];
};

export type FxCategory =
  | 'lens'
  | 'film'
  | 'grain'
  | 'color'
  | 'repair'
  | 'diagnostic'
  | 'stylize';

export type FxDefinition = {
  /** Stable id stored in projects, e.g. "buckswood-post-plugins.optics-lab". */
  id: string;
  name: string;
  vendor: string;
  version: string;
  category: FxCategory;
  description: string;
  /** Matching OFX plugin identifier for the native host / oracle tests. */
  ofxIdentifier?: string;
  groups?: FxGroup[];
  params: FxParamDef[];
  /** Named parameter snapshots shown as "Presets" in the UI. */
  presets?: FxPreset[];
  passes: FxPass[];
  /** Needs neighbouring frames (rendered via the native OFX host only). */
  temporal?: boolean;
  /**
   * Rendered outside WebGL: 'ofx' = native OpenFX plugin via the sidecar host
   * (`ofxIdentifier` is the plugin id). Such definitions have no passes.
   */
  native?: 'ofx';
};

export type FxPreset = {
  id: string;
  name: string;
  description?: string;
  values: FxParamValues;
};

/** One effect applied to a clip or photo layer (serialised in projects). */
export type FxInstance = {
  id: string;
  /** FxDefinition.id, or "ofx:<identifier>" for native OFX plugins. */
  effectId: string;
  enabled: boolean;
  params: FxParamValues;
  /** 0..1 blend of the effect result over its input. */
  mix?: number;
  /** Collapsed state in the Effect Controls panel. */
  collapsed?: boolean;
};

export type FxStack = FxInstance[];
