import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createHistoryState,
  pushHistoryState,
  redoHistoryState,
  resetHistoryState,
  undoHistoryState,
} from './historyState.ts';

type ReferenceStub = {
  id: string;
  type: 'character' | 'environment';
  name: string;
};

const references: ReferenceStub[] = [
  { id: 'char-1', type: 'character', name: 'Mara' },
  { id: 'env-1', type: 'environment', name: 'Harbor' },
];

test('undo restores a deleted reference card from a functional update', () => {
  let state = createHistoryState(references);

  state = pushHistoryState(state, (current) => current.filter((item) => item.id !== 'char-1'));

  assert.deepEqual(state.present.map((item) => item.id), ['env-1']);

  state = undoHistoryState(state);

  assert.deepEqual(state.present.map((item) => item.id), ['char-1', 'env-1']);
  assert.deepEqual(state.future[0].map((item) => item.id), ['env-1']);
});

test('redo reapplies the reference card deletion after undo', () => {
  let state = createHistoryState(references);

  state = pushHistoryState(state, references.filter((item) => item.id !== 'char-1'));
  state = undoHistoryState(state);
  state = redoHistoryState(state);

  assert.deepEqual(state.present.map((item) => item.id), ['env-1']);
  assert.equal(state.future.length, 0);
});

test('reset replaces the present state and clears undo history', () => {
  let state = createHistoryState(references);
  state = pushHistoryState(state, []);

  state = resetHistoryState([{ id: 'char-2', type: 'character', name: 'Noor' }]);

  assert.deepEqual(state.present.map((item) => item.id), ['char-2']);
  assert.equal(state.past.length, 0);
  assert.equal(state.future.length, 0);
});
