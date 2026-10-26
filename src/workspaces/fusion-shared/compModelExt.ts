/**
 * Extensions to the shared composition model (compModel.ts) used by the
 * Fusion-page shell and the Fusion / Nuke views. Pure functions only — every
 * op returns a new Composition, never mutates.
 *
 * Also defines optional, view-specific data that rides along on the
 * Composition object (`CompositionExt`): per-view node positions (the Nuke DAG
 * flows top → bottom, the Fusion flow left → right) and the render range.
 * compModel ops spread `...comp`, so these fields survive every edit.
 */
import type { CompEasing, CompKeyframe, CompNode, CompNodeType, Composition } from './compModel.ts';
import { NODE_PORTS, addNode, connect, createComposition, createNode, getNode, removeNode, setKeyframe, updateNode } from './compModel.ts';

export type NodePos = { x: number; y: number };
export type CompRange = { start: number; end: number };

export type CompositionExt = Composition & {
  /** Node positions per view that does not use node.x/y (Nuke DAG). */
  layouts?: { nuke?: Record<string, NodePos> };
  /** Render range in seconds (Fusion "render range", Nuke "frame range"). */
  renderRange?: CompRange;
};

/** Port that a node's "main" stream enters through (the pipe kept when the node is bypassed). */
export const MAIN_PORT: Record<CompNodeType, string | null> = {
  media: null,
  solid: null,
  text: null,
  transform: 'input',
  merge: 'bg',
  fx: 'input',
  mask: 'input',
  output: 'input',
};

export const isSourceType = (type: CompNodeType) => type === 'media' || type === 'solid' || type === 'text';

// ---------------------------------------------------------------- time

export const timeToFrame = (comp: Composition, time: number) => Math.round(time * Math.max(1, comp.fps));
export const frameToTime = (comp: Composition, frame: number) => frame / Math.max(1, comp.fps);
export const totalFrames = (comp: Composition) => Math.max(1, Math.round(comp.durationSeconds * Math.max(1, comp.fps)));

export function clampTime(comp: Composition, time: number): number {
  if (!Number.isFinite(time)) return 0;
  const last = Math.max(0, frameToTime(comp, totalFrames(comp) - 1));
  return Math.min(last, Math.max(0, time));
}

export function snapToFrame(comp: Composition, time: number): number {
  return frameToTime(comp, timeToFrame(comp, time));
}

export function getRenderRange(comp: Composition): CompRange {
  const ext = comp as CompositionExt;
  const last = Math.max(0, frameToTime(comp, totalFrames(comp) - 1));
  const range = ext.renderRange;
  if (!range || !Number.isFinite(range.start) || !Number.isFinite(range.end)) return { start: 0, end: last };
  const start = Math.min(last, Math.max(0, range.start));
  const end = Math.min(last, Math.max(start, range.end));
  return { start, end };
}

export function setRenderRange(comp: Composition, range: CompRange): CompositionExt {
  const start = Math.max(0, Math.min(range.start, range.end));
  const end = Math.max(start, range.start, range.end);
  return { ...(comp as CompositionExt), renderRange: { start, end } };
}

// ---------------------------------------------------------------- graph queries

export type PortRef = { nodeId: string; port: string };

/** Nodes (and ports) that read the output of `id`. */
export function consumersOf(comp: Composition, id: string): PortRef[] {
  const out: PortRef[] = [];
  for (const node of comp.nodes) for (const [port, src] of Object.entries(node.inputs)) if (src === id) out.push({ nodeId: node.id, port });
  return out;
}

/** First unconnected input port in port order (merge: bg → fg → mask). */
export function firstFreePort(node: CompNode): string | null {
  for (const port of NODE_PORTS[node.type]) if (!node.inputs[port]) return port;
  return null;
}

/** Connects `from` into the first free input of `to`; falls back to the main port. */
export function connectToFirstFree(comp: Composition, from: string, to: string): Composition {
  const target = getNode(comp, to);
  if (!target) return comp;
  const port = firstFreePort(target) ?? MAIN_PORT[target.type];
  return port ? connect(comp, from, to, port) : comp;
}

