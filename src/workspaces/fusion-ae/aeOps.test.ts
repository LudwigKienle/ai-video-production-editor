import test from 'node:test';
import assert from 'node:assert/strict';

import { createComposition, createNode, getNode, layersOf, paramsAt, valueAt } from '../fusion-shared/compModel.ts';
import type { Composition } from '../fusion-shared/compModel.ts';
import {
  adjacentTime,
  addFxInstanceToLayer,
  addKeyframeAt,
  addMaskToLayer,
  aeLayers,
  applyEase,
  collectKeyTimes,
  deleteKeyframes,
  deleteLayers,
  duplicateLayer,
  ensureTransform,
  formatRotation,
  formatTimecode,
  fromDisplay,
  isLayerGraph,
  keyframeShape,
  keyframedProps,
  layerCorners,
  moveKeyframes,
  moveLayerInTo,
  moveLayerOutTo,
  moveLayerTime,
  moveLayersToIndex,
  newMediaLayer,
  newSolidLayer,
  newTextLayer,
  P_OFFSET,
  panBehind,
  parseTimecode,
  prepareForRender,
  propKeyframeTimes,
  propValueAt,
  removeBranchNode,
  reorderLayers,
  resolveAeShortcut,
  revealProps,
  sanitizeUi,
  selectedLayerIds,
  setLayerBlend,
  setLayerSwitch,
  setPropValue,
  setWorkArea,
  splitLayer,
  toDisplay,
  toggleKeyframeAt,
  toggleStopwatch,
  trimLayerIn,
  trimLayerOut,
  wrapResolver,
  AE_COMMANDS,
} from './aeOps.ts';

const base = () => createComposition({ id: 'c', width: 1920, height: 1080, fps: 25, durationSeconds: 10 });

function threeLayers(): { comp: Composition; ids: string[] } {
  let comp = base();
  const ids: string[] = [];
  for (const name of ['A', 'B', 'C']) {
    const r = newSolidLayer(comp, { name });
    comp = r.comp;
    ids.push(r.layerId);
  }
  return { comp, ids };
}

const names = (comp: Composition) => aeLayers(comp).map((l) => l.source.name);
const transformOf = (comp: Composition, id: string) => getNode(comp, aeLayers(comp).find((l) => l.sourceId === id)!.transformId)!;

test('timecode formats and parses AE style', () => {
  assert.equal(formatTimecode(0, 25), '0:00:00:00');
  assert.equal(formatTimecode(61.52, 25), '0:01:01:13');
  assert.equal(parseTimecode('0:00:02:12', 25), 2.48);
  assert.equal(parseTimecode('50', 25), 2);
  assert.equal(parseTimecode('1,5s', 25), 1.5);
  assert.equal(parseTimecode('x', 25), null);
  assert.equal(formatRotation(390), '1x +30,0°');
  assert.equal(formatRotation(-45), '0x -45,0°');
});

test('layers are numbered top → bottom with AE defaults', () => {
  const { comp, ids } = threeLayers();
  const layers = aeLayers(comp);
  assert.deepEqual(names(comp), ['C', 'B', 'A']);
  assert.deepEqual(layers.map((l) => l.index), [1, 2, 3]);
  assert.equal(layers[0].inPoint, 0);
  assert.equal(layers[0].outPoint, 10);
  assert.ok(layers[0].source.color);
  assert.deepEqual(selectedLayerIds(comp, [layers[1].transformId!, ids[2]]), [ids[1], ids[2]]);
  assert.ok(isLayerGraph(comp));
});

test('reorder keeps blend modes with their layer', () => {
  let { comp, ids } = threeLayers();
  comp = setLayerBlend(comp, ids[2], 'screen'); // C (top)
  comp = reorderLayers(comp, [ids[2]], 'back');
  assert.deepEqual(names(comp), ['B', 'A', 'C']);
  assert.equal(aeLayers(comp).find((l) => l.sourceId === ids[2])!.blend, 'screen');
  assert.ok(aeLayers(comp).filter((l) => l.sourceId !== ids[2]).every((l) => l.blend === 'normal'));
  comp = reorderLayers(comp, [ids[2]], 'front');
  assert.deepEqual(names(comp), ['C', 'B', 'A']);
  assert.equal(aeLayers(comp)[0].blend, 'screen');
  comp = reorderLayers(comp, [ids[0]], 'forward');
  assert.deepEqual(names(comp), ['C', 'A', 'B']);
  comp = reorderLayers(comp, [ids[2]], 'backward');
  assert.deepEqual(names(comp), ['A', 'C', 'B']);
  comp = moveLayersToIndex(comp, [ids[1]], 1);
  assert.deepEqual(names(comp), ['B', 'A', 'C']);
  assert.equal(comp.nodes.filter((n) => n.type === 'merge').length, 2);
});

