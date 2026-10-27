import test from 'node:test';
import assert from 'node:assert/strict';

import { canRedo, canUndo, commit, createHistory, currentState, dropOldest, jumpTo, redo, undo } from './history.ts';

test('commit, undo, redo and branch truncation', () => {
  let h = createHistory('a', 'Öffnen', 10, 0);
  h = commit(h, 'b', 'Pinsel', { now: 10 });
  h = commit(h, 'c', 'Radiergummi', { now: 20 });
  assert.equal(currentState(h), 'c');
  h = undo(h);
  assert.equal(currentState(h), 'b');
  assert.ok(canRedo(h));
  h = redo(h);
  assert.equal(currentState(h), 'c');
  h = jumpTo(h, 0);
  assert.equal(currentState(h), 'a');
  assert.ok(!canUndo(h));
  h = commit(h, 'd', 'Text', { now: 30 });
  assert.deepEqual(h.entries.map((e) => e.state), ['a', 'd'], 'future states are dropped');
});

test('identical state is not recorded; coalescing merges quick slider changes', () => {
  let h = createHistory({ v: 1 }, 'Öffnen', 10, 0);
  const s = currentState(h);
  assert.equal(commit(h, s, 'noop'), h);
  h = commit(h, { v: 2 }, 'Deckkraft', { coalesceKey: 'op:L1', now: 100 });
  h = commit(h, { v: 3 }, 'Deckkraft', { coalesceKey: 'op:L1', now: 400 });
  assert.equal(h.entries.length, 2);
  assert.deepEqual(currentState(h), { v: 3 });
  h = commit(h, { v: 4 }, 'Deckkraft', { coalesceKey: 'op:L1', now: 5000 });
  assert.equal(h.entries.length, 3, 'outside the window a new entry is created');
});

test('limit and memory trimming never drop the current state', () => {
  let h = createHistory(0, 'Öffnen', 3, 0);
  for (let i = 1; i <= 5; i += 1) h = commit(h, i, `S${i}`, { now: i * 10000 });
  assert.deepEqual(h.entries.map((e) => e.state), [3, 4, 5]);
  h = dropOldest(h, 10);
  assert.deepEqual(h.entries.map((e) => e.state), [5]);
  assert.equal(currentState(h), 5);
});
