import test from 'node:test';
import assert from 'node:assert/strict';

import { addNode, connect, createComposition, createNode, getNode, layersOf } from './compModel.ts';
import {
  arrangeNuke,
  attachMask,
  autoLayout,
  clampTime,
  compIsAnimated,
  connectToFirstFree,
  consumersOf,
  createCompFromMedia,
  duplicateNodes,
  getRenderRange,
  insertNodeAfter,
  keyframeTimes,
  neighbourKeyframe,
  nodeRanks,
  nukePos,
  removeNodes,
  setParamAtTime,
  setRenderRange,
  swapMergeInputs,
  toggleKeyframe,
  togglePassthrough,
  uniqueNodeName,
} from './compModelExt.ts';
import { createHistory, pushHistory, redoHistory, undoHistory } from './compHistory.ts';

const chain = () => {
  let comp = createComposition();
  const bg = createNode('media', { id: 'bg', name: 'MediaIn1', mediaId: 'm1' });
  const fg = createNode('text', { id: 'fg', name: 'Text1' });
  const merge = createNode('merge', { id: 'mrg', name: 'Merge1' });
  comp = addNode(addNode(addNode(comp, bg), fg), merge);
  comp = connect(comp, 'bg', 'mrg', 'bg');
  comp = connect(comp, 'fg', 'mrg', 'fg');
  comp = connect(comp, 'mrg', comp.outputNodeId, 'input');
  return comp;
};

test('createCompFromMedia wires MediaIn1 → MediaOut1 and takes the clip duration', () => {
  const comp = createCompFromMedia({ id: 'clip', name: 'Shot 010', type: 'video', duration: 3.5 }, { fps: 25 });
  assert.equal(comp.name, 'Shot 010');
  assert.equal(comp.durationSeconds, 3.5);
  assert.equal(comp.fps, 25);
  const output = getNode(comp, comp.outputNodeId)!;
  const mediaIn = getNode(comp, output.inputs.input)!;
  assert.equal(mediaIn.type, 'media');
  assert.equal(mediaIn.mediaId, 'clip');
  assert.equal(mediaIn.name, 'MediaIn1');
  assert.ok(compIsAnimated(comp, () => 'video'));
  assert.ok(!compIsAnimated(comp, () => 'image'));
});

test('swapMergeInputs exchanges bg and fg (Ctrl+T / Shift+X)', () => {
  const swapped = swapMergeInputs(chain(), ['mrg']);
  assert.equal(getNode(swapped, 'mrg')!.inputs.bg, 'fg');
  assert.equal(getNode(swapped, 'mrg')!.inputs.fg, 'bg');
  // Non-merge ids are ignored.
  const base = chain();
  assert.equal(swapMergeInputs(base, ['bg']), base);
});

test('togglePassthrough bypasses all selected nodes, then re-enables; output is never bypassed', () => {
  let comp = togglePassthrough(chain(), ['mrg', 'fg']);
  assert.equal(getNode(comp, 'mrg')!.enabled, false);
  assert.equal(getNode(comp, 'fg')!.enabled, false);
  comp = togglePassthrough(comp, ['mrg']);
  assert.equal(getNode(comp, 'mrg')!.enabled, true);
  comp = togglePassthrough(comp, [comp.outputNodeId]);
  assert.equal(getNode(comp, comp.outputNodeId)!.enabled, true);
});

