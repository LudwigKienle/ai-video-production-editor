/**
 * MCP tools: After Effects view of the Fusion page (layer timeline on the
 * shared composition model). Tools edit the compositions stored in
 * `state.extras.compositions` (CompStore from fusion-shared/compPersist.ts,
 * written by the Fusion page) through the same pure ops the AE view uses
 * (workspaces/fusion-ae/aeOps.ts). UI-local state of the mounted view
 * (tool, revealed properties, viewer options) is reached via live commands.
 *
 * Units follow After Effects: position/anchor in comp pixels (0,0 = top left),
 * scale and opacity in percent, rotation in degrees, times in seconds.
 */
import type { CompBlendMode, Composition } from '../../workspaces/fusion-shared/compModel.ts';
import { createComposition, getNode } from '../../workspaces/fusion-shared/compModel.ts';
import type { CompStore } from '../../workspaces/fusion-shared/compPersist.ts';
import { emptyStore, sanitizeComposition, storeFromUnknown, upsertComp } from '../../workspaces/fusion-shared/compPersist.ts';
import type { AeLayer, AePropId, EaseKind } from '../../workspaces/fusion-ae/aeOps.ts';
import {
  AE_COMMANDS,
  AE_PROPS,
  addFxInstanceToLayer,
  addKeyframeAt,
  addMaskToLayer,
  aeLayers,
  applyEase,
  deleteKeyframes,
  deleteLayers,
  duplicateLayer,
  ensureTransform,
  fromDisplay,
  isLayerGraph,
  moveLayerInTo,
  moveLayerTime,
  moveLayersToIndex,
  newMediaLayer,
  newSolidLayer,
  newTextLayer,
  P_OFFSET,
  propKeyframeTimes,
  propValueAt,
  renameLayer,
  reorderLayers,
  replaceNode,
  setLayerBlend,
  setLayerLabel,
  setLayerSwitch,
  setPropValue,
  snapToFrame,
  splitLayer,
  toDisplay,
  trimLayerIn,
  trimLayerOut,
} from '../../workspaces/fusion-ae/aeOps.ts';
import { createFxInstance, getFxDefinition } from '../../fx/registry.ts';
import type { FxParamValues } from '../../fx/types.ts';
import { invokeLiveCommand } from '../liveCommands.ts';
import { numArg, registerStudioToolModule, str, type StudioToolContext, type StudioToolModule } from '../toolModules.ts';

export const COMP_EXTRA_KEY = 'compositions';

const BLENDS: CompBlendMode[] = ['normal', 'screen', 'multiply', 'overlay', 'soft-light', 'add', 'lighten', 'darken', 'difference'];
const PROP_IDS = AE_PROPS.map((p) => p.id);

// ------------------------------------------------------------ store access

/** Reads the comp store from project extras (accepts a CompStore or a bare comp array). */
export function readStore(ctx: StudioToolContext): CompStore {
  const raw = ctx.getState().extras?.[COMP_EXTRA_KEY];
  if (Array.isArray(raw)) return storeFromUnknown({ version: 1, comps: raw, activeId: null, view: 'ae' }) ?? emptyStore();
  return storeFromUnknown(raw) ?? emptyStore();
}

function writeStore(ctx: StudioToolContext, store: CompStore): void {
  ctx.actions.setExtra(COMP_EXTRA_KEY, { ...store, savedAt: Date.now() });
}

function pickComp(ctx: StudioToolContext, args: Record<string, unknown>, create = false): { store: CompStore; comp: Composition } {
  let store = readStore(ctx);
  const id = typeof args.compId === 'string' && args.compId ? args.compId : store.activeId;
  let comp = store.comps.find((c) => c.id === id) ?? (id === store.activeId ? store.comps[0] : undefined);
  if (!comp && typeof args.compId === 'string' && args.compId) throw new Error(`Composition ${args.compId} not found.`);
  if (!comp) {
    if (!create) throw new Error('No composition yet. Create one on the Fusion page or call ae_layer_add.');
    comp = sanitizeComposition(createComposition({ name: 'Komposition 1' }))!;
    store = { ...store, comps: [...store.comps, comp], activeId: comp.id };
  }
  return { store, comp };
}

