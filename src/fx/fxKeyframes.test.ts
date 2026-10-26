import test from 'node:test';
import assert from 'node:assert/strict';

import { createFxInstance, hasActiveFx, hasFxKeyframes, resolveMixAtTime, resolveParams, resolveParamsAtTime, resolveStackAtTime } from './registry.ts';
import {
  clipLocalDuration,
  clipLocalTime,
  clipTrackKey,
  deleteKeyframes,
  fxTrackKey,
  getTrackPoints,
  listAnimatedTracks,
  moveKeyframes,
  parseTrackKey,
  setAnimationEnabled,
  setKeyframeEasing,
  setValueAtTime,
  toggleKeyframeAtTime,
  valueAtTime,
} from './clipAnimation.ts';
import type { FxInstance } from './types.ts';
import type { TimelineClip } from '../types';

const OPTICS = 'buckswood-post-plugins.optics-lab';

const animatedInstance = (): FxInstance => ({
  ...createFxInstance(OPTICS),
  keyframes: {
    effectStrength: [
      { time: 1, value: 0.2, easing: 'linear' },
      { time: 3, value: 0.8, easing: 'ease-in' },
    ],
    irisBlades: [
      { time: 0, value: 3, easing: 'linear' },
      { time: 1, value: 6, easing: 'linear' },
    ],
    mix: [
      { time: 0, value: 0, easing: 'hold' },
      { time: 2, value: 1, easing: 'linear' },
    ],
  },
});

test('resolveParamsAtTime: no keyframes equals resolveParams', () => {
  const instance = createFxInstance(OPTICS, { effectStrength: 0.3 });
  assert.deepEqual(resolveParamsAtTime(instance, 5), resolveParams(instance));
  assert.equal(resolveMixAtTime(instance, 5), 1);
});

test('resolveParamsAtTime: before/after first/last, easing, int rounding', () => {
  const instance = animatedInstance();
  assert.equal(resolveParamsAtTime(instance, 0).effectStrength, 0.2);
  assert.equal(resolveParamsAtTime(instance, 10).effectStrength, 0.8);
  // ease-in on the arriving keyframe: progress 0.5 → 0.25
  assert.ok(Math.abs(Number(resolveParamsAtTime(instance, 2).effectStrength) - (0.2 + 0.6 * 0.25)) < 1e-9);
  // Int param rounds.
  assert.equal(resolveParamsAtTime(instance, 0.5).irisBlades, 5);
  // Un-animated params keep their constant value.
  assert.equal(resolveParamsAtTime(instance, 2).focalLength, resolveParams(instance).focalLength);
});

test('resolveParamsAtTime clamps to the descriptor range', () => {
  const instance: FxInstance = { ...createFxInstance(OPTICS), keyframes: { effectStrength: [{ time: 0, value: 5, easing: 'linear' }] } };
  assert.equal(resolveParamsAtTime(instance, 0).effectStrength, 1);
});

test('mix keyframes incl. hold', () => {
  const instance = animatedInstance();
  assert.equal(resolveMixAtTime(instance, 1.9), 0);
  assert.equal(resolveMixAtTime(instance, 2), 1);
  assert.ok(hasActiveFx([instance]));
  const off: FxInstance = { ...instance, mix: 1, keyframes: { mix: [{ time: 0, value: 0, easing: 'linear' }] } };
  assert.equal(hasActiveFx([off]), false);
});

test('resolveStackAtTime drops keyframes and keeps untouched instances identical', () => {
  const plain = createFxInstance(OPTICS);
  const animated = animatedInstance();
  const resolved = resolveStackAtTime([plain, animated], 2);
  assert.equal(resolved[0], plain);
  assert.equal(resolved[1].keyframes, undefined);
  assert.equal(resolved[1].mix, 1);
  assert.equal(resolved[1].params.irisBlades, 6);
  assert.ok(hasFxKeyframes([animated]));
  assert.equal(hasFxKeyframes(resolved), false);
  // Different times give different serialised stacks (OFX preview cache key).
  assert.notEqual(JSON.stringify(resolveStackAtTime([animated], 1)), JSON.stringify(resolveStackAtTime([animated], 2)));
});

const makeClip = (overrides: Partial<TimelineClip> = {}): TimelineClip => ({
  id: 'c1',
  mediaId: 'm1',
  trackId: 't1',
  start: 10,
  end: 14,
  duration: 4,
  speed: 1,
  effect: null,
  ...overrides,
});

test('clip-local time and duration follow speed', () => {
  const clip = makeClip({ speed: 2 });
  assert.equal(clipLocalTime(clip, 11), 2);
  assert.equal(clipLocalDuration(clip), 8);
});

test('track keys round-trip', () => {
  assert.deepEqual(parseTrackKey(clipTrackKey('rotation')), { kind: 'clip', property: 'rotation' });
  assert.deepEqual(parseTrackKey(fxTrackKey('fx-a:b', 'mix')), { kind: 'fx', instanceId: 'fx-a:b', param: 'mix' });
  assert.equal(parseTrackKey('clip:nope'), null);
});