test('delete, duplicate and split layers', () => {
  let { comp, ids } = threeLayers();
  const dup = duplicateLayer(comp, ids[1]);
  assert.ok(dup.layerId);
  assert.deepEqual(names(dup.comp), ['C', 'B 2', 'B', 'A']);
  comp = deleteLayers(dup.comp, [ids[0], ids[2]]);
  assert.deepEqual(names(comp), ['B 2', 'B']);
  assert.ok(isLayerGraph(comp));
  comp = deleteLayers(comp, aeLayers(comp).map((l) => l.sourceId));
  assert.equal(layersOf(comp).length, 0);
  assert.equal(getNode(comp, 'output')!.inputs.input, null);

  let media = base();
  const r = newMediaLayer(media, { id: 'm1', name: 'Clip', type: 'video', duration: 8 });
  media = r.comp;
  assert.equal(aeLayers(media)[0].outPoint, 8);
  const split = splitLayer(media, r.layerId, 3);
  assert.ok(split.layerId);
  const [top, bottom] = aeLayers(split.comp);
  assert.equal(top.sourceId, split.layerId);
  assert.equal(top.inPoint, 3);
  assert.equal(top.outPoint, 8);
  assert.equal(top.source.params[P_OFFSET], 3);
  assert.equal(bottom.outPoint, 3);
  assert.equal(top.source.name, 'Clip');
  assert.equal(splitLayer(media, r.layerId, 0).layerId, null);
});

test('move and trim layers; media keeps content in place', () => {
  const r = newMediaLayer(base(), { id: 'm1', name: 'Clip', type: 'video', duration: 6 });
  let comp = moveLayerTime(r.comp, r.layerId, 1);
  assert.deepEqual([aeLayers(comp)[0].inPoint, aeLayers(comp)[0].outPoint], [1, 7]);
  comp = trimLayerIn(comp, r.layerId, 2);
  let layer = aeLayers(comp)[0];
  assert.equal(layer.inPoint, 2);
  assert.equal(layer.source.params[P_OFFSET], 1);
  comp = trimLayerIn(comp, r.layerId, 0); // cannot go before footage start (t = 1)
  layer = aeLayers(comp)[0];
  assert.equal(layer.inPoint, 1);
  assert.equal(layer.source.params[P_OFFSET], 0);
  comp = trimLayerOut(comp, r.layerId, 9.5, 6);
  assert.equal(aeLayers(comp)[0].outPoint, 7);
  comp = trimLayerOut(comp, r.layerId, 0);
  assert.equal(aeLayers(comp)[0].outPoint, 1.04);
  comp = moveLayerInTo(comp, r.layerId, 4);
  assert.equal(aeLayers(comp)[0].inPoint, 4);
  comp = moveLayerOutTo(comp, r.layerId, 4);
  assert.equal(aeLayers(comp)[0].outPoint, 4);
});

test('render prep: solo, transparency and source offsets', () => {
  let { comp, ids } = threeLayers();
  comp = setLayerSwitch(comp, ids[1], 'solo', true);
  const prepared = prepareForRender(comp, { transparent: true });
  assert.equal(getNode(prepared, ids[0])!.enabled, false);
  assert.equal(getNode(prepared, ids[1])!.enabled, true);
  assert.equal(prepared.background, 'rgba(0,0,0,0)');
  assert.equal(getNode(comp, ids[0])!.enabled, true);

  const r = newMediaLayer(base(), { id: 'clip', name: 'Clip', type: 'video', duration: 6 });
  const trimmed = trimLayerIn(r.comp, r.layerId, 2);
  const media = prepareForRender(trimmed).nodes.find((n) => n.type === 'media')!;
  const calls: [string, number][] = [];
  wrapResolver((id, t) => calls.push([id, t]))(media.mediaId!, 0.5);
  assert.deepEqual(calls, [['clip', 2.5]]);
});

