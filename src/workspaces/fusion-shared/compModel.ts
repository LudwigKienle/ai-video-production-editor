/**
 * Shared composition model for the Fusion page. One document, three views:
 * node graph (Fusion style), node graph top-down (Nuke style) and layer
 * timeline (After Effects style). Views only call the pure operations below,
 * so a comp edited in one view looks the same in the others.
 *
 * Graph semantics: every node produces an RGBA image at time t. A `merge`
 * node composites `fg` over `bg` with a blend mode and opacity. The layer view
 * is a projection: layers are the source branches of a merge chain that ends
 * in the output node (bottom layer = first `bg`).
 */
import type { FxStack } from '../../fx/types.ts';

export type CompParamValue = number | string | boolean;
export type CompEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'hold';
export type CompKeyframe = { time: number; value: number; easing?: CompEasing };

export type CompNodeType = 'media' | 'solid' | 'text' | 'transform' | 'merge' | 'fx' | 'mask' | 'output';

export type CompBlendMode = 'normal' | 'screen' | 'multiply' | 'overlay' | 'soft-light' | 'add' | 'lighten' | 'darken' | 'difference';

export type CompNode = {
  id: string;
  type: CompNodeType;
  name: string;
  /** Node-graph position (Fusion/Nuke views). */
  x: number;
  y: number;
  enabled: boolean;
  /** Input port name → upstream node id. Ports: merge {bg, fg, mask}; transform/fx/mask/output {input}. */
  inputs: Record<string, string | null>;
  params: Record<string, CompParamValue>;
  /** Animated numeric params. */
  keyframes?: Record<string, CompKeyframe[]>;
  /** media nodes: MediaItem id. */
  mediaId?: string;
  /** fx nodes: GPU effect stack (Buckswood Post Plugins ports, primary grade …). */
  fxStack?: FxStack;
  /** Layer view: time range of the layer in seconds (media/solid/text). */
  inPoint?: number;
  outPoint?: number;
  /** Layer view: label colour. */
  color?: string;
};

export type Composition = {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  background: string;
  nodes: CompNode[];
  outputNodeId: string;
};

export const NODE_PORTS: Record<CompNodeType, string[]> = {
  media: [],
  solid: [],
  text: [],
  transform: ['input'],
  merge: ['bg', 'fg', 'mask'],
  fx: ['input'],
  mask: ['input'],
  output: ['input'],
};

/** Default params per node type (layer transform lives on the layer's merge/transform). */
export const NODE_DEFAULTS: Record<CompNodeType, Record<string, CompParamValue>> = {
  media: { opacity: 1 },
  solid: { color: '#3a3a3a', opacity: 1 },
  text: { text: 'Text', font: 'Inter', size: 96, color: '#ffffff', opacity: 1 },
  transform: { x: 0, y: 0, scale: 1, rotation: 0, anchorX: 0, anchorY: 0, opacity: 1 },
  merge: { blend: 'normal', opacity: 1 },
  fx: {},
  mask: { shape: 'ellipse', cx: 0.5, cy: 0.5, w: 0.5, h: 0.5, feather: 0.05, invert: false },
  output: {},
};

let counter = 0;
export const newId = (prefix = 'n') => `${prefix}-${Date.now().toString(36)}-${(counter += 1).toString(36)}`;

export function createNode(type: CompNodeType, init: Partial<CompNode> = {}): CompNode {
  return {
    id: init.id ?? newId(type),
    type,
    name: init.name ?? type.charAt(0).toUpperCase() + type.slice(1),
    x: init.x ?? 0,
    y: init.y ?? 0,
    enabled: init.enabled ?? true,
    inputs: { ...Object.fromEntries(NODE_PORTS[type].map((port) => [port, null])), ...(init.inputs ?? {}) },
    params: { ...NODE_DEFAULTS[type], ...(init.params ?? {}) },
    keyframes: init.keyframes,
    mediaId: init.mediaId,
    fxStack: init.fxStack,
    inPoint: init.inPoint,
    outPoint: init.outPoint,
    color: init.color,
  };
}

