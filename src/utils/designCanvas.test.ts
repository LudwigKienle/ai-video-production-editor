import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addDesignElement,
  createDefaultDesignState,
  duplicateDesignElement,
  moveDesignElementLayer,
  resolveDesignPreset,
} from './designCanvas.ts';

test('createDefaultDesignState creates a named canvas preset', () => {
  const state = createDefaultDesignState('9:16');

  assert.equal(state.preset, '9:16');
  assert.equal(state.width, 1080);
  assert.equal(state.height, 1920);
  assert.equal(state.elements.length, 0);
});

test('addDesignElement appends an unlocked visible layer with stable defaults', () => {
  const state = createDefaultDesignState('16:9');
  const next = addDesignElement(state, {
    type: 'text',
    name: 'Headline',
    text: 'Launch film',
  });

  assert.equal(next.elements.length, 1);
  assert.equal(next.selectedElementId, next.elements[0].id);
  assert.equal(next.elements[0].name, 'Headline');
  assert.equal(next.elements[0].visible, true);
  assert.equal(next.elements[0].locked, false);
  assert.equal(next.elements[0].zIndex, 1);
});

test('duplicateDesignElement offsets the copy and selects it above the source layer', () => {
  const state = addDesignElement(createDefaultDesignState('1:1'), {
    id: 'hero',
    type: 'shape',
    name: 'Hero block',
    shape: 'rect',
    x: 100,
    y: 100,
    zIndex: 4,
  });

  const next = duplicateDesignElement(state, 'hero');
  const copy = next.elements.find((element) => element.id !== 'hero');

  assert.ok(copy);
  assert.equal(copy?.name, 'Hero block copy');
  assert.equal(copy?.x, 124);
  assert.equal(copy?.y, 124);
  assert.equal(copy?.zIndex, 5);
  assert.equal(next.selectedElementId, copy?.id);
});

test('moveDesignElementLayer reorders layers without changing element count', () => {
  let state = createDefaultDesignState('4:5');
  state = addDesignElement(state, { id: 'back', type: 'shape', name: 'Back', zIndex: 1 });
  state = addDesignElement(state, { id: 'front', type: 'shape', name: 'Front', zIndex: 2 });

  const next = moveDesignElementLayer(state, 'back', 'front');

  assert.equal(next.elements.length, 2);
  assert.deepEqual(next.elements.map((element) => [element.id, element.zIndex]), [
    ['front', 1],
    ['back', 2],
  ]);
});

test('resolveDesignPreset falls back to 16:9 for unknown presets', () => {
  assert.deepEqual(resolveDesignPreset('unknown'), resolveDesignPreset('16:9'));
});
