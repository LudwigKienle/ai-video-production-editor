/**
 * The set design command bus: runs commands from commands.ts against the scene document held
 * by the app (React state, saved with the project) and the shared UI state, keeps undo/redo,
 * and lets a mounted viewport add capabilities (real bounds, aspect, frame capture).
 *
 * One bus exists per window (`setDesignBus`), so the workspace UI and the MCP tools see the
 * same selection, camera view and history even when the workspace is not on screen.
 */
import type { SetDesignState } from '../types';
import {
  DEFAULT_UI_STATE,
  getCommand,
  type CommandServices,
  type SetDesignUiState,
} from './commands.ts';
import { makeSceneId, normalizeSetDesignState } from './sceneModel.ts';

export type SceneHost = {
  getScene: () => SetDesignState | null;
  setScene: (next: SetDesignState) => void;
};

export type HistoryEntry = { label: string; scene: SetDesignState };

export type RunResult = { ok: true; result: unknown } ;

const HISTORY_LIMIT = 100;

export const createSetDesignBus = (options: { makeId?: (prefix: string) => string } = {}) => {
  let host: SceneHost | null = null;
  /** Scene written by the last run, until the host's React state has caught up. */
  let pending: SetDesignState | null = null;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let ui: SetDesignUiState = { ...DEFAULT_UI_STATE, overlays: { ...DEFAULT_UI_STATE.overlays } };
  const undoStack: HistoryEntry[] = [];
  const redoStack: HistoryEntry[] = [];
  const listeners = new Set<() => void>();
  let services: CommandServices = {};
  /** App-level actions with side effects (frame capture into media/shots), shared by UI and agents. */
  const actions = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
  let interaction: HistoryEntry | null = null;
  let version = 0;
  const makeId = options.makeId || makeSceneId;

  const notify = () => {
    version += 1;
    for (const listener of [...listeners]) listener();
  };

  let lastRaw: SetDesignState | null | undefined;
  let lastNormalized: SetDesignState | null = null;
  /** The current scene, normalized once per stored object so identity checks stay meaningful. */
  const getScene = (): SetDesignState => {
    const raw = pending || host?.getScene() || null;
    if (lastNormalized && raw === lastRaw) return lastNormalized;
    lastRaw = raw;
    lastNormalized = normalizeSetDesignState(raw);
    return lastNormalized;
  };

  const writeScene = (next: SetDesignState) => {
    pending = next;
    if (pendingTimer) clearTimeout(pendingTimer);
    // React applies the update on its next render; keep our copy until then.
    pendingTimer = setTimeout(() => { pending = null; pendingTimer = null; }, 50);
    host?.setScene(next);
  };

  const pushUndo = (entry: HistoryEntry) => {
    undoStack.push(entry);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack.length = 0;
  };

  /** Drop selection entries that no longer exist. */
  const pruneSelection = (scene: SetDesignState, next: SetDesignUiState): SetDesignUiState => {
    const existing = new Set([...scene.assets, ...(scene.cameras || []), ...scene.lights].map((o) => o.id));
    const selectedIds = next.selectedIds.filter((id) => existing.has(id));
    const activeId = next.activeId && existing.has(next.activeId) ? next.activeId : null;
    return selectedIds.length === next.selectedIds.length && activeId === next.activeId ? next : { ...next, selectedIds, activeId };
  };

  const bus = {
    attachHost(next: SceneHost) {
      host = next;
      return () => { if (host === next) host = null; };
    },
    hasHost: () => !!host,
    inInteraction: () => !!interaction,
    getScene,
    getUi: () => ui,
    getVersion: () => version,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    /** Called by the mounted viewport; returns a detach function. */
    provideServices(next: CommandServices) {
      services = { ...services, ...next };
      return () => {
        for (const key of Object.keys(next) as Array<keyof CommandServices>) {
          if (services[key] === next[key]) delete services[key];
        }
      };
    },
    provideAction(name: string, fn: (args: Record<string, unknown>) => Promise<unknown>) {
      actions.set(name, fn);
      return () => { if (actions.get(name) === fn) actions.delete(name); };
    },
    async callAction(name: string, args: Record<string, unknown> = {}) {
      const fn = actions.get(name);
      if (!fn) throw new Error(`${name} is not available right now.`);
      return fn(args);
    },
    hasAction: (name: string) => actions.has(name),
    setUi(patch: Partial<SetDesignUiState>) {
      ui = pruneSelection(getScene(), { ...ui, ...patch });
      notify();
    },
    /** Run a command by id. Throws with a readable message on bad arguments. */
    run(id: string, args: Record<string, unknown> = {}): unknown {
      if (id === 'edit.undo') return bus.undo();
      if (id === 'edit.redo') return bus.redo();
      const command = getCommand(id);
      if (!command) throw new Error(`Unknown set design command: ${id}. Use setdesign_list_commands.`);
      for (const key of command.required || []) {
        if (args[key] === undefined || args[key] === null || args[key] === '') throw new Error(`${id} needs ${key}.`);
      }
      const before = getScene();
      const outcome = command.run({ scene: before, ui, makeId, services }, args || {});
      if (outcome.scene && outcome.scene !== before) {
        // Inside an interaction (slider drag) the whole gesture is one undo step.
        if (outcome.undoable !== false && !interaction) pushUndo({ label: command.label, scene: before });
        writeScene(outcome.scene);
      }
      if (outcome.ui) ui = { ...ui, ...outcome.ui };
      ui = pruneSelection(outcome.scene || before, ui);
      notify();
      return outcome.result ?? { ok: true };
    },
    /** Start a continuous edit (gizmo drag, slider): one undo step for the whole gesture. */
    beginInteraction(label: string) {
      interaction = { label, scene: getScene() };
    },
    /** Write the scene directly (during an interaction or from legacy UI code). */
    update(next: SetDesignState, label?: string) {
      if (!interaction && label) pushUndo({ label, scene: getScene() });
      writeScene(next);
      notify();
    },
    endInteraction(commit = true) {
      if (!interaction) return;
      const start = interaction;
      interaction = null;
      if (!commit) { writeScene(start.scene); notify(); return; }
      if (getScene() !== start.scene) pushUndo(start);
      notify();
    },
    undo() {
      const entry = undoStack.pop();
      if (!entry) return { undone: null };
      redoStack.push({ label: entry.label, scene: getScene() });
      writeScene(entry.scene);
      ui = pruneSelection(entry.scene, ui);
      notify();
      return { undone: entry.label };
    },
    redo() {
      const entry = redoStack.pop();
      if (!entry) return { redone: null };
      undoStack.push({ label: entry.label, scene: getScene() });
      writeScene(entry.scene);
      ui = pruneSelection(entry.scene, ui);
      notify();
      return { redone: entry.label };
    },
    history: () => ({ undo: undoStack.map((entry) => entry.label), redo: redoStack.map((entry) => entry.label) }),
    /** Forget history (new project opened). */
    reset() {
      undoStack.length = 0;
      redoStack.length = 0;
      pending = null;
      ui = { ...DEFAULT_UI_STATE, overlays: { ...DEFAULT_UI_STATE.overlays }, workspaceTab: ui.workspaceTab };
      notify();
    },
  };
  return bus;
};

export type SetDesignBus = ReturnType<typeof createSetDesignBus>;

/** One bus per window, also across hot reloads (UI and MCP tools must share it). */
const globalScope = globalThis as unknown as { __avpeSetDesignBus?: SetDesignBus };
export const setDesignBus: SetDesignBus = globalScope.__avpeSetDesignBus || (globalScope.__avpeSetDesignBus = createSetDesignBus());