test('switches: eye, lock, fx', () => {
  let { comp, ids } = threeLayers();
  comp = setLayerSwitch(comp, ids[0], 'visible', false);
  comp = setLayerSwitch(comp, ids[0], 'lock', true);
  const fx = addFxInstanceToLayer(comp, ids[0], { id: 'fx1', effectId: 'demo', enabled: true, params: {} });
  comp = fx.comp;
  let layer = aeLayers(comp).find((l) => l.sourceId === ids[0])!;
  assert.equal(layer.visible, false);
  assert.equal(layer.locked, true);
  assert.equal(layer.fxNodes.length, 1);
  comp = addFxInstanceToLayer(comp, ids[0], { id: 'fx2', effectId: 'demo', enabled: true, params: {} }).comp;
  layer = aeLayers(comp).find((l) => l.sourceId === ids[0])!;
  assert.equal(layer.fxNodes.length, 1);
  assert.equal(layer.fxNodes[0].fxStack!.length, 2);
  comp = setLayerSwitch(comp, ids[0], 'fx', false);
  assert.equal(aeLayers(comp).find((l) => l.sourceId === ids[0])!.fxEnabled, false);
  // fx sits above the transform, the layer order still works
  comp = reorderLayers(comp, [ids[0]], 'front');
  assert.deepEqual(names(comp), ['A', 'C', 'B']);
  assert.equal(aeLayers(comp)[0].fxNodes.length, 1);
});

test('masks insert into the branch and can be removed', () => {
  let { comp, ids } = threeLayers();
  const m = addMaskToLayer(comp, ids[1], 'ellipse', { cx: 0.4, cy: 0.5, w: 0.2, h: 0.3 });
  comp = m.comp;
  let layer = aeLayers(comp).find((l) => l.sourceId === ids[1])!;
  assert.equal(layer.maskNodes.length, 1);
  assert.equal(layer.maskNodes[0].params.shape, 'ellipse');
  assert.ok(isLayerGraph(comp));
  comp = removeBranchNode(comp, m.maskId!);
  layer = aeLayers(comp).find((l) => l.sourceId === ids[1])!;
  assert.equal(layer.maskNodes.length, 0);
  assert.ok(layer.transformId);
});

test('ensureTransform adds a transform to a bare layer', () => {
  let comp = base();
  const src = createNode('solid', { id: 'bare' });
  comp = { ...comp, nodes: [...comp.nodes, src], };
  comp = { ...comp, nodes: comp.nodes.map((n) => (n.id === 'output' ? { ...n, inputs: { input: 'bare' } } : n)) };
  assert.equal(layersOf(comp)[0].transformId, null);
  const r = ensureTransform(comp, 'bare');
  assert.ok(r.transformId);
  assert.equal(layersOf(r.comp)[0].transformId, r.transformId);
});

test('property display units round-trip', () => {
  const comp = { width: 1920, height: 1080 };
  assert.deepEqual(toDisplay('position', [0, 0], comp), [960, 540]);
  assert.deepEqual(fromDisplay('position', [1000, 500], comp), [40, -40]);
  assert.deepEqual(toDisplay('scale', [1.5], comp), [150]);
  assert.deepEqual(fromDisplay('opacity', [150], comp), [1]);
});

test('stopwatch, keyframe navigator and value edits', () => {
  const { comp, ids } = threeLayers();
  let t = transformOf(comp, ids[0]);
  t = setPropValue(t, 'scale', [1.2], 0);
  assert.equal(t.params.scale, 1.2);
  t = toggleStopwatch(t, 'position', 1);
  assert.deepEqual(propKeyframeTimes(t, 'position'), [1]);
  t = setPropValue(t, 'position', [100, 50], 3);
  assert.deepEqual(propKeyframeTimes(t, 'position'), [1, 3]);
  assert.deepEqual(propValueAt(t, 'position', 2), [50, 25]);
  t = toggleKeyframeAt(t, 'position', 2);
  assert.deepEqual(propKeyframeTimes(t, 'position'), [1, 2, 3]);
  t = toggleKeyframeAt(t, 'position', 2);
  assert.deepEqual(propKeyframeTimes(t, 'position'), [1, 3]);
  assert.deepEqual(keyframedProps(t), ['position']);
  t = toggleStopwatch(t, 'position', 3);
  assert.deepEqual(propKeyframeTimes(t, 'position'), []);
  assert.equal(t.params.x, 100);
  t = addKeyframeAt(t, 'opacity', 0.5);
  assert.deepEqual(propKeyframeTimes(t, 'opacity'), [0.5]);
});

