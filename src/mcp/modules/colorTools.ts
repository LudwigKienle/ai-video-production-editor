/**
 * MCP tools: Color page (node grading on the GPU, gallery stills, grade copy,
 * scopes, viewer state). Colour nodes are `avpe.primary-grade` instances in the
 * clip's fxStack; other GPU effects in the stack count as nodes too.
 *
 * Node addressing: pass `nodeId`, or `nodeIndex` (0-based, the UI shows it as
 * 01, 02 …). Without either, colour tools use the first colour node and create
 * node 01 when the clip has none.
 */
import '../../workspaces/color-pro/registerPrimaryGrade.ts';
import { PRIMARY_GRADE, PRIMARY_GRADE_ID } from '../../fx/effects/primaryGrade/index.ts';
import { WINDOW_TYPES, serializeCurve, type CurvePoint } from '../../fx/effects/primaryGrade/model.ts';
import { createFxInstance, getFxDefinition, resolveParams } from '../../fx/registry.ts';
import type { FxInstance, FxParamValues, FxStack } from '../../fx/types.ts';
import type { TimelineClip } from '../../types.ts';
import {
  addSerialNode,
  applyGradeToClips,
  createGradeNode,
  extractGrade,
  gradeDefaults,
  gradeSummary,
  isGradeNode,
  moveNode,
  nodeLabel,
  removeNode,
  resetNode,
  setNodeLabel,
  setNodeMix,
  updateNodeParams,
} from '../../workspaces/color-pro/nodeStack.ts';
import { createStill, loadGallery, removeStill, saveGallery } from '../../workspaces/color-pro/gallery.ts';
import { qualifierFromPick } from '../../workspaces/color-pro/qualifierPick.ts';
import { hasLiveCommand, invokeLiveCommand } from '../liveCommands.ts';
import { findClip, numArg, registerStudioToolModule, str, type JsonSchema, type StudioToolContext, type StudioToolModule } from '../toolModules.ts';

const stackOf = (clip: TimelineClip): FxStack => clip.fxStack ?? [];
const defaults = gradeDefaults();

const nodeArgs: Record<string, JsonSchema> = {
  clipId: { type: 'string', description: 'Timeline clip id (selected clip when omitted).' },
  nodeId: { type: 'string', description: 'Node (fx instance) id.' },
  nodeIndex: { type: 'integer', minimum: 0, description: '0-based node position (UI label 01 = index 0).' },
};

/** Finds the node to edit; colour tools may create node 01 on an empty clip. */
function locate(clip: TimelineClip, args: Record<string, unknown>, options: { create?: boolean; gradeOnly?: boolean } = {}): { stack: FxStack; index: number } {
  let stack = stackOf(clip);
  let index = -1;
  if (typeof args.nodeId === 'string' && args.nodeId) {
    index = stack.findIndex((node) => node.id === args.nodeId);
    if (index < 0) throw new Error(`Node ${args.nodeId} not on clip ${clip.id}.`);
  } else if (args.nodeIndex !== undefined) {
    index = Math.round(numArg(args, 'nodeIndex'));
    if (index < 0 || index >= stack.length) throw new Error(`Node index ${index} out of range (clip has ${stack.length} node(s)).`);
  } else {
    index = stack.findIndex(isGradeNode);
    if (index < 0 && options.create) {
      const added = addSerialNode(stack, stack.length - 1);
      stack = added.stack;
      index = added.index;
    }
    if (index < 0) throw new Error(`Clip ${clip.id} has no colour node.`);
  }
  if (options.gradeOnly && !isGradeNode(stack[index])) throw new Error(`Node ${index} is an effect node (${stack[index].effectId}), not a colour node.`);
  return { stack, index };
}

const describeNode = (node: FxInstance, index: number) => {
  const grade = isGradeNode(node);
  const definition = getFxDefinition(node.effectId);
  const params = resolveParams(node);
  const changed: FxParamValues = {};
  if (grade) {
    for (const [key, value] of Object.entries(params)) {
      if (key === 'nodeLabel' || key === 'showMask') continue;
      const def = defaults[key];
      const differs = key in defaults ? (typeof value === 'number' && typeof def === 'number' ? Math.abs(value - def) > 1e-6 : value !== def) : typeof value === 'string' && value !== '';
      if (differs) changed[key] = value;
    }
  }
  return {
    index,
    label: `${String(index + 1).padStart(2, '0')} ${nodeLabel(node, grade ? '' : definition?.name ?? node.effectId)}`.trim(),
    id: node.id,
    kind: grade ? 'color' : 'effect',
    effectId: node.effectId,
    enabled: node.enabled,
    mix: node.mix ?? 1,
    ...(grade ? { changedParams: changed } : { params }),
  };
};

