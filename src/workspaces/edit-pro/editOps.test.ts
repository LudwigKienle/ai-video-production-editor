import test from 'node:test';
import assert from 'node:assert/strict';

import {
    adjacentEditPoint,
    editPoints,
    extractRange,
    liftRange,
    linkedPartners,
    rangeEditTracks,
    splitClipAt,
    stepAllTrackHeights,
    trackIndexAtY,
    trackRowLayout,
    TRACK_HEIGHT_MAX,
} from './editOps.ts';

const clip = (id: string, trackId: string, start: number, end: number, extra: Record<string, unknown> = {}) => ({
    id, trackId, start, end, sourceIn: 0, sourceOut: end - start, speed: 1, duration: end - start, mediaId: `media-${id}`, ...extra,
});

let n = 0;
const makeId = () => `new-${++n}`;

test('splitClipAt keeps source continuity and speed', () => {
    const c = clip('a', 'v1', 2, 6, { sourceIn: 1, sourceOut: 9, speed: 2, keyframes: [{ id: 'k1', time: 1 }, { id: 'k2', time: 6 }] });
    const parts = splitClipAt(c, 4, 'b');
    assert.ok(parts);
    const [left, right] = parts!;
    assert.equal(left.end, 4);
    assert.equal(left.sourceOut, 5);
    assert.equal(right.start, 4);
    assert.equal(right.sourceIn, 5);
    assert.equal(right.sourceOut, 9);
    assert.equal(right.id, 'b');
    assert.deepEqual(left.keyframes?.map((k) => k.id), ['k1']);
    assert.deepEqual(right.keyframes?.map((k) => k.time), [2]);
    assert.equal(splitClipAt(c, 2, 'x'), null);
});

test('rangeEditTracks prefers targeted unlocked tracks', () => {
    const tracks = [
        { id: 'v1', type: 'video' as const, isLocked: false, isTargeted: true },
        { id: 'v2', type: 'video' as const, isLocked: false },
        { id: 'a1', type: 'audio' as const, isLocked: true, isTargeted: true },
    ];
    assert.deepEqual(rangeEditTracks(tracks), ['v1']);
    assert.deepEqual(rangeEditTracks(tracks.map((t) => ({ ...t, isTargeted: false }))), ['v1', 'v2']);
});

test('liftRange splits a spanning clip and leaves a gap', () => {
    const clips = [clip('a', 'v1', 0, 10), clip('b', 'v2', 0, 10)];
    const result = liftRange(clips, ['v1'], 2, 5, { makeId });
    assert.equal(result.changed, true);
    const v1 = result.clips.filter((c) => c.trackId === 'v1').sort((x, y) => x.start - y.start);
    assert.deepEqual(v1.map((c) => [c.start, c.end, c.sourceIn, c.sourceOut]), [[0, 2, 0, 2], [5, 10, 5, 10]]);
    assert.equal(v1[0].id, 'a');
    assert.equal(result.addedIds.length, 1);
    assert.equal(result.clips.find((c) => c.id === 'b')?.end, 10);
});

test('liftRange removes clips fully inside and trims edges', () => {
    const clips = [clip('a', 'v1', 0, 3), clip('b', 'v1', 3, 4), clip('c', 'v1', 4, 8)];
    const result = liftRange(clips, ['v1'], 2, 6, { makeId });
    assert.deepEqual(result.removedIds, ['b']);
    assert.deepEqual(result.clips.map((c) => [c.id, c.start, c.end, c.sourceIn]), [['a', 0, 2, 0], ['c', 6, 8, 2]]);
});

test('extractRange closes the gap on the affected tracks only', () => {
    const clips = [clip('a', 'v1', 0, 4), clip('b', 'v1', 6, 9), clip('c', 'a1', 6, 9)];
    const result = extractRange(clips, ['v1'], 4, 6, { makeId });
    assert.deepEqual(result.clips.map((c) => [c.id, c.start, c.end]), [['a', 0, 4], ['b', 4, 7], ['c', 6, 9]]);
    assert.equal(result.changed, true);
});

test('empty range is a no-op', () => {
    const clips = [clip('a', 'v1', 0, 4)];
    assert.equal(liftRange(clips, ['v1'], 2, 2, { makeId }).clips, clips);
    assert.equal(extractRange(clips, ['v1'], 5, 7, { makeId }).changed, false);
});

test('edit points and navigation', () => {
    const points = editPoints([clip('a', 'v1', 1, 3), clip('b', 'a1', 3, 5)]);
    assert.deepEqual(points, [0, 1, 3, 5]);
    assert.deepEqual(editPoints([clip('a', 'v1', 1, 3), clip('b', 'a1', 3, 5)], ['a1']), [0, 3, 5]);
    assert.equal(adjacentEditPoint(points, 3, 1), 5);
    assert.equal(adjacentEditPoint(points, 3, -1), 1);
    assert.equal(adjacentEditPoint(points, 5, 1), null);
});

test('per-track heights layout and hit testing', () => {
    const layout = trackRowLayout(['v1', 'a1', 'a2'], { a1: 100 }, 64, 6);
    assert.deepEqual(layout.tops, [0, 70, 176]);
    assert.equal(layout.total, 246);
    assert.equal(trackIndexAtY(layout, 69), 0);
    assert.equal(trackIndexAtY(layout, 70), 1);
    assert.equal(trackIndexAtY(layout, 500), -1);
    const grown = stepAllTrackHeights({ v1: TRACK_HEIGHT_MAX }, ['v1', 'a1'], 64, 1);
    assert.equal(grown.v1, TRACK_HEIGHT_MAX);
    assert.equal(grown.a1, 80);
});

test('linked partners: same media, same span, other track', () => {
    const v = { ...clip('v', 'v1', 1, 4), mediaId: 'm' };
    const a = { ...clip('a', 'a1', 1, 4), mediaId: 'm' };
    const other = { ...clip('o', 'a2', 2, 4), mediaId: 'm' };
    assert.deepEqual(linkedPartners([v, a, other], v).map((c) => c.id), ['a']);
});

test('rippleDeleteClip closes the gap on the same track only', async () => {
    const { rippleDeleteClip } = await import('./editOps.ts');
    const clips = [clip('a', 'v1', 0, 2), clip('b', 'v1', 2, 5), clip('c', 'v1', 5, 6), clip('d', 'a1', 5, 6)];
    const next = rippleDeleteClip(clips, 'b');
    assert.deepEqual(next.map((c) => [c.id, c.start, c.end]), [['a', 0, 2], ['c', 2, 3], ['d', 5, 6]]);
    assert.equal(rippleDeleteClip(clips, 'zz'), clips);
});
