import test from 'node:test';
import assert from 'node:assert/strict';

import { addNode, connect, createComposition, createNode, getNode } from '../fusion-shared/compModel.ts';
import { swapMergeInputs } from '../fusion-shared/compModelExt.ts';
import { blendToNukeOp, nukeClassName, nukeInputs, nukeLabelForPort, nukeOpToBlend, nukePortFor } from './nukeModel.ts';
import { BLUR_FX_ID, GRADE_FX_ID } from '../fusion-shared/nodeClass.ts';

test('Merge A/B map to fg/bg: "A over B" = foreground over background', () => {
  assert.equal(nukePortFor('A'), 'fg');
  assert.equal(nukePortFor('B'), 'bg');
  assert.equal(nukePortFor('mask'), 'mask');
  const merge = createNode('merge', { id: 'm' });
  assert.equal(nukeLabelForPort(merge, 'fg'), 'A');
  assert.equal(nukeLabelForPort(merge, 'bg'), 'B');
  assert.deepEqual(nukeInputs(merge).map((i) => i.label), ['B', 'A', 'mask']);
  assert.deepEqual(nukeInputs(createNode('media')), []);
});

test('connecting to A in the Nuke view is visible as fg everywhere; Shift+X swaps', () => {
  let comp = createComposition();
  comp = addNode(comp, createNode('merge', { id: 'm' }));
  comp = addNode(comp, createNode('text', { id: 'title' }));
  comp = addNode(comp, createNode('media', { id: 'plate' }));
  comp = connect(comp, 'title', 'm', nukePortFor('A'));
  comp = connect(comp, 'plate', 'm', nukePortFor('B'));
  assert.equal(getNode(comp, 'm')!.inputs.fg, 'title');
  comp = swapMergeInputs(comp, ['m']);
  assert.equal(getNode(comp, 'm')!.inputs.fg, 'plate');
});

test('class names: Read/Write/Grade/Blur/Dot/Radial', () => {
  assert.equal(nukeClassName(createNode('media')), 'Read');
  assert.equal(nukeClassName(createNode('output')), 'Write');
  assert.equal(nukeClassName(createNode('fx', { fxStack: [{ id: 'f', effectId: GRADE_FX_ID, enabled: true, params: {} }] })), 'Grade');
  assert.equal(nukeClassName(createNode('fx', { fxStack: [{ id: 'f', effectId: BLUR_FX_ID, enabled: true, params: {} }] })), 'Blur');
  assert.equal(nukeClassName(createNode('fx', { params: { _class: 'dot' } })), 'Dot');
  assert.equal(nukeClassName(createNode('fx', { fxStack: [{ id: 'f', effectId: 'other', enabled: true, params: {} }] })), 'OFX');
  assert.equal(nukeClassName(createNode('mask')), 'Radial');
  assert.equal(nukeClassName(createNode('mask', { params: { shape: 'rectangle' } })), 'Rectangle');
});

test('merge operations map to blend modes both ways', () => {
  assert.equal(blendToNukeOp('normal'), 'over');
  assert.equal(blendToNukeOp('add'), 'plus');
  assert.equal(nukeOpToBlend('max'), 'lighten');
  assert.equal(nukeOpToBlend('unknown'), 'normal');
});