const commit = (ctx: StudioToolContext, clip: TimelineClip, stack: FxStack) => ctx.actions.updateClip({ ...clip, fxStack: stack });

const rgbObject = (raw: unknown, prefix: string, withY: boolean): FxParamValues => {
  if (!raw || typeof raw !== 'object') return {};
  const v = raw as Record<string, unknown>;
  const out: FxParamValues = {};
  for (const [key, channel] of [['r', 'R'], ['g', 'G'], ['b', 'B'], ...(withY ? [['y', 'Y']] : [])] as Array<[string, string]>) {
    if (typeof v[key] === 'number' && Number.isFinite(v[key])) out[`${prefix}${channel}`] = v[key] as number;
  }
  return out;
};

const rgbSchema = (withY: boolean, note: string): JsonSchema => ({
  type: 'object',
  description: note,
  properties: { r: { type: 'number' }, g: { type: 'number' }, b: { type: 'number' }, ...(withY ? { y: { type: 'number', description: 'Master (Y).' } } : {}) },
});

const KNOWN_PARAMS = new Set(PRIMARY_GRADE.params.map((param) => param.id));
const CURVE_PARAM: Record<string, string> = { y: 'curveY', r: 'curveR', g: 'curveG', b: 'curveB', hue_hue: 'hueHue', hue_sat: 'hueSat', hue_lum: 'hueLum' };

const cleanParams = (raw: unknown): FxParamValues => {
  if (!raw || typeof raw !== 'object') return {};
  const out: FxParamValues = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!KNOWN_PARAMS.has(key) && !Object.values(CURVE_PARAM).includes(key) && key !== 'nodeLabel') throw new Error(`Unknown colour node param "${key}".`);
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') out[key] = value;
  }
  return out;
};

const patchNode = (ctx: StudioToolContext, args: Record<string, unknown>, patch: FxParamValues) => {
  const clip = findClip(ctx, args.clipId);
  const { stack, index } = locate(clip, args, { create: true, gradeOnly: true });
  const next = updateNodeParams(stack, index, patch);
  commit(ctx, clip, next);
  return { clipId: clip.id, node: describeNode(next[index], index) };
};

const visualClipIds = (ctx: StudioToolContext) => {
  const { timelineClips, mediaItems } = ctx.getState();
  return timelineClips.filter((clip) => {
    const media = mediaItems.find((item) => item.id === clip.mediaId);
    return media ? media.type !== 'audio' : true;
  }).map((clip) => clip.id);
};

const openColor = (ctx: StudioToolContext) => () => ctx.actions.setActiveWorkspace('POST');

