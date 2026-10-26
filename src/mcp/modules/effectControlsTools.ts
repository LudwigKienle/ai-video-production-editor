/**
 * MCP tools: Effect Controls (Motion / Opacity / Volume / Rotation) and
 * keyframes of clip properties and FX params (incl. the effect mix).
 *
 * Properties are addressed either by `property` (x, y, scale, rotation,
 * opacity, volume) or by `instanceId` + `param` (FX param id or "mix").
 * Keyframe times are clip-local seconds from the clip's start on the keyframe
 * clock (timeline offset × speed); `timelineTime` may be passed instead, and
 * without either the playhead is used. Effect add/update/remove live in
 * fxTools.ts (fx_*), not here.
 */
import type { TimelineClip } from '../../types.ts';
import {
  CLIP_ANIM_DEFAULTS,
  clipLocalDuration,
  clipLocalTime,
  clipTrackKey,
  deleteKeyframes,
  fxTrackKey,
  getStaticValue,
  getTrackPoints,
  listAnimatedTracks,
  clipExportWarnings,
  moveKeyframes,
  parseTrackKey,
  setAnimationEnabled,
  setKeyframeEasing,
  setStaticValue,
  setTrackPoints,
  setValueAtTime,
  timelineTimeOf,
  valueAtTime,
  type ClipAnimProperty,
} from '../../fx/clipAnimation.ts';
import { findKeyframeAt, KEYFRAME_EASINGS, KEYFRAME_TIME_TOLERANCE, type KeyframeEasing } from '../../fx/keyframes.ts';
import { getFxDefinition } from '../../fx/registry.ts';
import { invokeLiveCommand } from '../liveCommands.ts';
import { findClip, numArg, registerStudioToolModule, type JsonSchema, type StudioToolContext, type StudioToolModule } from '../toolModules.ts';

const PROPERTIES = Object.keys(CLIP_ANIM_DEFAULTS) as ClipAnimProperty[];
const EASINGS = KEYFRAME_EASINGS.map((entry) => entry.id);
const BLEND_MODES = ['normal', 'screen', 'overlay', 'multiply', 'darken', 'lighten', 'color-dodge', 'soft-light', 'difference'];

const TARGET_PROPS: Record<string, JsonSchema> = {
  clipId: { type: 'string', description: 'Timeline clip id (selected clip if omitted).' },
  property: { type: 'string', enum: PROPERTIES, description: 'Clip property: x/y in % of the frame (50 = centre), scale (1 = 100 %), rotation in degrees clockwise, opacity 0..1, volume 0..2.' },
  instanceId: { type: 'string', description: 'FX instance id (from fx_get_clip_stack) — use with param instead of property.' },
  param: { type: 'string', description: 'Numeric FX param id, or "mix" for the effect opacity.' },
};
const TIME_PROPS: Record<string, JsonSchema> = {
  time: { type: 'number', description: 'Clip-local seconds (0 = clip start, keyframe clock = timeline offset × speed).' },
  timelineTime: { type: 'number', description: 'Timeline seconds instead of time. Default: the playhead.' },
};

const isEasing = (value: unknown): value is KeyframeEasing => typeof value === 'string' && (EASINGS as string[]).includes(value);

/** Track key from property or instanceId+param; validates that the target exists and is numeric. */
function trackKeyFor(clip: TimelineClip, args: Record<string, unknown>): string {
  if (typeof args.property === 'string' && args.property) {
    if (!(PROPERTIES as string[]).includes(args.property)) throw new Error(`Unknown property ${args.property}; use one of ${PROPERTIES.join(', ')}.`);
    return clipTrackKey(args.property as ClipAnimProperty);
  }
  if (typeof args.instanceId === 'string' && args.instanceId) {
    const instance = clip.fxStack?.find((entry) => entry.id === args.instanceId);
    if (!instance) throw new Error(`Effect ${args.instanceId} not on clip ${clip.id}.`);
    const param = typeof args.param === 'string' && args.param ? args.param : 'mix';
    if (param !== 'mix') {
      const definition = getFxDefinition(instance.effectId);
      const def = definition?.params.find((entry) => entry.id === param);
      if (definition && !def) throw new Error(`Unknown param ${param} of ${instance.effectId}.`);
      if (def && def.type !== 'float' && def.type !== 'int') throw new Error(`Param ${param} is ${def.type}; only numeric params can be keyframed.`);
    }
    return fxTrackKey(instance.id, param);
  }
  throw new Error('Pass property (x, y, scale, rotation, opacity, volume) or instanceId + param.');
}