test('insertNodeAfter puts the new node into the pipe and rewires consumers', () => {
  const blur = createNode('fx', { id: 'blur', name: 'Blur1', fxStack: [] });
  const comp = insertNodeAfter(chain(), blur, 'mrg');
  assert.equal(getNode(comp, 'blur')!.inputs.input, 'mrg');
  assert.equal(getNode(comp, comp.outputNodeId)!.inputs.input, 'blur');
  assert.deepEqual(consumersOf(comp, 'mrg'), [{ nodeId: 'blur', port: 'input' }]);
  // A new merge takes the selected node as background (main input).
  const merge = createNode('merge', { id: 'm2' });
  const withMerge = insertNodeAfter(comp, merge, 'blur');
  assert.equal(getNode(withMerge, 'm2')!.inputs.bg, 'blur');
  assert.equal(getNode(withMerge, withMerge.outputNodeId)!.inputs.input, 'm2');
  // Source tools are only added.
  const solid = createNode('solid', { id: 's' });
  const withSolid = insertNodeAfter(comp, solid, 'mrg');
  assert.equal(consumersOf(withSolid, 's').length, 0);
});

test('attachMask connects shapes to a merge mask input, otherwise inserts', () => {
  const mask = createNode('mask', { id: 'ell' });
  const comp = attachMask(chain(), mask, 'mrg');
  assert.equal(getNode(comp, 'mrg')!.inputs.mask, 'ell');
  const masked = attachMask(chain(), createNode('mask', { id: 'ell2' }), 'fg');
  assert.equal(getNode(masked, 'ell2')!.inputs.input, 'fg');
  assert.equal(getNode(masked, 'mrg')!.inputs.fg, 'ell2');
});

test('connectToFirstFree fills merge ports in bg → fg → mask order', () => {
  let comp = createComposition();
  comp = addNode(comp, createNode('merge', { id: 'm' }));
  comp = addNode(comp, createNode('solid', { id: 'a' }));
  comp = addNode(comp, createNode('solid', { id: 'b' }));
  comp = connectToFirstFree(comp, 'a', 'm');
  comp = connectToFirstFree(comp, 'b', 'm');
  assert.equal(getNode(comp, 'm')!.inputs.bg, 'a');
  assert.equal(getNode(comp, 'm')!.inputs.fg, 'b');
});

test('removeNodes reconnects the main pipe and cleans Nuke positions', () => {
  let comp = arrangeNuke(chain());
  comp = removeNodes(comp, ['mrg']) as typeof comp;
  assert.equal(getNode(comp, comp.outputNodeId)!.inputs.input, 'bg');
  assert.equal(comp.layouts?.nuke?.mrg, undefined);
});

test('uniqueNodeName and duplicateNodes', () => {
  const comp = chain();
  assert.equal(uniqueNodeName(comp, 'Merge'), 'Merge2');
  const dup = duplicateNodes(comp, ['mrg', 'fg']);
  assert.equal(dup.ids.length, 2);
  const mergeCopy = dup.comp.nodes.find((n) => n.id === dup.ids[0])!;
  assert.equal(mergeCopy.name, 'Merge2');
  // Internal link fg → mrg is mapped to the copies, external bg stays.
  assert.equal(mergeCopy.inputs.fg, dup.ids[1]);
  assert.equal(mergeCopy.inputs.bg, 'bg');
});

test('auto layout LR: sources left of merge, merge left of output, main pipe straight', () => {
  const positions = autoLayout(chain(), { direction: 'lr' });
  const out = positions.get('output')!;
  const mrg = positions.get('mrg')!;
  const bg = positions.get('bg')!;
  const fg = positions.get('fg')!;
  assert.ok(bg.x < mrg.x && mrg.x < out.x);
  assert.equal(bg.x, fg.x);
  assert.equal(mrg.y, out.y);
  assert.equal(bg.y, mrg.y, 'background pipe stays in line');
  assert.ok(fg.y > bg.y);
  const ranks = nodeRanks(chain());
  assert.equal(ranks.get('output'), 0);
  assert.equal(ranks.get('bg'), 2);
});

