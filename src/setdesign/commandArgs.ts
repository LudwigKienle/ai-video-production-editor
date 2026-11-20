/**
 * Argument helpers shared by the set design command modules (commands.ts, builderCommands.ts).
 * Kept separate so the command modules do not import each other at runtime.
 */
import type { SetDesignState, SetDesignTransform } from '../types';
import type { CommandContext, ParamSpec } from './commands.ts';
import { findSceneObject, type SceneObjectRef } from './sceneModel.ts';

export const asString = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
export const asNumber = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && value.trim() && Number.isFinite(Number(value)) ? Number(value) : undefined);
export const asBool = (value: unknown) => (typeof value === 'boolean' ? value : undefined);

/** Accepts {x,y,z}, [x,y,z] or a single number (uniform). Missing axes come from `fallback`. */
export const asVec = (value: unknown, fallback?: SetDesignTransform): SetDesignTransform | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return { x: value, y: value, z: value };
  if (Array.isArray(value)) {
    const [x, y, z] = value.map((entry) => asNumber(entry));
    if (x === undefined && y === undefined && z === undefined) return undefined;
    return { x: x ?? fallback?.x ?? 0, y: y ?? fallback?.y ?? 0, z: z ?? fallback?.z ?? 0 };
  }
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    const x = asNumber(v.x); const y = asNumber(v.y); const z = asNumber(v.z);
    if (x === undefined && y === undefined && z === undefined) return undefined;
    return { x: x ?? fallback?.x ?? 0, y: y ?? fallback?.y ?? 0, z: z ?? fallback?.z ?? 0 };
  }
  return undefined;
};

/** Two numbers ([u, v], {x, y} or one number for both). */
export const asPair = (value: unknown): [number, number] | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return [value, value];
  if (Array.isArray(value)) {
    const a = asNumber(value[0]); const b = asNumber(value[1]);
    if (a === undefined && b === undefined) return undefined;
    return [a ?? b ?? 0, b ?? a ?? 0];
  }
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    const a = asNumber(v.x ?? v.u ?? v.w); const b = asNumber(v.y ?? v.v ?? v.d);
    if (a === undefined && b === undefined) return undefined;
    return [a ?? b ?? 0, b ?? a ?? 0];
  }
  return undefined;
};

export const ids = (value: unknown): string[] => {
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string' && !!entry.trim()).map((entry) => entry.trim());
  return [];
};

export const requireObject = (ctx: { scene: SetDesignState; ui: CommandContext['ui'] }, key: unknown): SceneObjectRef => {
  const name = asString(key);
  const ref = name ? findSceneObject(ctx.scene, name) : (ctx.ui.activeId ? findSceneObject(ctx.scene, ctx.ui.activeId) : null);
  if (!ref) throw new Error(name ? `No object "${name}" in the set. Call setdesign_get_scene for ids and names.` : 'No object given and nothing is selected.');
  return ref;
};

/** Ids of the objects named in `value` (ids or names), or of the selection when empty. */
export const targetIds = (ctx: { scene: SetDesignState; ui: CommandContext['ui'] }, value: unknown) => {
  const given = ids(value);
  const list = given.length ? given : ctx.ui.selectedIds;
  return list.map((key) => {
    const ref = findSceneObject(ctx.scene, key);
    if (!ref) throw new Error(`No object "${key}" in the set. Call setdesign_get_scene for ids and names.`);
    return ref.object.id;
  });
};

export const vecParam = (description: string): ParamSpec => ({ type: 'array', description: `${description} [x, y, z]`, items: { type: 'number' } });
export const OBJECT_PARAM: ParamSpec = { type: 'string', description: 'Object id or name (default: the active/selected object).' };
export const OBJECTS_PARAM: ParamSpec = { type: 'array', description: 'Object ids or names (default: the selection).', items: { type: 'string' } };

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
