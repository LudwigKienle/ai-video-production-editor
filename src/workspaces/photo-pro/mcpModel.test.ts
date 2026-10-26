import test from 'node:test';
import assert from 'node:assert/strict';

import { adjustmentFromArgs, describeLayers, layerPatchFromArgs, parseBlendMode, parseOpacity, resolveLayer } from './mcpModel.ts';
import { createDoc, makeAdjustmentLayer, makeRasterLayer, makeTextLayer } from './layers.ts';
import { defaultAdjustment } from './adjustments.ts';

const doc = () => createDoc('a.png', 100, 50, [
  makeRasterLayer('L1', 'Hintergrund', 'px-1', 100, 50),
  makeTextLayer('T1', 5, 5, { text: 'Hallo' }),
  makeAdjustmentLayer('A1', 'Belichtung 1', defaultAdjustment('exposure')),
]);

test('opacity and blend mode parsing', () => {
  assert.equal(parseOpacity(0.4), 0.4);
  assert.equal(parseOpacity(40), 0.4, 'values above 1 are percent');
  assert.equal(parseOpacity(-3), 0);
  assert.equal(parseBlendMode('multiply'), 'multiply');
  assert.equal(parseBlendMode('soft_light'), 'soft-light');
  assert.equal(parseBlendMode('Negativ multiplizieren'), 'screen');
  assert.throws(() => parseBlendMode('nope'), /Unknown blend mode/);
});

test('adjustment values merge with defaults and are validated', () => {
  assert.deepEqual(adjustmentFromArgs('exposure', { exposure: 1.5, junk: 3 }), { type: 'exposure', exposure: 1.5, offset: 0, gamma: 1 });
  const cb = adjustmentFromArgs('colorBalance', { midtones: [10, 0, -10] });
  assert.deepEqual((cb as any).midtones, [10, 0, -10]);
  assert.throws(() => adjustmentFromArgs('colorBalance', { midtones: [1, 2] }), /\[r, g, b\]/);
  assert.deepEqual((adjustmentFromArgs('curves', { points: [[0, 0], [128, 150], [255, 255]] }) as any).points[1], [128, 150]);
  assert.throws(() => adjustmentFromArgs('sharpen', {}), /Unknown adjustment type/);
});

test('layer patches respect kind and lock', () => {
  const d = doc();
  assert.deepEqual(layerPatchFromArgs(d.layers[0], { opacity: 50, blendMode: 'overlay', x: 3.6, visible: false }), { opacity: 0.5, blendMode: 'overlay', visible: false, x: 4 });
  assert.deepEqual(layerPatchFromArgs(d.layers[1], { text: 'Neu', fontSize: 40, align: 'center' }), { text: 'Neu', fontSize: 40, align: 'center' });
  assert.throws(() => layerPatchFromArgs(d.layers[0], { text: 'x' }), /not a text layer/);
  const adj = layerPatchFromArgs(d.layers[2], { adjustment: { gamma: 1.4 } }) as any;
  assert.equal(adj.adjustment.gamma, 1.4);
  const locked = { ...d.layers[0], locked: true };
  assert.throws(() => layerPatchFromArgs(locked, { opacity: 0.2 }), /locked/);
  assert.deepEqual(layerPatchFromArgs(locked, { locked: false }), { locked: false });
});

test('layer description lists top first and resolves the active layer', () => {
  const d = doc();
  const list = describeLayers(d);
  assert.deepEqual(list.map((l) => l.id), ['A1', 'T1', 'L1']);
  assert.equal(list[2].index, 0);
  assert.equal(resolveLayer(d, undefined).id, 'A1');
  assert.throws(() => resolveLayer(d, 'X'), /not found/);
});
