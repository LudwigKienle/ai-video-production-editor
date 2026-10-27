import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addSerialNode,
  applyGradeToClips,
  cloneStack,
  createGradeNode,
  extractGrade,
  gradeSummary,
  isGradeNode,
  isNeutralGradeNode,
  moveNode,
  nodeLabel,
  removeNode,
  resetNode,
  setNodeLabel,
  toggleNode,
  updateNodeParams,
} from './nodeStack.ts';
import { GALLERY_STORAGE_KEY, createStill, loadGallery, nextStillName, removeStill, renameStill, saveGallery } from './gallery.ts';
import { chroma709, computeScopeData, vectorscopePosition } from './scopes.ts';
import { wheelPatch, wheelPosition, wheelResetPatch } from './wheelMath.ts';
import type { FxInstance } from '../../fx/types.ts';

let seq = 0;
const ids = () => `id${(seq += 1)}`;
const other = (id: string): FxInstance => ({ id, effectId: 'buckswood-post-plugins.optics-lab', enabled: true, params: { preset: 6 } });

test('node stack: add serial, remove, move, toggle, label', () => {
  const a = createGradeNode({}, 'a');
  let { stack, index } = addSerialNode([], -1, a);
  assert.equal(index, 0);
  ({ stack, index } = addSerialNode(stack, 0, createGradeNode({ liftY: 0.1 }, 'b')));
  assert.equal(index, 1);
  ({ stack, index } = addSerialNode(stack, 0, other('c')));
  assert.deepEqual(stack.map((n) => n.id), ['a', 'c', 'b']);
  assert.equal(index, 1);
  assert.deepEqual(moveNode(stack, 2, 0).map((n) => n.id), ['b', 'a', 'c']);
  assert.deepEqual(moveNode(stack, 0, 99).map((n) => n.id), ['c', 'b', 'a']);
  assert.equal(moveNode(stack, 5, 0), stack);
  assert.deepEqual(removeNode(stack, 1).map((n) => n.id), ['a', 'b']);
  assert.equal(toggleNode(stack, 2)[2].enabled, false);
  assert.equal(toggleNode(toggleNode(stack, 2), 2)[2].enabled, true);
  const labelled = setNodeLabel(stack, 0, '  Haut  ');
  assert.equal(nodeLabel(labelled[0], '01'), 'Haut');
  assert.equal(nodeLabel(setNodeLabel(labelled, 0, '')[0], '01'), '01');
  assert.equal(stack[0].params.nodeLabel, undefined, 'immutable');
  const ofx: FxInstance = { id: 'o', effectId: 'ofx:com.example', enabled: true, params: {} };
  assert.equal(setNodeLabel([ofx], 0, 'x')[0].params.nodeLabel, undefined, 'no label params on native OFX');
});

test('node stack: neutral detection, reset, params', () => {
  const node = createGradeNode({}, 'n');
  assert.ok(isGradeNode(node) && isNeutralGradeNode(node));
  const changed = updateNodeParams([node], 0, { gainY: 1.2, curveY: '0:0.1,1:1' });
  assert.equal(isNeutralGradeNode(changed[0]), false);
  const labelled = setNodeLabel(changed, 0, 'Look');
  const reset = resetNode(labelled, 0);
  assert.ok(isNeutralGradeNode(reset[0]));
  assert.equal(reset[0].params.nodeLabel, 'Look');
  assert.equal(isNeutralGradeNode(other('x')), false);
});

test('grade copy / paste and apply to all use fresh ids', () => {
  const source = { id: 'c1', fxStack: [createGradeNode({ gainY: 1.3 }, 'g1')], filters: undefined };
  const clips = [source, { id: 'c2', fxStack: undefined, filters: undefined }, { id: 'c3', fxStack: [other('o')], filters: undefined }];
  const grade = extractGrade(source);
  const next = applyGradeToClips(clips, grade, ['c2', 'c3'], ids);
  assert.equal(next[0], clips[0], 'untouched clip is the same object');
  assert.equal(next[1].fxStack?.[0].params.gainY, 1.3);
  assert.notEqual(next[1].fxStack?.[0].id, 'g1');
  assert.notEqual(next[1].fxStack?.[0].id, next[2].fxStack?.[0].id);
  assert.equal(next[2].fxStack?.length, 1, 'paste replaces the node tree');
  const cloned = cloneStack(source.fxStack, ids);
  cloned[0].params.gainY = 2;
  assert.equal(source.fxStack[0].params.gainY, 1.3, 'deep copy');
});

test('grade badge summary', () => {
  const neutral = gradeSummary({ fxStack: [createGradeNode({}, 'a')] });
  assert.deepEqual(neutral, { gradeNodes: 1, otherNodes: 0, active: 0, legacy: false, graded: false });
  const graded = gradeSummary({ fxStack: [createGradeNode({ saturation: 0.5 }, 'a'), other('b')] });
  assert.equal(graded.active, 2);
  assert.equal(graded.graded, true);
  const legacy = gradeSummary({
    fxStack: [],
    filters: { brightness: 100, contrast: 100, saturate: 100, hueRotate: 0, grain: 0, halation: 0, bloom: 0, vignette: 0, lut: 'kodak-2383' as never, lutIntensity: 100 },
  });
  assert.equal(legacy.legacy, true);
});