/** "Merge1", "Merge2" … — the first free `<base><n>` name. */
export function uniqueNodeName(comp: Composition, base: string): string {
  const names = new Set(comp.nodes.map((node) => node.name));
  for (let index = 1; index < 10000; index += 1) {
    const name = `${base}${index}`;
    if (!names.has(name)) return name;
  }
  return `${base}${Date.now().toString(36)}`;
}

// ---------------------------------------------------------------- graph edits

/** Swaps background and foreground of merge nodes (Fusion Ctrl+T, Nuke Shift+X). */
export function swapMergeInputs(comp: Composition, ids: string[]): Composition {
  let next = comp;
  for (const id of ids) {
    const node = getNode(next, id);
    if (!node || node.type !== 'merge') continue;
    next = updateNode(next, id, { inputs: { ...node.inputs, bg: node.inputs.fg ?? null, fg: node.inputs.bg ?? null } });
  }
  return next;
}

/** Toggles pass-through (bypass). If any of the nodes is active, all become bypassed. Output stays active. */
export function togglePassthrough(comp: Composition, ids: string[]): Composition {
  const nodes = ids.map((id) => getNode(comp, id)).filter((node): node is CompNode => Boolean(node) && node!.id !== comp.outputNodeId);
  if (!nodes.length) return comp;
  const enable = nodes.every((node) => !node.enabled);
  let next = comp;
  for (const node of nodes) next = updateNode(next, node.id, { enabled: enable });
  return next;
}

export function removeNodes(comp: Composition, ids: string[]): Composition {
  let next = comp;
  for (const id of ids) next = removeNode(next, id);
  const ext = next as CompositionExt;
  if (ext.layouts?.nuke) {
    const nuke = { ...ext.layouts.nuke };
    for (const id of ids) delete nuke[id];
    next = { ...ext, layouts: { ...ext.layouts, nuke } } as CompositionExt;
  }
  return next;
}

/**
 * Adds `node` downstream of `afterId` (Fusion/Nuke "add tool with a node
 * selected"): afterId feeds the new node's `port` (default: its main input)
 * and, with `rewire`, everything that read afterId now reads the new node.
 * Source nodes (no inputs) are just added.
 */
export function insertNodeAfter(
  comp: Composition,
  node: CompNode,
  afterId: string | null,
  options: { port?: string; rewire?: boolean } = {},
): Composition {
  let next = addNode(comp, node);
  const after = getNode(next, afterId);
  if (!after || after.id === comp.outputNodeId) return next;
  const port = options.port ?? MAIN_PORT[node.type];
  if (!port || !(port in node.inputs)) return next;
  const consumers = options.rewire === false ? [] : consumersOf(next, after.id).filter((ref) => ref.nodeId !== node.id);
  next = connect(next, after.id, node.id, port);
  for (const ref of consumers) next = connect(next, node.id, ref.nodeId, ref.port);
  return next;
}

/**
 * Masks: connect a shape node into the mask input of `targetId` when it is a
 * merge (Fusion "effect mask"); otherwise insert as a masking node.
 */
export function attachMask(comp: Composition, mask: CompNode, targetId: string | null): Composition {
  const target = getNode(comp, targetId);
  if (target?.type === 'merge') return connect(addNode(comp, mask), mask.id, target.id, 'mask');
  return insertNodeAfter(comp, mask, targetId);
}

/** Duplicates nodes; connections between duplicated nodes are kept, inputs from outside too. */
export function duplicateNodes(comp: Composition, ids: string[], offset: NodePos = { x: 30, y: 30 }): { comp: Composition; ids: string[] } {
  const map = new Map<string, string>();
  let next = comp;
  const copies: CompNode[] = [];
  for (const id of ids) {
    const node = getNode(comp, id);
    if (!node || node.id === comp.outputNodeId) continue;
    const copy = createNode(node.type, {
      ...structuredCloneSafe(node),
      id: undefined,
      name: uniqueNodeName({ ...next, nodes: [...next.nodes, ...copies] }, baseName(node.name)),
      x: node.x + offset.x,
      y: node.y + offset.y,
    });
    map.set(id, copy.id);
    copies.push(copy);
  }
  for (const copy of copies) {
    const inputs = Object.fromEntries(Object.entries(copy.inputs).map(([port, src]) => [port, src && map.has(src) ? map.get(src)! : src]));
    next = addNode(next, { ...copy, inputs });
  }
  return { comp: next, ids: copies.map((copy) => copy.id) };
}

