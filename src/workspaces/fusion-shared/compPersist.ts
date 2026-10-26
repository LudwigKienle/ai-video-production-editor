/**
 * Persistence of Fusion-page compositions per project (localStorage).
 * Everything read back is validated: unknown node types are dropped, inputs
 * are limited to the node's ports and to existing nodes, numbers are finite,
 * and a missing output node is recreated — a broken store never crashes the
 * page.
 */
import type { CompKeyframe, CompNode, CompNodeType, Composition } from './compModel.ts';
import { NODE_DEFAULTS, NODE_PORTS, createNode } from './compModel.ts';
import type { CompositionExt, NodePos } from './compModelExt.ts';
import type { FusionViewId } from './viewProps.ts';

export const COMP_STORE_VERSION = 1;
const PREFIX = 'avpe.fusion.comps.v1';

export type CompStore = {
  version: typeof COMP_STORE_VERSION;
  comps: CompositionExt[];
  activeId: string | null;
  view: FusionViewId;
  /** ms timestamp of the last write (UI or MCP) — the newer copy wins. */
  savedAt?: number;
};

export const emptyStore = (): CompStore => ({ version: COMP_STORE_VERSION, comps: [], activeId: null, view: 'fusion' });

/** djb2 → base36; keeps keys short and avoids putting file paths into storage keys. */
export function hashString(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0;
  return (hash >>> 0).toString(36);
}

export function storageKeyFor(projectPath: string | null | undefined): string {
  const trimmed = (projectPath ?? '').trim();
  return `${PREFIX}:${trimmed ? hashString(trimmed) : 'unsaved'}`;
}

const NODE_TYPES = Object.keys(NODE_PORTS) as CompNodeType[];
const VIEWS: FusionViewId[] = ['fusion', 'ae', 'nuke'];

const isObj = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const str = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback);
const EASINGS = new Set(['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold']);

function sanitizeKeyframes(raw: unknown): Record<string, CompKeyframe[]> | undefined {
  if (!isObj(raw)) return undefined;
  const out: Record<string, CompKeyframe[]> = {};
  for (const [param, frames] of Object.entries(raw)) {
    if (!Array.isArray(frames)) continue;
    const clean = frames
      .filter((frame): frame is Record<string, unknown> => isObj(frame) && Number.isFinite(frame.time) && Number.isFinite(frame.value))
      .map((frame) => ({
        time: frame.time as number,
        value: frame.value as number,
        ...(typeof frame.easing === 'string' && EASINGS.has(frame.easing) ? { easing: frame.easing as CompKeyframe['easing'] } : {}),
      }))
      .sort((a, b) => a.time - b.time);
    if (clean.length) out[param] = clean;
  }
  return Object.keys(out).length ? out : undefined;
}

function sanitizeNode(raw: unknown): CompNode | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || !raw.id) return null;
  const type = raw.type as CompNodeType;
  if (!NODE_TYPES.includes(type)) return null;
  const params: CompNode['params'] = { ...NODE_DEFAULTS[type] };
  if (isObj(raw.params)) {
    for (const [key, value] of Object.entries(raw.params)) {
      if (typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) params[key] = value;
    }
  }
  const inputs: Record<string, string | null> = {};
  for (const port of NODE_PORTS[type]) {
    const src = isObj(raw.inputs) ? raw.inputs[port] : null;
    inputs[port] = typeof src === 'string' && src ? src : null;
  }
  return createNode(type, {
    id: raw.id,
    name: str(raw.name, type),
    x: finite(raw.x, 0),
    y: finite(raw.y, 0),
    enabled: raw.enabled !== false,
    inputs,
    params,
    keyframes: sanitizeKeyframes(raw.keyframes),
    mediaId: typeof raw.mediaId === 'string' ? raw.mediaId : undefined,
    fxStack: Array.isArray(raw.fxStack) ? (raw.fxStack.filter((entry) => isObj(entry) && typeof entry.effectId === 'string' && typeof entry.id === 'string') as CompNode['fxStack']) : undefined,
    inPoint: typeof raw.inPoint === 'number' && Number.isFinite(raw.inPoint) ? raw.inPoint : undefined,
    outPoint: typeof raw.outPoint === 'number' && Number.isFinite(raw.outPoint) ? raw.outPoint : undefined,
    color: typeof raw.color === 'string' ? raw.color : undefined,
  });
}

