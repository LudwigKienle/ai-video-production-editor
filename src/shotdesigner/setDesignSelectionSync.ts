/**
 * One selection for the 2D camera plan (Scene Map) and the 3D set (Set Design).
 * Camera, person and asset ids are shared; ids that exist only in 2D are dropped
 * on the 3D side because `select.set` rejects unknown objects.
 */
import { setDesignBus, type SetDesignBus } from '../setdesign/bus.ts';
import { setSceneMapSelectionSync } from './session.ts';

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
