/**
 * Animation model behind the Effect Controls panel: one "track" per
 * animatable value of a timeline clip — Motion/Opacity/Volume (stored in
 * `clip.keyframes`) and every numeric FX param incl. the effect mix (stored
 * in `FxInstance.keyframes`). All functions are pure and return a new clip.
 *
 * Track keys: `clip:<property>` and `fx:<instanceId>:<paramId|mix>`.
 * Times are clip-local seconds from the clip's source-in (timeline offset ×
 * speed) — the clock PreviewPlayer uses for `keyframeTime`.
 */
import type { Keyframe, TimelineClip } from '../types';
import type { FxInstance, FxKeyframe } from './types.ts';
import { FX_MIX_KEY, getFxDefinition, resolveParams } from './registry.ts';
import {
  findKeyframeAt,
  interpolateKeyframes,
  KEYFRAME_TIME_TOLERANCE,
  sortKeyframes,
  upsertKeyframe,
  type KeyframeEasing,
} from './keyframes.ts';

export type ClipAnimProperty = 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'volume';

export const CLIP_ANIM_DEFAULTS: Record<ClipAnimProperty, number> = { x: 50, y: 50, scale: 1, rotation: 0, opacity: 1, volume: 1 };

export type KeyPoint = { id: string; time: number; value: number; easing: KeyframeEasing };

export type KeySelection = Array<{ key: string; id: string }>;

export type ParsedTrackKey =
  | { kind: 'clip'; property: ClipAnimProperty }
  | { kind: 'fx'; instanceId: string; param: string };

export const clipTrackKey = (property: ClipAnimProperty) => `clip:${property}`;
export const fxTrackKey = (instanceId: string, param: string) => `fx:${instanceId}:${param}`;

export function parseTrackKey(key: string): ParsedTrackKey | null {
  if (key.startsWith('clip:')) {
    const property = key.slice(5) as ClipAnimProperty;
    return property in CLIP_ANIM_DEFAULTS ? { kind: 'clip', property } : null;
  }
  if (key.startsWith('fx:')) {
    const rest = key.slice(3);
    const split = rest.lastIndexOf(':');
    if (split <= 0) return null;
    return { kind: 'fx', instanceId: rest.slice(0, split), param: rest.slice(split + 1) };
  }
  return null;
}

let idCounter = 0;
export const newKeyframeId = () => {
  idCounter += 1;
  return `kf-${Date.now().toString(36)}-${idCounter}`;
};

/** Clip-local keyframe time at a timeline position. */
export const clipLocalTime = (clip: TimelineClip, playhead: number) => (playhead - clip.start) * Math.max(0.05, clip.speed || 1);
/** Length of the clip on the keyframe clock. */
export const clipLocalDuration = (clip: TimelineClip) => Math.max(0, (clip.end - clip.start) * Math.max(0.05, clip.speed || 1));
/** Timeline position of a clip-local time. */
export const timelineTimeOf = (clip: TimelineClip, localTime: number) => clip.start + localTime / Math.max(0.05, clip.speed || 1);

const findInstance = (clip: TimelineClip, instanceId: string) => clip.fxStack?.find((entry) => entry.id === instanceId);

const updateInstance = (clip: TimelineClip, instanceId: string, update: (instance: FxInstance) => FxInstance): TimelineClip => ({
  ...clip,
  fxStack: (clip.fxStack ?? []).map((entry) => (entry.id === instanceId ? update(entry) : entry)),
});

const asEasing = (value: string | undefined): KeyframeEasing =>
  value === 'ease-in' || value === 'ease-out' || value === 'ease-in-out' || value === 'hold' ? value : 'linear';

export function getTrackPoints(clip: TimelineClip, key: string): KeyPoint[] {
  const parsed = parseTrackKey(key);
  if (!parsed) return [];
  if (parsed.kind === 'clip') {
    return sortKeyframes(
      (clip.keyframes ?? [])
        .filter((frame) => frame.property === parsed.property)
        .map((frame) => ({ id: frame.id, time: frame.time, value: frame.value, easing: asEasing(frame.easing) })),
    );
  }
  const points = findInstance(clip, parsed.instanceId)?.keyframes?.[parsed.param] ?? [];
  return sortKeyframes(points.map((point, index) => ({ id: point.id ?? `${key}#${index}`, time: point.time, value: point.value, easing: asEasing(point.easing) })));
}

