import type { FxDefinition, FxInstance, FxParamValues, FxStack } from './types.ts';
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

export function hasActiveFx(stack: FxStack | undefined | null): stack is FxStack {
  return Boolean(stack && stack.some((entry) => entry.enabled && (entry.mix ?? 1) > 0.0001));
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
