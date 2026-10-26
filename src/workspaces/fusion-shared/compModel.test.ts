import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addLayer,
  connect,
  createComposition,
  createNode,
  createsCycle,
  evaluationOrder,
  layersOf,
  paramsAt,
  removeNode,
  setKeyframe,
  setLayerOrder,
  valueAt,
} from './compModel.ts';

const media = (id: string) => createNode('media', { id, name: id, mediaId: `m-${id}` });

test('new composition only has an output node', () => {
  const comp = createComposition();
  assert.equal(comp.nodes.length, 1);
  assert.equal(comp.nodes[0].type, 'output');
  assert.deepEqual(layersOf(comp), []);
});

test('addLayer builds a merge chain and layersOf reads it back bottom → top', () => {
  let comp = createComposition();
  comp = addLayer(comp, media('bg'));
  comp = addLayer(comp, media('mid'));
  comp = addLayer(comp, media('top'));
  const layers = layersOf(comp);
  assert.deepEqual(layers.map((layer) => layer.sourceId), ['bg', 'mid', 'top']);
  assert.equal(layers[0].mergeId, null);
  assert.ok(layers[1].mergeId && layers[2].mergeId);
  const order = evaluationOrder(comp);
  assert.equal(order[order.length - 1], 'output');
  assert.ok(order.indexOf('bg') < order.indexOf(layers[1].mergeId!));
});

test('setLayerOrder reorders without losing nodes', () => {
  let comp = createComposition();
  for (const id of ['a', 'b', 'c']) comp = addLayer(comp, media(id));
  const [a, b, c] = layersOf(comp);
  const reordered = setLayerOrder(comp, [c, a, b]);
  assert.deepEqual(layersOf(reordered).map((layer) => layer.sourceId), ['c', 'a', 'b']);
  assert.equal(reordered.nodes.filter((node) => node.type === 'merge').length, 2);
  assert.equal(reordered.nodes.filter((node) => node.type === 'media').length, 3);
});

test('connect refuses cycles and unknown ports', () => {
  let comp = createComposition();
  const t1 = createNode('transform', { id: 't1' });
  const t2 = createNode('transform', { id: 't2' });
  comp = { ...comp, nodes: [...comp.nodes, t1, t2] };
  comp = connect(comp, 't1', 't2', 'input');
  assert.equal(createsCycle(comp, 't2', 't1'), true);
  const same = connect(comp, 't2', 't1', 'input');
  assert.equal(same.nodes.find((n) => n.id === 't1')!.inputs.input, null);
  assert.equal(connect(comp, 't1', 't2', 'nope'), comp);
});

test('removeNode reconnects the pass-through input', () => {
  let comp = createComposition();
  comp = addLayer(comp, media('solo'));
  const [layer] = layersOf(comp);
  comp = removeNode(comp, layer.transformId!);
  assert.equal(comp.nodes.find((n) => n.id === 'output')!.inputs.input, 'solo');
  assert.equal(removeNode(comp, 'output'), comp);
});

test('keyframes interpolate with easing and hold', () => {
  const frames = [
    { time: 0, value: 0 },
    { time: 2, value: 10, easing: 'hold' as const },
    { time: 4, value: 20 },
  ];
  assert.equal(valueAt(frames, -1, 5), 0);
  assert.equal(valueAt(frames, 1, 5), 5);
  assert.equal(valueAt(frames, 3, 5), 10);
  assert.equal(valueAt(frames, 9, 5), 20);
  let node = createNode('transform');
  node = setKeyframe(node, 'scale', 0, 1);
  node = setKeyframe(node, 'scale', 1, 2);
  node = setKeyframe(node, 'scale', 1, 3);
  assert.equal(node.keyframes!.scale.length, 2);
  assert.equal(paramsAt(node, 0.5).scale, 2);
});
