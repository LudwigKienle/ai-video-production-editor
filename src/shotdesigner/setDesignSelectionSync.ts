/**
 * Scene Map (2D camera plan) ↔ Set Design (3D set): one selection and one undo history.
 *
 * Selection:
 * Camera, person and asset ids are shared; ids that exist only in 2D are dropped
 * on the 3D side because `select.set` rejects unknown objects.
 */
import { setDesignBus, type SetDesignBus } from '../setdesign/bus.ts';
import type { SetDesignState } from '../types.ts';
import { bindSceneMapBridge, getBridge, setSceneMapCommitter, setSceneMapSelectionSync } from './session.ts';

export function connectSetDesignSelection(bus: SetDesignBus = setDesignBus): () => void {
  setSceneMapSelectionSync({
    read: () => bus.getUi().selectedIds,
    write: (ids) => {
      const scene = bus.getScene();
      const known = new Set([...scene.assets, ...(scene.cameras || []), ...scene.lights].map((object) => object.id));
      bus.run('select.set', { objects: ids.filter((id) => known.has(id)), mode: 'replace' });
    },
    subscribe: (listener) => bus.subscribe(listener),
  });
  return () => setSceneMapSelectionSync(null);
}

/**
 * Routes Scene Map edits through the set design bus, so 2D, 3D and MCP share one
 * undo/redo. The Scene Map reads the bus scene (it is ahead of React state right
 * after a write). Call after the Scene Map bridge is bound; returns the undo.
 */
export function connectSetDesignHistory(bus: SetDesignBus = setDesignBus): () => void {
  const original = getBridge();
  if (!original) return () => undefined;
  const bridge = { ...original, getSetDesign: () => (bus.hasHost() ? bus.getScene() : original.getSetDesign()) };
  bindSceneMapBridge(bridge);
  setSceneMapCommitter({
    commit: (stored, label) => bus.update(stored as unknown as SetDesignState, label),
    undo: () => bus.undo(),
    redo: () => bus.redo(),
    canUndo: () => bus.history().undo.length > 0,
    canRedo: () => bus.history().redo.length > 0,
  });
  return () => {
    setSceneMapCommitter(null);
    if (getBridge() === bridge) bindSceneMapBridge(original);
  };
}