function localTimeFor(clip: TimelineClip, args: Record<string, unknown>, ctx: StudioToolContext): number {
  const duration = clipLocalDuration(clip);
  let time: number;
  if (args.time !== undefined) time = numArg(args, 'time');
  else if (args.timelineTime !== undefined) time = clipLocalTime(clip, numArg(args, 'timelineTime'));
  else time = clipLocalTime(clip, ctx.getState().playheadPosition);
  if (time < -KEYFRAME_TIME_TOLERANCE || time > duration + KEYFRAME_TIME_TOLERANCE) {
    throw new Error(`Time ${time.toFixed(3)} s is outside the clip (0 … ${duration.toFixed(3)} s clip-local).`);
  }
  return Math.max(0, Math.min(duration, time));
}

const describeTrack = (clip: TimelineClip, key: string, time: number) => {
  const parsed = parseTrackKey(key);
  const points = getTrackPoints(clip, key);
  return {
    key,
    ...(parsed?.kind === 'clip' ? { property: parsed.property } : parsed?.kind === 'fx' ? { instanceId: parsed.instanceId, param: parsed.param } : {}),
    animated: points.length > 0,
    value: valueAtTime(clip, key, time),
    staticValue: getStaticValue(clip, key),
    keyframes: points.map((point) => ({ ...point, timelineTime: timelineTimeOf(clip, point.time) })),
  };
};

const allTrackKeys = (clip: TimelineClip): string[] => {
  const keys = PROPERTIES.map(clipTrackKey);
  (clip.fxStack ?? []).forEach((instance) => {
    keys.push(fxTrackKey(instance.id, 'mix'));
    getFxDefinition(instance.effectId)?.params
      .filter((param) => !param.hidden && (param.type === 'float' || param.type === 'int'))
      .forEach((param) => keys.push(fxTrackKey(instance.id, param.id)));
  });
  return keys;
};

const idsArg = (args: Record<string, unknown>): string[] | null => {
  if (Array.isArray(args.keyframeIds)) return (args.keyframeIds as unknown[]).filter((id): id is string => typeof id === 'string');
  if (typeof args.keyframeId === 'string') return [args.keyframeId];
  return null;
};

/** Keyframes addressed by ids, by time (± tolerance), or all of the track. */
function selectionFor(clip: TimelineClip, key: string, args: Record<string, unknown>, ctx: StudioToolContext) {
  const points = getTrackPoints(clip, key);
  const ids = idsArg(args);
  if (ids) {
    const missing = ids.filter((id) => !points.some((point) => point.id === id));
    if (missing.length) throw new Error(`Keyframe ${missing.join(', ')} not found on ${key}.`);
    return ids.map((id) => ({ key, id }));
  }
  if (args.all === true) return points.map((point) => ({ key, id: point.id }));
  const time = localTimeFor(clip, args, ctx);
  const index = findKeyframeAt(points, time);
  if (index < 0) throw new Error(`No keyframe of ${key} at ${time.toFixed(3)} s.`);
  return [{ key, id: points[index].id }];
}

