/**
 * Shared Scene Map session: the UI and the MCP tools read and write the same playhead, selection,
 * view toggles and undo history, and reach project state through one bridge that App.tsx binds.
 * Serialisable, no React dependency.
 */
import type { ReferenceItem, SceneMapState, SetDesignState, ShotPrompt } from '../types';
import { ensureHost, toStoredHost, type StageHost } from './planModel.ts';
import { runBlockingBatch, runBlockingCommand, type CommandResult } from './commands.ts';
import type { StageState } from '../scene/stageModel.ts';

export type SceneMapView = 'plan' | 'overview' | '3d';
export type SceneMapTool = 'select' | 'wall' | 'element' | 'character' | 'camera' | 'pan';

export type SceneMapSession = {
  view: SceneMapView;
  timeS: number;
  playing: boolean;
  speed: number;
  selection: string[];
  selectedKeyId: string | null;
  tool: SceneMapTool;
  elementCategory: string;
  showCones: boolean;
  showPaths: boolean;
  showGrid: boolean;
  showLabels: boolean;
  showFrames: boolean;
  bottomTab: 'timeline' | 'shots';
};

export type SceneMapBridge = {
  getSetDesign: () => SetDesignState | StageHost | null | undefined;
  setSetDesign: (next: StageHost) => void;
  getShotPrompts?: () => ShotPrompt[];
  setShotPrompts?: (next: ShotPrompt[]) => void;
  getReferences?: () => ReferenceItem[];
  getSceneMap?: () => SceneMapState | null | undefined;
  setSceneMap?: (next: SceneMapState) => void;
  getProjectPath?: () => string | null | undefined;
  getProjectName?: () => string;
  openSceneMap?: () => void;
};

const DEFAULT_SESSION: SceneMapSession = {
  view: 'plan', timeS: 0, playing: false, speed: 1, selection: [], selectedKeyId: null, tool: 'select', elementCategory: 'table',
  showCones: true, showPaths: true, showGrid: true, showLabels: true, showFrames: true, bottomTab: 'timeline',
};

let session: SceneMapSession = { ...DEFAULT_SESSION };
const listeners = new Set<() => void>();
let bridge: SceneMapBridge | null = null;
let lastBase: unknown = undefined;
let lastApplied: StageHost | null = null;
const past: StageHost[] = [];
const future: StageHost[] = [];
const HISTORY_LIMIT = 100;
/**
 * Optional shared history: after merging with the 3D set design, wire its command bus here, e.g.
 *   setSceneMapCommitter({ commit: (doc, label) => setDesignBus.update(doc, label),
 *                          undo: () => setDesignBus.undo(), redo: () => setDesignBus.redo(),
 *                          canUndo: () => setDesignBus.history().undo.length > 0,
 *                          canRedo: () => setDesignBus.history().redo.length > 0 });
 * Then 2D, 3D and MCP share one undo/redo. Without it the Scene Map keeps its own history.
 */
export type SceneMapCommitter = {
  commit: (stored: StageHost, label: string) => void;
  undo?: () => unknown;
  redo?: () => unknown;
  canUndo?: () => boolean;
  canRedo?: () => boolean;
};
let committer: SceneMapCommitter | null = null;
export const setSceneMapCommitter = (next: SceneMapCommitter | null) => { committer = next; };

const emit = () => listeners.forEach((l) => { try { l(); } catch { /* listener errors never break commands */ } });

export const getSession = () => session;
export const subscribeSession = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const updateSession = (patch: Partial<SceneMapSession>) => {
  const selectionChanged = patch.selection !== undefined && patch.selection !== session.selection;
  session = { ...session, ...patch };
  if (selectionChanged && selectionSync && !syncingSelection) {
    try { selectionSync.write(session.selection); } catch { /* the 3D side may not know a 2D-only id */ }
  }
  emit();
};

/**
 * Optional shared selection with the 3D set design (after the merge), e.g.
 *   setSceneMapSelectionSync({
 *     read: () => setDesignBus.getUi().selectedIds,
 *     // select.set throws on unknown ids: keep only objects that exist in the set.
 *     write: (ids) => {
 *       const scene = setDesignBus.getScene();
 *       const known = new Set([...scene.assets, ...(scene.cameras || []), ...scene.lights].map((o) => o.id));
 *       setDesignBus.run('select.set', { objects: ids.filter((id) => known.has(id)), mode: 'replace' });
 *     },
 *     subscribe: (fn) => setDesignBus.subscribe(fn),
 *   });
 * Camera, person and asset ids are the same in 2D and 3D, so no mapping is needed.
 */