test('keyframes move, delete and navigate with J/K', () => {
  const { comp, ids } = threeLayers();
  let t = transformOf(comp, ids[0]);
  t = toggleStopwatch(t, 'rotation', 0);
  t = setPropValue(t, 'rotation', [90], 2);
  t = setPropValue(t, 'rotation', [180], 4);
  t = moveKeyframes(t, [{ prop: 'rotation', time: 2 }], 0.51, 25);
  assert.deepEqual(propKeyframeTimes(t, 'rotation'), [0, 2.52, 4]);
  t = moveKeyframes(t, [{ prop: 'rotation', time: 2.52 }], 1.48, 25); // lands on 4 → replaces it
  assert.deepEqual(propKeyframeTimes(t, 'rotation'), [0, 4]);
  assert.equal(valueAt(t.keyframes!.rotation, 4, 0), 90);
  t = deleteKeyframes(t, [{ prop: 'rotation', time: 0 }]);
  assert.deepEqual(propKeyframeTimes(t, 'rotation'), [4]);
  const times = collectKeyTimes([t, null]);
  assert.equal(adjacentTime([0, 1, 2], 1, 1), 2);
  assert.equal(adjacentTime([0, 1, 2], 1, -1), 0);
  assert.equal(adjacentTime([0, 1, 2], 2, 1), null);
  assert.deepEqual(times, [4]);
});

test('easy ease (F9) sets both sides, in/out one side, hold toggles', () => {
  const { comp, ids } = threeLayers();
  let t = transformOf(comp, ids[0]);
  t = toggleStopwatch(t, 'opacity', 0);
  t = setPropValue(t, 'opacity', [0.5], 1);
  t = setPropValue(t, 'opacity', [0], 2);
  t = applyEase(t, [{ prop: 'opacity', time: 1 }], 'easy');
  assert.deepEqual(t.keyframes!.opacity.map((f) => f.easing), ['ease-out', 'ease-in', 'linear']);
  assert.equal(keyframeShape(t, 'opacity', 1), 'ease');
  t = applyEase(t, [{ prop: 'opacity', time: 2 }], 'in');
  assert.deepEqual(t.keyframes!.opacity.map((f) => f.easing), ['ease-out', 'ease-in-out', 'linear']);
  assert.equal(keyframeShape(t, 'opacity', 2), 'ease-in');
  t = applyEase(t, [{ prop: 'opacity', time: 0 }], 'out');
  assert.equal(t.keyframes!.opacity[0].easing, 'ease-in-out');
  assert.equal(keyframeShape(t, 'opacity', 0), 'ease-out');
  t = applyEase(t, [{ prop: 'opacity', time: 1 }], 'linear');
  assert.deepEqual(t.keyframes!.opacity.map((f) => f.easing), ['ease-in', 'ease-out', 'linear']);
  t = applyEase(t, [{ prop: 'opacity', time: 1 }], 'hold');
  assert.equal(keyframeShape(t, 'opacity', 1), 'hold');
  assert.equal(paramsAt(t, 1.5).opacity, 0.5);
  t = applyEase(t, [{ prop: 'opacity', time: 1 }], 'hold');
  assert.equal(t.keyframes!.opacity[1].easing, 'linear');
});

test('reveal: P shows position only, Shift adds, same key again hides', () => {
  let state = revealProps({}, ['a'], ['position'], false);
  assert.deepEqual(state.a, ['position']);
  state = revealProps(state, ['a'], ['scale'], true);
  assert.deepEqual(state.a, ['position', 'scale']);
  state = revealProps(state, ['a'], ['scale'], true);
  assert.deepEqual(state.a, ['position']);
  state = revealProps(state, ['a'], ['position'], false);
  assert.deepEqual(state.a, []);
});

test('pan behind keeps the anchor-mapped image in place', () => {
  const params = { x: 10, y: 0, scale: 2, rotation: 90, anchorX: 0, anchorY: 0 };
  const corners = layerCorners(params, { width: 100, height: 100 });
  const moved = panBehind(params, 20, 0);
  const after = layerCorners({ ...params, ...moved }, { width: 100, height: 100 });
  corners.forEach((c, i) => {
    assert.ok(Math.abs(c.x - after[i].x) < 1e-9 && Math.abs(c.y - after[i].y) < 1e-9);
  });
});

