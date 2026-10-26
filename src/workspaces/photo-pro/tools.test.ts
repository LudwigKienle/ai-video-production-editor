import test from 'node:test';
import assert from 'node:assert/strict';

import { TOOL_GROUPS, TOOL_INFO, groupOfTool, toolForShortcut } from './tools.ts';

test('shortcuts pick the group tool, Shift cycles inside the group', () => {
  assert.equal(toolForShortcut('b', false, 'move'), 'brush');
  assert.equal(toolForShortcut('M', false, 'move'), 'marquee-rect');
  assert.equal(toolForShortcut('m', true, 'marquee-rect'), 'marquee-ellipse');
  assert.equal(toolForShortcut('m', true, 'marquee-ellipse'), 'marquee-rect');
  assert.equal(toolForShortcut('m', false, 'marquee-ellipse'), 'marquee-ellipse');
  assert.equal(toolForShortcut('o', false, 'brush', { dodge: 'burn' }), 'burn', 'remembers the flyout choice');
  assert.equal(toolForShortcut('q', false, 'brush'), null);
});

test('every tool belongs to exactly one group and has a label', () => {
  const all = TOOL_GROUPS.flatMap((g) => g.tools);
  assert.equal(new Set(all).size, all.length);
  for (const id of Object.keys(TOOL_INFO)) {
    assert.ok(all.includes(id as any), id);
    assert.equal(groupOfTool(id as any).tools.includes(id as any), true);
  }
  const keys = TOOL_GROUPS.map((g) => g.key);
  assert.equal(new Set(keys).size, keys.length, 'unique shortcut keys');
});