export function sanitizeComposition(raw: unknown): CompositionExt | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || !raw.id || !Array.isArray(raw.nodes)) return null;
  const seen = new Set<string>();
  let nodes = raw.nodes.map(sanitizeNode).filter((node): node is CompNode => {
    if (!node || seen.has(node.id)) return false;
    seen.add(node.id);
    return true;
  });
  let outputNodeId = typeof raw.outputNodeId === 'string' ? raw.outputNodeId : '';
  if (!nodes.some((node) => node.id === outputNodeId && node.type === 'output')) {
    const existing = nodes.find((node) => node.type === 'output');
    if (existing) outputNodeId = existing.id;
    else {
      const output = createNode('output', { id: seen.has('output') ? `output-${Date.now().toString(36)}` : 'output', name: 'MediaOut1', x: 600, y: 0 });
      nodes.push(output);
      outputNodeId = output.id;
    }
  }
  // Inputs may only reference existing nodes (self-references dropped).
  const ids = new Set(nodes.map((node) => node.id));
  nodes = nodes.map((node) => ({
    ...node,
    inputs: Object.fromEntries(Object.entries(node.inputs).map(([port, src]) => [port, src && ids.has(src) && src !== node.id ? src : null])),
  }));
  const fps = Math.min(240, Math.max(1, finite(raw.fps, 24)));
  const comp: CompositionExt = {
    id: raw.id,
    name: str(raw.name, 'Komposition'),
    width: Math.round(Math.min(8192, Math.max(16, finite(raw.width, 1920)))),
    height: Math.round(Math.min(8192, Math.max(16, finite(raw.height, 1080)))),
    fps,
    durationSeconds: Math.min(3600, Math.max(1 / fps, finite(raw.durationSeconds, 10))),
    background: str(raw.background, '#000000'),
    nodes,
    outputNodeId,
  };
  if (isObj(raw.renderRange) && Number.isFinite(raw.renderRange.start) && Number.isFinite(raw.renderRange.end)) {
    comp.renderRange = { start: raw.renderRange.start as number, end: raw.renderRange.end as number };
  }
  if (isObj(raw.layouts) && isObj(raw.layouts.nuke)) {
    const nuke: Record<string, NodePos> = {};
    for (const [id, pos] of Object.entries(raw.layouts.nuke)) {
      if (ids.has(id) && isObj(pos) && Number.isFinite(pos.x) && Number.isFinite(pos.y)) nuke[id] = { x: pos.x as number, y: pos.y as number };
    }
    comp.layouts = { nuke };
  }
  return comp;
}

export function parseStore(raw: string | null | undefined): CompStore {
  if (!raw) return emptyStore();
  try {
    const data = JSON.parse(raw) as unknown;
    if (!isObj(data) || !Array.isArray(data.comps)) return emptyStore();
    const comps = data.comps.map(sanitizeComposition).filter((comp): comp is CompositionExt => Boolean(comp));
    const activeId = typeof data.activeId === 'string' && comps.some((comp) => comp.id === data.activeId) ? data.activeId : comps[0]?.id ?? null;
    const view = VIEWS.includes(data.view as FusionViewId) ? (data.view as FusionViewId) : 'fusion';
    const savedAt = typeof data.savedAt === 'number' && Number.isFinite(data.savedAt) ? data.savedAt : undefined;
    return { version: COMP_STORE_VERSION, comps, activeId, view, ...(savedAt !== undefined ? { savedAt } : {}) };
  } catch {
    return emptyStore();
  }
}

export const serializeStore = (store: CompStore): string => JSON.stringify(store);

type ReadStorage = Pick<Storage, 'getItem'>;
type WriteStorage = Pick<Storage, 'setItem'>;

export function loadStore(storage: ReadStorage | null | undefined, key: string): CompStore {
  try {
    return parseStore(storage?.getItem(key) ?? null);
  } catch {
    return emptyStore();
  }
}

export function saveStore(storage: WriteStorage | null | undefined, key: string, store: CompStore): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, serializeStore(store));
    return true;
  } catch {
    return false;
  }
}

/** Replaces (or appends) a comp in a list by id. */
export const upsertComp = (comps: CompositionExt[], comp: Composition): CompositionExt[] =>
  comps.some((entry) => entry.id === comp.id) ? comps.map((entry) => (entry.id === comp.id ? (comp as CompositionExt) : entry)) : [...comps, comp as CompositionExt];

/** Validates a store object that did not come from JSON (e.g. MCP project extras). */
export function storeFromUnknown(raw: unknown): CompStore | null {
  if (!isObj(raw) || !Array.isArray(raw.comps)) return null;
  try {
    return parseStore(JSON.stringify(raw));
  } catch {
    return null;
  }
}

/** The more recently saved of two stores (missing timestamps count as oldest). */
export const newerStore = (a: CompStore | null, b: CompStore | null): CompStore => {
  if (!a) return b ?? emptyStore();
  if (!b) return a;
  return (b.savedAt ?? 0) > (a.savedAt ?? 0) ? b : a;
};