test('work area edges stay ordered', () => {
  const comp = { fps: 25, durationSeconds: 10 };
  assert.deepEqual(setWorkArea({ start: 0, end: 10 }, 'start', 3, comp), { start: 3, end: 10 });
  assert.deepEqual(setWorkArea({ start: 3, end: 10 }, 'end', 1, comp), { start: 3, end: 3.04 });
});

test('text layer at a click position', () => {
  const r = newTextLayer(base(), { text: 'Hallo', position: { x: 100, y: -50 } });
  const layer = aeLayers(r.comp)[0];
  assert.equal(layer.source.params.text, 'Hallo');
  assert.equal(getNode(r.comp, layer.transformId)!.params.x, 100);
});

test('shortcut map', () => {
  const k = (key: string, extra: Record<string, unknown> = {}) => resolveAeShortcut({ key, ...extra })?.command ?? null;
  assert.equal(k(' ', { code: 'Space' }), 'transport.playToggle');
  assert.equal(k('j'), 'time.prevKeyframe');
  assert.equal(k('k'), 'time.nextKeyframe');
  assert.equal(k('PageDown'), 'time.nextFrame');
  assert.equal(k('PageUp', { shiftKey: true }), 'time.prev10');
  assert.equal(k('b'), 'workArea.start');
  assert.equal(k('n'), 'workArea.end');
  assert.equal(k('[', { code: 'BracketLeft' }), 'layer.inToTime');
  assert.equal(k('“', { code: 'BracketLeft', altKey: true }), 'layer.trimIn');
  assert.equal(k(']', { code: 'BracketRight', altKey: true }), 'layer.trimOut');
  assert.equal(k('[', { code: 'Digit5', altKey: true }), 'layer.inToTime'); // German layout types [ with Alt+5
  assert.equal(k(']', { code: 'BracketRight', metaKey: true }), 'layer.forward');
  assert.equal(k('p'), 'reveal.position');
  assert.equal(resolveAeShortcut({ key: 'P', shiftKey: true })?.additive, true);
  assert.equal(k('∏', { code: 'KeyP', altKey: true, shiftKey: true }), 'key.position');
  assert.equal(k('u'), 'reveal.keyframed');
  assert.equal(k('F9'), 'ease.easy');
  assert.equal(k('F9', { shiftKey: true }), 'ease.in');
  assert.equal(k('F9', { shiftKey: true, metaKey: true }), 'ease.out');
  assert.equal(k('d', { metaKey: true }), 'layer.duplicate');
  assert.equal(k('d', { metaKey: true, shiftKey: true }), 'layer.split');
  assert.equal(k('y', { metaKey: true }), 'layer.newSolid');
  assert.equal(k('t', { metaKey: true }), 'tool.text');
  assert.equal(k('v'), 'tool.selection');
  assert.equal(k('h'), 'tool.hand');
  assert.equal(k('z'), 'tool.zoom');
  assert.equal(k('w'), 'tool.rotate');
  assert.equal(k('y'), 'tool.anchor');
  assert.equal(k('q'), 'tool.mask');
  assert.equal(k('z', { metaKey: true }), 'edit.undo');
  assert.equal(k('Backspace'), 'edit.delete');
  assert.equal(k('x'), null);
  const ids = new Set(AE_COMMANDS.map((c) => c.id));
  assert.equal(ids.size, AE_COMMANDS.length);
});

test('ui state sanitising', () => {
  const ui = sanitizeUi({ tool: 'bogus', resolution: 3, pxPerSecond: 1e9, showGrid: 'yes' });
  assert.equal(ui.tool, 'selection');
  assert.equal(ui.resolution, 3);
  assert.equal(ui.pxPerSecond, 2000);
  assert.equal(ui.showGrid, false);
  assert.equal(sanitizeUi(null).tool, 'selection');
});

test('keyframe refs round-trip exact (non-integer frame times)', async () => {
  const { keyRefId: id, parseKeyRef: parse } = await import('./aeOps.ts');
  const t = 50 / 24;
  assert.equal(parse(id({ nodeId: 'n', prop: 'position', time: t }))!.time, t);
});