function save(ctx: StudioToolContext, store: CompStore, next: Composition): void {
  writeStore(ctx, { ...store, comps: upsertComp(store.comps, next), activeId: store.activeId ?? next.id });
}

const findLayer = (comp: Composition, layerId: unknown): AeLayer => {
  const layers = aeLayers(comp);
  if (typeof layerId === 'number') {
    const byIndex = layers.find((l) => l.index === layerId);
    if (byIndex) return byIndex;
  }
  const id = typeof layerId === 'string' ? layerId : '';
  const layer = layers.find((l) => l.sourceId === id || l.transformId === id || l.mergeId === id || l.fxIds.includes(id)) ?? layers.find((l) => String(l.index) === id);
  if (!layer) throw new Error(id || layerId !== undefined ? `Layer ${String(layerId)} not found.` : 'Parameter "layerId" is required (source node id or layer number).');
  return layer;
};

const requireLayerGraph = (comp: Composition) => {
  if (!isLayerGraph(comp)) throw new Error('This composition contains nodes that are not simple layers (nested merges); reorder/delete/duplicate are disabled. Use the fusion_ tools.');
};

const vec = (value: unknown, size: number): number[] | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return Array.from({ length: size }, () => value);
  if (Array.isArray(value) && value.length >= size && value.slice(0, size).every((v) => typeof v === 'number' && Number.isFinite(v))) return value.slice(0, size) as number[];
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const arr = [o.x, o.y].slice(0, size);
    if (arr.every((v) => typeof v === 'number' && Number.isFinite(v))) return arr as number[];
  }
  return null;
};

const fxValues = (raw: unknown): FxParamValues => {
  if (!raw || typeof raw !== 'object') return {};
  const out: FxParamValues = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') out[key] = value;
  }
  return out;
};

export function describeLayer(comp: Composition, layer: AeLayer, time: number) {
  const transform: Record<string, number | number[]> = {};
  const keyframes: Record<string, Array<{ time: number; value: number | number[]; easing?: string }>> = {};
  for (const prop of PROP_IDS) {
    const display = toDisplay(prop, propValueAt(layer.transform, prop, time), comp);
    transform[prop] = display.length === 1 ? display[0] : display;
    const times = propKeyframeTimes(layer.transform, prop);
    if (times.length) {
      const param = AE_PROPS.find((p) => p.id === prop)!.params[0];
      keyframes[prop] = times.map((t) => {
        const v = toDisplay(prop, propValueAt(layer.transform, prop, t), comp);
        return { time: t, value: v.length === 1 ? v[0] : v, easing: layer.transform?.keyframes?.[param]?.find((f) => Math.abs(f.time - t) < 1e-6)?.easing };
      });
    }
  }
  return {
    layerId: layer.sourceId,
    index: layer.index,
    name: layer.source.name,
    type: layer.source.type,
    mediaId: layer.source.mediaId ?? null,
    inPoint: layer.inPoint,
    outPoint: layer.outPoint,
    sourceOffset: Number(layer.source.params[P_OFFSET] ?? 0),
    visible: layer.visible,
    solo: layer.solo,
    locked: layer.locked,
    blend: layer.blend,
    label: layer.source.color ?? null,
    transform,
    keyframes,
    effects: layer.fxNodes.flatMap((node) => (node.fxStack ?? []).map((inst) => ({ fxNodeId: node.id, instanceId: inst.id, effectId: inst.effectId, name: getFxDefinition(inst.effectId)?.name ?? inst.effectId, enabled: inst.enabled }))),
    masks: layer.maskNodes.map((m) => ({ maskId: m.id, name: m.name, shape: m.params.shape, cx: m.params.cx, cy: m.params.cy, w: m.params.w, h: m.params.h, feather: m.params.feather, invert: m.params.invert })),
    nodes: { source: layer.sourceId, transform: layer.transformId, merge: layer.mergeId, chain: layer.fxIds },
  };
}