export type SceneMapSelectionSync = { read: () => string[]; write: (ids: string[]) => void; subscribe: (listener: () => void) => () => void };
let selectionSync: SceneMapSelectionSync | null = null;
let selectionUnsub: (() => void) | null = null;
let syncingSelection = false;
export const setSceneMapSelectionSync = (next: SceneMapSelectionSync | null) => {
  selectionUnsub?.();
  selectionUnsub = null;
  selectionSync = next;
  if (!next) return;
  const pull = () => {
    let ids: string[] = [];
    try { ids = next.read() || []; } catch { return; }
    if (ids.length === session.selection.length && ids.every((id, i) => id === session.selection[i])) return;
    syncingSelection = true;
    try { updateSession({ selection: [...ids], selectedKeyId: null }); } finally { syncingSelection = false; }
  };
  selectionUnsub = next.subscribe(pull);
  pull();
};
export const resetSession = () => {
  setSceneMapSelectionSync(null); session = { ...DEFAULT_SESSION }; past.length = 0; future.length = 0; lastApplied = null; lastBase = undefined; emit(); };

export const bindSceneMapBridge = (next: SceneMapBridge | null) => { bridge = next; };
export const getBridge = () => bridge;

const requireBridge = () => {
  if (!bridge) throw new Error('Scene Map ist nicht mit dem Projekt verbunden (App lädt noch).');
  return bridge;
};

/** Latest host, including a change applied before React re-rendered. */
export const getHost = (): StageHost & { stage: StageState } => {
  const fromApp = requireBridge().getSetDesign();
  if (lastApplied && fromApp === lastBase) return ensureHost(lastApplied);
  return ensureHost(fromApp as StageHost);
};

const apply = (next: StageHost, recordHistory = true) => {
  const b = requireBridge();
  const base = b.getSetDesign();
  if (recordHistory) {
    past.push(getHost());
    if (past.length > HISTORY_LIMIT) past.shift();
    future.length = 0;
  }
  const stored = toStoredHost(ensureHost(next), base);
  lastBase = base;
  lastApplied = ensureHost(next);
  if (committer) committer.commit(stored, 'Kameraplan');
  else b.setSetDesign(stored);
  emit();
};

/** Apply a whole new host (e.g. after a drag) as one undo step. */
export const commitHost = (next: StageHost) => apply(next);

const clampTime = (t: number) => {
  const d = getHost().stage.animation.durationS;
  return Math.max(0, Math.min(d, Number.isFinite(t) ? t : 0));
};

/** Run one command against the project; ok results are applied with undo. */
export const dispatch = (id: string, params: Record<string, unknown> = {}): CommandResult => {
  const host = getHost();
  const out = runBlockingCommand(host, id, params, session.timeS);
  if (out.ok && out.host) {
    apply(out.host);
    if (out.select) updateSession({ selection: out.select, selectedKeyId: null });
  }
  return out;
};

export const dispatchBatch = (commands: Array<{ command: string; params?: Record<string, unknown> }>) => {
  const out = runBlockingBatch(getHost(), commands, session.timeS);
  if (out.ok && out.host) {
    apply(out.host);
    if (out.select) updateSession({ selection: out.select });
  }
  return out;
};

export const undo = (): boolean => {
  if (committer?.undo) { const before = getHost(); lastApplied = null; committer.undo(); emit(); return getHost() !== before; }
  const prev = past.pop();
  if (!prev) return false;
  future.push(getHost());
  apply(prev, false);
  return true;
};

export const redo = (): boolean => {
  if (committer?.redo) { const before = getHost(); lastApplied = null; committer.redo(); emit(); return getHost() !== before; }
  const next = future.pop();
  if (!next) return false;
  past.push(getHost());
  apply(next, false);
  return true;
};

export const historyState = () => (committer?.canUndo
  ? { canUndo: committer.canUndo(), canRedo: committer.canRedo?.() ?? false, undoDepth: -1 }
  : { canUndo: past.length > 0, canRedo: future.length > 0, undoDepth: past.length });

export const setTime = (t: number) => updateSession({ timeS: clampTime(t) });

// Automation handle in the renderer (same commands as the UI and MCP; serialisable UI state).
if (typeof window !== 'undefined') {
  (window as unknown as { __avpeSceneMap?: unknown }).__avpeSceneMap = { getSession, historyState, getHost: () => getHost(), dispatch, dispatchBatch, updateSession };
}
