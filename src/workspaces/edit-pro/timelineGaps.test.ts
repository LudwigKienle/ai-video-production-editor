import test from 'node:test';
import assert from 'node:assert/strict';
import { findVideoGaps } from './timelineGaps.ts';

test('finds gaps on video tracks only, with coverage class', () => {
  const clip = (id: string, trackId: string, start: number, end: number) => ({ id, trackId, start, end, mediaId: 'm', duration: end - start, speed: 1, effect: null }) as never;
  const gaps = findVideoGaps(
    [clip('a', 'v1', 0, 2), clip('b', 'v1', 6, 8), clip('c', 'v1', 8.5, 9), clip('d', 'a1', 0, 1)],
    [{ id: 'v1', name: 'V1', type: 'video', isLocked: false, isMuted: false }, { id: 'a1', name: 'A1', type: 'audio', isLocked: false, isMuted: false }],
  );
  assert.equal(gaps.length, 1);
  assert.deepEqual({ ...gaps[0] }, { trackId: 'v1', start: 2, end: 6, duration: 4, previousClipId: 'a', nextClipId: 'b', suggestedCoverage: 'b-roll' });
});