const layerResult = (comp: Composition, layerId: string | null, time = 0) => {
  const layer = layerId ? aeLayers(comp).find((l) => l.sourceId === layerId) : undefined;
  return layer ? { layer: describeLayer(comp, layer, time) } : {};
};

const openFusion = (ctx: StudioToolContext) => () => ctx.actions.setActiveWorkspace('COMPOSITING');

const layerIdSchema = { type: 'string' as const, description: 'Layer: source node id (from ae_layers_list) or layer number as string ("1" = top).' };
const compIdSchema = { type: 'string' as const, description: 'Composition id (default: the active composition).' };

// ------------------------------------------------------------ module

export const AE_TOOL_MODULE: StudioToolModule = {
  id: 'ae',
  label: 'Fusion · After-Effects-Ansicht',
  tools: [
    {
      name: 'ae_layers_list',
      description: 'List the compositions and the layers of one composition (top → bottom, AE numbering) with in/out points, switches, blend mode, transform values at `time` (AE units), keyframes, effects and masks.',
      parameters: { type: 'object', properties: { compId: compIdSchema, time: { type: 'number', description: 'Seconds (default 0).' } } },
      handler: (args, ctx) => {
        const store = readStore(ctx);
        const compositions = store.comps.map((c) => ({ id: c.id, name: c.name, width: c.width, height: c.height, fps: c.fps, durationSeconds: c.durationSeconds, active: c.id === store.activeId }));
        if (!store.comps.length) return { compositions, layers: [], message: 'No composition yet.' };
        const { comp } = pickComp(ctx, args);
        const time = numArg(args, 'time', 0);
        return { compositions, compId: comp.id, layerGraph: isLayerGraph(comp), layers: aeLayers(comp).map((layer) => describeLayer(comp, layer, time)) };
      },
    },
    {
      name: 'ae_layer_add',
      description: 'Add a new top layer: kind "media" (mediaId from the media pool), "solid" (color, name) or "text" (text, position). Creates a composition if none exists. Returns the new layer.',
      writes: true,
      parameters: {
        type: 'object',
        properties: {
          compId: compIdSchema,
          kind: { type: 'string', enum: ['media', 'solid', 'text'] },
          mediaId: { type: 'string' },
          name: { type: 'string' },
          color: { type: 'string', description: 'Solid colour or text colour, CSS hex.' },
          text: { type: 'string' },
          at: { type: 'number', description: 'In point in seconds (default 0).' },
          position: { type: 'array', items: { type: 'number' }, description: 'Text: [x, y] comp pixels (default centre).' },
        },
        required: ['kind'],
      },
      handler: (args, ctx) => {
        const kind = str(args, 'kind');
        const { store, comp } = pickComp(ctx, args, true);
        const at = numArg(args, 'at', 0);
        let result: { comp: Composition; layerId: string };
        if (kind === 'media') {
          const mediaId = str(args, 'mediaId');
          const media = ctx.getState().mediaItems.find((m) => m.id === mediaId);
          if (!media) throw new Error(`Media ${mediaId} not found.`);
          if (media.type === 'audio') throw new Error('Audio layers are not supported in the composition.');
          result = newMediaLayer(comp, media, { at });
        } else if (kind === 'solid') {
          result = newSolidLayer(comp, { name: typeof args.name === 'string' ? args.name : undefined, color: typeof args.color === 'string' ? args.color : undefined, at });
        } else if (kind === 'text') {
          const pos = vec(args.position, 2);
          result = newTextLayer(comp, { text: typeof args.text === 'string' ? args.text : undefined, at, position: pos ? { x: pos[0] - comp.width / 2, y: pos[1] - comp.height / 2 } : undefined });
          if (typeof args.color === 'string') result = { ...result, comp: { ...result.comp, nodes: result.comp.nodes.map((n) => (n.id === result.layerId ? { ...n, params: { ...n.params, color: args.color as string } } : n)) } };
        } else throw new Error('kind must be media, solid or text.');
        if (typeof args.name === 'string' && args.name.trim() && kind !== 'solid') result = { ...result, comp: renameLayer(result.comp, result.layerId, args.name) };
        save(ctx, store, result.comp);
        return { compId: result.comp.id, ...layerResult(result.comp, result.layerId, at) };
      },
    },
    {
      name: 'ae_layer_reorder',
      description: 'Change the stacking order: mode forward/backward/front/back (Cmd+] etc.) or index (1 = top).',
      writes: true,
      parameters: { type: 'object', properties: { compId: compIdSchema, layerId: layerIdSchema, mode: { type: 'string', enum: ['forward', 'backward', 'front', 'back'] }, index: { type: 'integer', minimum: 1 } }, required: ['layerId'] },
      handler: (args, ctx) => {
        const { store, comp } = pickComp(ctx, args);
        requireLayerGraph(comp);
        const layer = findLayer(comp, args.layerId);
        let next: Composition;
        if (typeof args.index === 'number' || (typeof args.index === 'string' && args.index)) {
          const target = Math.round(numArg(args, 'index'));
          // moveLayersToIndex counts the target before removing the moved layer.
          next = moveLayersToIndex(comp, [layer.sourceId], target > layer.index ? target + 1 : target);
        } else {
          const mode = str(args, 'mode');
          if (!['forward', 'backward', 'front', 'back'].includes(mode)) throw new Error('mode must be forward, backward, front or back.');
          next = reorderLayers(comp, [layer.sourceId], mode as 'forward');
        }
        save(ctx, store, next);
        return { order: aeLayers(next).map((l) => ({ index: l.index, layerId: l.sourceId, name: l.source.name })) };
      },
    },
    {
      name: 'ae_layer_set_transform',
      description:
        'Set transform properties at `time` (AE units: anchor/position [x,y] comp pixels, scale %, rotation °, opacity %). Animated properties get a keyframe at `time`, static ones change their value. Also sets switches (visible, solo, locked), blend mode, label colour and name.',
      writes: true,
      parameters: {
        type: 'object',
        properties: {
          compId: compIdSchema,
          layerId: layerIdSchema,
          time: { type: 'number' },
          anchor: { type: 'array', items: { type: 'number' } },
          position: { type: 'array', items: { type: 'number' } },
          scale: { type: 'number' },
          rotation: { type: 'number' },
          opacity: { type: 'number' },
          visible: { type: 'boolean' },
          solo: { type: 'boolean' },
          locked: { type: 'boolean' },
          blend: { type: 'string', enum: BLENDS },
          label: { type: 'string', description: 'Label colour, CSS hex.' },
          name: { type: 'string' },
        },
        required: ['layerId'],
      },
      handler: (args, ctx) => {
        const { store, comp } = pickComp(ctx, args);
        const layer = findLayer(comp, args.layerId);
        const time = snapToFrame(numArg(args, 'time', 0), comp.fps);
        let next = comp;
        const changed: string[] = [];
        const props: Array<[AePropId, number[] | null]> = [
          ['anchor', vec(args.anchor, 2)],
          ['position', vec(args.position, 2)],
          ['scale', vec(args.scale, 1)],
          ['rotation', vec(args.rotation, 1)],
          ['opacity', vec(args.opacity, 1)],
        ];
        if (props.some(([, v]) => v)) {
          if (layer.locked && args.locked !== false) throw new Error('Layer is locked.');
          const ensured = ensureTransform(next, layer.sourceId);
          next = ensured.comp;
          let node = getNode(next, ensured.transformId)!;
          for (const [prop, value] of props) {
            if (!value) continue;
            node = setPropValue(node, prop, fromDisplay(prop, value, comp), time);
            changed.push(prop);
          }
          next = replaceNode(next, node);
        }
        if (typeof args.visible === 'boolean') (next = setLayerSwitch(next, layer.sourceId, 'visible', args.visible)), changed.push('visible');
        if (typeof args.solo === 'boolean') (next = setLayerSwitch(next, layer.sourceId, 'solo', args.solo)), changed.push('solo');
        if (typeof args.locked === 'boolean') (next = setLayerSwitch(next, layer.sourceId, 'lock', args.locked)), changed.push('locked');
        if (typeof args.blend === 'string') {
          if (!BLENDS.includes(args.blend as CompBlendMode)) throw new Error(`blend must be one of ${BLENDS.join(', ')}.`);
          next = setLayerBlend(next, layer.sourceId, args.blend as CompBlendMode);
          changed.push('blend');
        }
        if (typeof args.label === 'string') (next = setLayerLabel(next, layer.sourceId, args.label)), changed.push('label');
        if (typeof args.name === 'string') (next = renameLayer(next, layer.sourceId, args.name)), changed.push('name');
        if (!changed.length) throw new Error('Nothing to change: pass anchor, position, scale, rotation, opacity or a switch.');
        save(ctx, store, next);
        return { changed, ...layerResult(next, layer.sourceId, time) };
      },
    },
    {
      name: 'ae_layer_set_keyframe',
      description:
        'Add/update a keyframe of a transform property at `time` (value in AE units; omit value to key the current value), remove it (remove: true), and/or set its interpolation: easy (F9), in (Shift+F9), out (Cmd+Shift+F9), linear, hold.',
      writes: true,
      parameters: {
        type: 'object',
        properties: {
          compId: compIdSchema,
          layerId: layerIdSchema,
          prop: { type: 'string', enum: PROP_IDS },
          time: { type: 'number' },
          value: { type: 'array', items: { type: 'number' }, description: 'Number or [x, y].' },
          easing: { type: 'string', enum: ['easy', 'in', 'out', 'linear', 'hold'] },
          remove: { type: 'boolean' },
        },
        required: ['layerId', 'prop', 'time'],
      },
      handler: (args, ctx) => {
        const { store, comp } = pickComp(ctx, args);
        const layer = findLayer(comp, args.layerId);
        if (layer.locked) throw new Error('Layer is locked.');
        const prop = str(args, 'prop') as AePropId;
        if (!PROP_IDS.includes(prop)) throw new Error(`prop must be one of ${PROP_IDS.join(', ')}.`);
        const time = snapToFrame(numArg(args, 'time'), comp.fps);
        const ensured = ensureTransform(comp, layer.sourceId);
        let node = getNode(ensured.comp, ensured.transformId)!;
        if (args.remove === true) node = deleteKeyframes(node, [{ prop, time }]);
        else {
          const size = prop === 'position' || prop === 'anchor' ? 2 : 1;
          const value = args.value === undefined ? null : vec(args.value, size);
          if (args.value !== undefined && !value) throw new Error(`value must be ${size === 2 ? '[x, y]' : 'a number'}.`);
          node = addKeyframeAt(node, prop, time);
          if (value) node = setPropValue(node, prop, fromDisplay(prop, value, comp), time);
          if (typeof args.easing === 'string') {
            if (!['easy', 'in', 'out', 'linear', 'hold'].includes(args.easing)) throw new Error('easing must be easy, in, out, linear or hold.');
            node = applyEase(node, [{ prop, time }], args.easing as EaseKind);
          }
        }
        const next = replaceNode(ensured.comp, node);
        save(ctx, store, next);
        return { keyframes: propKeyframeTimes(node, prop), ...layerResult(next, layer.sourceId, time) };
      },
    },
    {
      name: 'ae_layer_trim',
      description: 'Trim or move a layer in time: inPoint/outPoint trim (footage stays in place, Alt+[ / Alt+]); moveBy shifts the whole layer by seconds; moveInTo moves the in point to a time ([).',
      writes: true,
      parameters: { type: 'object', properties: { compId: compIdSchema, layerId: layerIdSchema, inPoint: { type: 'number' }, outPoint: { type: 'number' }, moveBy: { type: 'number' }, moveInTo: { type: 'number' } }, required: ['layerId'] },
      handler: (args, ctx) => {
        const { store, comp } = pickComp(ctx, args);
        const layer = findLayer(comp, args.layerId);
        if (layer.locked) throw new Error('Layer is locked.');
        let next = comp;
        if (args.moveBy !== undefined) next = moveLayerTime(next, layer.sourceId, numArg(args, 'moveBy'));
        if (args.moveInTo !== undefined) next = moveLayerInTo(next, layer.sourceId, numArg(args, 'moveInTo'));
        if (args.inPoint !== undefined) next = trimLayerIn(next, layer.sourceId, numArg(args, 'inPoint'));
        if (args.outPoint !== undefined) {
          const duration = layer.source.type === 'media' ? ctx.getState().mediaItems.find((m) => m.id === layer.source.mediaId)?.duration : undefined;
          next = trimLayerOut(next, layer.sourceId, numArg(args, 'outPoint'), duration);
        }
        if (next === comp) throw new Error('Pass inPoint, outPoint, moveBy or moveInTo.');
        save(ctx, store, next);
        return layerResult(next, layer.sourceId);
      },
    },
    {
      name: 'ae_layer_split',
      description: 'Split a layer at `time` (Cmd+Shift+D): the original ends at time, the new layer above continues the footage.',
      writes: true,
      parameters: { type: 'object', properties: { compId: compIdSchema, layerId: layerIdSchema, time: { type: 'number' } }, required: ['layerId', 'time'] },
      handler: (args, ctx) => {
        const { store, comp } = pickComp(ctx, args);
        requireLayerGraph(comp);
        const layer = findLayer(comp, args.layerId);
        const result = splitLayer(comp, layer.sourceId, numArg(args, 'time'));
        if (!result.layerId) throw new Error('Time must be inside the layer (between its in and out point).');
        save(ctx, store, result.comp);
        return { newLayerId: result.layerId, ...layerResult(result.comp, result.layerId) };
      },
    },
    {
      name: 'ae_layer_duplicate',
      description: 'Duplicate a layer (Cmd+D); the copy is placed above the original.',
      writes: true,
      parameters: { type: 'object', properties: { compId: compIdSchema, layerId: layerIdSchema }, required: ['layerId'] },
      handler: (args, ctx) => {
        const { store, comp } = pickComp(ctx, args);
        requireLayerGraph(comp);
        const layer = findLayer(comp, args.layerId);
        const result = duplicateLayer(comp, layer.sourceId);
        if (!result.layerId) throw new Error('Duplicate failed.');
        save(ctx, store, result.comp);
        return { newLayerId: result.layerId, ...layerResult(result.comp, result.layerId) };
      },
    },
    {
      name: 'ae_layer_delete',
      description: 'Delete layers (their source, transform, effect and mask nodes).',
      writes: true,
      parameters: { type: 'object', properties: { compId: compIdSchema, layerIds: { type: 'array', items: { type: 'string' } } }, required: ['layerIds'] },
      handler: (args, ctx) => {
        const { store, comp } = pickComp(ctx, args);
        requireLayerGraph(comp);
        const ids = (Array.isArray(args.layerIds) ? args.layerIds : []).map((id) => findLayer(comp, id).sourceId);
        if (!ids.length) throw new Error('Parameter "layerIds" is required.');
        const next = deleteLayers(comp, ids);
        save(ctx, store, next);
        return { deleted: ids, remaining: aeLayers(next).length };
      },
    },
    {
      name: 'ae_layer_add_effect',
      description: 'Apply a GPU effect (Buckswood Post Plugins etc., ids from fx_list_effects) to a layer; inserts an fx node into the layer branch or appends to its effect stack. kind "mask_ellipse"/"mask_rect" adds a mask instead (cx, cy, w, h as 0..1 of the comp).',
      writes: true,
      parameters: {
        type: 'object',
        properties: {
          compId: compIdSchema,
          layerId: layerIdSchema,
          effectId: { type: 'string' },
          params: { type: 'object' },
          kind: { type: 'string', enum: ['effect', 'mask_ellipse', 'mask_rect'] },
          cx: { type: 'number' },
          cy: { type: 'number' },
          w: { type: 'number' },
          h: { type: 'number' },
        },
        required: ['layerId'],
      },
      handler: (args, ctx) => {
        const { store, comp } = pickComp(ctx, args);
        const layer = findLayer(comp, args.layerId);
        if (layer.locked) throw new Error('Layer is locked.');
        const kind = typeof args.kind === 'string' ? args.kind : 'effect';
        if (kind === 'mask_ellipse' || kind === 'mask_rect') {
          const rect = { cx: numArg(args, 'cx', 0.5), cy: numArg(args, 'cy', 0.5), w: numArg(args, 'w', 0.5), h: numArg(args, 'h', 0.5) };
          const result = addMaskToLayer(comp, layer.sourceId, kind === 'mask_ellipse' ? 'ellipse' : 'rectangle', rect);
          save(ctx, store, result.comp);
          return { maskId: result.maskId, ...layerResult(result.comp, layer.sourceId) };
        }
        const effectId = str(args, 'effectId');
        if (!getFxDefinition(effectId)) throw new Error(`Unknown effect "${effectId}". Use fx_list_effects.`);
        const instance = createFxInstance(effectId, fxValues(args.params));
        const result = addFxInstanceToLayer(comp, layer.sourceId, instance);
        save(ctx, store, result.comp);
        return { fxNodeId: result.fxNodeId, instanceId: instance.id, ...layerResult(result.comp, layer.sourceId) };
      },
    },
    {
      name: 'ae_view_state',
      description: 'Read the After Effects view state (current time, selected layers/keyframes, tool, viewer resolution/zoom, revealed properties). Opens the Fusion page if needed.',
      parameters: { type: 'object', properties: {} },
      handler: async (_args, ctx) => ({ state: await invokeLiveCommand('ae.state.get', {}, { openWorkspace: openFusion(ctx), workspace: 'COMPOSITING', timeoutMs: 6000 }) }),
    },
    {
      name: 'ae_run_command',
      description: `Run an After Effects view command on the current selection/time, e.g. tools (tool.selection, tool.mask), reveal (reveal.position, reveal.keyframed), easing (ease.easy), layer.split, time.nextKeyframe. Pass selectLayers (ids) or time first if needed. Commands: ${AE_COMMANDS.map((c) => c.id).join(', ')}.`,
      writes: true,
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', enum: AE_COMMANDS.map((c) => c.id) },
          selectLayers: { type: 'array', items: { type: 'string' } },
          time: { type: 'number' },
          additive: { type: 'boolean' },
          ui: { type: 'object', description: 'Optional UI state patch (resolution 1-4, viewerZoom, showGrid, showSafe, transparency, pxPerSecond).' },
        },
      },
      handler: async (args, ctx) => ({ state: await invokeLiveCommand('ae.command.run', args, { openWorkspace: openFusion(ctx), workspace: 'COMPOSITING', timeoutMs: 6000 }) }),
    },
  ],
};

registerStudioToolModule(AE_TOOL_MODULE);
