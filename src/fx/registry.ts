import type { FxDefinition, FxInstance, FxParamValues, FxStack } from './types.ts';
import { interpolateKeyframes } from './keyframes.ts';
import { OPTICS_LAB } from './effects/opticsLab/index.ts';
import { LENS_PHYSICS } from './effects/lensPhysics/index.ts';
import { AI_PHOTOREALIZER } from './effects/photorealizer/index.ts';
import { DEBAND } from './effects/deband/index.ts';
import { FAKE_DIAGNOSTIC } from './effects/fakeDiagnostic/index.ts';
import { FILM_EMULATION } from './effects/filmEmulation/index.ts';

const definitions = new Map<string, FxDefinition>();

const listeners = new Set<() => void>();

export function registerFx(definition: FxDefinition): void {
  definitions.set(definition.id, definition);
  listeners.forEach((listener) => listener());
}

/** Notifies when definitions are added (e.g. native OFX plugins after a scan). */
export function subscribeFxRegistry(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getFxDefinition(id: string): FxDefinition | undefined {
  return definitions.get(id);
}

export function listFxDefinitions(): FxDefinition[] {
  return [...definitions.values()];
}

export function defaultParams(definition: FxDefinition): FxParamValues {
  const values: FxParamValues = {};
  for (const param of definition.params) values[param.id] = param.default;
  return values;
}

/**
 * App-level defaults that differ from the OFX descriptors. Buckswood Post Plugins's
 * "Adjustment Layer Guard" makes black opaque input transparent (meant for
 * empty Resolve adjustment clips); on a clip in this editor that would punch
 * holes into fades to black, so new instances start with it off.
 */
const APP_PARAM_DEFAULTS: Record<string, FxParamValues[string]> = {
  adjustmentLayerGuard: false,
};

let instanceCounter = 0;

export function createFxInstance(effectId: string, overrides: FxParamValues = {}): FxInstance {
  const definition = getFxDefinition(effectId);
  instanceCounter += 1;
  return {
    id: `fx-${Date.now().toString(36)}-${instanceCounter}`,
    effectId,
    enabled: true,
    mix: 1,
    params: { ...(definition ? appDefaultParams(definition) : {}), ...overrides },
  };
}

/** Descriptor defaults plus the app-level overrides above (used for new instances and "reset"). */
export function appDefaultParams(definition: FxDefinition): FxParamValues {
  const values = defaultParams(definition);
  for (const [id, value] of Object.entries(APP_PARAM_DEFAULTS)) {
    if (id in values) values[id] = value;
  }
  return values;
}

/** Definition params with defaults filled in (projects may predate new params). */
export function resolveParams(instance: FxInstance): FxParamValues {
  const definition = getFxDefinition(instance.effectId);
  return definition ? { ...defaultParams(definition), ...instance.params } : { ...instance.params };
}

/** Key under `FxInstance.keyframes` for the effect's mix (opacity) instead of a param. */
export const FX_MIX_KEY = 'mix';

const animated = (instance: FxInstance, key: string) => {
  const points = instance.keyframes?.[key];
  return points && points.length > 0 ? points : null;
};

/**
 * Params at a clip-local time: keyframed numeric params are interpolated
 * (int params rounded, clamped to the descriptor range), everything else is
 * the constant value. Without keyframes this equals `resolveParams()`.
 */
export function resolveParamsAtTime(instance: FxInstance, time: number): FxParamValues {
  const values = resolveParams(instance);
  if (!instance.keyframes) return values;
  const definition = getFxDefinition(instance.effectId);
  for (const [key, points] of Object.entries(instance.keyframes)) {
    if (key === FX_MIX_KEY || !points?.length) continue;
    const param = definition?.params.find((entry) => entry.id === key);
    if (param && param.type !== 'float' && param.type !== 'int') continue;
    const base = Number(values[key]);
    let value = interpolateKeyframes(points, time, Number.isFinite(base) ? base : 0);
    if (param && (param.type === 'float' || param.type === 'int')) {
      if (param.type === 'int') value = Math.round(value);
      value = Math.min(param.max, Math.max(param.min, value));
    }
    values[key] = value;
  }
  return values;
}

/** Effect mix (0..1) at a clip-local time. */
export function resolveMixAtTime(instance: FxInstance, time: number): number {
  const points = animated(instance, FX_MIX_KEY);
  const value = points ? interpolateKeyframes(points, time, instance.mix ?? 1) : instance.mix ?? 1;
  return Math.min(1, Math.max(0, value));
}

export function hasFxKeyframes(stack: FxStack | undefined | null): boolean {
  return Boolean(stack?.some((entry) => entry.enabled && entry.keyframes && Object.values(entry.keyframes).some((points) => points?.length)));
}

/**
 * Stack with every keyframed value resolved at `time` and keyframes dropped —
 * what the renderer and the OFX host (constant params only) consume. Instances
 * without keyframes are returned as-is, so cache keys stay stable.
 */
export function resolveStackAtTime(stack: FxStack, time: number): FxStack {
  return stack.map((instance) => {
    if (!instance.keyframes || !Object.values(instance.keyframes).some((points) => points?.length)) return instance;
    const { keyframes: _keyframes, ...rest } = instance;
    return { ...rest, params: resolveParamsAtTime(instance, time), mix: resolveMixAtTime(instance, time) };
  });
}

/** True while the effect can contribute anywhere (an animated mix counts when any keyframe is > 0). */
const mixCanBeActive = (entry: FxInstance) => {
  const points = animated(entry, FX_MIX_KEY);
  return points ? points.some((point) => point.value > 0.0001) : (entry.mix ?? 1) > 0.0001;
};

export function hasActiveFx(stack: FxStack | undefined | null): stack is FxStack {
  return Boolean(stack && stack.some((entry) => entry.enabled && mixCanBeActive(entry)));
}

/** True when every active effect can be rendered by the WebGL engine. */
export function isGpuRenderable(stack: FxStack | undefined | null): boolean {
  if (!stack) return true;
  return stack.every((entry) => {
    if (!entry.enabled) return true;
    const definition = getFxDefinition(entry.effectId);
    return Boolean(definition && !definition.native);
  });
}

/** True when an active effect needs the native OFX host. */
export function needsNativeHost(stack: FxStack | undefined | null): boolean {
  return Boolean(stack?.some((entry) => entry.enabled && (entry.effectId.startsWith('ofx:') || getFxDefinition(entry.effectId)?.native === 'ofx')));
}

registerFx(OPTICS_LAB);
registerFx(LENS_PHYSICS);
registerFx(AI_PHOTOREALIZER);
registerFx(DEBAND);
registerFx(FAKE_DIAGNOSTIC);
registerFx(FILM_EMULATION);