test('auto layout TB: flow goes top → bottom; loose nodes go to the source row', () => {
  let comp = chain();
  comp = addNode(comp, createNode('solid', { id: 'loose' }));
  const positions = autoLayout(comp, { direction: 'tb' });
  assert.ok(positions.get('bg')!.y < positions.get('mrg')!.y);
  assert.ok(positions.get('mrg')!.y < positions.get('output')!.y);
  assert.equal(positions.get('loose')!.y, positions.get('bg')!.y);
  const arranged = arrangeNuke(comp);
  assert.deepEqual(nukePos(arranged, getNode(arranged, 'mrg')!), positions.get('mrg'));
});

test('keyframe diamond toggles and animated params key on edit', () => {
  let node = createNode('transform', { id: 't' });
  node = toggleKeyframe(node, 'x', 0, 10);
  assert.equal(node.keyframes!.x.length, 1);
  node = setParamAtTime(node, 'x', 1, 50);
  assert.equal(node.keyframes!.x.length, 2);
  assert.deepEqual(keyframeTimes(node), [0, 1]);
  assert.equal(neighbourKeyframe(node, 0, 1), 1);
  assert.equal(neighbourKeyframe(node, 1, -1), 0);
  assert.equal(neighbourKeyframe(node, 1, 1), null);
  node = toggleKeyframe(node, 'x', 1, 50);
  node = toggleKeyframe(node, 'x', 0, 10);
  assert.equal(node.keyframes!.x, undefined);
  assert.equal(node.params.x, 10, 'value kept after the last key is removed');
  // Static param edit does not create keys.
  node = setParamAtTime(node, 'y', 2, 5);
  assert.equal(node.params.y, 5);
  assert.equal(node.keyframes!.y, undefined);
});

test('render range is clamped to the comp and time helpers clamp', () => {
  const comp = createComposition({ fps: 10, durationSeconds: 2 });
  assert.deepEqual(getRenderRange(comp), { start: 0, end: 1.9 });
  const ranged = setRenderRange(comp, { start: 1.5, end: 0.5 });
  assert.deepEqual(getRenderRange(ranged), { start: 0.5, end: 1.5 });
  assert.equal(clampTime(comp, 99), 1.9);
  assert.equal(clampTime(comp, -1), 0);
});

test('layer projection still reads the graph after ext ops', () => {
  const comp = insertNodeAfter(chain(), createNode('fx', { id: 'gr', fxStack: [] }), 'fg');
  const layers = layersOf(comp);
  assert.equal(layers.length, 2);
  assert.deepEqual(layers[1].fxIds, ['gr']);
});

test('history coalesces slider drags and supports undo/redo', () => {
  let h = createHistory(1);
  h = pushHistory(h, 2, { key: 'x', now: 0 });
  h = pushHistory(h, 3, { key: 'x', now: 100 });
  h = pushHistory(h, 4, { key: 'y', now: 200 });
  assert.deepEqual(h.past, [1, 3], 'drag 2→3 is one step');
  h = undoHistory(h);
  assert.equal(h.present, 3);
  h = undoHistory(h);
  assert.equal(h.present, 1);
  h = redoHistory(h);
  assert.equal(h.present, 3);
  h = pushHistory(h, 9, { now: 5000 });
  assert.deepEqual(h.future, []);
});

test('addSourceWithMerge: Text+ added with a node selected is merged over it', async () => {
  const { addSourceWithMerge } = await import('./compModelExt.ts');
  const text = createNode('text', { id: 't2' });
  const merge = createNode('merge', { id: 'm2' });
  const comp = addSourceWithMerge(chain(), text, 'mrg', merge);
  assert.equal(getNode(comp, 'm2')!.inputs.bg, 'mrg');
  assert.equal(getNode(comp, 'm2')!.inputs.fg, 't2');
  assert.equal(getNode(comp, comp.outputNodeId)!.inputs.input, 'm2');
  // Without selection only the source is added.
  const plain = addSourceWithMerge(chain(), createNode('text', { id: 't3' }), null, createNode('merge', { id: 'm3' }));
  assert.ok(getNode(plain, 't3'));
  assert.equal(getNode(plain, 'm3'), undefined);
});