export function setTrackPoints(clip: TimelineClip, key: string, points: KeyPoint[]): TimelineClip {
  const parsed = parseTrackKey(key);
  if (!parsed) return clip;
  const sorted = sortKeyframes(points);
  if (parsed.kind === 'clip') {
    const others = (clip.keyframes ?? []).filter((frame) => frame.property !== parsed.property);
    const own: Keyframe[] = sorted.map((point) => ({ id: point.id, time: point.time, value: point.value, easing: point.easing, property: parsed.property }));
    return { ...clip, keyframes: [...others, ...own] };
  }
  if (!findInstance(clip, parsed.instanceId)) return clip;
  return updateInstance(clip, parsed.instanceId, (instance) => {
    const next: Record<string, FxKeyframe[]> = { ...(instance.keyframes ?? {}) };
    if (sorted.length) next[parsed.param] = sorted.map((point) => ({ id: point.id, time: point.time, value: point.value, easing: point.easing }));
    else delete next[parsed.param];
    const copy: FxInstance = { ...instance, keyframes: next };
    if (Object.keys(next).length === 0) delete copy.keyframes;
    return copy;
  });
}

export function getStaticValue(clip: TimelineClip, key: string): number {
  const parsed = parseTrackKey(key);
  if (!parsed) return 0;
  if (parsed.kind === 'clip') {
    const transform = clip.transform;
    switch (parsed.property) {
      case 'x': return transform?.position.x ?? CLIP_ANIM_DEFAULTS.x;
      case 'y': return transform?.position.y ?? CLIP_ANIM_DEFAULTS.y;
      case 'scale': return transform?.scale ?? CLIP_ANIM_DEFAULTS.scale;
      case 'rotation': return transform?.rotation ?? CLIP_ANIM_DEFAULTS.rotation;
      case 'opacity': return transform?.opacity ?? CLIP_ANIM_DEFAULTS.opacity;
      case 'volume': return clip.volume ?? CLIP_ANIM_DEFAULTS.volume;
      default: return 0;
    }
  }
  const instance = findInstance(clip, parsed.instanceId);
  if (!instance) return 0;
  if (parsed.param === FX_MIX_KEY) return instance.mix ?? 1;
  const value = Number(resolveParams(instance)[parsed.param]);
  return Number.isFinite(value) ? value : 0;
}

const clampFxValue = (instance: FxInstance, param: string, value: number) => {
  if (param === FX_MIX_KEY) return Math.min(1, Math.max(0, value));
  const def = getFxDefinition(instance.effectId)?.params.find((entry) => entry.id === param);
  if (!def || (def.type !== 'float' && def.type !== 'int')) return value;
  const rounded = def.type === 'int' ? Math.round(value) : value;
  return Math.min(def.max, Math.max(def.min, rounded));
};

export function setStaticValue(clip: TimelineClip, key: string, value: number): TimelineClip {
  const parsed = parseTrackKey(key);
  if (!parsed) return clip;
  if (parsed.kind === 'clip') {
    if (parsed.property === 'volume') return { ...clip, volume: value };
    const base = clip.transform ?? { scale: 1, opacity: 1, position: { x: 50, y: 50 } };
    const transform = { ...base, position: { ...base.position } };
    if (parsed.property === 'x') transform.position.x = value;
    else if (parsed.property === 'y') transform.position.y = value;
    else if (parsed.property === 'scale') transform.scale = value;
    else if (parsed.property === 'rotation') transform.rotation = value;
    else if (parsed.property === 'opacity') transform.opacity = value;
    return { ...clip, transform };
  }
  if (!findInstance(clip, parsed.instanceId)) return clip;
  return updateInstance(clip, parsed.instanceId, (instance) => {
    const next = clampFxValue(instance, parsed.param, value);
    return parsed.param === FX_MIX_KEY ? { ...instance, mix: next } : { ...instance, params: { ...instance.params, [parsed.param]: next } };
  });
}

export const isAnimated = (clip: TimelineClip, key: string) => getTrackPoints(clip, key).length > 0;

export function valueAtTime(clip: TimelineClip, key: string, time: number): number {
  return interpolateKeyframes(getTrackPoints(clip, key), time, getStaticValue(clip, key));
}

/** Value edit: updates/creates the keyframe at `time` while animated, otherwise the constant value. */
export function setValueAtTime(clip: TimelineClip, key: string, time: number, value: number): TimelineClip {
  const points = getTrackPoints(clip, key);
  if (points.length === 0) return setStaticValue(clip, key, value);
  const parsed = parseTrackKey(key);
  const instance = parsed?.kind === 'fx' ? findInstance(clip, parsed.instanceId) : undefined;
  const stored = instance && parsed?.kind === 'fx' ? clampFxValue(instance, parsed.param, value) : value;
  return setTrackPoints(clip, key, upsertKeyframe(points, time, stored, (t, v) => ({ id: newKeyframeId(), time: t, value: v, easing: 'linear' })));
}

/**
 * Stopwatch: `enable` creates the first keyframe at `time` with the current
 * value; disabling removes every keyframe and keeps the value at `time` as the
 * new constant (like an NLE stopwatch).
 */