const baseName = (name: string) => name.replace(/\d+$/, '') || 'Node';

const structuredCloneSafe = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// ---------------------------------------------------------------- keyframes

const EPS = 1e-4;

export function hasKeyframeAt(node: CompNode, param: string, time: number): boolean {
  return Boolean(node.keyframes?.[param]?.some((frame) => Math.abs(frame.time - time) < EPS));
}

export function isAnimated(node: CompNode, param: string): boolean {
  return Boolean(node.keyframes?.[param]?.length);
}

export function removeKeyframe(node: CompNode, param: string, time: number): CompNode {
  const frames = (node.keyframes?.[param] ?? []).filter((frame) => Math.abs(frame.time - time) >= EPS);
  const keyframes = { ...(node.keyframes ?? {}) };
  if (frames.length) keyframes[param] = frames;
  else delete keyframes[param];
  return { ...node, keyframes };
}

/** Keyframe diamond: adds a key with `value` at `time`, or removes the existing one. */
export function toggleKeyframe(node: CompNode, param: string, time: number, value: number, easing: CompEasing = 'linear'): CompNode {
  if (hasKeyframeAt(node, param, time)) {
    const next = removeKeyframe(node, param, time);
    // Last key removed: keep the value the param showed.
    return isAnimated(next, param) ? next : { ...next, params: { ...next.params, [param]: value } };
  }
  return setKeyframe(node, param, time, value, easing);
}

/** Editing an animated param sets a key at `time` (AE/Fusion/Nuke behaviour); a static param just changes. */
export function setParamAtTime(node: CompNode, param: string, time: number, value: number | string | boolean): CompNode {
  if (typeof value === 'number' && isAnimated(node, param)) return setKeyframe(node, param, time, value, keyAt(node, param, time)?.easing ?? 'linear');
  return { ...node, params: { ...node.params, [param]: value } };
}

const keyAt = (node: CompNode, param: string, time: number): CompKeyframe | undefined =>
  node.keyframes?.[param]?.find((frame) => Math.abs(frame.time - time) < EPS);

/** All keyframe times of a node (sorted, unique) — for ruler ticks. */
export function keyframeTimes(node: CompNode | undefined): number[] {
  if (!node?.keyframes) return [];
  const times: number[] = [];
  for (const frames of Object.values(node.keyframes)) for (const frame of frames) if (!times.some((t) => Math.abs(t - frame.time) < EPS)) times.push(frame.time);
  return times.sort((a, b) => a - b);
}

export function neighbourKeyframe(node: CompNode | undefined, time: number, direction: 1 | -1): number | null {
  const times = keyframeTimes(node);
  if (direction > 0) return times.find((t) => t > time + EPS) ?? null;
  for (let index = times.length - 1; index >= 0; index -= 1) if (times[index] < time - EPS) return times[index];
  return null;
}

// ---------------------------------------------------------------- layout

/**
 * Column (rank) of every node: distance from the output, measured along the
 * longest path — sources end up furthest left (LR) / top (TB). Nodes that do
 * not reach the output get ranks relative to their own sinks.
 */
export function nodeRanks(comp: Composition): Map<string, number> {
  const rank = new Map<string, number>();
  const consumers = new Map<string, string[]>();
  for (const node of comp.nodes) for (const src of Object.values(node.inputs)) if (src && getNode(comp, src)) consumers.set(src, [...(consumers.get(src) ?? []), node.id]);
  const visiting = new Set<string>();
  const depth = (id: string): number => {
    if (rank.has(id)) return rank.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const outs = consumers.get(id) ?? [];
    const value = outs.length ? Math.max(...outs.map((out) => depth(out) + 1)) : 0;
    visiting.delete(id);
    rank.set(id, value);
    return value;
  };
  for (const node of comp.nodes) depth(node.id);
  return rank;
}

