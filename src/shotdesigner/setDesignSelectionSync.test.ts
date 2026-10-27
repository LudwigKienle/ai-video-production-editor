import test from 'node:test';
import assert from 'node:assert/strict';

import { createSetDesignBus } from '../setdesign/bus.ts';
import { normalizeSetDesignState } from '../setdesign/sceneModel.ts';
import type { SetDesignState } from '../types.ts';
import { getSession, updateSession } from './session.ts';
import { connectSetDesignSelection } from './setDesignSelectionSync.ts';

test('Scene Map and Set Design share one selection', () => {
  const bus = createSetDesignBus();
  let scene: SetDesignState = normalizeSetDesignState(null);
  bus.attachHost({ getScene: () => scene, setScene: (next) => { scene = next; } });
  const ids = [...scene.assets, ...(scene.cameras || []), ...scene.lights].map((object) => object.id);
  assert.ok(ids.length >= 2, 'default set has a camera and a light');
  const disconnect = connectSetDesignSelection(bus);
  try {
    bus.run('select.set', { objects: [ids[0]], mode: 'replace' });
    assert.deepEqual(getSession().selection, [ids[0]], '3D → 2D');

    updateSession({ selection: [ids[1]] });
    assert.deepEqual(bus.getUi().selectedIds, [ids[1]], '2D → 3D');

    updateSession({ selection: ['only-in-2d'] });
    assert.deepEqual(bus.getUi().selectedIds, [], '2D-only ids are dropped in 3D');
  } finally {
    disconnect();
  }
  updateSession({ selection: [ids[0]] });
  assert.deepEqual(bus.getUi().selectedIds, [], 'no sync after disconnect');
});
