/**
 * MCP tools: Fusion page compositions (one node graph, shown as Fusion, After
 * Effects or Nuke view). Comps live in the project extras
 * (`extras.compositions`, mirrored to the page's localStorage store); while
 * the Fusion page is open, edits go through its live commands so the UI
 * updates immediately. Rendering needs the page (canvas / GPU) and opens it.
 *
 * Layer tools for the After Effects view (`ae_*`) live in aeTools.ts.
 */
import type { CompEasing, CompNode, Composition } from '../../workspaces/fusion-shared/compModel.ts';
import { connect, createNode, getNode, paramsAt, setKeyframe, updateNode } from '../../workspaces/fusion-shared/compModel.ts';
import {
  addSourceWithMerge,
  arrangeFlow,
  arrangeNuke,
  attachMask,
  createCompFromMedia,
  createEmptyComp,
  getRenderRange,
  insertNodeAfter,
  isSourceType,
  removeKeyframe,
  removeNodes,
  setParamAtTime,
  setRenderRange,
  swapMergeInputs,
  togglePassthrough,
  uniqueNodeName,
  type CompositionExt,
} from '../../workspaces/fusion-shared/compModelExt.ts';
import { emptyStore, loadStore, newerStore, saveStore, storageKeyFor, storeFromUnknown, upsertComp, type CompStore } from '../../workspaces/fusion-shared/compPersist.ts';
import { FUSION_TOOLS, NUKE_TOOLS, buildToolNode, type ToolDef } from '../../workspaces/fusion-shared/toolCatalog.ts';
import { nodeClassOf } from '../../workspaces/fusion-shared/nodeClass.ts';
import { fxStackFor } from '../../workspaces/fusion-shared/compFx.ts';
import { createFxInstance, getFxDefinition } from '../../fx/registry.ts';
import { nukePortFor } from '../../workspaces/fusion-nuke/nukeModel.ts';
import type { FusionViewId } from '../../workspaces/fusion-shared/viewProps.ts';
import { hasLiveCommand, invokeLiveCommand } from '../liveCommands.ts';
import { numArg, registerStudioToolModule, str, type StudioToolContext, type StudioToolModule } from '../toolModules.ts';

export const COMPOSITIONS_EXTRA = 'compositions';

/** Live commands the Fusion page registers while mounted. */
export const FUSION_LIVE = {
  storeGet: 'fusion.store.get',
  storeSet: 'fusion.store.set',
  renderFrame: 'fusion.render.frame',
  renderMedia: 'fusion.render.media',
  viewerSet: 'fusion.viewer.set',
  nukeViewerSet: 'nuke.viewer.set',
} as const;

const safeStorage = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

export async function readCompStore(ctx: StudioToolContext): Promise<CompStore> {
  if (hasLiveCommand(FUSION_LIVE.storeGet)) {
    const live = storeFromUnknown(await invokeLiveCommand(FUSION_LIVE.storeGet, {}));
    if (live) return live;
  }
  const state = ctx.getState();
  const fromExtras = storeFromUnknown(state.extras?.[COMPOSITIONS_EXTRA]);
  const local = loadStore(safeStorage(), storageKeyFor(state.projectPath));
  return newerStore(fromExtras, local.comps.length || local.savedAt ? local : null);
}

export async function writeCompStore(ctx: StudioToolContext, store: CompStore): Promise<CompStore> {
  const stamped: CompStore = { ...store, savedAt: Date.now() };
  if (hasLiveCommand(FUSION_LIVE.storeSet)) await invokeLiveCommand(FUSION_LIVE.storeSet, { store: stamped });
  ctx.actions.setExtra(COMPOSITIONS_EXTRA, stamped);
  saveStore(safeStorage(), storageKeyFor(ctx.getState().projectPath), stamped);
  return stamped;
}

const pickComp = (store: CompStore, compId: unknown): CompositionExt => {
  const id = typeof compId === 'string' && compId ? compId : store.activeId;
  const comp = store.comps.find((entry) => entry.id === id || entry.name === id);
  if (!comp) throw new Error(id ? `Composition ${id} not found.` : 'No composition yet; call fusion_comp_create first.');
  return comp;
};