export function setAnimationEnabled(clip: TimelineClip, key: string, time: number, enable: boolean): TimelineClip {
  if (enable) {
    if (isAnimated(clip, key)) return clip;
    return setTrackPoints(clip, key, [{ id: newKeyframeId(), time: Math.max(0, time), value: getStaticValue(clip, key), easing: 'linear' }]);
  }
  const current = valueAtTime(clip, key, time);
  return setStaticValue(setTrackPoints(clip, key, []), key, current);
}

/** Navigator "◆": removes the keyframe at `time`, or adds one with the current value. */
export function toggleKeyframeAtTime(clip: TimelineClip, key: string, time: number): TimelineClip {
  const points = getTrackPoints(clip, key);
  const index = findKeyframeAt(points, time, KEYFRAME_TIME_TOLERANCE);
  if (index >= 0) {
    const value = valueAtTime(clip, key, time);
    const rest = points.filter((_, i) => i !== index);
    const next = setTrackPoints(clip, key, rest);
    // Removing the last keyframe leaves the property constant at that value.
    return rest.length === 0 ? setStaticValue(next, key, value) : next;
  }
  const value = valueAtTime(clip, key, time);
  return setTrackPoints(clip, key, [...points, { id: newKeyframeId(), time: Math.max(0, time), value, easing: 'linear' }]);
}

const groupSelection = (selection: KeySelection) => {
  const map = new Map<string, Set<string>>();
  selection.forEach(({ key, id }) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key)!.add(id);
  });
  return map;
};

/** Moves the selected keyframes by `delta` seconds; the whole selection is clamped to [0, duration]. */
export function moveKeyframes(clip: TimelineClip, selection: KeySelection, delta: number, duration = clipLocalDuration(clip)): TimelineClip {
  const groups = groupSelection(selection);
  let lo = Infinity;
  let hi = -Infinity;
  groups.forEach((ids, key) => getTrackPoints(clip, key).forEach((point) => {
    if (!ids.has(point.id)) return;
    lo = Math.min(lo, point.time);
    hi = Math.max(hi, point.time);
  }));
  if (!Number.isFinite(lo)) return clip;
  const clamped = Math.max(-lo, Math.min(Math.max(0, duration) - hi, delta));
  if (clamped === 0) return clip;
  let next = clip;
  groups.forEach((ids, key) => {
    const points = getTrackPoints(next, key).map((point) => (ids.has(point.id) ? { ...point, time: point.time + clamped } : point));
    next = setTrackPoints(next, key, points);
  });
  return next;
}

export function deleteKeyframes(clip: TimelineClip, selection: KeySelection, time = 0): TimelineClip {
  let next = clip;
  groupSelection(selection).forEach((ids, key) => {
    const points = getTrackPoints(next, key);
    const rest = points.filter((point) => !ids.has(point.id));
    if (rest.length === points.length) return;
    const value = valueAtTime(next, key, time);
    next = setTrackPoints(next, key, rest);
    if (rest.length === 0) next = setStaticValue(next, key, value);
  });
  return next;
}

export function setKeyframeEasing(clip: TimelineClip, selection: KeySelection, easing: KeyframeEasing): TimelineClip {
  let next = clip;
  groupSelection(selection).forEach((ids, key) => {
    next = setTrackPoints(next, key, getTrackPoints(next, key).map((point) => (ids.has(point.id) ? { ...point, easing } : point)));
  });
  return next;
}

/** Every animated track of a clip (Motion/Opacity/Volume first, then FX in stack order). */
export function listAnimatedTracks(clip: TimelineClip): string[] {
  const keys = (Object.keys(CLIP_ANIM_DEFAULTS) as ClipAnimProperty[]).map(clipTrackKey).filter((key) => isAnimated(clip, key));
  (clip.fxStack ?? []).forEach((instance) => {
    Object.entries(instance.keyframes ?? {}).forEach(([param, points]) => {
      if (points?.length) keys.push(fxTrackKey(instance.id, param));
    });
  });
  return keys;
}

/** Clip-level features the HQ FFmpeg export does not reproduce yet (shown as export hints). */
export function clipExportWarnings(clip: TimelineClip): string[] {
  const warnings: string[] = [];
  const keyframes = clip.keyframes ?? [];
  if (Math.abs(clip.transform?.rotation ?? 0) > 1e-6 || keyframes.some((frame) => frame.property === 'rotation')) {
    warnings.push('Drehung wird im HQ-Export noch nicht angewendet (nur Vorschau).');
  }
  if (keyframes.some((frame) => frame.easing === 'hold' && frame.property !== 'effectIntensity')) {
    warnings.push('Halten-Keyframes werden im HQ-Export linear interpoliert.');
  }
  return warnings;
}