test('stopwatch on/off, value edits and navigator toggle on clip properties', () => {
  const key = clipTrackKey('scale');
  let clip = makeClip({ transform: { scale: 1.2, opacity: 1, position: { x: 50, y: 50 } } });
  clip = setAnimationEnabled(clip, key, 0, true);
  assert.deepEqual(getTrackPoints(clip, key).map((p) => [p.time, p.value]), [[0, 1.2]]);
  clip = setValueAtTime(clip, key, 2, 2);
  assert.equal(getTrackPoints(clip, key).length, 2);
  assert.ok(Math.abs(valueAtTime(clip, key, 1) - 1.6) < 1e-9);
  clip = setValueAtTime(clip, key, 2.005, 1.8); // within tolerance → update
  assert.equal(getTrackPoints(clip, key).length, 2);
  clip = toggleKeyframeAtTime(clip, key, 1); // add with interpolated value
  assert.equal(getTrackPoints(clip, key).length, 3);
  clip = toggleKeyframeAtTime(clip, key, 1); // remove again
  assert.equal(getTrackPoints(clip, key).length, 2);
  // Other keyframe kinds stay untouched.
  clip = { ...clip, keyframes: [...(clip.keyframes ?? []), { id: 'blur', time: 0, value: 4, property: 'textBlur', easing: 'linear' }] };
  clip = setAnimationEnabled(clip, key, 2, false);
  assert.equal(getTrackPoints(clip, key).length, 0);
  assert.equal(clip.transform?.scale, 1.8);
  assert.deepEqual(clip.keyframes?.map((k) => k.id), ['blur']);
});

test('rotation and volume are animatable clip tracks', () => {
  let clip = makeClip();
  clip = setValueAtTime(clip, clipTrackKey('rotation'), 0, 15);
  assert.equal(clip.transform?.rotation, 15);
  clip = setAnimationEnabled(clip, clipTrackKey('rotation'), 0, true);
  clip = setValueAtTime(clip, clipTrackKey('rotation'), 4, 90);
  assert.ok(Math.abs(valueAtTime(clip, clipTrackKey('rotation'), 2) - 52.5) < 1e-9);
  clip = setAnimationEnabled(clip, clipTrackKey('volume'), 1, true);
  assert.deepEqual(listAnimatedTracks(clip), [clipTrackKey('rotation'), clipTrackKey('volume')]);
});

test('FX param tracks: stopwatch, move with clamp, easing, delete', () => {
  const instance = createFxInstance(OPTICS);
  let clip = makeClip({ fxStack: [instance] });
  const key = fxTrackKey(instance.id, 'effectStrength');
  const mixKey = fxTrackKey(instance.id, 'mix');
  clip = setAnimationEnabled(clip, key, 1, true);
  clip = setValueAtTime(clip, key, 3, 0.1);
  clip = setAnimationEnabled(clip, mixKey, 0, true);
  assert.deepEqual(listAnimatedTracks(clip), [key, mixKey]);
  const points = getTrackPoints(clip, key);
  assert.ok(points.every((p) => p.id && !p.id.includes('#')));
  // Move both effectStrength keys + mix key by +5 → clamped so the last stays ≤ duration (4).
  const selection = [...points.map((p) => ({ key, id: p.id })), { key: mixKey, id: getTrackPoints(clip, mixKey)[0].id }];
  clip = moveKeyframes(clip, selection, 5);
  assert.deepEqual(getTrackPoints(clip, key).map((p) => p.time), [2, 4]);
  assert.deepEqual(getTrackPoints(clip, mixKey).map((p) => p.time), [1]);
  clip = setKeyframeEasing(clip, [{ key, id: points[0].id }], 'hold');
  assert.equal(getTrackPoints(clip, key)[0].easing, 'hold');
  assert.equal(resolveParamsAtTime(clip.fxStack![0], 3.9).effectStrength, getTrackPoints(clip, key)[0].value);
  clip = deleteKeyframes(clip, selection, 0);
  assert.equal(clip.fxStack![0].keyframes, undefined);
  assert.equal(listAnimatedTracks(clip).length, 0);
});

test('FX keyframes without ids get synthetic, stable ids', () => {
  const instance: FxInstance = { ...createFxInstance(OPTICS), keyframes: { effectStrength: [{ time: 0, value: 0.1, easing: 'linear' }, { time: 1, value: 0.9, easing: 'linear' }] } };
  const clip = makeClip({ fxStack: [instance] });
  const key = fxTrackKey(instance.id, 'effectStrength');
  const ids = getTrackPoints(clip, key).map((p) => p.id);
  assert.deepEqual(ids, [`${key}#0`, `${key}#1`]);
  const moved = moveKeyframes(clip, [{ key, id: ids[1] }], 0.5);
  assert.deepEqual(getTrackPoints(moved, key).map((p) => [p.id, p.time]), [[ids[0], 0], [ids[1], 1.5]]);
});
