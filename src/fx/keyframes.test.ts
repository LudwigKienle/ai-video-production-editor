import test from 'node:test';
import assert from 'node:assert/strict';

import {
  easeProgress,
  findKeyframeAt,
  interpolateKeyframes,
  nextKeyframeTime,
  previousKeyframeTime,
  shiftKeyframeTimes,
  upsertKeyframe,
  type TimedValue,
} from './keyframes.ts';

/** Verbatim copy of the original PreviewPlayer implementation (reference for compatibility). */
const legacyInterpolate = (start: number, end: number, progress: number, easing: string) => {
  let t = progress;
  if (easing === 'ease-in') t = progress * progress;
  else if (easing === 'ease-out') t = progress * (2 - progress);
  else if (easing === 'ease-in-out') t = progress < 0.5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress;
  return start + (end - start) * t;
};
const legacyGetKeyframeValue = (props: Array<TimedValue & { easing: string }>, currentTime: number, defaultValue: number) => {
  if (props.length === 0) return defaultValue;
  const sorted = [...props].sort((a, b) => a.time - b.time);
  if (currentTime <= sorted[0].time) return sorted[0].value;
  if (currentTime >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].value;
  for (let i = 0; i < sorted.length - 1; i++) {
    const k1 = sorted[i];
    const k2 = sorted[i + 1];
    if (currentTime >= k1.time && currentTime < k2.time) {
      return legacyInterpolate(k1.value, k2.value, (currentTime - k1.time) / (k2.time - k1.time), k2.easing);
    }
  }
  return defaultValue;
};

const near = (actual: number, expected: number, eps = 1e-9) => assert.ok(Math.abs(actual - expected) <= eps, `${actual} ≉ ${expected}`);

test('no keyframes → fallback; one keyframe → constant', () => {
  assert.equal(interpolateKeyframes(undefined, 1, 7), 7);
  assert.equal(interpolateKeyframes([], 1, 7), 7);
  const single = [{ time: 2, value: 3, easing: 'linear' }];
  assert.equal(interpolateKeyframes(single, 0, 7), 3);
  assert.equal(interpolateKeyframes(single, 2, 7), 3);
  assert.equal(interpolateKeyframes(single, 9, 7), 3);
});

test('before first / after last keyframe hold the end values', () => {
  const points = [
    { time: 1, value: 10, easing: 'linear' },
    { time: 3, value: 30, easing: 'linear' },
  ];
  assert.equal(interpolateKeyframes(points, -5, 0), 10);
  assert.equal(interpolateKeyframes(points, 1, 0), 10);
  assert.equal(interpolateKeyframes(points, 3, 0), 30);
  assert.equal(interpolateKeyframes(points, 99, 0), 30);
  near(interpolateKeyframes(points, 2, 0), 20);
});

test('easing is taken from the arriving keyframe (legacy semantics)', () => {
  const at = (easing: string) => interpolateKeyframes([{ time: 0, value: 0, easing: 'linear' }, { time: 1, value: 1, easing }], 0.25, 0);
  near(at('linear'), 0.25);
  near(at('ease-in'), 0.0625);
  near(at('ease-out'), 0.4375);
  near(at('ease-in-out'), 0.125);
  near(easeProgress(0.75, 'ease-in-out'), 0.875);
  // Unsorted input is fine.
  near(interpolateKeyframes([{ time: 1, value: 1, easing: 'ease-in' }, { time: 0, value: 0, easing: 'linear' }], 0.5, 0), 0.25);
});

test('matches the original getKeyframeValue for all legacy easings', () => {
  const easings = ['linear', 'ease-in', 'ease-out', 'ease-in-out'];
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let round = 0; round < 200; round += 1) {
    const count = 1 + Math.floor(rand() * 5);
    const points = Array.from({ length: count }, () => ({ time: Math.round(rand() * 40) / 10, value: rand() * 200 - 100, easing: easings[Math.floor(rand() * 4)] }));
    for (let t = -0.5; t <= 4.5; t += 0.13) {
      near(interpolateKeyframes(points, t, 42), legacyGetKeyframeValue(points, t, 42), 1e-9);
    }
  }
});

test('hold keeps the keyframe value until the next keyframe', () => {
  const points = [
    { time: 0, value: 0, easing: 'hold' },
    { time: 1, value: 10, easing: 'linear' },
    { time: 2, value: 20, easing: 'ease-in' },
  ];
  assert.equal(interpolateKeyframes(points, 0.5, -1), 0);
  assert.equal(interpolateKeyframes(points, 0.999, -1), 0);
  assert.equal(interpolateKeyframes(points, 1, -1), 10);
  near(interpolateKeyframes(points, 1.5, -1), 12.5);
  // 'hold' on the arriving keyframe has no curve of its own → linear.
  near(interpolateKeyframes([{ time: 0, value: 0, easing: 'linear' }, { time: 2, value: 4, easing: 'hold' }], 1, 0), 2);
  // Last keyframe hold → after it the value stays (as always).
  assert.equal(interpolateKeyframes([{ time: 0, value: 1, easing: 'linear' }, { time: 1, value: 5, easing: 'hold' }], 3, 0), 5);
});

test('navigation helpers', () => {
  const points = [{ time: 0 }, { time: 1 }, { time: 2.5 }].map((p) => ({ ...p, value: 0 }));
  assert.equal(previousKeyframeTime(points, 1), 0);
  assert.equal(previousKeyframeTime(points, 0), null);
  assert.equal(nextKeyframeTime(points, 1), 2.5);
  assert.equal(nextKeyframeTime(points, 2.5), null);
  assert.equal(nextKeyframeTime(points, -3), 0);
  assert.equal(findKeyframeAt(points, 1.005), 1);
  assert.equal(findKeyframeAt(points, 1.5), -1);
});

test('upsert updates within tolerance, otherwise inserts sorted', () => {
  const make = (time: number, value: number) => ({ id: `n${time}`, time, value, easing: 'linear' as const });
  const base = [{ id: 'a', time: 0, value: 1, easing: 'ease-out' as const }, { id: 'b', time: 2, value: 3, easing: 'linear' as const }];
  const updated = upsertKeyframe(base, 2.004, 9, make);
  assert.deepEqual(updated.map((p) => [p.id, p.time, p.value, p.easing]), [['a', 0, 1, 'ease-out'], ['b', 2, 9, 'linear']]);
  const inserted = upsertKeyframe(base, 1, 5, make);
  assert.deepEqual(inserted.map((p) => p.id), ['a', 'n1', 'b']);
});

test('shifting a block keeps spacing and is clamped to the range', () => {
  const points = [{ time: 0.5, value: 0 }, { time: 1, value: 0 }, { time: 3, value: 0 }];
  const moved = shiftKeyframeTimes(points, (_p, i) => i < 2, -2, 0, 4);
  assert.deepEqual(moved.map((p) => p.time), [0, 0.5, 3]);
  const late = shiftKeyframeTimes(points, (_p, i) => i === 2, 5, 0, 4);
  assert.deepEqual(late.map((p) => p.time), [0.5, 1, 4]);
});
