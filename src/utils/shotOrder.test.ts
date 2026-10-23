import test from 'node:test';
import assert from 'node:assert/strict';
import { nextInScreenOrder, previousInScreenOrder, screenOrder } from './shotOrder.ts';

// Scene 1 directed last, so its shots carry the highest numbers.
const shots = [
  { shot: 147, sceneNumber: 10, sceneShotNumber: 15, imageUrl: 'x' },
  { shot: 149, sceneNumber: 1, sceneShotNumber: 1, imageUrl: 'a' },
  { shot: 150, sceneNumber: 1, sceneShotNumber: 2 },
  { shot: 151, sceneNumber: 1, sceneShotNumber: 3, imageUrl: 'c' },
  { shot: 20, sceneNumber: 2, sceneShotNumber: 1, imageUrl: 'd' },
];

test('screen order follows scenes, not shot numbers', () => {
  assert.deepEqual(screenOrder(shots).map((s) => s.shot), [149, 150, 151, 20, 147]);
});

test('the previous shot of the first shot of scene 1 is nothing, not the last shot of scene 10', () => {
  assert.equal(previousInScreenOrder(shots, 149), null);
  assert.equal(previousInScreenOrder(shots, 151)?.shot, 150);
  assert.equal(previousInScreenOrder(shots, 151, { where: (s) => Boolean(s.imageUrl) })?.shot, 149);
  assert.equal(previousInScreenOrder(shots, 20)?.shot, 151);
  assert.equal(previousInScreenOrder(shots, 20, { sameScene: true }), null);
  assert.equal(nextInScreenOrder(shots, 151)?.shot, 20);
  assert.equal(nextInScreenOrder(shots, 151, { sameScene: true }), null);
});
