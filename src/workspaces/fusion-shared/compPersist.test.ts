import test from 'node:test';
import assert from 'node:assert/strict';

import { emptyStore, hashString, loadStore, parseStore, sanitizeComposition, saveStore, serializeStore, storageKeyFor, upsertComp } from './compPersist.ts';
import { createCompFromMedia, setRenderRange, arrangeNuke } from './compModelExt.ts';
import { getNode } from './compModel.ts';

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value), data };
};

test('storage key is per project and never contains the path', () => {
  const a = storageKeyFor('/projects/a');
  const b = storageKeyFor('/projects/b');
  assert.notEqual(a, b);
  assert.ok(!a.includes('projects'));
  assert.equal(storageKeyFor(null), storageKeyFor('  '));
  assert.equal(hashString('x'), hashString('x'));
});

test('store round-trips comps with render range and Nuke layout', () => {
  let comp = arrangeNuke(createCompFromMedia({ id: 'm', name: 'Shot', type: 'image' }));
  comp = setRenderRange(comp, { start: 1, end: 2 });
  const store = { ...emptyStore(), comps: [comp], activeId: comp.id, view: 'nuke' as const };
  const storage = memory();
  assert.ok(saveStore(storage, 'k', store));
  const loaded = loadStore(storage, 'k');
  assert.equal(loaded.view, 'nuke');
  assert.equal(loaded.activeId, comp.id);
  assert.deepEqual(loaded.comps[0].renderRange, { start: 1, end: 2 });
  assert.deepEqual(loaded.comps[0].layouts?.nuke, comp.layouts?.nuke);
  assert.deepEqual(loaded.comps[0].nodes.map((n) => n.id), comp.nodes.map((n) => n.id));
});

test('broken JSON and wrong shapes give an empty store', () => {
  assert.deepEqual(parseStore('{nope'), emptyStore());
  assert.deepEqual(parseStore('[]'), emptyStore());
  assert.deepEqual(loadStore({ getItem: () => { throw new Error('denied'); } }, 'k'), emptyStore());
  assert.equal(saveStore({ setItem: () => { throw new Error('quota'); } }, 'k', emptyStore()), false);
});

test('sanitizeComposition drops bad nodes, dangling inputs and recreates the output', () => {
  const comp = sanitizeComposition({
    id: 'c',
    nodes: [
      { id: 'a', type: 'media', params: { opacity: 'x', bad: { nested: true }, ok: 0.5 }, inputs: {} },
      { id: 'b', type: 'warp' },
      { id: 'm', type: 'merge', inputs: { bg: 'a', fg: 'ghost', extra: 'a' }, x: Infinity, keyframes: { opacity: [{ time: 1, value: 0 }, { time: 'x', value: 1 }] } },
      { id: 'a', type: 'solid' },
    ],
    fps: -5,
  })!;
  assert.deepEqual(comp.nodes.map((n) => n.id).slice(0, 2), ['a', 'm']);
  const merge = getNode(comp, 'm')!;
  assert.deepEqual(merge.inputs, { bg: 'a', fg: null, mask: null });
  assert.equal(merge.x, 0);
  assert.equal(merge.keyframes!.opacity.length, 1);
  assert.equal(getNode(comp, 'a')!.params.ok, 0.5);
  assert.equal(getNode(comp, 'a')!.params.bad, undefined);
  assert.equal(getNode(comp, comp.outputNodeId)!.type, 'output');
  assert.equal(comp.fps, 1);
  assert.equal(sanitizeComposition({ nodes: [] }), null);
});

test('parseStore falls back to the first comp when activeId is unknown; upsert replaces by id', () => {
  const comp = createCompFromMedia({ id: 'm', name: 'Shot', type: 'image' });
  const parsed = parseStore(serializeStore({ ...emptyStore(), comps: [comp], activeId: 'missing', view: 'xx' as never }));
  assert.equal(parsed.activeId, comp.id);
  assert.equal(parsed.view, 'fusion');
  const renamed = { ...comp, name: 'Neu' };
  assert.equal(upsertComp([comp], renamed)[0].name, 'Neu');
  assert.equal(upsertComp([comp], { ...comp, id: 'other' }).length, 2);
});
