/**
 * After Effects view of the Fusion page — pure layer/keyframe logic.
 *
 * Everything here is a pure function over the shared `Composition`
 * (fusion-shared/compModel.ts): the React view only calls these ops and the
 * command table below, so UI, keyboard, menus and agents share one code path.
 * Covered by aeOps.test.ts (node --test, no DOM).
 *
 * Layer state that has no field in the shared model is stored in the layer's
 * source-node params (renderComp ignores unknown params):
 *   aeSolo, aeLock (boolean) · aeBlend (blend fallback for the bottom layer)
 *   aeSourceOffset (seconds of media skipped before the in point — trim/split)
 */
import type { CompBlendMode, CompEasing, CompKeyframe, CompLayer, CompNode, CompParamValue, Composition } from '../fusion-shared/compModel.ts';
import { addLayer, createNode, getNode, layersOf, newId, paramsAt, setLayerOrder, evaluationOrder } from '../fusion-shared/compModel.ts';
import type { FxInstance } from '../../fx/types.ts';

// ---------------------------------------------------------------- basics

export const EPS = 1e-6;
export const P_SOLO = 'aeSolo';
export const P_LOCK = 'aeLock';
export const P_BLEND = 'aeBlend';
export const P_OFFSET = 'aeSourceOffset';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const num = (v: unknown, fallback = 0) => (isNum(v) ? v : fallback);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const frameDuration = (fps: number) => 1 / Math.max(1, fps || 24);
export const snapToFrame = (t: number, fps: number) => {
  const f = Math.max(1, fps || 24);
  return Math.round(t * f) / f;
};