export function createComposition(init: Partial<Composition> = {}): Composition {
  const output = createNode('output', { id: 'output', name: 'MediaOut', x: 600, y: 0 });
  return {
    id: init.id ?? newId('comp'),
    name: init.name ?? 'Komposition 1',
    width: init.width ?? 1920,
    height: init.height ?? 1080,
    fps: init.fps ?? 24,
    durationSeconds: init.durationSeconds ?? 10,
    background: init.background ?? '#000000',
    nodes: init.nodes ?? [output],
    outputNodeId: init.outputNodeId ?? output.id,
  };
}

export const getNode = (comp: Composition, id: string | null | undefined) => (id ? comp.nodes.find((node) => node.id === id) : undefined);

export function updateNode(comp: Composition, id: string, patch: Partial<CompNode>): Composition {
  return { ...comp, nodes: comp.nodes.map((node) => (node.id === id ? { ...node, ...patch, params: { ...node.params, ...(patch.params ?? {}) } } : node)) };
}

export function addNode(comp: Composition, node: CompNode): Composition {
  return { ...comp, nodes: [...comp.nodes, node] };
}

/** Removes a node and reconnects its main input to whatever it fed (like deleting in Fusion/Nuke). */
export function removeNode(comp: Composition, id: string): Composition {
  if (id === comp.outputNodeId) return comp;
  const removed = getNode(comp, id);
  const passThrough = removed ? removed.inputs.input ?? removed.inputs.bg ?? null : null;
  return {
    ...comp,
    nodes: comp.nodes
      .filter((node) => node.id !== id)
      .map((node) => ({
        ...node,
        inputs: Object.fromEntries(Object.entries(node.inputs).map(([port, src]) => [port, src === id ? passThrough : src])),
      })),
  };
}

/** Would connecting `from` into `to` create a cycle? */
export function createsCycle(comp: Composition, from: string, to: string): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const current = stack.pop()!;
    if (current === to) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    const node = getNode(comp, current);
    if (node) for (const src of Object.values(node.inputs)) if (src) stack.push(src);
  }
  return false;
}

export function connect(comp: Composition, from: string | null, to: string, port: string): Composition {
  const target = getNode(comp, to);
  if (!target || !(port in target.inputs)) return comp;
  if (from && (from === to || createsCycle(comp, from, to))) return comp;
  return updateNode(comp, to, { inputs: { ...target.inputs, [port]: from } });
}

/** Topological order of the nodes that contribute to the output (upstream first). */
export function evaluationOrder(comp: Composition, rootId = comp.outputNodeId): string[] {
  const order: string[] = [];
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (id: string) => {
    if (done.has(id) || visiting.has(id)) return;
    visiting.add(id);
    const node = getNode(comp, id);
    if (node) for (const src of Object.values(node.inputs)) if (src) visit(src);
    visiting.delete(id);
    done.add(id);
    order.push(id);
  };
  visit(rootId);
  return order;
}

// ---------------------------------------------------------------- animation

const ease = (t: number, easing: CompEasing | undefined) => {
  switch (easing) {
    case 'ease-in':
      return t * t;
    case 'ease-out':
      return t * (2 - t);
    case 'ease-in-out':
      return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    case 'hold':
      return 0;
    default:
      return t;
  }
};

export function valueAt(frames: CompKeyframe[] | undefined, time: number, fallback: number): number {
  if (!frames || frames.length === 0) return fallback;
  const sorted = [...frames].sort((a, b) => a.time - b.time);
  if (time <= sorted[0].time) return sorted[0].value;
  const last = sorted[sorted.length - 1];
  if (time >= last.time) return last.value;
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (time >= a.time && time <= b.time) {
      const t = (time - a.time) / Math.max(1e-9, b.time - a.time);
      return a.value + (b.value - a.value) * ease(t, a.easing);
    }
  }
  return fallback;
}

/** Params of a node at time t (keyframed numbers resolved). */
export function paramsAt(node: CompNode, time: number): Record<string, CompParamValue> {
  const out: Record<string, CompParamValue> = { ...node.params };
  for (const [param, frames] of Object.entries(node.keyframes ?? {})) {
    const base = typeof node.params[param] === 'number' ? (node.params[param] as number) : 0;
    out[param] = valueAt(frames, time, base);
  }
  return out;
}