const pickNode = (comp: Composition, ref: unknown, label = 'nodeId'): CompNode => {
  if (typeof ref !== 'string' || !ref) throw new Error(`Parameter "${label}" is required (node id or name).`);
  const node = comp.nodes.find((entry) => entry.id === ref) ?? comp.nodes.find((entry) => entry.name === ref);
  if (!node) throw new Error(`Node ${ref} not found in ${comp.name}.`);
  return node;
};

const summarizeNode = (node: CompNode, time = 0) => ({
  id: node.id,
  name: node.name,
  type: node.type,
  class: nodeClassOf(node),
  enabled: node.enabled,
  inputs: node.inputs,
  params: paramsAt(node, time),
  animated: Object.keys(node.keyframes ?? {}),
  keyframes: node.keyframes ?? {},
  mediaId: node.mediaId ?? null,
  fx: (node.fxStack ?? []).map((entry) => ({ instanceId: entry.id, effectId: entry.effectId, enabled: entry.enabled, params: entry.params })),
  position: { x: node.x, y: node.y },
});

const summarizeComp = (comp: CompositionExt) => ({
  id: comp.id,
  name: comp.name,
  width: comp.width,
  height: comp.height,
  fps: comp.fps,
  durationSeconds: comp.durationSeconds,
  nodeCount: comp.nodes.length,
  outputNodeId: comp.outputNodeId,
  renderRange: getRenderRange(comp),
});

const ALL_TOOLS: ToolDef[] = [...FUSION_TOOLS, ...NUKE_TOOLS];
const findTool = (name: string): ToolDef => {
  const lower = name.toLowerCase();
  const tool = ALL_TOOLS.find((entry) => entry.id.toLowerCase() === lower || entry.label.toLowerCase() === lower) ?? ALL_TOOLS.find((entry) => entry.type === lower);
  if (!tool) throw new Error(`Unknown tool "${name}". Use one of: ${[...new Set(ALL_TOOLS.map((entry) => entry.id))].join(', ')}.`);
  return tool;
};

const scalarParams = (raw: unknown): Record<string, number | string | boolean> => {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, number | string | boolean> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) out[key] = value;
  }
  return out;
};

const PORT_ALIASES: Record<string, string> = { A: nukePortFor('A'), B: nukePortFor('B'), background: 'bg', foreground: 'fg', effectmask: 'mask', input: 'input', bg: 'bg', fg: 'fg', mask: 'mask' };

/** Applies `edit` to one comp and stores it. */
async function editComp(ctx: StudioToolContext, compId: unknown, edit: (comp: CompositionExt) => CompositionExt) {
  const store = await readCompStore(ctx);
  const comp = pickComp(store, compId);
  const next = edit(comp);
  await writeCompStore(ctx, { ...store, comps: upsertComp(store.comps, next) });
  return next;
}

const VIEWS: FusionViewId[] = ['fusion', 'ae', 'nuke'];

const openFusion = (ctx: StudioToolContext) => () => ctx.actions.setActiveWorkspace('COMPOSITING');