/** After Effects style timecode H:MM:SS:FF. */
export function formatTimecode(seconds: number, fps: number): string {
  const f = Math.max(1, Math.round(fps || 24));
  const total = Math.round(Math.max(0, num(seconds)) * f);
  const frames = total % f;
  const secs = Math.floor(total / f);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${h}:${pad(m)}:${pad(s)}:${pad(frames)}`;
}

/** Accepts "H:MM:SS:FF", "SS:FF", a frame count ("48") or seconds with unit ("2.5s"). */
export function parseTimecode(text: string, fps: number): number | null {
  const f = Math.max(1, Math.round(fps || 24));
  const trimmed = String(text ?? '').trim().replace(',', '.');
  if (!trimmed) return null;
  if (/^-?\d+(\.\d+)?s$/i.test(trimmed)) return Math.max(0, parseFloat(trimmed));
  if (/^\d+$/.test(trimmed)) return Number(trimmed) / f;
  const parts = trimmed.split(/[:;.]/).map((p) => Number(p));
  if (parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
  while (parts.length < 4) parts.unshift(0);
  const [h, m, s, fr] = parts.slice(-4);
  return h * 3600 + m * 60 + s + fr / f;
}

// ---------------------------------------------------------------- layer projection

export type AeLayer = CompLayer & {
  /** 1 = top layer (After Effects numbering). */
  index: number;
  source: CompNode;
  transform: CompNode | null;
  merge: CompNode | null;
  /** fx nodes in apply order (first applied first). */
  fxNodes: CompNode[];
  maskNodes: CompNode[];
  inPoint: number;
  outPoint: number;
  visible: boolean;
  solo: boolean;
  locked: boolean;
  blend: CompBlendMode;
  fxEnabled: boolean;
};

export function layerRange(comp: Composition, source: CompNode): { inPoint: number; outPoint: number } {
  const inPoint = isNum(source.inPoint) ? source.inPoint : 0;
  const outPoint = isNum(source.outPoint) ? source.outPoint : Math.max(inPoint + frameDuration(comp.fps), comp.durationSeconds);
  return { inPoint, outPoint };
}

/** Layers top → bottom with resolved nodes and switches. */
export function aeLayers(comp: Composition): AeLayer[] {
  const raw = layersOf(comp);
  const out: AeLayer[] = [];
  raw.forEach((layer) => {
    const source = getNode(comp, layer.sourceId);
    if (!source) return;
    const transform = getNode(comp, layer.transformId) ?? null;
    const merge = getNode(comp, layer.mergeId) ?? null;
    const chain = [...layer.fxIds].reverse().map((id) => getNode(comp, id)).filter((n): n is CompNode => Boolean(n));
    const fxNodes = chain.filter((n) => n.type === 'fx');
    const maskNodes = chain.filter((n) => n.type === 'mask');
    const { inPoint, outPoint } = layerRange(comp, source);
    const blend = ((merge?.params.blend as CompBlendMode) ?? (source.params[P_BLEND] as CompBlendMode) ?? 'normal') || 'normal';
    out.push({
      ...layer,
      index: 0,
      source,
      transform,
      merge,
      fxNodes,
      maskNodes,
      inPoint,
      outPoint,
      visible: source.enabled,
      solo: source.params[P_SOLO] === true,
      locked: source.params[P_LOCK] === true,
      blend,
      fxEnabled: fxNodes.length === 0 || fxNodes.some((n) => n.enabled),
    });
  });
  out.reverse();
  out.forEach((layer, i) => {
    layer.index = i + 1;
  });
  return out;
}

const layerNodeIds = (layer: CompLayer) => [layer.sourceId, layer.transformId, layer.mergeId, ...layer.fxIds].filter((id): id is string => Boolean(id));

/** The layer (by source id) that contains any of its nodes (selection from other views). */
export function layerIdForNode(comp: Composition, nodeId: string): string | null {
  for (const layer of layersOf(comp)) if (layerNodeIds(layer).includes(nodeId)) return layer.sourceId;
  return null;
}

/** Maps a node selection (any node of a layer) to layer source ids, keeping order. */
export function selectedLayerIds(comp: Composition, nodeIds: string[]): string[] {
  const out: string[] = [];
  for (const id of nodeIds) {
    const layerId = layerIdForNode(comp, id);
    if (layerId && !out.includes(layerId)) out.push(layerId);
  }
  return out;
}

/** Nodes feeding the output that are not part of a simple layer (nested merges, etc.). */
export function nonLayerNodeIds(comp: Composition): string[] {
  const inLayers = new Set(layersOf(comp).flatMap(layerNodeIds));
  return evaluationOrder(comp).filter((id) => id !== comp.outputNodeId && !inLayers.has(id));
}

/** Structural layer edits (reorder, delete, duplicate) are safe only on the canonical layer graph. */
export const isLayerGraph = (comp: Composition) => nonLayerNodeIds(comp).length === 0;

// ---------------------------------------------------------------- order

/**
 * setLayerOrder() reuses merge nodes in pool order, so the blend mode stored on
 * a merge could jump to another layer. This wrapper detaches the chain first
 * (no stale cycles), keeps each layer's blend/opacity with the layer and
 * verifies the result (returns the input unchanged if the projection fails).
 */
export function withLayerOrder(comp: Composition, bottomToTop: CompLayer[]): Composition {
  const snapshot = new Map<string, { blend: CompParamValue; opacity: CompParamValue; keyframes?: Record<string, CompKeyframe[]> }>();
  for (const layer of bottomToTop) {
    const merge = getNode(comp, layer.mergeId);
    const source = getNode(comp, layer.sourceId);
    snapshot.set(layer.sourceId, {
      blend: merge?.params.blend ?? source?.params[P_BLEND] ?? 'normal',
      opacity: merge?.params.opacity ?? 1,
      keyframes: merge?.keyframes,
    });
  }
  const mergeIds = new Set(bottomToTop.map((l) => l.mergeId).filter(Boolean) as string[]);
  const detached: Composition = {
    ...comp,
    nodes: comp.nodes.map((node) => (mergeIds.has(node.id) ? { ...node, inputs: { ...node.inputs, bg: null, fg: null } } : node)),
  };
  let next = setLayerOrder(detached, bottomToTop);
  const result = layersOf(next);
  if (result.length !== bottomToTop.length || result.some((l, i) => l.sourceId !== bottomToTop[i].sourceId)) return comp;
  next = {
    ...next,
    nodes: next.nodes.map((node) => {
      const layer = result.find((l) => l.mergeId === node.id);
      if (layer) {
        const snap = snapshot.get(layer.sourceId)!;
        return { ...node, params: { ...node.params, blend: snap.blend, opacity: snap.opacity }, keyframes: snap.keyframes };
      }
      const owned = snapshot.get(node.id);
      if (owned) return { ...node, params: { ...node.params, [P_BLEND]: owned.blend } };
      return node;
    }),
  };
  return next;
}

export type ReorderMode = 'forward' | 'backward' | 'front' | 'back';

/** Cmd+] / Cmd+[ / Cmd+Shift+] / Cmd+Shift+[ on the selected layers. */
export function reorderLayers(comp: Composition, layerIds: string[], mode: ReorderMode): Composition {
  const order = layersOf(comp); // bottom → top
  const ids = new Set(layerIds);
  if (!ids.size) return comp;
  let next = [...order];
  if (mode === 'front') next = [...order.filter((l) => !ids.has(l.sourceId)), ...order.filter((l) => ids.has(l.sourceId))];
  else if (mode === 'back') next = [...order.filter((l) => ids.has(l.sourceId)), ...order.filter((l) => !ids.has(l.sourceId))];
  else if (mode === 'forward') {
    for (let i = next.length - 2; i >= 0; i -= 1) {
      if (ids.has(next[i].sourceId) && !ids.has(next[i + 1].sourceId)) [next[i], next[i + 1]] = [next[i + 1], next[i]];
    }
  } else {
    for (let i = 1; i < next.length; i += 1) {
      if (ids.has(next[i].sourceId) && !ids.has(next[i - 1].sourceId)) [next[i], next[i - 1]] = [next[i - 1], next[i]];
    }
  }
  if (next.every((l, i) => l.sourceId === order[i].sourceId)) return comp;
  return withLayerOrder(comp, next);
}

/** Drag in the layer list: move layers so the first one lands at top-index `targetIndex` (1 = top). */
export function moveLayersToIndex(comp: Composition, layerIds: string[], targetIndex: number): Composition {
  const topToBottom = [...layersOf(comp)].reverse();
  const ids = new Set(layerIds);
  const moving = topToBottom.filter((l) => ids.has(l.sourceId));
  if (!moving.length) return comp;
  const rest = topToBottom.filter((l) => !ids.has(l.sourceId));
  const before = topToBottom.slice(0, clamp(Math.round(targetIndex) - 1, 0, topToBottom.length)).filter((l) => !ids.has(l.sourceId)).length;
  const merged = [...rest.slice(0, before), ...moving, ...rest.slice(before)];
  if (merged.every((l, i) => l.sourceId === topToBottom[i].sourceId)) return comp;
  return withLayerOrder(comp, merged.reverse());
}

export function deleteLayers(comp: Composition, layerIds: string[]): Composition {
  const ids = new Set(layerIds);
  const order = layersOf(comp);
  const removed = order.filter((l) => ids.has(l.sourceId));
  if (!removed.length) return comp;
  const drop = new Set(removed.flatMap(layerNodeIds));
  const keep = order.filter((l) => !ids.has(l.sourceId));
  const stripped: Composition = {
    ...comp,
    nodes: comp.nodes
      .filter((n) => !drop.has(n.id))
      .map((n) => ({ ...n, inputs: Object.fromEntries(Object.entries(n.inputs).map(([port, src]) => [port, src && drop.has(src) ? null : src])) })),
  };
  if (!keep.length) {
    return { ...stripped, nodes: stripped.nodes.map((n) => (n.id === comp.outputNodeId ? { ...n, inputs: { ...n.inputs, input: null } } : n)) };
  }
  return withLayerOrder(stripped, keep);
}

// ---------------------------------------------------------------- insert into a layer branch

const layerTopId = (layer: CompLayer) => layer.fxIds[0] ?? layer.transformId ?? layer.sourceId;

/** Inserts `node` between the layer's top node and its consumer (fx/mask above the transform). */
export function insertAtLayerTop(comp: Composition, layerId: string, node: CompNode): Composition {
  const layer = layersOf(comp).find((l) => l.sourceId === layerId);
  if (!layer) return comp;
  const top = layerTopId(layer);
  const rewired = comp.nodes.map((n) => ({
    ...n,
    inputs: Object.fromEntries(Object.entries(n.inputs).map(([port, src]) => [port, src === top ? node.id : src])),
  }));
  const inserted: CompNode = { ...node, inputs: { ...node.inputs, input: top } };
  return { ...comp, nodes: [...rewired, inserted] };
}

/** Gives a layer without transform node one (needed before editing Transform properties). */
export function ensureTransform(comp: Composition, layerId: string): { comp: Composition; transformId: string | null } {
  const layer = layersOf(comp).find((l) => l.sourceId === layerId);
  if (!layer) return { comp, transformId: null };
  if (layer.transformId) return { comp, transformId: layer.transformId };
  const source = getNode(comp, layerId)!;
  const transform = createNode('transform', { name: `${source.name} Transform`, x: source.x + 160, y: source.y });
  const rewired = comp.nodes.map((n) => ({
    ...n,
    inputs: Object.fromEntries(Object.entries(n.inputs).map(([port, src]) => [port, src === layerId ? transform.id : src])),
  }));
  return { comp: { ...comp, nodes: [...rewired, { ...transform, inputs: { input: layerId } }] }, transformId: transform.id };
}

export function addFxInstanceToLayer(comp: Composition, layerId: string, instance: FxInstance): { comp: Composition; fxNodeId: string | null } {
  const layer = aeLayers(comp).find((l) => l.sourceId === layerId);
  if (!layer) return { comp, fxNodeId: null };
  const existing = layer.fxNodes[layer.fxNodes.length - 1];
  if (existing) {
    return {
      comp: { ...comp, nodes: comp.nodes.map((n) => (n.id === existing.id ? { ...n, fxStack: [...(n.fxStack ?? []), instance] } : n)) },
      fxNodeId: existing.id,
    };
  }
  const fx = createNode('fx', { name: `${layer.source.name} Effekte`, x: layer.source.x + 320, y: layer.source.y, fxStack: [instance] });
  return { comp: insertAtLayerTop(comp, layerId, fx), fxNodeId: fx.id };
}

export type MaskRect = { cx: number; cy: number; w: number; h: number };

export function addMaskToLayer(comp: Composition, layerId: string, shape: 'ellipse' | 'rectangle', rect?: MaskRect): { comp: Composition; maskId: string | null } {
  const layer = aeLayers(comp).find((l) => l.sourceId === layerId);
  if (!layer) return { comp, maskId: null };
  const n = layer.maskNodes.length + 1;
  const mask = createNode('mask', {
    name: `Maske ${n}`,
    x: layer.source.x + 240,
    y: layer.source.y + 60,
    params: { shape, feather: 0, ...(rect ? { cx: clamp(rect.cx, -1, 2), cy: clamp(rect.cy, -1, 2), w: clamp(rect.w, 0.001, 4), h: clamp(rect.h, 0.001, 4) } : {}) },
  });
  return { comp: insertAtLayerTop(comp, layerId, mask), maskId: mask.id };
}

/** Removes an fx/mask node from a layer branch (reconnects its input). */
export function removeBranchNode(comp: Composition, nodeId: string): Composition {
  const node = getNode(comp, nodeId);
  if (!node || (node.type !== 'fx' && node.type !== 'mask')) return comp;
  const pass = node.inputs.input ?? null;
  return {
    ...comp,
    nodes: comp.nodes
      .filter((n) => n.id !== nodeId)
      .map((n) => ({ ...n, inputs: Object.fromEntries(Object.entries(n.inputs).map(([port, src]) => [port, src === nodeId ? pass : src])) })),
  };
}

// ---------------------------------------------------------------- new layers

export const LABEL_COLORS: { id: string; name: string; color: string }[] = [
  { id: 'none', name: 'Ohne', color: '#6a6a70' },
  { id: 'red', name: 'Rot', color: '#c9565c' },
  { id: 'yellow', name: 'Gelb', color: '#d3bf4c' },
  { id: 'teal', name: 'Türkis', color: '#4fb0ad' },
  { id: 'rose', name: 'Rosa', color: '#d585b6' },
  { id: 'lavender', name: 'Lavendel', color: '#a092d6' },
  { id: 'peach', name: 'Pfirsich', color: '#dca57b' },
  { id: 'mint', name: 'Mint', color: '#98cc97' },
  { id: 'blue', name: 'Blau', color: '#5b7fd4' },
  { id: 'green', name: 'Grün', color: '#4aa457' },
  { id: 'violet', name: 'Violett', color: '#8d5bb6' },
  { id: 'orange', name: 'Orange', color: '#de8a3c' },
  { id: 'brown', name: 'Braun', color: '#93694b' },
];

export function defaultLabel(node: Pick<CompNode, 'type'>, mediaType?: string): string {
  if (node.type === 'solid' || node.type === 'text') return LABEL_COLORS[1].color;
  if (mediaType === 'image') return LABEL_COLORS[5].color;
  return LABEL_COLORS[3].color;
}

export function layerColor(layer: Pick<AeLayer, 'source'>): string {
  return layer.source.color || defaultLabel(layer.source);
}

const topLayerId = (comp: Composition) => {
  const order = layersOf(comp);
  return order.length ? order[order.length - 1].sourceId : null;
};

export type NewLayerOptions = { at?: number; duration?: number; position?: { x: number; y: number }; name?: string; color?: string; mediaType?: string };

/** Adds a source node as new top layer, with AE defaults (in point, label). Returns the new layer id. */
export function addSourceLayer(comp: Composition, source: CompNode, options: NewLayerOptions = {}): { comp: Composition; layerId: string } {
  const at = Math.max(0, num(options.at, 0));
  const duration = num(options.duration, 0) > 0 ? num(options.duration) : Math.max(frameDuration(comp.fps), comp.durationSeconds - at);
  const prepared: CompNode = {
    ...source,
    inPoint: isNum(source.inPoint) ? source.inPoint : at,
    outPoint: isNum(source.outPoint) ? source.outPoint : at + duration,
    color: source.color ?? options.color ?? defaultLabel(source, options.mediaType),
  };
  let next = addLayer(comp, prepared);
  const layerId = topLayerId(next) ?? prepared.id;
  if (options.position) {
    const layer = layersOf(next).find((l) => l.sourceId === layerId);
    if (layer?.transformId) next = patchParams(next, layer.transformId, { x: options.position.x, y: options.position.y });
  }
  return { comp: next, layerId };
}

const countOf = (comp: Composition, type: CompNode['type']) => comp.nodes.filter((n) => n.type === type).length;

export function newSolidLayer(comp: Composition, opts: { name?: string; color?: string; at?: number } = {}) {
  const solid = createNode('solid', { name: opts.name || `Farbfläche ${countOf(comp, 'solid') + 1}`, params: { color: opts.color || '#7a7a7a' } });
  return addSourceLayer(comp, solid, { at: opts.at });
}

export function newTextLayer(comp: Composition, opts: { text?: string; at?: number; position?: { x: number; y: number } } = {}) {
  const text = opts.text || 'Text';
  const node = createNode('text', { name: text, params: { text } });
  return addSourceLayer(comp, node, { at: opts.at, position: opts.position });
}

export function newMediaLayer(comp: Composition, media: { id: string; name: string; type?: string; duration?: number }, opts: { at?: number } = {}) {
  const isStill = media.type === 'image';
  const node = createNode('media', { name: media.name || 'Footage', mediaId: media.id });
  return addSourceLayer(comp, node, { at: opts.at, duration: isStill ? undefined : media.duration, mediaType: media.type });
}

// ---------------------------------------------------------------- node patches

export function patchParams(comp: Composition, nodeId: string, params: Record<string, CompParamValue>): Composition {
  return { ...comp, nodes: comp.nodes.map((n) => (n.id === nodeId ? { ...n, params: { ...n.params, ...params } } : n)) };
}

export function replaceNode(comp: Composition, node: CompNode): Composition {
  return { ...comp, nodes: comp.nodes.map((n) => (n.id === node.id ? node : n)) };
}

const patchNode = (comp: Composition, id: string, patch: Partial<CompNode>): Composition => ({
  ...comp,
  nodes: comp.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
});

export type LayerSwitch = 'visible' | 'solo' | 'lock' | 'fx';

export function setLayerSwitch(comp: Composition, layerId: string, which: LayerSwitch, value: boolean): Composition {
  const layer = aeLayers(comp).find((l) => l.sourceId === layerId);
  if (!layer) return comp;
  switch (which) {
    case 'visible':
      return patchNode(comp, layerId, { enabled: value });
    case 'solo':
      return patchParams(comp, layerId, { [P_SOLO]: value });
    case 'lock':
      return patchParams(comp, layerId, { [P_LOCK]: value });
    case 'fx': {
      const ids = new Set(layer.fxNodes.map((n) => n.id));
      return { ...comp, nodes: comp.nodes.map((n) => (ids.has(n.id) ? { ...n, enabled: value } : n)) };
    }
  }
}

export function setLayerBlend(comp: Composition, layerId: string, blend: CompBlendMode): Composition {
  const layer = layersOf(comp).find((l) => l.sourceId === layerId);
  if (!layer) return comp;
  let next = patchParams(comp, layerId, { [P_BLEND]: blend });
  if (layer.mergeId) next = patchParams(next, layer.mergeId, { blend });
  return next;
}

export const setLayerLabel = (comp: Composition, layerId: string, color: string) => patchNode(comp, layerId, { color });
export const renameLayer = (comp: Composition, layerId: string, name: string) => (name.trim() ? patchNode(comp, layerId, { name: name.trim() }) : comp);

// ---------------------------------------------------------------- time: move, trim, split, duplicate

/** Drag a layer bar: in and out move together; media keeps its source offset. */
export function moveLayerTime(comp: Composition, layerId: string, delta: number): Composition {
  const source = getNode(comp, layerId);
  if (!source || !isNum(delta) || Math.abs(delta) < EPS) return comp;
  const { inPoint, outPoint } = layerRange(comp, source);
  return patchNode(comp, layerId, { inPoint: snapToFrame(inPoint + delta, comp.fps), outPoint: snapToFrame(outPoint + delta, comp.fps) });
}

/** `[` — move the layer so its in point sits at t. */
export const moveLayerInTo = (comp: Composition, layerId: string, t: number) => {
  const source = getNode(comp, layerId);
  return source ? moveLayerTime(comp, layerId, snapToFrame(t, comp.fps) - layerRange(comp, source).inPoint) : comp;
};

/** `]` — move the layer so its out point sits at t. */
export const moveLayerOutTo = (comp: Composition, layerId: string, t: number) => {
  const source = getNode(comp, layerId);
  return source ? moveLayerTime(comp, layerId, snapToFrame(t, comp.fps) - layerRange(comp, source).outPoint) : comp;
};

/**
 * Alt+[ / dragging the bar start: trims the in point. Media content stays in
 * place on the comp timeline (source offset follows), never before frame 0 of
 * the footage. Optional `sourceDuration` limits the out point for footage.
 */
export function trimLayerIn(comp: Composition, layerId: string, t: number): Composition {
  const source = getNode(comp, layerId);
  if (!source || !isNum(t)) return comp;
  const fd = frameDuration(comp.fps);
  const { inPoint, outPoint } = layerRange(comp, source);
  let nextIn = Math.min(snapToFrame(t, comp.fps), outPoint - fd);
  if (source.type === 'media') {
    const offset = num(source.params[P_OFFSET], 0);
    const start = inPoint - offset; // comp time of footage frame 0
    nextIn = Math.max(nextIn, start);
    const nextOffset = Math.max(0, nextIn - start);
    return { ...comp, nodes: comp.nodes.map((n) => (n.id === layerId ? { ...n, inPoint: nextIn, outPoint, params: { ...n.params, [P_OFFSET]: snapToFrame(nextOffset, comp.fps) } } : n)) };
  }
  return patchNode(comp, layerId, { inPoint: nextIn, outPoint });
}

export function trimLayerOut(comp: Composition, layerId: string, t: number, sourceDuration?: number): Composition {
  const source = getNode(comp, layerId);
  if (!source || !isNum(t)) return comp;
  const fd = frameDuration(comp.fps);
  const { inPoint } = layerRange(comp, source);
  let nextOut = Math.max(snapToFrame(t, comp.fps), inPoint + fd);
  if (source.type === 'media' && isNum(sourceDuration) && sourceDuration > 0) {
    const start = inPoint - num(source.params[P_OFFSET], 0);
    nextOut = Math.min(nextOut, start + sourceDuration);
  }
  return patchNode(comp, layerId, { inPoint, outPoint: nextOut });
}

const cloneFrames = (frames: Record<string, CompKeyframe[]> | undefined) => (frames ? JSON.parse(JSON.stringify(frames)) as Record<string, CompKeyframe[]> : undefined);

function incrementName(name: string, taken: Set<string>): string {
  const match = /^(.*?)(\s+)(\d+)$/.exec(name);
  const base = match ? match[1] : name;
  let n = match ? Number(match[3]) + 1 : 2;
  while (taken.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

/** Copies a layer's nodes (source, transform, fx/masks) with fresh ids. */
function cloneLayerNodes(comp: Composition, layer: CompLayer, rename: boolean) {
  const map = new Map<string, string>();
  const ids = [layer.sourceId, layer.transformId, ...layer.fxIds].filter((id): id is string => Boolean(id));
  for (const id of ids) map.set(id, newId(getNode(comp, id)?.type ?? 'n'));
  const taken = new Set(comp.nodes.map((n) => n.name));
  const clones: CompNode[] = ids.map((id) => {
    const node = getNode(comp, id)!;
    return {
      ...node,
      id: map.get(id)!,
      name: id === layer.sourceId && rename ? incrementName(node.name, taken) : node.name,
      y: node.y + 90,
      params: { ...node.params },
      keyframes: cloneFrames(node.keyframes),
      fxStack: node.fxStack ? JSON.parse(JSON.stringify(node.fxStack)) : undefined,
      inputs: Object.fromEntries(Object.entries(node.inputs).map(([port, src]) => [port, src ? map.get(src) ?? src : src])),
    };
  });
  const cloneLayer: CompLayer = {
    sourceId: map.get(layer.sourceId)!,
    transformId: layer.transformId ? map.get(layer.transformId)! : null,
    fxIds: layer.fxIds.map((id) => map.get(id)!),
    mergeId: null,
  };
  return { clones, cloneLayer };
}

/** Cmd+D — duplicate above the original. */
export function duplicateLayer(comp: Composition, layerId: string): { comp: Composition; layerId: string | null } {
  const order = layersOf(comp);
  const index = order.findIndex((l) => l.sourceId === layerId);
  if (index < 0) return { comp, layerId: null };
  const { clones, cloneLayer } = cloneLayerNodes(comp, order[index], true);
  const withNodes: Composition = { ...comp, nodes: [...comp.nodes, ...clones] };
  const nextOrder = [...order.slice(0, index + 1), cloneLayer, ...order.slice(index + 1)];
  const next = withLayerOrder(withNodes, nextOrder);
  if (next === withNodes) return { comp, layerId: null };
  // The copy keeps the original's blend mode.
  const blend = (getNode(comp, order[index].mergeId)?.params.blend ?? getNode(comp, layerId)?.params[P_BLEND] ?? 'normal') as CompBlendMode;
  return { comp: setLayerBlend(next, cloneLayer.sourceId, blend), layerId: cloneLayer.sourceId };
}

/**
 * Cmd+Shift+D — split at t: the original ends at t, the copy (placed above, as
 * After Effects does) starts at t and continues the footage (source offset).
 */
export function splitLayer(comp: Composition, layerId: string, t: number): { comp: Composition; layerId: string | null } {
  const source = getNode(comp, layerId);
  if (!source) return { comp, layerId: null };
  const time = snapToFrame(t, comp.fps);
  const { inPoint, outPoint } = layerRange(comp, source);
  if (time <= inPoint + EPS || time >= outPoint - EPS) return { comp, layerId: null };
  const dup = duplicateLayer(comp, layerId);
  if (!dup.layerId) return { comp, layerId: null };
  const offset = num(source.params[P_OFFSET], 0);
  let next = patchNode(dup.comp, layerId, { inPoint, outPoint: time });
  next = {
    ...next,
    nodes: next.nodes.map((n) =>
      n.id === dup.layerId
        ? { ...n, name: source.name, inPoint: time, outPoint, params: source.type === 'media' ? { ...n.params, [P_OFFSET]: snapToFrame(offset + (time - inPoint), comp.fps) } : n.params }
        : n,
    ),
  };
  return { comp: next, layerId: dup.layerId };
}

// ---------------------------------------------------------------- transform properties

export type AePropId = 'anchor' | 'position' | 'scale' | 'rotation' | 'opacity';

export const AE_PROPS: { id: AePropId; label: string; params: string[]; key: string; unit: string }[] = [
  { id: 'anchor', label: 'Ankerpunkt', params: ['anchorX', 'anchorY'], key: 'a', unit: '' },
  { id: 'position', label: 'Position', params: ['x', 'y'], key: 'p', unit: '' },
  { id: 'scale', label: 'Skalierung', params: ['scale'], key: 's', unit: '%' },
  { id: 'rotation', label: 'Drehung', params: ['rotation'], key: 'r', unit: '°' },
  { id: 'opacity', label: 'Deckkraft', params: ['opacity'], key: 't', unit: '%' },
];

export const propDef = (id: AePropId) => AE_PROPS.find((p) => p.id === id)!;

const TRANSFORM_DEFAULTS: Record<string, number> = { x: 0, y: 0, scale: 1, rotation: 0, anchorX: 0, anchorY: 0, opacity: 1 };

/** Model values at time t (numbers per param). */
export function propValueAt(node: CompNode | null | undefined, prop: AePropId, t: number): number[] {
  const params = node ? paramsAt(node, t) : {};
  return propDef(prop).params.map((p) => num(params[p], TRANSFORM_DEFAULTS[p] ?? 0));
}

/** Model → display units (AE: absolute pixel position, %, degrees). */
export function toDisplay(prop: AePropId, values: number[], comp: Pick<Composition, 'width' | 'height'>): number[] {
  switch (prop) {
    case 'position':
    case 'anchor':
      return [values[0] + comp.width / 2, values[1] + comp.height / 2];
    case 'scale':
    case 'opacity':
      return [values[0] * 100];
    default:
      return [values[0]];
  }
}

export function fromDisplay(prop: AePropId, values: number[], comp: Pick<Composition, 'width' | 'height'>): number[] {
  switch (prop) {
    case 'position':
    case 'anchor':
      return [values[0] - comp.width / 2, values[1] - comp.height / 2];
    case 'scale':
      return [values[0] / 100];
    case 'opacity':
      return [clamp(values[0] / 100, 0, 1)];
    default:
      return [values[0]];
  }
}

/** "1x +30,0°" (revolutions + degrees, AE style). */
export function formatRotation(deg: number): string {
  const d = num(deg);
  const turns = Math.trunc(d / 360);
  const rest = d - turns * 360;
  return `${turns}x ${rest < 0 ? '-' : '+'}${Math.abs(rest).toFixed(1).replace('.', ',')}°`;
}

export const isPropAnimated = (node: CompNode | null | undefined, prop: AePropId) =>
  Boolean(node && propDef(prop).params.some((p) => (node.keyframes?.[p]?.length ?? 0) > 0));

/** Keyframe times of a property (union of its params), sorted. */
export function propKeyframeTimes(node: CompNode | null | undefined, prop: AePropId): number[] {
  if (!node) return [];
  const times: number[] = [];
  for (const p of propDef(prop).params) {
    for (const frame of node.keyframes?.[p] ?? []) if (!times.some((t) => Math.abs(t - frame.time) < EPS)) times.push(frame.time);
  }
  return times.sort((a, b) => a - b);
}

const setFrames = (node: CompNode, param: string, frames: CompKeyframe[]): CompNode => {
  const keyframes = { ...(node.keyframes ?? {}) };
  if (frames.length) keyframes[param] = [...frames].sort((a, b) => a.time - b.time);
  else delete keyframes[param];
  return { ...node, keyframes: Object.keys(keyframes).length ? keyframes : undefined };
};

const upsertFrame = (frames: CompKeyframe[], time: number, value: number): CompKeyframe[] => {
  const existing = frames.find((f) => Math.abs(f.time - time) < EPS);
  const rest = frames.filter((f) => f !== existing);
  return [...rest, { time, value, easing: existing?.easing ?? 'linear' }].sort((a, b) => a.time - b.time);
};

/**
 * Sets a property value at t. Animated → keyframe at t (keeps its easing),
 * static → param value. `values` are model units.
 */
export function setPropValue(node: CompNode, prop: AePropId, values: number[], t: number): CompNode {
  const def = propDef(prop);
  const animated = isPropAnimated(node, prop);
  let next: CompNode = node;
  def.params.forEach((param, i) => {
    const value = values[i];
    if (!isNum(value)) return;
    if (animated) next = setFrames(next, param, upsertFrame(next.keyframes?.[param] ?? [], t, value));
    else next = { ...next, params: { ...next.params, [param]: value } };
  });
  return next;
}

/** Stopwatch: on → keyframe at t with the current value; off → removes all keyframes, keeps value at t. */
export function toggleStopwatch(node: CompNode, prop: AePropId, t: number): CompNode {
  const def = propDef(prop);
  const values = propValueAt(node, prop, t);
  let next: CompNode = node;
  if (isPropAnimated(node, prop)) {
    def.params.forEach((param, i) => {
      next = setFrames(next, param, []);
      next = { ...next, params: { ...next.params, [param]: values[i] } };
    });
    return next;
  }
  def.params.forEach((param, i) => {
    next = setFrames(next, param, [{ time: t, value: values[i], easing: 'linear' }]);
  });
  return next;
}

/** Keyframe navigator diamond: add a keyframe at t, or remove the one at t. */
export function toggleKeyframeAt(node: CompNode, prop: AePropId, t: number): CompNode {
  const def = propDef(prop);
  const has = propKeyframeTimes(node, prop).some((time) => Math.abs(time - t) < EPS);
  const values = propValueAt(node, prop, t);
  let next: CompNode = node;
  def.params.forEach((param, i) => {
    const frames = next.keyframes?.[param] ?? [];
    next = setFrames(next, param, has ? frames.filter((f) => Math.abs(f.time - t) >= EPS) : upsertFrame(frames, t, values[i]));
  });
  return next;
}

/** Alt+Shift+P etc.: add (or update) a keyframe at t with the current value. */
export function addKeyframeAt(node: CompNode, prop: AePropId, t: number): CompNode {
  const values = propValueAt(node, prop, t);
  let next: CompNode = node;
  propDef(prop).params.forEach((param, i) => {
    next = setFrames(next, param, upsertFrame(next.keyframes?.[param] ?? [], t, values[i]));
  });
  return next;
}

export type KeyRef = { nodeId: string; prop: AePropId; time: number };
export const keyRefId = (ref: KeyRef) => `${ref.nodeId}|${ref.prop}|${ref.time.toFixed(5)}`;
export function parseKeyRef(id: string): KeyRef | null {
  const [nodeId, prop, time] = id.split('|');
  const t = Number(time);
  if (!nodeId || !AE_PROPS.some((p) => p.id === prop) || !Number.isFinite(t)) return null;
  return { nodeId, prop: prop as AePropId, time: t };
}

/** Drags keyframes of one node by delta (snapped to frames). A moved key replaces one it lands on. */
export function moveKeyframes(node: CompNode, refs: { prop: AePropId; time: number }[], delta: number, fps: number): CompNode {
  if (!refs.length || !isNum(delta)) return node;
  let next: CompNode = node;
  const byParam = new Map<string, number[]>();
  for (const ref of refs) for (const p of propDef(ref.prop).params) byParam.set(p, [...(byParam.get(p) ?? []), ref.time]);
  for (const [param, times] of byParam) {
    const frames = next.keyframes?.[param] ?? [];
    const moving = frames.filter((f) => times.some((t) => Math.abs(t - f.time) < EPS));
    const staying = frames.filter((f) => !moving.includes(f));
    const moved = moving.map((f) => ({ ...f, time: Math.max(0, snapToFrame(f.time + delta, fps)) }));
    const kept = staying.filter((f) => !moved.some((m) => Math.abs(m.time - f.time) < EPS));
    next = setFrames(next, param, [...kept, ...moved]);
  }
  return next;
}

export function deleteKeyframes(node: CompNode, refs: { prop: AePropId; time: number }[]): CompNode {
  let next: CompNode = node;
  for (const ref of refs) {
    for (const p of propDef(ref.prop).params) {
      next = setFrames(next, p, (next.keyframes?.[p] ?? []).filter((f) => Math.abs(f.time - ref.time) >= EPS));
    }
  }
  return next;
}

// Segment easing (compModel: the segment a→b is shaped by a.easing) as two flags:
// start = slow leaving a, end = slow arriving at b.
const flagsOf = (easing: CompEasing | undefined) => ({
  start: easing === 'ease-in' || easing === 'ease-in-out',
  end: easing === 'ease-out' || easing === 'ease-in-out',
});
const easingOf = (start: boolean, end: boolean): CompEasing => (start && end ? 'ease-in-out' : start ? 'ease-in' : end ? 'ease-out' : 'linear');

export type EaseKind = 'easy' | 'in' | 'out' | 'linear' | 'hold';

/**
 * F9 easy ease (both sides), Shift+F9 easy ease in (arrive slowly),
 * Cmd+Shift+F9 easy ease out (leave slowly), linear, Cmd+Alt+H hold toggle.
 */
export function applyEase(node: CompNode, refs: { prop: AePropId; time: number }[], kind: EaseKind): CompNode {
  let next: CompNode = node;
  for (const ref of refs) {
    for (const param of propDef(ref.prop).params) {
      const frames = [...(next.keyframes?.[param] ?? [])].sort((a, b) => a.time - b.time).map((f) => ({ ...f }));
      const i = frames.findIndex((f) => Math.abs(f.time - ref.time) < EPS);
      if (i < 0) continue;
      const cur = frames[i];
      const prev = i > 0 ? frames[i - 1] : null;
      const setEnd = (frame: CompKeyframe | null, end: boolean) => {
        if (!frame || frame.easing === 'hold') return;
        frame.easing = easingOf(flagsOf(frame.easing).start, end);
      };
      const setStart = (frame: CompKeyframe, start: boolean) => {
        const flags = frame.easing === 'hold' ? { start: false, end: false } : flagsOf(frame.easing);
        frame.easing = easingOf(start, flags.end);
      };
      if (kind === 'hold') cur.easing = cur.easing === 'hold' ? 'linear' : 'hold';
      else if (kind === 'easy') {
        setEnd(prev, true);
        setStart(cur, true);
      } else if (kind === 'in') setEnd(prev, true);
      else if (kind === 'out') setStart(cur, true);
      else {
        setEnd(prev, false);
        setStart(cur, false);
      }
      next = setFrames(next, param, frames);
    }
  }
  return next;
}

export type KeyShape = 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'hold';

/** Display shape of a keyframe: incoming / outgoing easing (diamond, hourglass, square). */
export function keyframeShape(node: CompNode, prop: AePropId, time: number): KeyShape {
  const param = propDef(prop).params[0];
  const frames = [...(node.keyframes?.[param] ?? [])].sort((a, b) => a.time - b.time);
  const i = frames.findIndex((f) => Math.abs(f.time - time) < EPS);
  if (i < 0) return 'linear';
  if (frames[i].easing === 'hold') return 'hold';
  const incoming = i > 0 && flagsOf(frames[i - 1].easing).end;
  const outgoing = flagsOf(frames[i].easing).start;
  return incoming && outgoing ? 'ease' : incoming ? 'ease-in' : outgoing ? 'ease-out' : 'linear';
}

/** Properties with keyframes (U). */
export const keyframedProps = (node: CompNode | null | undefined): AePropId[] => AE_PROPS.filter((p) => isPropAnimated(node, p.id)).map((p) => p.id);

/** Sorted keyframe times (plus optional extra times such as layer in/out) for J/K. */
export function collectKeyTimes(nodes: (CompNode | null | undefined)[], props: AePropId[] = AE_PROPS.map((p) => p.id)): number[] {
  const times: number[] = [];
  for (const node of nodes) for (const prop of props) for (const t of propKeyframeTimes(node, prop)) if (!times.some((x) => Math.abs(x - t) < EPS)) times.push(t);
  return times.sort((a, b) => a - b);
}

/** J (dir -1) / K (dir +1): nearest keyframe strictly before/after t, or null. */
export function adjacentTime(times: number[], t: number, dir: -1 | 1): number | null {
  const tolerance = 1e-4;
  if (dir > 0) return times.find((x) => x > t + tolerance) ?? null;
  for (let i = times.length - 1; i >= 0; i -= 1) if (times[i] < t - tolerance) return times[i];
  return null;
}

// ---------------------------------------------------------------- reveal (P/S/R/T/A/U, twirl)

export type RevealState = Record<string, AePropId[]>;

/** P/S/R/T/A: show only this property on the layers; Shift adds/removes it. */
export function revealProps(state: RevealState, layerIds: string[], props: AePropId[], additive: boolean): RevealState {
  const next: RevealState = { ...state };
  for (const id of layerIds) {
    if (!additive) {
      const current = state[id] ?? [];
      const same = current.length === props.length && props.every((p) => current.includes(p));
      next[id] = same ? [] : [...props];
      continue;
    }
    const current = new Set(state[id] ?? []);
    for (const p of props) {
      if (current.has(p)) current.delete(p);
      else current.add(p);
    }
    next[id] = AE_PROPS.map((p) => p.id).filter((p) => current.has(p));
  }
  return next;
}

// ---------------------------------------------------------------- viewer helpers

/** Pan Behind (Y): move the anchor without moving the image. Deltas in comp pixels. */
export function panBehind(params: Record<string, CompParamValue>, dxComp: number, dyComp: number): Record<string, number> {
  const s = num(params.scale, 1) || 1;
  const r = (num(params.rotation, 0) * Math.PI) / 180;
  // Inverse of rotate(r)·scale(s) applied to the comp-space delta.
  const cos = Math.cos(-r);
  const sin = Math.sin(-r);
  const lx = (dxComp * cos - dyComp * sin) / s;
  const ly = (dxComp * sin + dyComp * cos) / s;
  return {
    x: num(params.x) + dxComp,
    y: num(params.y) + dyComp,
    anchorX: num(params.anchorX) + lx,
    anchorY: num(params.anchorY) + ly,
  };
}

/** Comp-space corners of a layer (source rect in layer space, transformed like renderComp). */
export function layerCorners(
  params: Record<string, CompParamValue>,
  comp: Pick<Composition, 'width' | 'height'>,
  rect: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: comp.width, h: comp.height },
): { x: number; y: number }[] {
  const cx = comp.width / 2;
  const cy = comp.height / 2;
  const s = num(params.scale, 1);
  const r = (num(params.rotation, 0) * Math.PI) / 180;
  const map = (px: number, py: number) => {
    const lx = (px - cx - num(params.anchorX)) * s;
    const ly = (py - cy - num(params.anchorY)) * s;
    return { x: cx + num(params.x) + lx * Math.cos(r) - ly * Math.sin(r), y: cy + num(params.y) + lx * Math.sin(r) + ly * Math.cos(r) };
  };
  return [map(rect.x, rect.y), map(rect.x + rect.w, rect.y), map(rect.x + rect.w, rect.y + rect.h), map(rect.x, rect.y + rect.h)];
}

/**
 * Comp prepared for the viewer: solo (only solo layers render), optional
 * transparent background, and media source offsets (trim/split) encoded into
 * the media id for `wrapResolver`. Never stored — render only.
 */
export function prepareForRender(comp: Composition, options: { transparent?: boolean } = {}): Composition {
  const layers = layersOf(comp);
  const soloIds = new Set(layers.filter((l) => getNode(comp, l.sourceId)?.params[P_SOLO] === true).map((l) => l.sourceId));
  const sourceIds = new Set(layers.map((l) => l.sourceId));
  return {
    ...comp,
    background: options.transparent ? 'rgba(0,0,0,0)' : comp.background,
    nodes: comp.nodes.map((n) => {
      let node = n;
      if (soloIds.size && sourceIds.has(n.id) && !soloIds.has(n.id)) node = { ...node, enabled: false };
      const offset = num(n.params[P_OFFSET], 0);
      if (n.type === 'media' && n.mediaId && offset > EPS) node = { ...node, mediaId: `${n.mediaId}${OFFSET_SEP}${offset}` };
      return node;
    }),
  };
}

export const OFFSET_SEP = '@@ae-offset:';

export function wrapResolver<T>(resolve: (mediaId: string, t: number) => T): (mediaId: string, t: number) => T {
  return (mediaId, t) => {
    const at = mediaId.indexOf(OFFSET_SEP);
    if (at < 0) return resolve(mediaId, t);
    const offset = Number(mediaId.slice(at + OFFSET_SEP.length));
    return resolve(mediaId.slice(0, at), t + (Number.isFinite(offset) ? offset : 0));
  };
}

// ---------------------------------------------------------------- work area

export type TimeRange = { start: number; end: number };

export function setWorkArea(range: TimeRange, edge: 'start' | 'end', t: number, comp: Pick<Composition, 'fps' | 'durationSeconds'>): TimeRange {
  const fd = frameDuration(comp.fps);
  const time = clamp(snapToFrame(t, comp.fps), 0, comp.durationSeconds);
  if (edge === 'start') return { start: Math.min(time, range.end - fd), end: range.end };
  return { start: range.start, end: Math.max(time, range.start + fd) };
}

// ---------------------------------------------------------------- commands & shortcuts

export type AeToolId = 'selection' | 'hand' | 'zoom' | 'rotate' | 'anchor' | 'mask' | 'text';

export type AeCommandId =
  | 'transport.playToggle'
  | 'time.prevFrame'
  | 'time.nextFrame'
  | 'time.prev10'
  | 'time.next10'
  | 'time.start'
  | 'time.end'
  | 'time.prevKeyframe'
  | 'time.nextKeyframe'
  | 'time.layerIn'
  | 'time.layerOut'
  | 'workArea.start'
  | 'workArea.end'
  | 'layer.inToTime'
  | 'layer.outToTime'
  | 'layer.trimIn'
  | 'layer.trimOut'
  | 'layer.newSolid'
  | 'layer.newText'
  | 'layer.duplicate'
  | 'layer.split'
  | 'layer.forward'
  | 'layer.backward'
  | 'layer.front'
  | 'layer.back'
  | 'layer.precompose'
  | 'layer.maskEllipse'
  | 'layer.maskRect'
  | 'edit.delete'
  | 'edit.undo'
  | 'edit.redo'
  | 'select.all'
  | 'select.none'
  | 'select.above'
  | 'select.below'
  | 'reveal.anchor'
  | 'reveal.position'
  | 'reveal.scale'
  | 'reveal.rotation'
  | 'reveal.opacity'
  | 'reveal.keyframed'
  | 'key.anchor'
  | 'key.position'
  | 'key.scale'
  | 'key.rotation'
  | 'key.opacity'
  | 'ease.easy'
  | 'ease.in'
  | 'ease.out'
  | 'ease.linear'
  | 'ease.hold'
  | 'tool.selection'
  | 'tool.hand'
  | 'tool.zoom'
  | 'tool.rotate'
  | 'tool.anchor'
  | 'tool.mask'
  | 'tool.text'
  | 'view.zoomIn'
  | 'view.zoomOut'
  | 'timeline.zoomIn'
  | 'timeline.zoomOut'
  | 'comp.render';

export type AeCommand = { id: AeCommandId; label: string; menu: string; shortcut?: string };

/** One table for menus, shortcut hints and agent automation (window.avpeAeView.run). */
export const AE_COMMANDS: AeCommand[] = [
  { id: 'transport.playToggle', label: 'Wiedergabe / Stopp', menu: 'Vorschau', shortcut: 'Leertaste' },
  { id: 'time.prevFrame', label: 'Vorheriges Bild', menu: 'Vorschau', shortcut: 'Bild ↑' },
  { id: 'time.nextFrame', label: 'Nächstes Bild', menu: 'Vorschau', shortcut: 'Bild ↓' },
  { id: 'time.prev10', label: '10 Bilder zurück', menu: 'Vorschau', shortcut: '⇧ Bild ↑' },
  { id: 'time.next10', label: '10 Bilder vor', menu: 'Vorschau', shortcut: '⇧ Bild ↓' },
  { id: 'time.start', label: 'Zum Anfang', menu: 'Vorschau', shortcut: 'Pos1' },
  { id: 'time.end', label: 'Zum Ende', menu: 'Vorschau', shortcut: 'Ende' },
  { id: 'time.prevKeyframe', label: 'Vorheriger Keyframe', menu: 'Animation', shortcut: 'J' },
  { id: 'time.nextKeyframe', label: 'Nächster Keyframe', menu: 'Animation', shortcut: 'K' },
  { id: 'time.layerIn', label: 'Zum In-Point der Ebene', menu: 'Ebene', shortcut: 'I' },
  { id: 'time.layerOut', label: 'Zum Out-Point der Ebene', menu: 'Ebene', shortcut: 'O' },
  { id: 'workArea.start', label: 'Arbeitsbereich-Anfang setzen', menu: 'Komposition', shortcut: 'B' },
  { id: 'workArea.end', label: 'Arbeitsbereich-Ende setzen', menu: 'Komposition', shortcut: 'N' },
  { id: 'layer.inToTime', label: 'In-Point zur aktuellen Zeit verschieben', menu: 'Ebene', shortcut: '[' },
  { id: 'layer.outToTime', label: 'Out-Point zur aktuellen Zeit verschieben', menu: 'Ebene', shortcut: ']' },
  { id: 'layer.trimIn', label: 'In-Point auf aktuelle Zeit trimmen', menu: 'Ebene', shortcut: '⌥ [' },
  { id: 'layer.trimOut', label: 'Out-Point auf aktuelle Zeit trimmen', menu: 'Ebene', shortcut: '⌥ ]' },
  { id: 'layer.newSolid', label: 'Neu › Farbfläche …', menu: 'Ebene', shortcut: '⌘ Y' },
  { id: 'layer.newText', label: 'Neu › Text', menu: 'Ebene', shortcut: '⌥⇧⌘ T' },
  { id: 'layer.duplicate', label: 'Duplizieren', menu: 'Ebene', shortcut: '⌘ D' },
  { id: 'layer.split', label: 'Ebene teilen', menu: 'Ebene', shortcut: '⇧⌘ D' },
  { id: 'layer.forward', label: 'Ebene nach vorne', menu: 'Ebene', shortcut: '⌘ ]' },
  { id: 'layer.backward', label: 'Ebene nach hinten', menu: 'Ebene', shortcut: '⌘ [' },
  { id: 'layer.front', label: 'In den Vordergrund', menu: 'Ebene', shortcut: '⇧⌘ ]' },
  { id: 'layer.back', label: 'In den Hintergrund', menu: 'Ebene', shortcut: '⇧⌘ [' },
  { id: 'layer.maskEllipse', label: 'Neue Maske › Ellipse', menu: 'Ebene' },
  { id: 'layer.maskRect', label: 'Neue Maske › Rechteck', menu: 'Ebene' },
  { id: 'layer.precompose', label: 'Vorkomponieren … (nicht verfügbar)', menu: 'Ebene', shortcut: '⇧⌘ C' },
  { id: 'edit.delete', label: 'Löschen', menu: 'Bearbeiten', shortcut: '⌫' },
  { id: 'edit.undo', label: 'Rückgängig', menu: 'Bearbeiten', shortcut: '⌘ Z' },
  { id: 'edit.redo', label: 'Wiederholen', menu: 'Bearbeiten', shortcut: '⇧⌘ Z' },
  { id: 'select.all', label: 'Alle Ebenen auswählen', menu: 'Bearbeiten', shortcut: '⌘ A' },
  { id: 'select.none', label: 'Auswahl aufheben', menu: 'Bearbeiten', shortcut: 'F2' },
  { id: 'select.above', label: 'Ebene darüber auswählen', menu: 'Bearbeiten', shortcut: '⌘ ↑' },
  { id: 'select.below', label: 'Ebene darunter auswählen', menu: 'Bearbeiten', shortcut: '⌘ ↓' },
  { id: 'reveal.anchor', label: 'Ankerpunkt einblenden', menu: 'Animation', shortcut: 'A' },
  { id: 'reveal.position', label: 'Position einblenden', menu: 'Animation', shortcut: 'P' },
  { id: 'reveal.scale', label: 'Skalierung einblenden', menu: 'Animation', shortcut: 'S' },
  { id: 'reveal.rotation', label: 'Drehung einblenden', menu: 'Animation', shortcut: 'R' },
  { id: 'reveal.opacity', label: 'Deckkraft einblenden', menu: 'Animation', shortcut: 'T' },
  { id: 'reveal.keyframed', label: 'Animierte Eigenschaften einblenden', menu: 'Animation', shortcut: 'U' },
  { id: 'key.anchor', label: 'Keyframe: Ankerpunkt', menu: 'Animation', shortcut: '⌥⇧ A' },
  { id: 'key.position', label: 'Keyframe: Position', menu: 'Animation', shortcut: '⌥⇧ P' },
  { id: 'key.scale', label: 'Keyframe: Skalierung', menu: 'Animation', shortcut: '⌥⇧ S' },
  { id: 'key.rotation', label: 'Keyframe: Drehung', menu: 'Animation', shortcut: '⌥⇧ R' },
  { id: 'key.opacity', label: 'Keyframe: Deckkraft', menu: 'Animation', shortcut: '⌥⇧ T' },
  { id: 'ease.easy', label: 'Keyframe-Assistent › Easy Ease', menu: 'Animation', shortcut: 'F9' },
  { id: 'ease.in', label: 'Keyframe-Assistent › Easy Ease In', menu: 'Animation', shortcut: '⇧ F9' },
  { id: 'ease.out', label: 'Keyframe-Assistent › Easy Ease Out', menu: 'Animation', shortcut: '⇧⌘ F9' },
  { id: 'ease.linear', label: 'Keyframe-Interpolation › Linear', menu: 'Animation' },
  { id: 'ease.hold', label: 'Keyframe-Interpolation › Halten umschalten', menu: 'Animation', shortcut: '⌥⌘ H' },
  { id: 'tool.selection', label: 'Auswahl-Werkzeug', menu: 'Werkzeuge', shortcut: 'V' },
  { id: 'tool.hand', label: 'Hand-Werkzeug', menu: 'Werkzeuge', shortcut: 'H' },
  { id: 'tool.zoom', label: 'Zoom-Werkzeug', menu: 'Werkzeuge', shortcut: 'Z' },
  { id: 'tool.rotate', label: 'Drehen-Werkzeug', menu: 'Werkzeuge', shortcut: 'W' },
  { id: 'tool.anchor', label: 'Ausschnitt-dahinter-Werkzeug (Ankerpunkt)', menu: 'Werkzeuge', shortcut: 'Y' },
  { id: 'tool.mask', label: 'Form-/Masken-Werkzeug', menu: 'Werkzeuge', shortcut: 'Q' },
  { id: 'tool.text', label: 'Text-Werkzeug', menu: 'Werkzeuge', shortcut: '⌘ T' },
  { id: 'view.zoomIn', label: 'Ansicht vergrößern', menu: 'Ansicht', shortcut: '.' },
  { id: 'view.zoomOut', label: 'Ansicht verkleinern', menu: 'Ansicht', shortcut: ',' },
  { id: 'timeline.zoomIn', label: 'Zeitleiste einzoomen', menu: 'Ansicht', shortcut: '=' },
  { id: 'timeline.zoomOut', label: 'Zeitleiste auszoomen', menu: 'Ansicht', shortcut: '-' },
  { id: 'comp.render', label: 'Rendern → Medien', menu: 'Komposition', shortcut: '⌃⌘ M' },
];

export type KeyInput = { key: string; code?: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean };
export type ShortcutHit = { command: AeCommandId; additive?: boolean };

/**
 * Keyboard → command. Letters use `key` (layout-aware); with Alt pressed the
 * physical `code` is used (macOS turns Alt+P into "π"). Brackets accept both
 * the US key and the physical key (German layout: Ü / +).
 */
export function resolveAeShortcut(e: KeyInput): ShortcutHit | null {
  const meta = Boolean(e.metaKey || e.ctrlKey);
  const shift = Boolean(e.shiftKey);
  const alt = Boolean(e.altKey);
  const code = e.code ?? '';
  const rawKey = e.key ?? '';
  let letter = rawKey.length === 1 ? rawKey.toLowerCase() : '';
  if ((alt || !/^[a-z]$/.test(letter)) && /^Key[A-Z]$/.test(code)) letter = code.slice(3).toLowerCase();

  const bracket = code === 'BracketLeft' || rawKey === '[' ? '[' : code === 'BracketRight' || rawKey === ']' ? ']' : null;
  if (bracket) {
    const physicalAlt = alt && (code === 'BracketLeft' || code === 'BracketRight');
    if (meta) return { command: bracket === '[' ? (shift ? 'layer.back' : 'layer.backward') : shift ? 'layer.front' : 'layer.forward' };
    if (physicalAlt) return { command: bracket === '[' ? 'layer.trimIn' : 'layer.trimOut' };
    return { command: bracket === '[' ? 'layer.inToTime' : 'layer.outToTime' };
  }

  if (rawKey === ' ' || code === 'Space') return meta || alt ? null : { command: 'transport.playToggle' };
  if (rawKey === 'F9') return { command: meta && shift ? 'ease.out' : shift ? 'ease.in' : 'ease.easy' };
  if (rawKey === 'F2') return { command: 'select.none' };
  if (rawKey === 'PageUp') return { command: shift ? 'time.prev10' : 'time.prevFrame' };
  if (rawKey === 'PageDown') return { command: shift ? 'time.next10' : 'time.nextFrame' };
  if (rawKey === 'Home') return { command: 'time.start' };
  if (rawKey === 'End') return { command: 'time.end' };
  if (rawKey === 'ArrowLeft' && meta) return { command: shift ? 'time.prev10' : 'time.prevFrame' };
  if (rawKey === 'ArrowRight' && meta) return { command: shift ? 'time.next10' : 'time.nextFrame' };
  if (rawKey === 'ArrowUp' && meta) return { command: 'select.above' };
  if (rawKey === 'ArrowDown' && meta) return { command: 'select.below' };
  if (rawKey === 'Delete' || rawKey === 'Backspace') return meta ? null : { command: 'edit.delete' };
  if (!meta && !alt && (rawKey === '=' || rawKey === '+')) return { command: 'timeline.zoomIn' };
  if (!meta && !alt && rawKey === '-') return { command: 'timeline.zoomOut' };
  if (!meta && !alt && rawKey === '.') return { command: 'view.zoomIn' };
  if (!meta && !alt && rawKey === ',') return { command: 'view.zoomOut' };

  if (!letter) return null;
  if (meta) {
    if (letter === 'z') return { command: shift ? 'edit.redo' : 'edit.undo' };
    if (letter === 'd') return { command: shift ? 'layer.split' : 'layer.duplicate' };
    if (letter === 'y' && !shift && !alt) return { command: 'layer.newSolid' };
    if (letter === 't') return alt && shift ? { command: 'layer.newText' } : shift || alt ? null : { command: 'tool.text' };
    if (letter === 'a') return { command: shift ? 'select.none' : 'select.all' };
    if (letter === 'h' && alt) return { command: 'ease.hold' };
    if (letter === 'm' && e.ctrlKey && e.metaKey) return { command: 'comp.render' };
    return null;
  }
  const props: Record<string, AePropId> = { a: 'anchor', p: 'position', s: 'scale', r: 'rotation', t: 'opacity' };
  if (alt && shift && props[letter]) return { command: `key.${props[letter]}` as AeCommandId };
  if (alt) return null;
  if (props[letter]) return { command: `reveal.${props[letter]}` as AeCommandId, additive: shift };
  if (letter === 'u') return { command: 'reveal.keyframed', additive: shift };
  if (shift) return null;
  const simple: Record<string, AeCommandId> = {
    j: 'time.prevKeyframe',
    k: 'time.nextKeyframe',
    b: 'workArea.start',
    n: 'workArea.end',
    i: 'time.layerIn',
    o: 'time.layerOut',
    v: 'tool.selection',
    h: 'tool.hand',
    z: 'tool.zoom',
    w: 'tool.rotate',
    y: 'tool.anchor',
    q: 'tool.mask',
  };
  return simple[letter] ? { command: simple[letter] } : null;
}

// ---------------------------------------------------------------- serialisable UI state

export type AeUiState = {
  tool: AeToolId;
  maskShape: 'rectangle' | 'ellipse';
  resolution: 1 | 2 | 3 | 4;
  /** 0 = fit. */
  viewerZoom: number;
  showGrid: boolean;
  showSafe: boolean;
  transparency: boolean;
  /** Timeline pixels per second. */
  pxPerSecond: number;
  expanded: Record<string, boolean>;
  reveal: RevealState;
  showParentColumn: boolean;
  leftTab: 'project' | 'effectControls';
  timelineHeight: number;
};

export const DEFAULT_UI: AeUiState = {
  tool: 'selection',
  maskShape: 'rectangle',
  resolution: 2,
  viewerZoom: 0,
  showGrid: false,
  showSafe: false,
  transparency: false,
  pxPerSecond: 80,
  expanded: {},
  reveal: {},
  showParentColumn: false,
  leftTab: 'project',
  timelineHeight: 300,
};

/** Validates persisted UI state (localStorage is untrusted). */
export function sanitizeUi(raw: unknown): AeUiState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<AeUiState>;
  const tools: AeToolId[] = ['selection', 'hand', 'zoom', 'rotate', 'anchor', 'mask', 'text'];
  return {
    ...DEFAULT_UI,
    tool: tools.includes(r.tool as AeToolId) ? (r.tool as AeToolId) : DEFAULT_UI.tool,
    maskShape: r.maskShape === 'ellipse' ? 'ellipse' : 'rectangle',
    resolution: ([1, 2, 3, 4] as const).includes(r.resolution as 1) ? (r.resolution as AeUiState['resolution']) : DEFAULT_UI.resolution,
    viewerZoom: isNum(r.viewerZoom) ? clamp(r.viewerZoom, 0, 8) : 0,
    showGrid: r.showGrid === true,
    showSafe: r.showSafe === true,
    transparency: r.transparency === true,
    pxPerSecond: isNum(r.pxPerSecond) ? clamp(r.pxPerSecond, 5, 2000) : DEFAULT_UI.pxPerSecond,
    showParentColumn: r.showParentColumn === true,
    leftTab: r.leftTab === 'effectControls' ? 'effectControls' : 'project',
    timelineHeight: isNum(r.timelineHeight) ? clamp(r.timelineHeight, 140, 900) : DEFAULT_UI.timelineHeight,
  };
}
