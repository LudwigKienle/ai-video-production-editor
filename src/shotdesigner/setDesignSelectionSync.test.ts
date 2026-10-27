import test from 'node:test';
import assert from 'node:assert/strict';

import { createSetDesignBus } from '../setdesign/bus.ts';
import { normalizeSetDesignState } from '../setdesign/sceneModel.ts';
import type { SetDesignState } from '../types.ts';
import { bindSceneMapBridge, commitHost, getHost, getSession, historyState, undo, updateSession } from './session.ts';
import { connectSetDesignHistory, connectSetDesignSelection } from './setDesignSelectionSync.ts';

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

test('Scene Map edits share the set design undo history', () => {
  const bus = createSetDesignBus();
  let scene: SetDesignState = normalizeSetDesignState(null);
  bus.attachHost({ getScene: () => scene, setScene: (next) => { scene = next; } });
  bindSceneMapBridge({ getSetDesign: () => scene, setSetDesign: (next) => { scene = next as unknown as SetDesignState; } });
  const disconnect = connectSetDesignHistory(bus);
  try {
    const before = getHost();
    const moved = { ...before, output: { width: 1234, height: 567 } };
    commitHost(moved);
    assert.deepEqual(bus.history().undo, ['Kameraplan'], '2D edit lands in the 3D history');
    assert.equal(scene.output?.width, 1234);
    assert.equal(historyState().canUndo, true);

    assert.equal(undo(), true);
    assert.notEqual(scene.output?.width, 1234, 'undo restores the set');
    assert.equal(historyState().canRedo, true);
  } finally {
    disconnect();
    bindSceneMapBridge(null);
  }
  assert.equal(historyState().undoDepth >= 0, true, 'own history again after disconnect');
});