export const FUSION_TOOL_MODULE: StudioToolModule = {
  id: 'fusion',
  label: 'Fusion-Seite (Kompositionen, Fusion-/Nuke-Ansicht)',
  tools: [
    {
      name: 'fusion_comp_list',
      description: 'List the compositions of the project (Fusion page) with size, fps, duration, node count, the active comp and the current view (fusion | ae | nuke).',
      parameters: { type: 'object', properties: {} },
      handler: async (_args, ctx) => {
        const store = await readCompStore(ctx);
        return { activeId: store.activeId, view: store.view, comps: store.comps.map(summarizeComp) };
      },
    },
    {
      name: 'fusion_comp_create',
      description: 'Create a composition: from a media item (mediaId) or timeline clip (clipId) → MediaIn1 → MediaOut1, or empty. Becomes the active comp.',
      writes: true,
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          mediaId: { type: 'string' },
          clipId: { type: 'string', description: 'Timeline clip; its media and duration are used.' },
          width: { type: 'integer', minimum: 16, maximum: 8192 },
          height: { type: 'integer', minimum: 16, maximum: 8192 },
          fps: { type: 'number', minimum: 1, maximum: 240 },
          durationSeconds: { type: 'number', minimum: 0.04 },
        },
      },
      handler: async (args, ctx) => {
        const state = ctx.getState();
        const clip = typeof args.clipId === 'string' ? state.timelineClips.find((entry) => entry.id === args.clipId) : undefined;
        if (typeof args.clipId === 'string' && !clip) throw new Error(`Clip ${args.clipId} not found.`);
        const mediaId = clip?.mediaId ?? (typeof args.mediaId === 'string' ? args.mediaId : null);
        const media = mediaId ? state.mediaItems.find((item) => item.id === mediaId) : undefined;
        if (mediaId && !media) throw new Error(`Media ${mediaId} not found.`);
        const options = {
          width: args.width !== undefined ? Math.round(numArg(args, 'width')) : undefined,
          height: args.height !== undefined ? Math.round(numArg(args, 'height')) : undefined,
          fps: args.fps !== undefined ? numArg(args, 'fps') : undefined,
          durationSeconds: args.durationSeconds !== undefined ? numArg(args, 'durationSeconds') : clip ? Math.max(0.04, clip.end - clip.start) : undefined,
        };
        const store = await readCompStore(ctx);
        let comp = media ? createCompFromMedia(media, options) : createEmptyComp(`Komposition ${store.comps.length + 1}`, options);
        if (typeof args.name === 'string' && args.name.trim()) comp = { ...comp, name: args.name.trim() };
        await writeCompStore(ctx, { ...store, comps: [...store.comps, comp], activeId: comp.id });
        return { comp: summarizeComp(comp), nodes: comp.nodes.map((node) => ({ id: node.id, name: node.name, type: node.type })) };
      },
    },
    {
      name: 'fusion_comp_get',
      description: 'Read a composition (active one if compId is omitted): all nodes with class, inputs (ports bg/fg/mask/input), params at `time`, keyframes and fx stacks.',
      parameters: { type: 'object', properties: { compId: { type: 'string' }, time: { type: 'number', description: 'Seconds; params are evaluated at this time.' } } },
      handler: async (args, ctx) => {
        const comp = pickComp(await readCompStore(ctx), args.compId);
        const time = numArg(args, 'time', 0);
        return { comp: summarizeComp(comp), background: comp.background, nodes: comp.nodes.map((node) => summarizeNode(node, time)) };
      },
    },
    {
      name: 'fusion_comp_update',
      description: 'Change composition settings (name, width, height, fps, durationSeconds, background) and/or the render range in seconds; select it as active; or delete it.',
      writes: true,
      parameters: {
        type: 'object',
        properties: {
          compId: { type: 'string' },
          name: { type: 'string' },
          width: { type: 'integer', minimum: 16, maximum: 8192 },
          height: { type: 'integer', minimum: 16, maximum: 8192 },
          fps: { type: 'number', minimum: 1, maximum: 240 },
          durationSeconds: { type: 'number', minimum: 0.04 },
          background: { type: 'string' },
          renderStart: { type: 'number' },
          renderEnd: { type: 'number' },
          activate: { type: 'boolean' },
          arrange: { type: 'string', enum: ['fusion', 'nuke'], description: 'Auto-arrange the node layout of that view.' },
          delete: { type: 'boolean' },
        },
      },
      handler: async (args, ctx) => {
        const store = await readCompStore(ctx);
        const comp = pickComp(store, args.compId);
        if (args.delete === true) {
          const comps = store.comps.filter((entry) => entry.id !== comp.id);
          await writeCompStore(ctx, { ...store, comps, activeId: store.activeId === comp.id ? comps[0]?.id ?? null : store.activeId });
          return { deleted: comp.id };
        }
        let next: CompositionExt = { ...comp };
        if (typeof args.name === 'string' && args.name.trim()) next.name = args.name.trim();
        if (args.width !== undefined) next.width = Math.round(Math.min(8192, Math.max(16, numArg(args, 'width'))));
        if (args.height !== undefined) next.height = Math.round(Math.min(8192, Math.max(16, numArg(args, 'height'))));
        if (args.fps !== undefined) next.fps = Math.min(240, Math.max(1, numArg(args, 'fps')));
        if (args.durationSeconds !== undefined) next.durationSeconds = Math.max(1 / next.fps, numArg(args, 'durationSeconds'));
        if (typeof args.background === 'string') next.background = args.background;
        if (args.renderStart !== undefined || args.renderEnd !== undefined) {
          const range = getRenderRange(next);
          next = setRenderRange(next, { start: numArg(args, 'renderStart', range.start), end: numArg(args, 'renderEnd', range.end) });
        }
        if (args.arrange === 'fusion') next = arrangeFlow(next) as CompositionExt;
        if (args.arrange === 'nuke') next = arrangeNuke(next);
        await writeCompStore(ctx, { ...store, comps: upsertComp(store.comps, next), activeId: args.activate ? next.id : store.activeId });
        return { comp: summarizeComp(next) };
      },
    },
    {
      name: 'fusion_node_add',
      description:
        'Add a node by tool name. Fusion tools: Background, TextPlus, Merge, Transform, EllipseMask, RectangleMask, ColorCorrector, Blur, FX, MediaIn. Nuke classes: Read, Constant, Text, Merge, Transform, Grade, Blur, Radial, Rectangle, OFX, Dot. With afterNodeId the node is inserted downstream of it (masks attach to a merge mask input; generators are merged over it when mergeOver is true, like Fusion).',
      writes: true,
      parameters: {
        type: 'object',
        properties: {
          compId: { type: 'string' },
          tool: { type: 'string' },
          afterNodeId: { type: 'string', description: 'Node id or name to insert after.' },
          mergeOver: { type: 'boolean', description: 'Generators: create a Merge (selected = background, new = foreground). Default true.' },
          name: { type: 'string' },
          mediaId: { type: 'string', description: 'MediaIn/Read: media item id.' },
          effectId: { type: 'string', description: 'FX nodes: effect id (see fx_list_effects).' },
          params: { type: 'object' },
          x: { type: 'number' },
          y: { type: 'number' },
        },
        required: ['tool'],
      },
      handler: async (args, ctx) => {
        const def = findTool(str(args, 'tool'));
        if (def.type === 'output') throw new Error('A composition has exactly one output (MediaOut / Write).');
        let created: CompNode | null = null;
        let mergeId: string | null = null;
        const comp = await editComp(ctx, args.compId, (current) => {
          const after = typeof args.afterNodeId === 'string' ? pickNode(current, args.afterNodeId, 'afterNodeId') : null;
          const maxX = Math.max(0, ...current.nodes.map((node) => node.x));
          const pos = { x: args.x !== undefined ? numArg(args, 'x') : after ? after.x + 170 : maxX + 170, y: args.y !== undefined ? numArg(args, 'y') : after ? after.y : 0 };
          const node = buildToolNode(def, current, { fxStack: fxStackFor, defaultMediaId: typeof args.mediaId === 'string' ? args.mediaId : null }, pos)!;
          if (typeof args.name === 'string' && args.name.trim()) node.name = args.name.trim();
          node.params = { ...node.params, ...scalarParams(args.params) };
          if (typeof args.effectId === 'string' && node.type === 'fx') {
            if (!getFxDefinition(args.effectId)) throw new Error(`Unknown effect ${args.effectId}.`);
            node.fxStack = [createFxInstance(args.effectId)];
          }
          created = node;
          if (def.mask) return attachMask(current, node, after?.id ?? null) as CompositionExt;
          if (isSourceType(node.type) && after && args.mergeOver !== false) {
            const merge = createNode('merge', { name: uniqueNodeName(current, 'Merge'), x: after.x + 170, y: after.y });
            mergeId = merge.id;
            return addSourceWithMerge(current, { ...node, x: after.x, y: after.y + 80 }, after.id, merge) as CompositionExt;
          }
          return insertNodeAfter(current, node, after?.id ?? null) as CompositionExt;
        });
        const node = getNode(comp, (created as CompNode | null)?.id)!;
        return { node: summarizeNode(node), mergeId };
      },
    },
    {
      name: 'fusion_node_remove',
      description: 'Remove nodes (ids or names). The main input is reconnected to what the node fed. The output node cannot be removed.',
      writes: true,
      parameters: { type: 'object', properties: { compId: { type: 'string' }, nodeIds: { type: 'array', items: { type: 'string' } } }, required: ['nodeIds'] },
      handler: async (args, ctx) => {
        const refs = Array.isArray(args.nodeIds) ? args.nodeIds : [];
        let removed: string[] = [];
        await editComp(ctx, args.compId, (comp) => {
          removed = refs.map((ref) => pickNode(comp, ref).id).filter((id) => id !== comp.outputNodeId);
          return removeNodes(comp, removed) as CompositionExt;
        });
        return { removed };
      },
    },
    {
      name: 'fusion_node_connect',
      description: 'Connect the output of `from` into input `port` of `to` (ports: bg/fg/mask on Merge — or Nuke A (=fg) / B (=bg) — and input on other nodes). from = null disconnects. Cycles are rejected. Also: swap=true swaps a Merge\'s bg/fg; bypass=true toggles pass-through.',
      writes: true,
      parameters: {
        type: 'object',
        properties: { compId: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, port: { type: 'string' }, swap: { type: 'boolean' }, bypass: { type: 'boolean' } },
        required: ['to'],
      },
      handler: async (args, ctx) => {
        let result: Record<string, unknown> = {};
        await editComp(ctx, args.compId, (comp) => {
          const to = pickNode(comp, args.to, 'to');
          if (args.swap) {
            result = { swapped: to.id };
            return swapMergeInputs(comp, [to.id]) as CompositionExt;
          }
          if (args.bypass) {
            const next = togglePassthrough(comp, [to.id]);
            result = { enabled: getNode(next, to.id)!.enabled };
            return next as CompositionExt;
          }
          const portArg = typeof args.port === 'string' ? args.port : to.type === 'merge' ? 'bg' : 'input';
          const port = PORT_ALIASES[portArg] ?? PORT_ALIASES[portArg.toLowerCase()] ?? portArg;
          if (!(port in to.inputs)) throw new Error(`${to.name} has no input "${portArg}" (inputs: ${Object.keys(to.inputs).join(', ') || 'none'}).`);
          const from = args.from === null || args.from === undefined || args.from === '' ? null : pickNode(comp, args.from, 'from');
          const next = connect(comp, from?.id ?? null, to.id, port);
          if (from && getNode(next, to.id)!.inputs[port] !== from.id) throw new Error('Connection rejected (would create a cycle).');
          result = { to: to.id, port, from: from?.id ?? null };
          return next as CompositionExt;
        });
        return result;
      },
    },
    {
      name: 'fusion_node_set_params',
      description:
        'Set node params (e.g. Transform x/y/scale/rotation, Merge blend/opacity, Text text/size/color, Background color, mask cx/cy/w/h/feather). Animated params get a keyframe at `time`. Also name, enabled, mediaId, inPoint/outPoint, and fxParams (params of the node\'s first GPU effect, or instanceId) / effectId (replace the effect).',
      writes: true,
      parameters: {
        type: 'object',
        properties: {
          compId: { type: 'string' },
          nodeId: { type: 'string' },
          params: { type: 'object' },
          time: { type: 'number' },
          name: { type: 'string' },
          enabled: { type: 'boolean' },
          mediaId: { type: 'string' },
          inPoint: { type: 'number' },
          outPoint: { type: 'number' },
          effectId: { type: 'string' },
          fxParams: { type: 'object' },
          instanceId: { type: 'string' },
        },
        required: ['nodeId'],
      },
      handler: async (args, ctx) => {
        let nodeId = '';
        const comp = await editComp(ctx, args.compId, (current) => {
          let node = pickNode(current, args.nodeId);
          nodeId = node.id;
          const time = numArg(args, 'time', 0);
          for (const [key, value] of Object.entries(scalarParams(args.params))) node = setParamAtTime(node, key, time, value);
          const patch: Partial<CompNode> = { params: node.params, keyframes: node.keyframes };
          if (typeof args.name === 'string' && args.name.trim()) patch.name = args.name.trim();
          if (typeof args.enabled === 'boolean' && node.id !== current.outputNodeId) patch.enabled = args.enabled;
          if (typeof args.mediaId === 'string') {
            if (!ctx.getState().mediaItems.some((item) => item.id === args.mediaId)) throw new Error(`Media ${args.mediaId} not found.`);
            patch.mediaId = args.mediaId;
          }
          if (args.inPoint !== undefined) patch.inPoint = numArg(args, 'inPoint');
          if (args.outPoint !== undefined) patch.outPoint = numArg(args, 'outPoint');
          if (node.type === 'fx') {
            let stack = node.fxStack ?? [];
            if (typeof args.effectId === 'string') {
              if (!getFxDefinition(args.effectId)) throw new Error(`Unknown effect ${args.effectId}.`);
              stack = [createFxInstance(args.effectId)];
            }
            const fxParams = scalarParams(args.fxParams);
            if (Object.keys(fxParams).length) {
              const target = typeof args.instanceId === 'string' ? args.instanceId : stack[0]?.id;
              if (!stack.some((entry) => entry.id === target)) throw new Error('Node has no such effect instance.');
              stack = stack.map((entry) => (entry.id === target ? { ...entry, params: { ...entry.params, ...fxParams } } : entry));
            }
            patch.fxStack = stack;
          }
          const next = updateNode(current, node.id, patch);
          // updateNode merges params; keyframes must be replaced as a whole.
          return { ...next, nodes: next.nodes.map((entry) => (entry.id === node.id ? { ...entry, keyframes: node.keyframes } : entry)) };
        });
        return { node: summarizeNode(getNode(comp, nodeId)!, numArg(args, 'time', 0)) };
      },
    },
    {
      name: 'fusion_node_set_keyframe',
      description: 'Set (or with remove=true delete) a keyframe of a numeric node param at `time` seconds, with easing linear | ease-in | ease-out | ease-in-out | hold.',
      writes: true,
      parameters: {
        type: 'object',
        properties: {
          compId: { type: 'string' },
          nodeId: { type: 'string' },
          param: { type: 'string' },
          time: { type: 'number' },
          value: { type: 'number' },
          easing: { type: 'string', enum: ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold'] },
          remove: { type: 'boolean' },
        },
        required: ['nodeId', 'param', 'time'],
      },
      handler: async (args, ctx) => {
        const param = str(args, 'param');
        const time = numArg(args, 'time');
        let nodeId = '';
        const comp = await editComp(ctx, args.compId, (current) => {
          const node = pickNode(current, args.nodeId);
          nodeId = node.id;
          let next: CompNode;
          if (args.remove) next = removeKeyframe(node, param, time);
          else {
            const base = paramsAt(node, time)[param];
            const value = numArg(args, 'value', typeof base === 'number' ? base : NaN);
            if (!Number.isFinite(value)) throw new Error(`Param ${param} is not numeric; pass value.`);
            next = setKeyframe(node, param, time, value, (typeof args.easing === 'string' ? args.easing : 'linear') as CompEasing);
          }
          return { ...current, nodes: current.nodes.map((entry) => (entry.id === node.id ? next : entry)) };
        });
        return { nodeId, param, keyframes: getNode(comp, nodeId)!.keyframes?.[param] ?? [] };
      },
    },
    {
      name: 'fusion_view_set',
      description: 'Switch the Fusion page view of the same composition: fusion (node flow, two viewers), ae (layer timeline) or nuke (top-down DAG). Optionally select the active comp and open the page.',
      writes: true,
      parameters: { type: 'object', properties: { view: { type: 'string', enum: VIEWS }, compId: { type: 'string' }, open: { type: 'boolean', description: 'Open the Fusion page (default true).' } }, required: ['view'] },
      handler: async (args, ctx) => {
        const view = str(args, 'view') as FusionViewId;
        if (!VIEWS.includes(view)) throw new Error(`view must be one of ${VIEWS.join(', ')}.`);
        const store = await readCompStore(ctx);
        const activeId = typeof args.compId === 'string' ? pickComp(store, args.compId).id : store.activeId;
        await writeCompStore(ctx, { ...store, view, activeId });
        if (args.open !== false) ctx.actions.setActiveWorkspace('COMPOSITING');
        return { view, activeId };
      },
    },
    {
      name: 'fusion_viewer_set',
      description: 'Fusion view: show a node in viewer 1 or 2 (like pressing 1/2). Nuke view: use nuke_viewer_set. Opens the Fusion page.',
      writes: true,
      parameters: { type: 'object', properties: { nodeId: { type: 'string' }, viewer: { type: 'integer', enum: [1, 2] } }, required: ['nodeId', 'viewer'] },
      handler: async (args, ctx) => {
        const result = await invokeLiveCommand(FUSION_LIVE.viewerSet, args, { openWorkspace: openFusion(ctx), workspace: 'COMPOSITING' });
        return { result: result as Record<string, unknown> };
      },
    },
    {
      name: 'nuke_viewer_set',
      description: 'Nuke view: set viewer inputs A/B (node ids or names), channel (rgb|r|g|b|a) and the A/B wipe (on/off, position 0..1). Opens the Fusion page in Nuke view.',
      writes: true,
      parameters: {
        type: 'object',
        properties: { a: { type: 'string' }, b: { type: 'string' }, channel: { type: 'string', enum: ['rgb', 'r', 'g', 'b', 'a'] }, wipe: { type: 'boolean' }, wipePosition: { type: 'number', minimum: 0, maximum: 1 } },
      },
      handler: async (args, ctx) => {
        const store = await readCompStore(ctx);
        if (store.view !== 'nuke') await writeCompStore(ctx, { ...store, view: 'nuke' });
        const result = await invokeLiveCommand(FUSION_LIVE.nukeViewerSet, args, { openWorkspace: openFusion(ctx), workspace: 'COMPOSITING' });
        return { result: result as Record<string, unknown> };
      },
    },
    {
      name: 'fusion_render_frame',
      description: 'Render one frame of a composition (or of one node) as PNG and add it to the media bin. Opens the Fusion page (needs canvas/GPU).',
      writes: true,
      parameters: { type: 'object', properties: { compId: { type: 'string' }, time: { type: 'number' }, nodeId: { type: 'string' }, addToTimeline: { type: 'boolean' } } },
      handler: async (args, ctx) => {
        const result = await invokeLiveCommand(FUSION_LIVE.renderFrame, args, { openWorkspace: openFusion(ctx), workspace: 'COMPOSITING', timeoutMs: 8000 });
        return result as Record<string, unknown>;
      },
    },
    {
      name: 'fusion_render_to_media',
      description: 'Render the composition\'s render range to the media bin: a movie (ProRes, desktop app with a saved project) or a PNG still otherwise. Optional renderStart/renderEnd in seconds and addToTimeline.',
      writes: true,
      parameters: { type: 'object', properties: { compId: { type: 'string' }, renderStart: { type: 'number' }, renderEnd: { type: 'number' }, addToTimeline: { type: 'boolean' } } },
      handler: async (args, ctx) => {
        const result = await invokeLiveCommand(FUSION_LIVE.renderMedia, args, { openWorkspace: openFusion(ctx), workspace: 'COMPOSITING', timeoutMs: 8000 });
        return result as Record<string, unknown>;
      },
    },
  ],
};

export const emptyCompStore = emptyStore;

registerStudioToolModule(FUSION_TOOL_MODULE);