export type LayoutOptions = { direction: 'lr' | 'tb'; spacingMain?: number; spacingCross?: number; origin?: NodePos };

/**
 * Auto-arrange: returns positions per node id. Main axis = flow direction
 * (columns by rank), cross axis = order within a column. Within a column
 * nodes are sorted by the cross position of what they feed, then by port
 * order (bg/B first), which keeps the main pipe straight.
 */
export function autoLayout(comp: Composition, options: LayoutOptions): Map<string, NodePos> {
  const mainGap = options.spacingMain ?? (options.direction === 'lr' ? 170 : 90);
  const crossGap = options.spacingCross ?? (options.direction === 'lr' ? 70 : 150);
  const origin = options.origin ?? { x: 0, y: 0 };
  const ranks = nodeRanks(comp);
  const maxRank = Math.max(0, ...ranks.values());
  // Loose nodes (nothing in, nothing out) go to the source column, below the rest.
  for (const node of comp.nodes) {
    const loose = node.id !== comp.outputNodeId && !Object.values(node.inputs).some(Boolean) && consumersOf(comp, node.id).length === 0;
    if (loose) ranks.set(node.id, maxRank);
  }
  const columns: string[][] = Array.from({ length: maxRank + 1 }, () => []);
  for (const node of comp.nodes) columns[ranks.get(node.id) ?? 0].push(node.id);

  const cross = new Map<string, number>();
  const portOrder = (port: string) => {
    const order = ['input', 'bg', 'fg', 'mask'];
    const index = order.indexOf(port);
    return index < 0 ? order.length : index;
  };
  // Rank 0 (sinks): output first, then others in existing order.
  columns[0].sort((a, b) => (a === comp.outputNodeId ? -1 : b === comp.outputNodeId ? 1 : 0));
  columns[0].forEach((id, index) => cross.set(id, index));
  for (let r = 1; r <= maxRank; r += 1) {
    const keyed = columns[r].map((id, index) => {
      const refs = consumersOf(comp, id).filter((ref) => cross.has(ref.nodeId));
      const score = refs.length ? Math.min(...refs.map((ref) => cross.get(ref.nodeId)! + portOrder(ref.port) * 0.01)) : 1e6 + index;
      return { id, score, index };
    });
    keyed.sort((a, b) => a.score - b.score || a.index - b.index);
    // Keep a node in line with its consumer when possible (straight main pipe).
    let cursor = -Infinity;
    for (const entry of keyed) {
      const wanted = entry.score >= 1e6 ? cursor + 1 : Math.floor(entry.score);
      const slot = Math.max(wanted, cursor + 1);
      cross.set(entry.id, slot);
      cursor = slot;
    }
  }
  const minCross = Math.min(0, ...cross.values());
  const positions = new Map<string, NodePos>();
  for (const node of comp.nodes) {
    const main = (maxRank - (ranks.get(node.id) ?? 0)) * mainGap;
    const side = ((cross.get(node.id) ?? 0) - minCross) * crossGap;
    positions.set(node.id, options.direction === 'lr' ? { x: origin.x + main, y: origin.y + side } : { x: origin.x + side, y: origin.y + main });
  }
  return positions;
}

/** Applies auto layout to node.x/y (Fusion flow). */
export function arrangeFlow(comp: Composition): Composition {
  const positions = autoLayout(comp, { direction: 'lr' });
  return { ...comp, nodes: comp.nodes.map((node) => ({ ...node, ...(positions.get(node.id) ?? {}) })) };
}

/** Nuke DAG position of a node: stored, else transposed from the Fusion flow position. */
export function nukePos(comp: Composition, node: CompNode): NodePos {
  const stored = (comp as CompositionExt).layouts?.nuke?.[node.id];
  if (stored && Number.isFinite(stored.x) && Number.isFinite(stored.y)) return stored;
  return { x: Math.round(node.y * 2), y: Math.round(node.x * 0.55) };
}