export function setKeyframe(node: CompNode, param: string, time: number, value: number, easing: CompEasing = 'linear'): CompNode {
  const frames = (node.keyframes?.[param] ?? []).filter((frame) => Math.abs(frame.time - time) > 1e-6);
  frames.push({ time, value, easing });
  frames.sort((a, b) => a.time - b.time);
  return { ...node, keyframes: { ...(node.keyframes ?? {}), [param]: frames } };
}

// ---------------------------------------------------------------- layer projection (After Effects view)

export type CompLayer = {
  /** Source node (media/solid/text). */
  sourceId: string;
  /** Optional transform node between source and merge. */
  transformId: string | null;
  /** Optional fx node chain between transform and merge (top → bottom order). */
  fxIds: string[];
  /** Merge node that composites this layer over the layers below; null for the bottom layer. */
  mergeId: string | null;
};

const upstream = (comp: Composition, id: string | null | undefined, port = 'input') => (id ? getNode(comp, id)?.inputs[port] ?? null : null);

/** Walks a branch from a merge input down to its source, collecting transform/fx nodes. */
function branch(comp: Composition, startId: string | null): Omit<CompLayer, 'mergeId'> | null {
  let current = startId;
  const fxIds: string[] = [];
  let transformId: string | null = null;
  while (current) {
    const node = getNode(comp, current);
    if (!node) return null;
    if (node.type === 'media' || node.type === 'solid' || node.type === 'text') return { sourceId: node.id, transformId, fxIds };
    if (node.type === 'transform' && !transformId) transformId = node.id;
    else if (node.type === 'fx' || node.type === 'mask' || node.type === 'transform') fxIds.push(node.id);
    else return null; // merges inside a branch = precomp, not a simple layer
    current = upstream(comp, current);
  }
  return null;
}

/**
 * Layers bottom → top. Supports the canonical shape the layer view creates:
 * output ← merge(bg: merge(...), fg: layer) ← … ← bottom layer.
 */
export function layersOf(comp: Composition): CompLayer[] {
  const layers: CompLayer[] = [];
  let current = upstream(comp, comp.outputNodeId);
  while (current) {
    const node = getNode(comp, current);
    if (!node) break;
    if (node.type === 'merge') {
      const fg = branch(comp, node.inputs.fg ?? null);
      if (fg) layers.unshift({ ...fg, mergeId: node.id });
      current = node.inputs.bg ?? null;
      continue;
    }
    const bottom = branch(comp, current);
    if (bottom) layers.unshift({ ...bottom, mergeId: null });
    break;
  }
  return layers;
}

/** Rebuilds the merge chain for a given bottom → top layer order (keeps each layer's nodes). */
export function setLayerOrder(comp: Composition, order: CompLayer[]): Composition {
  const layerTop = (layer: CompLayer) => layer.fxIds[0] ?? layer.transformId ?? layer.sourceId;
  let next = comp;
  // Reuse existing merges where possible.
  const merges = order.map((layer) => layer.mergeId).filter((id): id is string => Boolean(id));
  let mergePool = [...merges];
  let below: string | null = null;
  order.forEach((layer, index) => {
    if (index === 0) {
      below = layerTop(layer);
      return;
    }
    let mergeId = mergePool.shift();
    if (!mergeId) {
      const merge = createNode('merge', { name: `Merge ${index}`, x: 400, y: index * 80 });
      next = addNode(next, merge);
      mergeId = merge.id;
    }
    next = connect(next, below, mergeId, 'bg');
    next = connect(next, layerTop(layer), mergeId, 'fg');
    below = mergeId;
  });
  // Unused merges are removed.
  for (const leftover of mergePool) next = { ...next, nodes: next.nodes.filter((node) => node.id !== leftover) };
  mergePool = [];
  return connect(next, below, next.outputNodeId, 'input');
}

/** Adds a layer on top (media/solid/text source + transform), as the layer view does. */
export function addLayer(comp: Composition, source: CompNode): Composition {
  const transform = createNode('transform', { name: `${source.name} Transform`, x: source.x + 160, y: source.y });
  let next = addNode(addNode(comp, source), transform);
  next = connect(next, source.id, transform.id, 'input');
  const layers = layersOf(next);
  return setLayerOrder(next, [...layers, { sourceId: source.id, transformId: transform.id, fxIds: [], mergeId: null }]);
}