test('gallery: create, name, save/load round trip, quota fallback', () => {
  const memory = new Map<string, string>();
  const storage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v) };
  let stills = createStill([], { fxStack: [createGradeNode({ hue: 20 }, 'a')] }, 'data:x', { id: 's1', now: 1 });
  stills = createStill(stills, { fxStack: [] }, '', { id: 's2', now: 2 });
  assert.deepEqual(stills.map((s) => s.name), ['Still 1.2', 'Still 1.1']);
  assert.equal(nextStillName(stills), 'Still 1.3');
  stills = renameStill(stills, 's1', 'Abendlicht');
  assert.ok(saveGallery(stills, storage));
  const loaded = loadGallery(storage);
  assert.equal(loaded.length, 2);
  assert.equal(loaded[1].name, 'Abendlicht');
  assert.equal(loaded[1].grade.fxStack[0].params.hue, 20);
  assert.equal(removeStill(loaded, 's2').length, 1);
  memory.set(GALLERY_STORAGE_KEY, '{broken');
  assert.deepEqual(loadGallery(storage), []);
  let calls = 0;
  const tight = { getItem: () => null, setItem: (_k: string, v: string) => { calls += 1; if (v.includes('data:x')) throw new Error('quota'); } };
  assert.ok(saveGallery(stills, tight));
  assert.equal(calls, 2, 'retried without thumbnails');
  assert.deepEqual(loadGallery(null), []);
  // LUT payloads survive the JSON round trip as Float32Array.
  const lutStill = createStill([], { fxStack: [], filters: { brightness: 100, contrast: 100, saturate: 100, hueRotate: 0, grain: 0, halation: 0, bloom: 0, vignette: 0, lut: 'custom', lutIntensity: 100, customLut: { size: 2, is3d: true, domainMin: [0, 0, 0], domainMax: [1, 1, 1], data: new Float32Array(24).fill(0.5) } } }, '', { id: 'l' });
  saveGallery(lutStill, storage);
  const revived = loadGallery(storage)[0].grade.filters?.customLut;
  assert.ok(revived?.data instanceof Float32Array && revived.data.length === 24);
});

test('scope binning: waveform, parade, histogram, vectorscope', () => {
  const w = 4;
  const h = 2;
  const px = new Uint8ClampedArray(w * h * 4);
  const set = (x: number, y: number, r: number, g: number, b: number) => px.set([r, g, b, 255], (y * w + x) * 4);
  set(0, 0, 0, 0, 0); set(0, 1, 0, 0, 0);
  set(1, 0, 255, 255, 255); set(1, 1, 255, 255, 255);
  set(2, 0, 255, 0, 0); set(2, 1, 255, 0, 0);
  set(3, 0, 128, 128, 128); set(3, 1, 128, 128, 128);
  const s = computeScopeData(px, w, h, { columns: 4, levels: 4, vectorSize: 8 });
  assert.equal(s.waveform[0 * 4 + 0], 2, 'black column at level 0');
  assert.equal(s.waveform[1 * 4 + 3], 2, 'white column at level 3');
  assert.equal(s.parade[0][2 * 4 + 3], 2, 'red column: R at top');
  assert.equal(s.parade[1][2 * 4 + 0], 2, 'red column: G at bottom');
  assert.equal(s.histogram.r[255], 4);
  assert.equal(s.histogram.y[0], 2);
  assert.equal(s.histogram.y.reduce((a, b) => a + b, 0), 8);
  assert.equal(s.vectorscope.reduce((a, b) => a + b, 0), 8);
  // Greys land in the centre of the vectorscope.
  const [cx, cy] = vectorscopePosition(0.5, 0.5, 0.5, 8);
  assert.equal(cx, 4); assert.equal(cy, 4);
  assert.equal(s.vectorscope[4 * 8 + 4], 6, 'black, white and grey in the centre bin');
  const [cb, cr] = chroma709(1, 0, 0);
  assert.ok(cr > 0.49 && cb < 0, 'red is up-left');
});

test('wheel puck mapping round trips and keeps luma', () => {
  const values = { liftR: 0, liftG: 0, liftB: 0, gainR: 1, gainG: 1, gainB: 1 };
  const patch = wheelPatch(values, 'lift', 0.4, -0.3);
  const pos = wheelPosition({ ...values, ...patch }, 'lift');
  assert.ok(Math.abs(pos.x - 0.4) < 1e-3 && Math.abs(pos.y + 0.3) < 1e-3);
  const r = Number(patch.liftR); const g = Number(patch.liftG); const b = Number(patch.liftB);
  assert.ok(Math.abs(0.2126 * r + 0.7152 * g + 0.0722 * b) < 1e-4, 'luma neutral');
  const gain = wheelPatch(values, 'gain', 0, 1);
  assert.ok(Number(gain.gainR) > 1 && Number(gain.gainG) < 1, 'up = toward red');
  const clamped = wheelPosition({ ...values, ...wheelPatch(values, 'gamma', 3, 4) }, 'gamma');
  assert.ok(Math.abs(Math.hypot(clamped.x, clamped.y) - 1) < 1e-3, 'puck clamped to the rim');
  assert.deepEqual(wheelResetPatch('gain'), { gainR: 1, gainG: 1, gainB: 1, gainY: 1 });
  assert.deepEqual(wheelResetPatch('offset'), { offsetR: 0, offsetG: 0, offsetB: 0 });
});