export const COLOR_TOOL_MODULE: StudioToolModule = {
  id: 'color',
  label: 'Color page (nodes, gallery, scopes)',
  tools: [
    {
      name: 'color_nodes_list',
      description: 'List the colour nodes of a clip (its fxStack in serial order) with the params that differ from neutral. Also returns the clip grade summary.',
      parameters: { type: 'object', properties: { clipId: nodeArgs.clipId } },
      handler: (args, ctx) => {
        const clip = findClip(ctx, args.clipId);
        return { clipId: clip.id, nodes: stackOf(clip).map(describeNode), summary: gradeSummary(clip) };
      },
    },
    {
      name: 'color_node_add',
      description: 'Add a serial node after `afterIndex` (default: at the end). Without effectId it is a colour node (avpe.primary-grade); with effectId any GPU effect becomes a node. Optional label and initial params.',
      writes: true,
      parameters: {
        type: 'object',
        properties: { clipId: nodeArgs.clipId, afterIndex: { type: 'integer', minimum: -1 }, effectId: { type: 'string' }, label: { type: 'string' }, params: { type: 'object' } },
      },
      handler: (args, ctx) => {
        const clip = findClip(ctx, args.clipId);
        const stack = stackOf(clip);
        const effectId = typeof args.effectId === 'string' && args.effectId ? args.effectId : PRIMARY_GRADE_ID;
        let node: FxInstance;
        if (effectId === PRIMARY_GRADE_ID) node = createGradeNode(cleanParams(args.params));
        else {
          if (!getFxDefinition(effectId)) throw new Error(`Unknown effect ${effectId}.`);
          node = createFxInstance(effectId, (args.params ?? {}) as FxParamValues);
        }
        const after = args.afterIndex === undefined ? stack.length - 1 : Math.round(numArg(args, 'afterIndex'));
        let { stack: next, index } = addSerialNode(stack, after, node);
        if (typeof args.label === 'string') next = setNodeLabel(next, index, args.label);
        commit(ctx, clip, next);
        return { clipId: clip.id, nodeId: node.id, index, nodes: next.map(describeNode) };
      },
    },
    {
      name: 'color_node_remove',
      description: 'Remove a node from the clip.',
      writes: true,
      parameters: { type: 'object', properties: nodeArgs },
      handler: (args, ctx) => {
        const clip = findClip(ctx, args.clipId);
        if (args.nodeId === undefined && args.nodeIndex === undefined) throw new Error('Pass nodeId or nodeIndex.');
        const { stack, index } = locate(clip, args);
        const next = removeNode(stack, index);
        commit(ctx, clip, next);
        return { clipId: clip.id, removed: stack[index].id, nodes: next.map(describeNode) };
      },
    },
    {
      name: 'color_node_reorder',
      description: 'Move a node to position `to` (0-based). Serial order = processing order.',
      writes: true,
      parameters: { type: 'object', properties: { ...nodeArgs, to: { type: 'integer', minimum: 0 } }, required: ['to'] },
      handler: (args, ctx) => {
        const clip = findClip(ctx, args.clipId);
        if (args.nodeId === undefined && args.nodeIndex === undefined) throw new Error('Pass nodeId or nodeIndex.');
        const { stack, index } = locate(clip, args);
        const next = moveNode(stack, index, Math.round(numArg(args, 'to')));
        commit(ctx, clip, next);
        return { clipId: clip.id, order: next.map((node) => node.id) };
      },
    },
    {
      name: 'color_node_enable',
      description: 'Enable/disable a node (omit `enabled` to toggle, like ⌘D), and optionally set its label or mix (0..1, key output).',
      writes: true,
      parameters: { type: 'object', properties: { ...nodeArgs, enabled: { type: 'boolean' }, label: { type: 'string' }, mix: { type: 'number', minimum: 0, maximum: 1 }, reset: { type: 'boolean', description: 'Reset the colour node to neutral.' } } },
      handler: (args, ctx) => {
        const clip = findClip(ctx, args.clipId);
        const { stack, index } = locate(clip, args);
        let next = stack.map((node, i) => (i === index ? { ...node, enabled: typeof args.enabled === 'boolean' ? args.enabled : !node.enabled } : node));
        if (typeof args.label === 'string') next = setNodeLabel(next, index, args.label);
        if (args.mix !== undefined) next = setNodeMix(next, index, numArg(args, 'mix'));
        if (args.reset === true) next = resetNode(next, index);
        commit(ctx, clip, next);
        return { clipId: clip.id, node: describeNode(next[index], index) };
      },
    },
    {
      name: 'color_primaries_set',
      description:
        'Set primary correction on a colour node: lift/gamma/gain {r,g,b,y} (lift/gamma neutral 0, range ±1; gain neutral 1, multiplier), offset {r,g,b} (neutral 0), contrast (1), pivot (0.435), saturation (1 = unchanged, 0 = grey), hue (degrees), temperature / tint (−100..100), lumMix (0..1), log {shadow,mid,high:{r,g,b}, lowRange, highRange}. Only passed values change; reset=true starts from neutral.',
      writes: true,
      parameters: {
        type: 'object',
        properties: {
          ...nodeArgs,
          lift: rgbSchema(true, 'Shadows, neutral 0.'),
          gamma: rgbSchema(true, 'Midtones, neutral 0.'),
          gain: rgbSchema(true, 'Highlights multiplier, neutral 1.'),
          offset: rgbSchema(false, 'Overall offset, neutral 0.'),
          contrast: { type: 'number' },
          pivot: { type: 'number' },
          saturation: { type: 'number' },
          hue: { type: 'number' },
          temperature: { type: 'number' },
          tint: { type: 'number' },
          lumMix: { type: 'number' },
          log: { type: 'object', properties: { shadow: rgbSchema(false, ''), mid: rgbSchema(false, ''), high: rgbSchema(false, ''), lowRange: { type: 'number' }, highRange: { type: 'number' } } },
          reset: { type: 'boolean' },
        },
      },
      handler: (args, ctx) => {
        const patch: FxParamValues = {
          ...(args.reset === true ? Object.fromEntries(Object.entries(defaults).filter(([key]) => /^(lift|gamma|gain|offset|log)/.test(key) || ['contrast', 'pivot', 'saturation', 'hue', 'temperature', 'tint', 'lumMix'].includes(key))) : {}),
          ...rgbObject(args.lift, 'lift', true),
          ...rgbObject(args.gamma, 'gamma', true),
          ...rgbObject(args.gain, 'gain', true),
          ...rgbObject(args.offset, 'offset', false),
        };
        for (const key of ['contrast', 'pivot', 'saturation', 'hue', 'temperature', 'tint', 'lumMix']) if (args[key] !== undefined) patch[key] = numArg(args, key);
        const log = (args.log ?? {}) as Record<string, unknown>;
        Object.assign(patch, rgbObject(log.shadow, 'logShadow', false), rgbObject(log.mid, 'logMid', false), rgbObject(log.high, 'logHigh', false));
        if (typeof log.lowRange === 'number') patch.logLowRange = log.lowRange;
        if (typeof log.highRange === 'number') patch.logHighRange = log.highRange;
        return patchNode(ctx, args, patch);
      },
    },
    {
      name: 'color_curves_set',
      description: 'Set a custom curve on a colour node. curve: y | r | g | b (points [x,y] in 0..1, identity = [[0,0],[1,1]]) or hue_hue | hue_sat | hue_lum (x = hue 0..1, y 0.5 = neutral). Empty points resets the curve.',
      writes: true,
      parameters: {
        type: 'object',
        properties: { ...nodeArgs, curve: { type: 'string', enum: Object.keys(CURVE_PARAM) }, points: { type: 'array', items: { type: 'array', items: { type: 'number' } } } },
        required: ['curve'],
      },
      handler: (args, ctx) => {
        const key = CURVE_PARAM[str(args, 'curve')];
        if (!key) throw new Error(`Unknown curve ${String(args.curve)}.`);
        const points = (Array.isArray(args.points) ? args.points : [])
          .filter((p): p is number[] => Array.isArray(p) && p.length >= 2 && p.every((v) => typeof v === 'number' && Number.isFinite(v)))
          .map((p) => [Math.min(1, Math.max(0, p[0])), Math.min(1, Math.max(0, p[1]))] as CurvePoint);
        return patchNode(ctx, args, { [key]: points.length ? serializeCurve(points) : '' });
      },
    },
    {
      name: 'color_qualifier_set',
      description: 'HSL qualifier that limits the colour node: hue {center 0..360, width (half, degrees), soft, on}, sat {low, high, soft, on}, lum {low, high, soft, on} (0..1), invert, enabled. pickRgb [r,g,b] (0..1) centres the key on that colour like the pipette.',
      writes: true,
      parameters: {
        type: 'object',
        properties: {
          ...nodeArgs,
          enabled: { type: 'boolean' },
          pickRgb: { type: 'array', items: { type: 'number' } },
          hue: { type: 'object', properties: { center: { type: 'number' }, width: { type: 'number' }, soft: { type: 'number' }, on: { type: 'boolean' } } },
          sat: { type: 'object', properties: { low: { type: 'number' }, high: { type: 'number' }, soft: { type: 'number' }, on: { type: 'boolean' } } },
          lum: { type: 'object', properties: { low: { type: 'number' }, high: { type: 'number' }, soft: { type: 'number' }, on: { type: 'boolean' } } },
          invert: { type: 'boolean' },
        },
      },
      handler: (args, ctx) => {
        const patch: FxParamValues = { qualEnabled: typeof args.enabled === 'boolean' ? args.enabled : true };
        if (Array.isArray(args.pickRgb) && args.pickRgb.length >= 3) Object.assign(patch, qualifierFromPick(args.pickRgb.slice(0, 3).map(Number) as [number, number, number]));
        const map = (raw: unknown, fields: Record<string, string>) => {
          if (!raw || typeof raw !== 'object') return;
          for (const [from, to] of Object.entries(fields)) {
            const value = (raw as Record<string, unknown>)[from];
            if (typeof value === 'number' || typeof value === 'boolean') patch[to] = value;
          }
        };
        map(args.hue, { center: 'qualHue', width: 'qualHueWidth', soft: 'qualHueSoft', on: 'qualHueOn' });
        map(args.sat, { low: 'qualSatLow', high: 'qualSatHigh', soft: 'qualSatSoft', on: 'qualSatOn' });
        map(args.lum, { low: 'qualLumLow', high: 'qualLumHigh', soft: 'qualLumSoft', on: 'qualLumOn' });
        if (typeof args.invert === 'boolean') patch.qualInvert = args.invert;
        if (typeof args.enabled === 'boolean') patch.qualEnabled = args.enabled;
        return patchNode(ctx, args, patch);
      },
    },
    {
      name: 'color_window_set',
      description: 'Power window that limits the colour node: type off | circle | linear (rectangle) | gradient; x, y = centre (0..1, y from top); width, height = radius in image heights; rotation (degrees); softness (0..1); invert.',
      writes: true,
      parameters: {
        type: 'object',
        properties: {
          ...nodeArgs,
          type: { type: 'string', enum: ['off', 'circle', 'linear', 'gradient'] },
          x: { type: 'number' },
          y: { type: 'number' },
          width: { type: 'number' },
          height: { type: 'number' },
          rotation: { type: 'number' },
          softness: { type: 'number' },
          invert: { type: 'boolean' },
        },
      },
      handler: (args, ctx) => {
        const patch: FxParamValues = {};
        if (typeof args.type === 'string') {
          const index = ['off', 'circle', 'linear', 'gradient'].indexOf(args.type);
          if (index < 0) throw new Error(`Unknown window type ${args.type}.`);
          patch.winType = index;
        }
        const fields: Record<string, string> = { x: 'winX', y: 'winY', width: 'winSizeX', height: 'winSizeY', rotation: 'winRotation', softness: 'winSoftness' };
        for (const [from, to] of Object.entries(fields)) if (args[from] !== undefined) patch[to] = numArg(args, from);
        if (typeof args.invert === 'boolean') patch.winInvert = args.invert;
        const result = patchNode(ctx, args, patch);
        return { ...result, windowTypes: [...WINDOW_TYPES] };
      },
    },
    {
      name: 'color_node_params_set',
      description: 'Set any colour node params directly, e.g. blurRadius (px @1080p), sharpen, keyGain, keyOffset, keyInvert, sizePan, sizeTilt, sizeZoom, sizeRotate, sizeFlipH, sizeFlipV. Use color_nodes_list / fx_list_effects {effectId:"avpe.primary-grade"} for all ids.',
      writes: true,
      parameters: { type: 'object', properties: { ...nodeArgs, params: { type: 'object' } }, required: ['params'] },
      handler: (args, ctx) => patchNode(ctx, args, cleanParams(args.params)),
    },
    {
      name: 'color_copy_grade',
      description: 'Copy the whole grade (node stack + legacy look) from one clip to others. toClipIds, or all=true for every visual clip. Pasted nodes get fresh ids.',
      writes: true,
      parameters: { type: 'object', properties: { fromClipId: { type: 'string' }, toClipIds: { type: 'array', items: { type: 'string' } }, all: { type: 'boolean' } } },
      handler: (args, ctx) => {
        const source = findClip(ctx, args.fromClipId);
        const targets = args.all === true ? visualClipIds(ctx).filter((id) => id !== source.id) : Array.isArray(args.toClipIds) ? (args.toClipIds as unknown[]).filter((id): id is string => typeof id === 'string') : [];
        if (!targets.length) throw new Error('Pass toClipIds or all=true.');
        const clips = ctx.getState().timelineClips;
        const missing = targets.filter((id) => !clips.some((clip) => clip.id === id));
        if (missing.length) throw new Error(`Clips not found: ${missing.join(', ')}.`);
        ctx.actions.setTimelineClips(applyGradeToClips(clips, extractGrade(source), targets));
        return { from: source.id, applied: targets };
      },
    },
    {
      name: 'color_grade_reset',
      description: 'Remove all colour nodes from a clip (effect nodes stay unless includeEffects=true).',
      writes: true,
      parameters: { type: 'object', properties: { clipId: nodeArgs.clipId, includeEffects: { type: 'boolean' } } },
      handler: (args, ctx) => {
        const clip = findClip(ctx, args.clipId);
        const next = args.includeEffects === true ? [] : stackOf(clip).filter((node) => !isGradeNode(node));
        commit(ctx, clip, next);
        return { clipId: clip.id, nodes: next.length };
      },
    },
    {
      name: 'color_stills_list',
      description: 'List gallery stills (saved grades).',
      parameters: { type: 'object', properties: {} },
      handler: () => ({ stills: loadGallery().map((still) => ({ id: still.id, name: still.name, createdAt: still.createdAt, nodes: still.grade.fxStack.length, sourceClipName: still.sourceClipName ?? null, hasThumbnail: Boolean(still.thumbnail) })) }),
    },
    {
      name: 'color_still_grab',
      description: 'Grab a gallery still from a clip: saves its grade (node stack + look) and, when the Color page is open, a thumbnail of the viewer.',
      writes: true,
      parameters: { type: 'object', properties: { clipId: nodeArgs.clipId, name: { type: 'string' } } },
      handler: async (args, ctx) => {
        const clip = findClip(ctx, args.clipId);
        let thumbnail = '';
        if (hasLiveCommand('color.viewer.thumbnail') && ctx.getState().selectedClipId === clip.id) {
          try { thumbnail = String((await invokeLiveCommand('color.viewer.thumbnail', {})) ?? ''); } catch { thumbnail = ''; }
        }
        const media = ctx.getState().mediaItems.find((item) => item.id === clip.mediaId);
        let stills = createStill(loadGallery(), extractGrade(clip), thumbnail, { sourceClipName: media?.name });
        if (typeof args.name === 'string' && args.name.trim()) stills = [{ ...stills[0], name: args.name.trim() }, ...stills.slice(1)];
        saveGallery(stills);
        return { stillId: stills[0].id, name: stills[0].name, nodes: stills[0].grade.fxStack.length, thumbnail: Boolean(thumbnail) };
      },
    },
    {
      name: 'color_still_apply',
      description: 'Apply a gallery still’s grade to clips (clipIds, all=true, or the selected clip).',
      writes: true,
      parameters: { type: 'object', properties: { stillId: { type: 'string' }, clipIds: { type: 'array', items: { type: 'string' } }, all: { type: 'boolean' } }, required: ['stillId'] },
      handler: (args, ctx) => {
        const still = loadGallery().find((entry) => entry.id === str(args, 'stillId'));
        if (!still) throw new Error(`Still ${String(args.stillId)} not found.`);
        const targets = args.all === true ? visualClipIds(ctx) : Array.isArray(args.clipIds) && args.clipIds.length ? (args.clipIds as unknown[]).filter((id): id is string => typeof id === 'string') : [findClip(ctx).id];
        ctx.actions.setTimelineClips(applyGradeToClips(ctx.getState().timelineClips, still.grade, targets));
        return { stillId: still.id, applied: targets };
      },
    },
    {
      name: 'color_still_remove',
      description: 'Delete a gallery still.',
      writes: true,
      parameters: { type: 'object', properties: { stillId: { type: 'string' } }, required: ['stillId'] },
      handler: (args) => {
        const id = str(args, 'stillId');
        const stills = loadGallery();
        if (!stills.some((still) => still.id === id)) throw new Error(`Still ${id} not found.`);
        saveGallery(removeStill(stills, id));
        return { removed: id };
      },
    },
    {
      name: 'color_scopes_read',
      description: 'Read scope numbers of the graded viewer frame (selected clip at the playhead): per channel R/G/B/luma min, max, mean, p1/p50/p99, clipped fractions (0..1 scale) and the vectorscope centre (mean Cb/Cr, chroma, hue). Opens the Color page if needed.',
      parameters: { type: 'object', properties: { clipId: nodeArgs.clipId } },
      handler: async (args, ctx) => {
        if (typeof args.clipId === 'string') {
          findClip(ctx, args.clipId);
          ctx.actions.selectClip(args.clipId);
        }
        const result = await invokeLiveCommand('color.scopes.read', {}, { openWorkspace: openColor(ctx), workspace: 'POST', timeoutMs: 6000 });
        return result as Record<string, unknown>;
      },
    },
    {
      name: 'color_viewer_set',
      description: 'Color page viewer state: bypass (all grades off), wipe (split screen original | graded) with wipePos 0..1, highlight (show the qualifier/window key of the selected node), selectNode (0-based). Returns the current viewer state.',
      parameters: { type: 'object', properties: { bypass: { type: 'boolean' }, wipe: { type: 'boolean' }, wipePos: { type: 'number', minimum: 0, maximum: 1 }, highlight: { type: 'boolean' }, selectNode: { type: 'integer', minimum: 0 } } },
      handler: async (args, ctx) => (await invokeLiveCommand('color.viewer.set', args, { openWorkspace: openColor(ctx), workspace: 'POST' })) as Record<string, unknown>,
    },
  ],
};

registerStudioToolModule(COLOR_TOOL_MODULE);