/** Inverse of the transposition above — gives nodes created in the Nuke view a sensible Fusion position. */
export const flowPosFromNuke = (pos: NodePos): NodePos => ({ x: Math.round(pos.y / 0.55), y: Math.round(pos.x / 2) });

export function setNukePositions(comp: Composition, positions: Map<string, NodePos> | Record<string, NodePos>): CompositionExt {
  const ext = comp as CompositionExt;
  const entries = positions instanceof Map ? [...positions.entries()] : Object.entries(positions);
  return { ...ext, layouts: { ...(ext.layouts ?? {}), nuke: { ...(ext.layouts?.nuke ?? {}), ...Object.fromEntries(entries) } } };
}

export function arrangeNuke(comp: Composition): CompositionExt {
  return setNukePositions(comp, autoLayout(comp, { direction: 'tb' }));
}

export function moveNodes(comp: Composition, deltas: Map<string, NodePos>): Composition {
  return { ...comp, nodes: comp.nodes.map((node) => (deltas.has(node.id) ? { ...node, x: deltas.get(node.id)!.x, y: deltas.get(node.id)!.y } : node)) };
}

// ---------------------------------------------------------------- creation

export type CompMediaSource = { id: string; name: string; type: 'video' | 'image' | 'audio'; duration?: number };

/** "Neue Komposition aus Clip": MediaIn1 → MediaOut1 (Resolve Fusion default comp). */
export function createCompFromMedia(
  media: CompMediaSource,
  options: { width?: number; height?: number; fps?: number; durationSeconds?: number } = {},
): CompositionExt {
  const fps = options.fps ?? 24;
  const duration = options.durationSeconds ?? (media.type === 'video' && media.duration && media.duration > 0 ? media.duration : 5);
  const base = createComposition({ name: media.name || 'Komposition', width: options.width ?? 1920, height: options.height ?? 1080, fps, durationSeconds: Math.max(1 / fps, duration) });
  const output = { ...base.nodes[0], name: 'MediaOut1', x: 220, y: 0 };
  const mediaIn = createNode('media', { name: 'MediaIn1', mediaId: media.id, x: 0, y: 0 });
  const comp: Composition = { ...base, nodes: [mediaIn, output] };
  return connect(comp, mediaIn.id, output.id, 'input') as CompositionExt;
}

export function createEmptyComp(name: string, options: { width?: number; height?: number; fps?: number; durationSeconds?: number } = {}): CompositionExt {
  const base = createComposition({ name, width: options.width, height: options.height, fps: options.fps, durationSeconds: options.durationSeconds });
  return { ...base, nodes: base.nodes.map((node) => (node.id === base.outputNodeId ? { ...node, name: 'MediaOut1', x: 220, y: 0 } : node)) };
}

/** True when the composition reads any video or animates anything (→ render a movie, else a still). */
export function compIsAnimated(comp: Composition, mediaTypeOf: (mediaId: string) => string | undefined): boolean {
  return comp.nodes.some(
    (node) =>
      (node.type === 'media' && node.mediaId && mediaTypeOf(node.mediaId) === 'video') ||
      Object.values(node.keyframes ?? {}).some((frames) => frames.length > 1) ||
      node.inPoint !== undefined ||
      node.outPoint !== undefined,
  );
}

/**
 * Fusion behaviour: adding a generator (Background, Text+, MediaIn) while a
 * node is selected merges it over that node — selected → Merge.bg, new
 * source → Merge.fg, and whatever read the selected node now reads the merge.
 */
export function addSourceWithMerge(comp: Composition, source: CompNode, selectedId: string | null, merge: CompNode): Composition {
  const selected = getNode(comp, selectedId);
  if (!selected || selected.id === comp.outputNodeId || !isSourceType(source.type) || merge.type !== 'merge') return addNode(comp, source);
  let next = insertNodeAfter(comp, merge, selected.id);
  next = addNode(next, source);
  return connect(next, source.id, merge.id, 'fg');
}
