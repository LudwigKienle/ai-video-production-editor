import test from 'node:test';
import assert from 'node:assert/strict';
import { bakeGradeToCube } from './cubeExport.ts';
import { PRIMARY_GRADE_ID } from '../../fx/effects/primaryGrade/index.ts';

test('no grade nodes bake an identity LUT', () => {
  const cube = bakeGradeToCube([], { size: 3 });
  const rows = cube.text.trim().split('\n').slice(4);
  assert.equal(rows.length, 27);
  assert.equal(rows[0], '0.000000 0.000000 0.000000');
  assert.equal(rows[1], '0.500000 0.000000 0.000000');
  assert.equal(rows[26], '1.000000 1.000000 1.000000');
  assert.equal(cube.nodes, 0);
});

test('a lifted gain brightens mid grey; disabled nodes are ignored', () => {
  const node = { id: 'n1', effectId: PRIMARY_GRADE_ID, enabled: true, params: { gainY: 1.5 } };
  const bright = bakeGradeToCube([node], { size: 3 });
  const mid = bright.text.trim().split('\n').slice(4)[13].split(' ').map(Number);
  assert.ok(mid[0] > 0.5 && mid[1] > 0.5 && mid[2] > 0.5, `mid grey ${mid}`);
  const off = bakeGradeToCube([{ ...node, enabled: false }], { size: 3 });
  assert.equal(off.text.trim().split('\n').slice(4)[13], '0.500000 0.500000 0.500000');
});

test('nodes with a window or qualifier are reported as masked', () => {
  const cube = bakeGradeToCube([{ id: 'w', effectId: PRIMARY_GRADE_ID, enabled: true, params: { winType: 1, gainY: 1.2 } }], { size: 2 });
  assert.deepEqual(cube.masked, ['w']);
});