export const EFFECT_CONTROLS_TOOL_MODULE: StudioToolModule = {
  id: 'effect-controls',
  label: 'Effekteinstellungen & Keyframes',
  tools: [
    {
      name: 'effect_controls_get',
      description: 'Read the Effect Controls of a clip: Motion (x, y, scale, rotation), opacity, blend mode, volume and every numeric FX param with value at the playhead, constant value, animated flag and keyframes. Also returns clip-local playhead time, clip duration on the keyframe clock and HQ-export hints.',
      parameters: { type: 'object', properties: { clipId: TARGET_PROPS.clipId, animatedOnly: { type: 'boolean', description: 'Only list animated tracks.' } } },
      handler: (args, ctx) => {
        const clip = findClip(ctx, args.clipId);
        const local = clipLocalTime(clip, ctx.getState().playheadPosition);
        const duration = clipLocalDuration(clip);
        const time = Math.max(0, Math.min(duration, local));
        const keys = args.animatedOnly ? listAnimatedTracks(clip) : allTrackKeys(clip);
        return {
          clipId: clip.id,
          playheadLocalTime: local,
          playheadInsideClip: local >= 0 && local <= duration,
          duration,
          blendMode: clip.blendMode ?? 'normal',
          tracks: keys.map((key) => describeTrack(clip, key, time)),
          exportWarnings: clipExportWarnings(clip),
        };
      },
    },
    {
      name: 'effect_controls_transform_set',
      description: 'Set Motion/Opacity/Volume values of a clip: x, y (% of frame), scale (1 = 100 %), rotation (degrees, clockwise around the clip centre; preview only in HQ export for now), opacity (0..1), volume (0..2), blendMode. Animated properties get a keyframe at the given time/playhead (like editing in the panel), others change their constant value.',
      writes: true,
      parameters: {
        type: 'object',
        properties: {
          clipId: TARGET_PROPS.clipId,
          x: { type: 'number' },
          y: { type: 'number' },
          scale: { type: 'number', minimum: 0.01 },
          rotation: { type: 'number' },
          opacity: { type: 'number', minimum: 0, maximum: 1 },
          volume: { type: 'number', minimum: 0, maximum: 2 },
          blendMode: { type: 'string', enum: BLEND_MODES },
          ...TIME_PROPS,
        },
      },
      handler: (args, ctx) => {
        let clip = findClip(ctx, args.clipId);
        const changed: string[] = [];
        const keyed: string[] = [];
        let time: number | null = null;
        for (const property of PROPERTIES) {
          if (args[property] === undefined) continue;
          let value = numArg(args, property);
          if (property === 'opacity') value = Math.min(1, Math.max(0, value));
          if (property === 'volume') value = Math.min(2, Math.max(0, value));
          if (property === 'scale') value = Math.max(0.01, value);
          const key = clipTrackKey(property);
          if (getTrackPoints(clip, key).length) {
            time ??= localTimeFor(clip, args, ctx);
            clip = setValueAtTime(clip, key, time, value);
            keyed.push(property);
          } else {
            clip = setStaticValue(clip, key, value);
          }
          changed.push(property);
        }
        if (typeof args.blendMode === 'string') {
          if (!BLEND_MODES.includes(args.blendMode)) throw new Error(`Unknown blend mode ${args.blendMode}.`);
          clip = { ...clip, blendMode: args.blendMode as TimelineClip['blendMode'] };
          changed.push('blendMode');
        }
        if (!changed.length) throw new Error('Nothing to set; pass x, y, scale, rotation, opacity, volume or blendMode.');
        ctx.actions.updateClip(clip);
        return { clipId: clip.id, changed, keyframed: keyed, ...(time !== null ? { time } : {}), transform: clip.transform ?? null, volume: clip.volume ?? 1 };
      },
    },
    {
      name: 'keyframe_list',
      description: 'List keyframes of a clip (all animated tracks, or one property / FX param). Each keyframe has id, clip-local time, timelineTime, value and easing.',
      parameters: { type: 'object', properties: { ...TARGET_PROPS } },
      handler: (args, ctx) => {
        const clip = findClip(ctx, args.clipId);
        const time = Math.max(0, Math.min(clipLocalDuration(clip), clipLocalTime(clip, ctx.getState().playheadPosition)));
        const keys = args.property || args.instanceId ? [trackKeyFor(clip, args)] : listAnimatedTracks(clip);
        return { clipId: clip.id, duration: clipLocalDuration(clip), tracks: keys.map((key) => describeTrack(clip, key, time)) };
      },
    },
    {
      name: 'keyframe_set',
      description: 'Create or update a keyframe (stopwatch on if needed). Target: property or instanceId+param (incl. "mix"). value defaults to the current value at that time; easing (linear, ease-in, ease-out, ease-in-out, hold) shapes the segment arriving at this keyframe, hold keeps this value until the next keyframe.',
      writes: true,
      parameters: {
        type: 'object',
        properties: { ...TARGET_PROPS, ...TIME_PROPS, value: { type: 'number' }, easing: { type: 'string', enum: EASINGS } },
      },
      handler: (args, ctx) => {
        let clip = findClip(ctx, args.clipId);
        const key = trackKeyFor(clip, args);
        const time = localTimeFor(clip, args, ctx);
        if (args.easing !== undefined && !isEasing(args.easing)) throw new Error(`Unknown easing ${String(args.easing)}; use ${EASINGS.join(', ')}.`);
        const value = args.value !== undefined ? numArg(args, 'value') : valueAtTime(clip, key, time);
        if (!getTrackPoints(clip, key).length) clip = setAnimationEnabled(clip, key, time, true);
        clip = setValueAtTime(clip, key, time, value);
        if (isEasing(args.easing)) {
          const points = getTrackPoints(clip, key);
          const index = findKeyframeAt(points, time);
          clip = setTrackPoints(clip, key, points.map((point, i) => (i === index ? { ...point, easing: args.easing as KeyframeEasing } : point)));
        }
        const points = getTrackPoints(clip, key);
        const keyframe = points[findKeyframeAt(points, time)] ?? null;
        ctx.actions.updateClip(clip);
        return { clipId: clip.id, key, keyframe, count: points.length };
      },
    },
    {
      name: 'keyframe_remove',
      description: 'Remove keyframes: by keyframeId(s), by time/timelineTime (default playhead), or all:true (stopwatch off — the value at the playhead becomes the constant value).',
      writes: true,
      parameters: {
        type: 'object',
        properties: { ...TARGET_PROPS, ...TIME_PROPS, keyframeId: { type: 'string' }, keyframeIds: { type: 'array', items: { type: 'string' } }, all: { type: 'boolean' } },
      },
      handler: (args, ctx) => {
        const clip = findClip(ctx, args.clipId);
        const key = trackKeyFor(clip, args);
        const playhead = Math.max(0, Math.min(clipLocalDuration(clip), clipLocalTime(clip, ctx.getState().playheadPosition)));
        if (args.all === true) {
          const removed = getTrackPoints(clip, key).length;
          const next = setAnimationEnabled(clip, key, playhead, false);
          ctx.actions.updateClip(next);
          return { clipId: clip.id, key, removed, staticValue: getStaticValue(next, key) };
        }
        const selection = selectionFor(clip, key, args, ctx);
        const next = deleteKeyframes(clip, selection, playhead);
        ctx.actions.updateClip(next);
        return { clipId: clip.id, key, removed: selection.length, remaining: getTrackPoints(next, key).length };
      },
    },
    {
      name: 'keyframe_set_interpolation',
      description: 'Set the interpolation (linear, ease-in, ease-out, ease-in-out, hold) of keyframes addressed by keyframeId(s), time/timelineTime or all:true.',
      writes: true,
      parameters: {
        type: 'object',
        properties: { ...TARGET_PROPS, ...TIME_PROPS, easing: { type: 'string', enum: EASINGS }, keyframeId: { type: 'string' }, keyframeIds: { type: 'array', items: { type: 'string' } }, all: { type: 'boolean' } },
        required: ['easing'],
      },
      handler: (args, ctx) => {
        const clip = findClip(ctx, args.clipId);
        if (!isEasing(args.easing)) throw new Error(`Unknown easing ${String(args.easing)}; use ${EASINGS.join(', ')}.`);
        const key = trackKeyFor(clip, args);
        const selection = selectionFor(clip, key, args, ctx);
        const next = setKeyframeEasing(clip, selection, args.easing);
        ctx.actions.updateClip(next);
        return { clipId: clip.id, key, easing: args.easing, updated: selection.length };
      },
    },
    {
      name: 'keyframe_move',
      description: 'Shift keyframes in time by delta seconds (clip-local; the block keeps its spacing and is clamped to the clip). Address by keyframeId(s), time or all:true.',
      writes: true,
      parameters: {
        type: 'object',
        properties: { ...TARGET_PROPS, ...TIME_PROPS, delta: { type: 'number' }, keyframeId: { type: 'string' }, keyframeIds: { type: 'array', items: { type: 'string' } }, all: { type: 'boolean' } },
        required: ['delta'],
      },
      handler: (args, ctx) => {
        const clip = findClip(ctx, args.clipId);
        const key = trackKeyFor(clip, args);
        const selection = selectionFor(clip, key, args, ctx);
        const next = moveKeyframes(clip, selection, numArg(args, 'delta'));
        ctx.actions.updateClip(next);
        const ids = new Set(selection.map((entry) => entry.id));
        return { clipId: clip.id, key, keyframes: getTrackPoints(next, key).filter((point) => ids.has(point.id)) };
      },
    },
    {
      name: 'effect_controls_ui',
      description: 'Read or change UI state of the open Effect Controls panel: keyframe lane visible, section collapse state (motion, opacity, volume, gpu-fx, css-fx). Opens the edit page if needed; the Effect Controls tab must be open.',
      parameters: {
        type: 'object',
        properties: {
          laneVisible: { type: 'boolean' },
          section: { type: 'string', enum: ['motion', 'opacity', 'volume', 'gpu-fx', 'css-fx'] },
          open: { type: 'boolean', description: 'With section: expand (true) or collapse (false).' },
        },
      },
      handler: async (args, ctx) => {
        const result = await invokeLiveCommand('effectControls.ui', args, { openWorkspace: () => ctx.actions.setActiveWorkspace('EDIT'), workspace: 'EDIT' });
        return (result && typeof result === 'object' ? result : { result }) as Record<string, unknown>;
      },
    },
  ],
};

registerStudioToolModule(EFFECT_CONTROLS_TOOL_MODULE);
