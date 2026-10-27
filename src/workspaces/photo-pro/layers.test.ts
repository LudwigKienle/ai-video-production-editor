import test from 'node:test';
import assert from 'node:assert/strict';

import {
  blendToComposite, canMergeDown, copyName, createDoc, docPixelKeys, docReducer,
  makeAdjustmentLayer, makeRasterLayer, makeTextLayer, nextLayerName,
} from './layers.ts';
import type { PhotoDoc } from './layers.ts';
import { defaultAdjustment } from './adjustments.ts';

const bg = makeRasterLayer('L1', 'Hintergrund', 'px-1', 100, 50);
const base = (): PhotoDoc => createDoc('test.png', 100, 50, [bg]);

test('add inserts above the active layer and activates it', () => {
  let doc = base();
  doc = docReducer(doc, { type: 'add', layer: makeRasterLayer('L2', 'Ebene 1', 'px-2', 100, 50) });
  doc = docReducer(doc, { type: 'select', id: 'L1' });
  doc = docReducer(doc, { type: 'add', layer: makeTextLayer('T1', 10, 10) });
  assert.deepEqual(doc.layers.map((l) => l.id), ['L1', 'T1', 'L2']);
  assert.equal(doc.activeLayerId, 'T1');
});

test('remove picks the layer below as active and respects locks', () => {
  let doc = base();
  doc = docReducer(doc, { type: 'add', layer: makeRasterLayer('L2', 'Ebene 1', 'px-2', 100, 50) });
  doc = docReducer(doc, { type: 'remove', id: 'L2' });
  assert.deepEqual(doc.layers.map((l) => l.id), ['L1']);
  assert.equal(doc.activeLayerId, 'L1');
  const locked = docReducer(doc, { type: 'update', id: 'L1', patch: { locked: true } });
  assert.equal(docReducer(locked, { type: 'remove', id: 'L1' }), locked, 'locked layers are not deleted');
});

test('update returns the same doc for no-op patches and keeps kind/id', () => {
  const doc = base();
  assert.equal(docReducer(doc, { type: 'update', id: 'L1', patch: { opacity: 1 } }), doc);
  const next = docReducer(doc, { type: 'update', id: 'L1', patch: { opacity: 0.5, blendMode: 'multiply', id: 'X' } as any });
  assert.equal(next.layers[0].opacity, 0.5);
  assert.equal(next.layers[0].id, 'L1');
  assert.equal(next.layers[0].blendMode, 'multiply');
});

test('reorder and step keep the stack order consistent', () => {
  let doc = base();
  doc = docReducer(doc, { type: 'add', layer: makeRasterLayer('L2', 'A', 'px-2', 1, 1) });
  doc = docReducer(doc, { type: 'add', layer: makeRasterLayer('L3', 'B', 'px-3', 1, 1) });
  doc = docReducer(doc, { type: 'reorder', id: 'L3', toIndex: 0 });
  assert.deepEqual(doc.layers.map((l) => l.id), ['L3', 'L1', 'L2']);
  doc = docReducer(doc, { type: 'step', id: 'L3', delta: 1 });
  assert.deepEqual(doc.layers.map((l) => l.id), ['L1', 'L3', 'L2']);
  assert.equal(docReducer(doc, { type: 'step', id: 'L2', delta: 1 }), doc, 'top layer cannot go higher');
});

test('duplicate shares the immutable pixel key and names the copy', () => {
  let doc = base();
  doc = docReducer(doc, { type: 'duplicate', id: 'L1', newId: 'L9' });
  assert.deepEqual(doc.layers.map((l) => l.id), ['L1', 'L9']);
  assert.equal(doc.layers[1].name, 'Hintergrund Kopie');
  assert.equal((doc.layers[1] as any).pixelKey, 'px-1');
  assert.equal(copyName(doc, 'Hintergrund'), 'Hintergrund Kopie 2');
  assert.equal(doc.activeLayerId, 'L9');
});

test('replace (merge down / flatten) puts the result at the lowest position', () => {
  let doc = base();
  doc = docReducer(doc, { type: 'add', layer: makeRasterLayer('L2', 'A', 'px-2', 1, 1) });
  doc = docReducer(doc, { type: 'add', layer: makeAdjustmentLayer('A1', 'Belichtung 1', defaultAdjustment('exposure')) });
  assert.ok(canMergeDown(doc, 'A1'));
  assert.ok(!canMergeDown(doc, 'L1'), 'bottom layer has nothing below');
  const merged = makeRasterLayer('M', 'A', 'px-m', 100, 50);
  const next = docReducer(doc, { type: 'replace', ids: ['L2', 'A1'], layer: merged });
  assert.deepEqual(next.layers.map((l) => l.id), ['L1', 'M']);
  const flat = docReducer(doc, { type: 'replace', ids: doc.layers.map((l) => l.id), layer: merged });
  assert.deepEqual(flat.layers.map((l) => l.id), ['M']);
});

test('crop shifts raster and text layers and resizes the document', () => {
  let doc = base();
  doc = docReducer(doc, { type: 'add', layer: makeTextLayer('T1', 40, 30) });
  const cropped = docReducer(doc, { type: 'crop', rect: { x: 10, y: 5, width: 50, height: 20 } });
  assert.equal(cropped.width, 50);
  assert.equal(cropped.height, 20);
  assert.deepEqual([(cropped.layers[0] as any).x, (cropped.layers[0] as any).y], [-10, -5]);
  assert.deepEqual([(cropped.layers[1] as any).x, (cropped.layers[1] as any).y], [30, 25]);
  const expanded = docReducer(doc, { type: 'expand', left: 8, top: 8, right: 8, bottom: 8 });
  assert.equal(expanded.width, 116);
  assert.equal((expanded.layers[0] as any).x, 8);
});

test('selection keeps the previous one for "Erneut auswählen" and pixel keys are tracked', () => {
  let doc = base();
  const sel = { pixelKey: 'sel-1', bounds: { x: 0, y: 0, width: 10, height: 10 } };
  doc = docReducer(doc, { type: 'selection', selection: sel });
  doc = docReducer(doc, { type: 'selection', selection: null });
  assert.equal(doc.selection, null);
  assert.equal(doc.lastSelection, sel);
  assert.deepEqual([...docPixelKeys(doc)].sort(), ['px-1', 'sel-1']);
});

test('layer names count up and blend modes map to canvas operations', () => {
  let doc = base();
  assert.equal(nextLayerName(doc), 'Ebene 1');
  doc = docReducer(doc, { type: 'add', layer: makeRasterLayer('L2', 'Ebene 4', 'px-2', 1, 1) });
  assert.equal(nextLayerName(doc), 'Ebene 5');
  assert.equal(blendToComposite('normal'), 'source-over');
  assert.equal(blendToComposite('multiply'), 'multiply');
});
