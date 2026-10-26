import test from 'node:test';
import assert from 'node:assert/strict';

import { scoreTool, searchTools } from './nodeSearch.ts';
import { FUSION_TOOLS, NUKE_TOOLS, buildToolNode } from './toolCatalog.ts';
import { createComposition } from './compModel.ts';
import { nodeClassOf } from './nodeClass.ts';

const ids = (list: { id: string }[]) => list.map((entry) => entry.id);

test('empty query lists every tool in catalogue order', () => {
  assert.deepEqual(ids(searchTools(FUSION_TOOLS, '')), ids(FUSION_TOOLS));
});

test('prefix, initials, short code and German keywords find Fusion tools', () => {
  assert.equal(searchTools(FUSION_TOOLS, 'mer')[0].id, 'Merge');
  assert.equal(searchTools(FUSION_TOOLS, 'cc')[0].id, 'ColorCorrector');
  assert.equal(searchTools(FUSION_TOOLS, 'xf')[0].id, 'Transform');
  assert.equal(searchTools(FUSION_TOOLS, 'text')[0].id, 'TextPlus');
  assert.equal(searchTools(FUSION_TOOLS, 'weichz')[0].id, 'Blur');
  assert.equal(searchTools(FUSION_TOOLS, 'maske').length >= 2, true);
  assert.deepEqual(searchTools(FUSION_TOOLS, 'zzzz'), []);
});

test('Nuke Tab menu: "gr" → Grade, "dot" → Dot, "wri" → Write, "read" before others', () => {
  assert.equal(searchTools(NUKE_TOOLS, 'gr')[0].id, 'Grade');
  assert.equal(searchTools(NUKE_TOOLS, 'dot')[0].id, 'Dot');
  assert.equal(searchTools(NUKE_TOOLS, 'wri')[0].id, 'Write');
  assert.equal(searchTools(NUKE_TOOLS, 'read')[0].id, 'Read');
  assert.ok(scoreTool({ id: 'x', label: 'Color Corrector' }, 'clrcrr') > 0, 'loose subsequence still matches');
});

test('buildToolNode names nodes uniquely and tags fx classes', () => {
  const comp = createComposition();
  const ctx = { fxStack: () => [], defaultMediaId: 'm1' };
  const merge = buildToolNode(FUSION_TOOLS.find((t) => t.id === 'Merge')!, comp, ctx, { x: 1, y: 2 })!;
  assert.equal(merge.name, 'Merge1');
  assert.equal(merge.type, 'merge');
  assert.equal(merge.x, 1);
  const read = buildToolNode(NUKE_TOOLS.find((t) => t.id === 'Read')!, comp, ctx, { x: 0, y: 0 })!;
  assert.equal(read.mediaId, 'm1');
  const dot = buildToolNode(NUKE_TOOLS.find((t) => t.id === 'Dot')!, comp, ctx, { x: 0, y: 0 })!;
  assert.equal(nodeClassOf(dot), 'dot');
  const grade = buildToolNode(NUKE_TOOLS.find((t) => t.id === 'Grade')!, comp, ctx, { x: 0, y: 0 })!;
  assert.equal(nodeClassOf(grade), 'grade');
  assert.equal(buildToolNode(NUKE_TOOLS.find((t) => t.id === 'Write')!, comp, ctx, { x: 0, y: 0 }), null);
});
